/**
 * One turn of Ozi's conversation with the server (ruling 99, 10 November 2026).
 *
 * The words go to POST /ozi/talk with the basket and what is on the screen, and the answer
 * comes back as it is made: each sentence to be spoken at once, and each thing the app should
 * do on the phone (put this in the basket, open that page, begin the checkout) as the
 * conversation asks for it. `unavailable` means the model cannot answer just now, and the app
 * carries on with its older, hand-built parts, so nobody is ever left without an answer.
 */
import {
  BASE_URL,
  conversationId,
  oziHeaders,
  readEvents,
  type CatalogueItem,
  type OziAsker,
} from './api';
import { screenSnapshot } from './screen';

/** Something the conversation asks the app to do on the phone. */
export type TalkAction =
  | { type: 'basket_add'; items: Array<{ item: CatalogueItem; quantity: number }> }
  | { type: 'basket_set'; productId: string; quantity: number }
  | { type: 'checkout' }
  | { type: 'navigate'; path: string }
  | { type: 'repeat_last_order' }
  | { type: 'sign_in' }
  | { type: 'new_account' }
  | { type: 'mute' };

/** The basket as the app holds it, for the conversation to speak of and change. */
export interface TalkBasket {
  lines: Array<{ id: string; name: string; quantity: number; pricePence: number }>;
  goodsPence: number;
  feePence: number;
  totalPence: number;
}

export interface TalkHandlers {
  onSentence: (text: string) => void;
  onAction: (action: TalkAction) => void;
}

export interface Talked {
  reply: string;
  awaitingYes: boolean;
  /** The part of the reply not sent as sentences; '' when all of it was. */
  unsaid: string;
}

/** Said by the app itself when the server could not be reached at all. */
export const COULD_NOT_REACH =
  'I could not reach my assistant just now, so I have no answer for you, and I will not make one up. Nothing has been done or changed. Please check your connection and ask me again.';
const unreachable = (): Talked => {
  console.error('Ozi: the assistant could not be reached.');
  return { reply: COULD_NOT_REACH, awaitingYes: false, unsaid: COULD_NOT_REACH };
};

/** How long a whole turn may take before the app carries on without it. */
export const TALK_WAIT_MS = 45_000;

const ACTION_TYPES = new Set([
  'basket_add',
  'basket_set',
  'checkout',
  'navigate',
  'repeat_last_order',
  'sign_in',
  'new_account',
  'mute',
]);

/**
 * One turn. Resolves with the reply when the conversation answered, and with null when it could
 * not (no connection, an older server, the model away, or too slow with nothing yet said), so
 * the caller answers the older way. Never rejects.
 */
export async function talkToOzi(
  text: string,
  turn: number,
  as: OziAsker,
  basket: TalkBasket | null,
  handlers: TalkHandlers,
  waitMs: number = TALK_WAIT_MS,
): Promise<Talked | null> {
  if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') return null;
  const stop = new AbortController();
  let began = false;
  const timer = setTimeout(() => stop.abort(), waitMs);
  try {
    const screen = screenSnapshot();
    const response = await fetch(`${BASE_URL}/ozi/talk`, {
      method: 'POST',
      headers: { ...oziHeaders(as), accept: 'text/event-stream' },
      body: JSON.stringify({
        text,
        turn,
        conversation: conversationId(),
        ...(basket ? { basket } : {}),
        ...(screen ? { screen } : {}),
      }),
      signal: stop.signal,
    });
    // The server answered that it is in trouble: said plainly, never the older way in silence.
    if (response.status >= 500) return unreachable();
    if (!response.ok || !response.body) return null;
    if (!/text\/event-stream/i.test(response.headers.get('content-type') ?? '')) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const done = new Set<number>();
    let buffer = '';
    const act = (raw: unknown, n: number): void => {
      if (done.has(n)) return;
      const action = raw as TalkAction | null;
      if (!action || typeof action !== 'object' || !ACTION_TYPES.has(action.type)) return;
      done.add(n);
      began = true;
      handlers.onAction(action);
    };
    for (;;) {
      const { value, done: ended } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !ended });
      const read = readEvents(ended ? `${buffer}\n\n` : buffer);
      buffer = read.rest;
      for (const event of read.events) {
        if (event['type'] === 'sentence' && typeof event['text'] === 'string') {
          began = true;
          handlers.onSentence(event['text']);
        } else if (event['type'] === 'action') {
          act(event['action'], Number(event['n']));
        } else if (event['type'] === 'unavailable') {
          return null;
        } else if (event['type'] === 'error') {
          return began ? { reply: '', awaitingYes: false, unsaid: '' } : null;
        } else if (event['type'] === 'done') {
          // Anything the app has not yet done, in order (a stream that lost an event).
          const all = Array.isArray(event['actions']) ? (event['actions'] as unknown[]) : [];
          all.forEach((action, n) => act(action, n));
          const reply = typeof event['reply'] === 'string' ? event['reply'] : '';
          return {
            reply,
            awaitingYes: event['awaitingYes'] === true,
            unsaid: typeof event['unsaid'] === 'string' ? event['unsaid'] : began ? '' : reply,
          };
        }
      }
      if (ended) return began ? { reply: '', awaitingYes: false, unsaid: '' } : null;
    }
  } catch {
    // Cut off or too slow. What was already said and done stands; otherwise they are told
    // plainly that the assistant could not be reached (13 November 2026).
    return began ? { reply: '', awaitingYes: false, unsaid: '' } : unreachable();
  } finally {
    clearTimeout(timer);
  }
}
