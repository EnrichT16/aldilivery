/**
 * Ozi on the telephone, through Twilio (rulings 28 and 45): the pieces that are not about the
 * conversation itself.
 *
 * - Checking that a webhook really came from Twilio. Twilio signs every request with the
 *   account's Auth Token; anything unsigned or wrongly signed is refused, so nobody can pretend
 *   to be a caller and place an order.
 * - Writing what Ozi says (TwiML, Twilio's small language for calls), always in British English
 *   at a gentle pace.
 * - Keeping track of where a conversation has got to, in the web address of the next step,
 *   signed so it cannot be changed. Nothing about a call is kept in the database.
 * - Phoning someone back when a call is cut off.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Twilio's signature: HMAC-SHA1 of the full address followed by every field, sorted by name. */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** Whether `given` is Twilio's signature for any of the addresses the request may have had. */
export function signedByTwilio(
  authToken: string,
  urls: readonly string[],
  params: Record<string, string>,
  given: string | undefined,
): boolean {
  if (!given) return false;
  const actual = Buffer.from(given);
  return urls.some((url) => {
    const expected = Buffer.from(twilioSignature(authToken, url, params));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VOICE = 'voice="Polly.Amy" language="en-GB"';

export function say(text: string): string {
  return `<Say ${VOICE}>${escapeXml(text)}</Say>`;
}

/** Say something, then listen for an answer, which is sent to `action`. */
export function ask(text: string, action: string): string {
  return (
    '<Response>' +
    `<Gather input="speech" language="en-GB" speechTimeout="auto" actionOnEmptyResult="true" method="POST" action="${escapeXml(action)}">` +
    say(text) +
    '</Gather>' +
    '</Response>'
  );
}

/** Say something, and put the phone down. */
export function goodbye(text: string): string {
  return `<Response>${say(text)}<Hangup/></Response>`;
}

/* ------------------------------------------------------------------ the conversation */

export type Step = 'consent' | 'name' | 'offer' | 'items' | 'confirm';

export interface CallState {
  step: Step;
  /** The Shopper, once known by the number they rang from. */
  shopperId?: string;
  /** What is in the basket so far: catalogue id and quantity. */
  lines: Array<[string, number]>;
  /** How many times in a row nothing was heard. */
  quiet: number;
  /** They agreed we may ring them back if the call is cut off. */
  callBack: boolean;
  /** The name a caller with no account gave. */
  name?: string;
  /** Paying by a link texted to them, not a saved card (ruling 48). */
  link?: boolean;
  /** The total read back to them, which their yes agreed to. */
  agreedTotalPence?: number;
  /** When this stops being accepted, in seconds since 1970. */
  expiresAt: number;
}

const LABEL = 'phone-call-state:';

export function sealState(state: CallState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(LABEL + payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function openState(sealed: string, secret: string, now: Date): CallState | null {
  const [payload, signature] = sealed.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(LABEL + payload)
      .digest('base64url'),
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CallState;
    if (typeof state.expiresAt !== 'number' || state.expiresAt * 1000 < now.getTime()) return null;
    return state;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ ringing back */

export type PlaceCall = (to: string, url: string, statusCallback: string) => Promise<void>;

/** A call from our number to `to`, which fetches what to say from `url` when answered. */
export function twilioDialler(
  settings: { accountSid: string; authToken: string; from: string },
  fetchImpl: typeof fetch = fetch,
): PlaceCall {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(settings.accountSid)}/Calls.json`;
  const authorisation = `Basic ${Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString('base64')}`;
  return async (to, url, statusCallback) => {
    const form = new URLSearchParams({
      To: to,
      From: settings.from,
      Url: url,
      Method: 'POST',
      StatusCallback: statusCallback,
      StatusCallbackMethod: 'POST',
    });
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: authorisation,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!response.ok) throw new Error(`Twilio could not place the call: HTTP ${response.status}`);
  };
}
