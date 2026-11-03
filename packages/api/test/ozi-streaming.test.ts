/**
 * Smoother, faster Ozi (ruling 92, 3 November 2026): the model's answer is streamed and spoken a
 * sentence at a time, the owner is told once when his model looks something up, a refusal
 * mid-stream ends with the safe line, shopping is acted on only when the JSON is whole, the
 * route's streamed `done` event is the same JSON as the plain route, the timings are written to
 * Ozi's memory, and the health check sums up the felt delay.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { loadStoreConfig } from '@aldilivery/core/node';

import {
  instructions,
  languageModel,
  LOOKING_UP,
  OWNER_DECLINED,
  ownerInstructions,
  speakerWords,
  type BrainClient,
  type OwnerTools,
  type OziBrain,
} from '../src/lib/language-model.js';
import { FeltDelays, summarise } from '../src/lib/ozi-latency.js';
import { replySoFar, SentenceSplitter, splitSentences, unsaidPart } from '../src/lib/sentences.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

const config = loadStoreConfig();

/** One streamed answer: the text deltas, then the complete message. */
interface Scripted {
  deltas?: string[];
  toolUse?: Array<{ id: string; name: string; input: unknown }>;
  stop_reason?: string;
}

/**
 * A stand-in for the SDK's `messages.stream`: `on('text')` hears each delta, `on('streamEvent')`
 * hears a tool call start, and `finalMessage()` gives the whole message, in that order.
 */
function streamingClient(script: Scripted[], sent: Array<Record<string, unknown>> = []) {
  return {
    messages: {
      create: async () => {
        throw new Error('the real client streams');
      },
      stream: (body: Record<string, unknown>) => {
        sent.push(structuredClone(body));
        const step = script.shift() ?? {};
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        const stream = {
          on(event: string, listener: (...args: unknown[]) => void) {
            (listeners[event] ??= []).push(listener);
            return stream;
          },
          async finalMessage() {
            await new Promise((resolve) => setTimeout(resolve, 1));
            for (const use of step.toolUse ?? []) {
              for (const listener of listeners['streamEvent'] ?? []) {
                listener(
                  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } },
                  {},
                );
              }
              void use;
            }
            let snapshot = '';
            for (const delta of step.deltas ?? []) {
              snapshot += delta;
              for (const listener of listeners['text'] ?? []) listener(delta, snapshot);
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
            const content: unknown[] = [];
            if (snapshot !== '') content.push({ type: 'text', text: snapshot });
            for (const use of step.toolUse ?? []) content.push({ type: 'tool_use', ...use });
            return {
              stop_reason: step.stop_reason ?? (step.toolUse?.length ? 'tool_use' : 'end_turn'),
              content,
            };
          },
        };
        return stream;
      },
    },
  } as unknown as BrainClient;
}

const tools: OwnerTools = {
  needsYou: async () => ({ matters: [] }),
  todaySummary: async () => ({ ordersToday: 3 }),
  partnerApprovals: async () => ({}),
  readApplication: async () => ({}),
  listReminders: async () => ({ waiting: [] }),
  propose: async () => ({ ok: false, why: 'no' }),
  listStaff: async () => ({}),
  ambassadorPrizes: async () => ({}),
  ambassadorLink: async () => ({}),
  listEmails: async () => ({}),
  readEmail: async () => ({}),
  getAlertPreferences: async () => ({}),
  proposeAction: async () => ({ ok: false, why: 'no' }),
};

describe('sentences (ruling 92)', () => {
  it('splits on sentence ends, never after "Mr." or a decimal point', () => {
    expect(splitSentences('Good morning, Mr. Anthony. Two things need you. One is')).toEqual({
      complete: ['Good morning, Mr. Anthony.', 'Two things need you.'],
      rest: 'One is',
    });
    expect(splitSentences('Delivery is £5.99 today. Is that')).toEqual({
      complete: ['Delivery is £5.99 today.'],
      rest: 'Is that',
    });
    expect(splitSentences('No end yet')).toEqual({ complete: [], rest: 'No end yet' });
    const splitter = new SentenceSplitter();
    expect(splitter.push('Hello there')).toEqual([]);
    expect(splitter.push('. How are you? Fine')).toEqual(['Hello there.', 'How are you?']);
    expect(splitter.flush()).toEqual(['Fine']);
  });

  it('reads "kind" and "reply" out of JSON that is still arriving, escapes included', () => {
    expect(replySoFar('{"kind":"question","items":[],"re')).toEqual({
      kind: 'question',
      reply: null,
      replyClosed: false,
    });
    expect(replySoFar('{"kind":"question","items":[],"reply":"It\\u2019s £5. Say \\"yes')).toEqual(
      { kind: 'question', reply: 'It’s £5. Say "yes', replyClosed: false },
    );
    expect(replySoFar('{"kind":"chatter","items":[],"reply":"Hello.\\nBye."}')).toEqual({
      kind: 'chatter',
      reply: 'Hello.\nBye.',
      replyClosed: true,
    });
    expect(replySoFar('{"kind":"items","items":[],"reply":null}').reply).toBeNull();
  });

  it('knows what is left to say', () => {
    expect(unsaidPart('One. Two. Three.', ['One.', 'Two.'])).toBe('Three.');
    expect(unsaidPart('One. Two.', ['One.', 'Two.'])).toBe('');
    expect(unsaidPart('Something else entirely.', ['One.'])).toBe('Something else entirely.');
    expect(unsaidPart('Whole reply.', [])).toBe('Whole reply.');
  });
});

describe('the everyday model, streamed (ruling 92)', () => {
  it('speaks each sentence of the reply as it completes, in order, through safeSpoken', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const brain = languageModel(
      { apiKey: 'test', config },
      streamingClient(
        [
          {
            deltas: [
              '{"kind":"ques',
              'tion","items":[],"reply":"Delivery is £10.99 for a small shop. ',
              'Call 07700 900123 for more. It depends on the plan',
              '."}',
            ],
          },
        ],
        sent,
      ),
    );
    const heard: string[] = [];
    const understood = await brain.understand({
      text: 'how much is delivery',
      account: 'shopper',
      channel: 'app',
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(heard).toEqual([
      'Delivery is £10.99 for a small shop.',
      "Call a number I won't read out for more.",
      'It depends on the plan.',
    ]);
    expect(understood?.kind).toBe('question');
    expect(understood?.reply).toBe(
      "Delivery is £10.99 for a small shop. Call a number I won't read out for more. It depends on the plan.",
    );
    // The request kept its shape: effort low, cached instructions, the JSON schema.
    expect(sent[0]!['output_config']).toMatchObject({ effort: 'low' });
    expect((sent[0]!['system'] as Array<{ cache_control: unknown }>)[0]!.cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(sent[0]).not.toHaveProperty('thinking');
  });

  it('never speaks shopping early: an "items" reply waits for the whole JSON', async () => {
    const brain = languageModel(
      { apiKey: 'test', config },
      streamingClient([
        {
          deltas: [
            '{"kind":"items","items":[{"name":"milk","quantity":2,"brand":null,"detail":null}],',
            '"reply":"Two milk. Anything else?"}',
          ],
        },
      ]),
    );
    const heard: string[] = [];
    const understood = await brain.understand({
      text: 'two milk',
      account: 'shopper',
      channel: 'app',
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(heard).toEqual([]);
    expect(understood?.items).toEqual([{ name: 'milk', quantity: 2, brand: null, detail: null }]);
  });

  it('a refusal mid-stream is absent, as before, and a stand-in with only create still works', async () => {
    const refused = languageModel(
      { apiKey: 'test', config },
      streamingClient([{ deltas: ['{"kind":"question","items":[],"reply":"Half a sen'], stop_reason: 'refusal' }]),
    );
    expect(await refused.understand({ text: 'x', account: 'shopper', channel: 'app' })).toBeNull();
    const plain = languageModel({ apiKey: 'test', config }, {
      messages: {
        create: async () => ({
          stop_reason: 'end_turn',
          content: [
            { type: 'text', text: '{"kind":"chatter","items":[],"reply":"Hello there."}' },
          ],
        }),
      },
    } as unknown as BrainClient);
    const heard: string[] = [];
    const understood = await plain.understand({
      text: 'hi',
      account: 'shopper',
      channel: 'app',
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(understood?.reply).toBe('Hello there.');
    expect(heard).toEqual([]);
  });
});

describe("the owner's model, streamed (ruling 92)", () => {
  it('tells him once that it is looking something up, then speaks the answer a sentence at a time', async () => {
    const brain = languageModel(
      { apiKey: 'test', config },
      streamingClient([
        { toolUse: [{ id: 't1', name: 'today_summary', input: {} }] },
        { toolUse: [{ id: 't2', name: 'needs_you', input: {} }] },
        { deltas: ['Three orders so far today. ', 'Nothing needs you', ' right now.'] },
      ]),
    );
    const heard: string[] = [];
    const statuses: string[] = [];
    const talk = await brain.talkWithOwner!({
      text: 'how is today going',
      channel: 'app',
      history: [],
      tools,
      onSentence: (sentence) => heard.push(sentence),
      onStatus: (text) => statuses.push(text),
    });
    expect(statuses).toEqual([LOOKING_UP]);
    expect(heard).toEqual(['Three orders so far today.', 'Nothing needs you right now.']);
    expect(talk).toEqual({
      reply: 'Three orders so far today. Nothing needs you right now.',
      proposal: null,
    });
  });

  it('a refusal mid-stream ends with the safe line, with no status and no half sentence', async () => {
    const brain = languageModel(
      { apiKey: 'test', config },
      streamingClient([{ deltas: ['Well, the thing is'], stop_reason: 'refusal' }]),
    );
    const heard: string[] = [];
    const statuses: string[] = [];
    const talk = await brain.talkWithOwner!({
      text: 'x',
      channel: 'app',
      history: [],
      tools,
      onSentence: (sentence) => heard.push(sentence),
      onStatus: (text) => statuses.push(text),
    });
    expect(talk).toEqual({ reply: OWNER_DECLINED, proposal: null });
    expect(heard).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it('his name is asked for naturally and sparingly, never forced at the start of every reply', () => {
    const owner = ownerInstructions(config, '');
    expect(owner).toMatch(/naturally and sparingly/);
    expect(owner).toMatch(/Never open every reply with his name/);
    expect(owner).not.toMatch(/Always address him as/);
    expect(speakerWords(config, { kind: 'owner', firstName: null })).toMatch(
      /not the start of every reply/,
    );
    // The same for Shoppers' first names.
    expect(instructions(config)).toMatch(/never the opening word of every reply/);
  });
});

/* ------------------------------------------------------------------ the route */

let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

/** Reads the events out of a server-sent events body. */
function events(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as Record<string, unknown>);
}

/** A stand-in brain whose everyday model streams its reply sentence by sentence. */
function streamingBrain(): OziBrain {
  return {
    name: 'model',
    model: 'stand-in-everyday',
    ownerModel: 'stand-in-owner',
    async understand(input) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      input.onSentence?.('Delivery starts at ten ninety-nine.');
      await new Promise((resolve) => setTimeout(resolve, 5));
      input.onSentence?.('Members pay less.');
      return {
        kind: 'question',
        items: [],
        reply: 'Delivery starts at ten ninety-nine. Members pay less. Shall I say more?',
      };
    },
    async talkWithOwner(input) {
      input.onStatus?.(LOOKING_UP);
      await new Promise((resolve) => setTimeout(resolve, 5));
      input.onSentence?.('Three orders so far today.');
      return { reply: 'Three orders so far today.', proposal: null };
    },
  };
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const post = (url: string, payload: object) =>
    harness.app.inject({ method: 'POST', url, payload, headers: STAFF });
  await post('/staff/owner', {
    name: 'Anthony',
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  return { 'x-staff-token': signedIn.json().token as string };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('POST /ozi/reply, streamed (ruling 92)', () => {
  it('sends each sentence, then done with the same JSON as the plain route and what is left to say', async () => {
    harness = await buildTestApp(new Date('2026-11-03T10:00:00.000Z'), {
      brain: streamingBrain(),
      sendText: async () => undefined,
    });
    const payload = {
      text: 'Ozi, what would a shop for a party of twelve cost me to have delivered?',
      mode: 'within',
      turn: 0,
      conversation: 'v1',
    };
    const plain = await harness.app.inject({ method: 'POST', url: '/ozi/reply', payload });
    const streamed = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload,
      headers: { accept: 'text/event-stream' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toMatch(/text\/event-stream/);
    const got = events(streamed.body);
    expect(got.map((event) => event['type'])).toEqual(['sentence', 'sentence', 'done']);
    expect(got[0]!['text']).toBe('Delivery starts at ten ninety-nine.');
    expect(got[1]!['text']).toBe('Members pay less.');
    const done = got[2]!;
    const { unsaid, ...sameJson } = done;
    delete (sameJson as Record<string, unknown>)['type'];
    expect(sameJson).toEqual(plain.json());
    expect(unsaid).toBe('Shall I say more?');
    // The body flag asks for the same.
    const flagged = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload: { ...payload, stream: true },
    });
    expect(events(flagged.body).at(-1)?.['type']).toBe('done');
  });

  it("the owner hears one status while his model looks, and the timings go into Ozi's memory", async () => {
    harness = await buildTestApp(new Date('2026-11-03T10:00:00.000Z'), {
      brain: streamingBrain(),
      sendText: async () => undefined,
    });
    const headers = { ...(await ownerHeaders()), accept: 'text/event-stream' };
    const streamed = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      headers,
      payload: { text: 'How is today going?', mode: 'within', turn: 4, conversation: 'owner-1' },
    });
    const got = events(streamed.body);
    expect(got.map((event) => event['type'])).toEqual(['status', 'sentence', 'done']);
    expect(got[0]!['text']).toBe(LOOKING_UP);
    expect(got[2]).toMatchObject({ reply: 'Three orders so far today.', unsaid: '' });
    await settle();
    const [row] = await harness.repository.memory.list({ limit: 1 });
    expect(row).toMatchObject({ accountKind: 'owner', brain: 'model', turn: 4 });
    expect(row!.modelMs).toBeGreaterThanOrEqual(0);
    expect(row!.firstWordMs).toBeGreaterThanOrEqual(0);
    expect(row!.totalMs).toBeGreaterThanOrEqual(row!.firstWordMs!);
    expect(row!.feltMs).toBeNull();

    // The app reports the delay he felt; it lands on that exchange, and in the summaries.
    const felt = await harness.app.inject({
      method: 'POST',
      url: '/ozi/felt',
      headers,
      payload: { conversation: 'owner-1', turn: 4, feltMs: 1800 },
    });
    expect(felt.statusCode).toBe(200);
    const [after] = await harness.repository.memory.list({ limit: 1 });
    expect(after!.feltMs).toBe(1800);
    const memory = await harness.app.inject({ method: 'GET', url: '/staff/memory', headers: STAFF });
    expect(memory.json().latency).toEqual({
      everyone: { medianFeltMs: 1800, p90FeltMs: 1800, exchanges: 1 },
      owner: { medianFeltMs: 1800, p90FeltMs: 1800, exchanges: 1 },
    });
    expect(memory.json().exchanges[0]).toMatchObject({ feltMs: 1800 });
    const health = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(health.json().brain.latency24h).toEqual({
      medianFeltMs: 1800,
      p90FeltMs: 1800,
      exchanges: 1,
    });
  });

  it('the health summary is null with nothing reported, and the percentiles are right', async () => {
    harness = await buildTestApp(new Date('2026-11-03T10:00:00.000Z'), { brain: streamingBrain() });
    const health = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(health.json().brain.latency24h).toBeNull();
    expect(summarise([])).toBeNull();
    expect(summarise([900, 1500, 1200, 3000, 800, 1100, 1300, 1000, 1400, 7000])).toEqual({
      medianFeltMs: 1200,
      p90FeltMs: 3000,
      exchanges: 10,
    });
    const delays = new FeltDelays();
    delays.record(500, new Date('2026-11-02T09:00:00.000Z'));
    delays.record(1500, new Date('2026-11-03T09:00:00.000Z'));
    expect(delays.last24h(new Date('2026-11-03T10:00:00.000Z'))).toEqual({
      medianFeltMs: 1500,
      p90FeltMs: 1500,
      exchanges: 1,
    });
  });
});
