/**
 * Joining a LiveKit room for an in-app call (docs/BUILD_PROMPT.md, Section F).
 *
 * LiveKit's library is large, so it is loaded only when a call starts. The microphone is the
 * only thing sent; the other people's voices are played as they arrive. Nobody's telephone
 * number is involved: the pass from our server is the whole of what joins the call.
 */

import type { CallJoin } from './api';

export interface CallConnection {
  setMuted(muted: boolean): Promise<void>;
  leave(): Promise<void>;
}

export interface CallEvents {
  /** How many other people are on the call now. */
  onOthersChanged(count: number): void;
  onDisconnected(): void;
}

export async function connectToCall(join: CallJoin, events: CallEvents): Promise<CallConnection> {
  const { Room, RoomEvent, Track } = await import('livekit-client');
  const room = new Room({ adaptiveStream: true });
  const players: HTMLMediaElement[] = [];

  const countOthers = (): void => events.onOthersChanged(room.remoteParticipants.size);
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) {
      const element = track.attach();
      element.setAttribute('aria-hidden', 'true');
      document.body.appendChild(element);
      players.push(element);
    }
  });
  room.on(RoomEvent.ParticipantConnected, countOthers);
  room.on(RoomEvent.ParticipantDisconnected, countOthers);
  room.on(RoomEvent.Disconnected, () => {
    players.forEach((element) => element.remove());
    events.onDisconnected();
  });

  await room.connect(join.url, join.token);
  await room.localParticipant.setMicrophoneEnabled(true);
  countOthers();

  return {
    async setMuted(muted) {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    },
    async leave() {
      await room.disconnect();
    },
  };
}
