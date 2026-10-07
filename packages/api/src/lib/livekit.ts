/**
 * LiveKit, which carries the in-app calls (docs/BUILD_PROMPT.md, Section F).
 *
 * Everything the server needs from it is behind `CallProvider`, so the routes and the tests
 * never touch LiveKit directly:
 *
 * - a short-lived pass into one room, for one identity of ours (never a phone number);
 * - checking that a webhook really came from LiveKit, because minutes are billed from it;
 * - closing a room when somebody ends the call for everyone.
 *
 * Without the three settings (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) there is no
 * provider, and the call routes say plainly that calls are not switched on yet.
 */

import { AccessToken, RoomServiceClient, SipClient, WebhookReceiver } from 'livekit-server-sdk';

export interface CallWebhookEvent {
  /** LiveKit's own id for the event, for ignoring a repeat. */
  id: string;
  /** `participant_joined`, `participant_left`, `room_finished`, and others we ignore. */
  event: string;
  roomName: string | null;
  identity: string | null;
  at: Date;
}

export interface CallProvider {
  /** The address the app connects to, `wss://…`. Public. */
  readonly url: string;
  issueToken(input: {
    roomName: string;
    identity: string;
    name: string;
    ttlSeconds: number;
  }): Promise<string>;
  /** Throws when the signature does not check out. */
  verifyWebhook(body: string, authorization: string | undefined): Promise<CallWebhookEvent>;
  endRoom(roomName: string): Promise<void>;
  /**
   * Rings a telephone into the room, through the SIP trunk to our Twilio number (ruling 46).
   * The number never appears to anyone in the room. Absent without LIVEKIT_SIP_TRUNK_ID.
   */
  dialPhone?(input: {
    roomName: string;
    phone: string;
    identity: string;
    name: string;
  }): Promise<void>;
}

export function livekitProvider(settings: {
  url: string;
  apiKey: string;
  apiSecret: string;
  /** LiveKit's id for the outbound trunk to Twilio, `ST_…`, for ringing telephones. */
  sipTrunkId?: string | undefined;
}): CallProvider {
  const receiver = new WebhookReceiver(settings.apiKey, settings.apiSecret);
  // The room service speaks https to the same host the app reaches over wss.
  const rooms = new RoomServiceClient(
    settings.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'),
    settings.apiKey,
    settings.apiSecret,
  );

  const host = settings.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  const sip = settings.sipTrunkId ? new SipClient(host, settings.apiKey, settings.apiSecret) : null;

  const provider: CallProvider = {
    url: settings.url,

    async issueToken({ roomName, identity, name, ttlSeconds }) {
      const token = new AccessToken(settings.apiKey, settings.apiSecret, {
        identity,
        name,
        ttl: ttlSeconds,
      });
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        // Nobody can rename themselves or change what the room says about them.
        canUpdateOwnMetadata: false,
      });
      return token.toJwt();
    },

    async verifyWebhook(body, authorization) {
      const event = await receiver.receive(body, authorization);
      return {
        id: event.id,
        event: event.event,
        roomName: event.room?.name ?? null,
        identity: event.participant?.identity ?? null,
        at: new Date(Number(event.createdAt) * 1000),
      };
    },

    async endRoom(roomName) {
      await rooms.deleteRoom(roomName);
    },
  };

  if (sip && settings.sipTrunkId) {
    const trunk = settings.sipTrunkId;
    provider.dialPhone = async ({ roomName, phone, identity, name }) => {
      await sip.createSipParticipant(trunk, phone, roomName, {
        participantIdentity: identity,
        participantName: name,
        // Nobody in the room is told the number.
        hidePhoneNumber: true,
        playDialtone: true,
        ringingTimeout: 40,
      });
    };
  }
  return provider;
}
