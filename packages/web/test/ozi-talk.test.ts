/**
 * The app's side of Ozi's conversation (ruling 99, 10 November 2026): the reply is taken a
 * sentence at a time, what the conversation asks the app to do is done once each, and when the
 * model cannot answer the caller is told so, to answer the older way. And the phone's most
 * natural voice is the one Ozi uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { talkToOzi, type TalkAction } from '../src/lib/ozi-talk';
import { bestVoice, voiceQuality } from '../src/voice/browser-engine';

function streamOf(events: Array<Record<string, unknown>>): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const half = Math.floor(bytes.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // In two pieces, cut anywhere, as a network delivers them.
      controller.enqueue(bytes.slice(0, half));
      controller.enqueue(bytes.slice(half));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const milk = { id: 'm1', name: 'Milk', category: 'dairy', estimatedPricePence: 130 };

afterEach(() => vi.unstubAllGlobals());

describe('one turn of the conversation, on the phone', () => {
  it('hands on each sentence and each action once, and gives the end', async () => {
    const add: TalkAction = { type: 'basket_add', items: [{ item: milk, quantity: 2 }] };
    const fetched = vi.fn(async () =>
      streamOf([
        { type: 'sentence', text: 'Let me have a look.' },
        { type: 'action', n: 0, action: add },
        { type: 'sentence', text: 'Two pints of milk are in your basket.' },
        // The end repeats every action; one the stream lost is done now, the rest never twice.
        {
          type: 'done',
          reply: 'Let me have a look. Two pints of milk are in your basket.',
          awaitingYes: false,
          unsaid: '',
          actions: [add, { type: 'navigate', path: '/basket' }],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetched);
    const sentences: string[] = [];
    const actions: TalkAction[] = [];
    const basket = { lines: [], goodsPence: 0, feePence: 0, totalPence: 0 };
    const answer = await talkToOzi('some milk', 3, { kind: 'shopper' }, basket, {
      onSentence: (text) => sentences.push(text),
      onAction: (action) => actions.push(action),
    });
    expect(sentences).toEqual(['Let me have a look.', 'Two pints of milk are in your basket.']);
    expect(actions).toEqual([add, { type: 'navigate', path: '/basket' }]);
    expect(answer).toMatchObject({ awaitingYes: false, unsaid: '' });
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/ozi\/talk$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'some milk', turn: 3, basket });
  });

  it('is null when the model cannot answer, the server is older, or nothing can be reached', async () => {
    const handlers = { onSentence: () => undefined, onAction: () => undefined };
    vi.stubGlobal('fetch', async () => streamOf([{ type: 'unavailable' }]));
    expect(await talkToOzi('hello', 0, { kind: 'shopper' }, null, handlers)).toBeNull();
    vi.stubGlobal('fetch', async () => new Response('Not found', { status: 404 }));
    expect(await talkToOzi('hello', 0, { kind: 'shopper' }, null, handlers)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await talkToOzi('hello', 0, { kind: 'shopper' }, null, handlers)).toBeNull();
  });

  it('keeps what was already said when the stream is cut off, and ignores an action it does not know', async () => {
    vi.stubGlobal('fetch', async () =>
      streamOf([
        { type: 'sentence', text: 'Good morning.' },
        { type: 'action', n: 0, action: { type: 'format_the_phone' } },
      ]),
    );
    const actions: TalkAction[] = [];
    const answer = await talkToOzi('hello', 0, { kind: 'shopper' }, null, {
      onSentence: () => undefined,
      onAction: (action) => actions.push(action),
    });
    expect(answer).toEqual({ reply: '', awaitingYes: false, unsaid: '' });
    expect(actions).toEqual([]);
  });
});

describe("the phone's most natural voice", () => {
  const voice = (name: string, lang: string, isDefault = false) => ({
    name,
    voiceURI: name,
    lang,
    default: isDefault,
  });

  it('prefers a natural or enhanced British voice to the default, and never a novelty voice', () => {
    const voices = [
      voice('Daniel', 'en-GB', true),
      voice('Zarvox', 'en-US'),
      voice('Samantha (Enhanced)', 'en-US'),
      voice('Kate (Enhanced)', 'en-GB'),
      voice('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB'),
      voice('Amélie', 'fr-FR'),
    ];
    expect(bestVoice(voices, 'en-GB')?.name).toMatch(/Sonia/);
    expect(bestVoice(voices.slice(0, 4), 'en-GB')?.name).toBe('Kate (Enhanced)');
    expect(
      bestVoice(
        [
          voice('Google UK English Female', 'en-GB'),
          voice('English United Kingdom', 'en_GB', true),
        ],
        'en-GB',
      )?.name,
    ).toMatch(/Google/);
    // The accent asked for comes before a finer voice in another accent.
    expect(
      bestVoice([voice('Daniel', 'en-GB'), voice('Samantha (Premium)', 'en-US')], 'en-GB')?.name,
    ).toBe('Daniel');
    expect(voiceQuality(voice('Zarvox', 'en-US'))).toBeLessThan(0);
    expect(bestVoice([voice('Amélie', 'fr-FR')], 'en-GB')).toBeUndefined();
  });
});
