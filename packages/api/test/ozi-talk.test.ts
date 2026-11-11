/**
 * Ozi as a real conversation for everybody (ruling 99, 10 November 2026): the model answers in
 * its own words with tools that act; the app is told what to do on the phone; nothing is sent
 * or set without a yes; a model that cannot answer hands back to the older parts; no schema
 * sent to the provider carries a constraint it refuses; and the health check shows whether the
 * model is really answering.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { loadStoreConfig } from '@aldilivery/core/node';

import * as modelModule from '../src/lib/language-model.js';
import {
  languageModel,
  modelHealth,
  ownerInstructions,
  OWNER_TOOLS,
  type BrainClient,
} from '../src/lib/language-model.js';
import { pagePath, spokenSentence, talkInstructions, talkToolsFor } from '../src/lib/ozi-talk.js';
import { buildTestApp, seedCatalogue, signUpShopper, STAFF, type TestHarness } from './helpers.js';

const config = loadStoreConfig();

interface Scripted {
  deltas?: string[];
  toolUse?: Array<{ id: string; name: string; input: unknown }>;
  stop_reason?: string;
  fail?: Error & { status?: number };
}

/** A stand-in for the SDK's `messages.stream`, as test/ozi-streaming.test.ts has it. */
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
            if (step.fail) throw step.fail;
            let snapshot = '';
            for (const delta of step.deltas ?? []) {
              snapshot += delta;
              for (const listener of listeners['text'] ?? []) listener(delta, snapshot);
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

function brainWith(script: Scripted[], sent: Array<Record<string, unknown>> = []) {
  return languageModel(
    { apiKey: 'test-key', config, knowledge: '' },
    streamingClient(script, sent),
  );
}

/** The events of a streamed turn, in order. */
function eventsOf(body: string): Array<Record<string, unknown>> {
  return body
    .split(/\n\n/)
    .map((part) => part.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

describe('what is sent to the model', () => {
  it('carries no schema constraint the provider refuses, in any tool or answer shape', () => {
    // A request with `minimum`, `maximum`, `minLength` or the like in a strict schema is
    // refused outright with a 400. That is how every turn but the owner's failed in silence.
    const refused =
      /"(minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minLength|maxLength|minItems|maxItems|pattern)":/;
    const kinds = ['shopper', 'visitor', 'runner', 'partner', 'organisation', 'staff'] as const;
    for (const kind of kinds) {
      for (const tool of talkToolsFor(kind)) {
        expect(JSON.stringify(tool.input_schema), tool.name).not.toMatch(refused);
        expect(tool.strict, tool.name).toBe(true);
        expect((tool.input_schema as { additionalProperties?: unknown }).additionalProperties).toBe(
          false,
        );
      }
    }
    for (const tool of OWNER_TOOLS) {
      expect(JSON.stringify(tool.input_schema), tool.name).not.toMatch(refused);
    }
    // Every answer shape the model module sends, read from the requests themselves.
    const sent: Array<Record<string, unknown>> = [];
    const brain = languageModel({ apiKey: 'k', config, knowledge: '' }, {
      messages: {
        create: async (body: Record<string, unknown>) => {
          sent.push(structuredClone(body));
          throw new Error('not answered');
        },
      },
    } as unknown as BrainClient);
    const photo = { mediaType: 'image/jpeg', base64: 'AAAA' } as never;
    return Promise.all([
      brain.understand({ text: 'two pints of milk', account: 'shopper', channel: 'app' } as never),
      brain.estimate?.('saffron'),
      brain.readReceipt?.(photo, ['milk']),
      brain.readLabel?.(photo),
    ]).then(() => {
      expect(sent.length).toBeGreaterThanOrEqual(3);
      for (const body of sent) {
        expect(JSON.stringify(body['output_config'] ?? {})).not.toMatch(refused);
        // Nor a list of choices on a type given as a pair, which the live service refused with
        // "Enum value 'none' does not match declared type" (10 November 2026).
        expect(JSON.stringify(body['output_config'] ?? {})).not.toMatch(
          /"type":\[[^\]]*\],"enum"|"enum":\[[^\]]*\],"type":\[/,
        );
        // Never a thinking setting, a sampling setting or a forced tool on these models.
        expect(body).not.toHaveProperty('thinking');
        expect(body).not.toHaveProperty('temperature');
      }
    });
  });

  it('shopping tools only for a Shopper or a visitor; pages only their own', () => {
    const names = (kind: Parameters<typeof talkToolsFor>[0]) =>
      talkToolsFor(kind).map((t) => t.name);
    expect(names('shopper')).toEqual(
      expect.arrayContaining([
        'search_shop',
        'add_to_basket',
        'change_basket',
        'start_checkout',
        'my_orders',
        'open_page',
        'set_reminder',
      ]),
    );
    expect(names('visitor')).toEqual(
      expect.arrayContaining(['start_sign_in', 'start_new_account']),
    );
    expect(names('visitor')).not.toContain('set_reminder');
    for (const kind of ['runner', 'partner', 'organisation', 'staff'] as const) {
      expect(names(kind)).not.toContain('add_to_basket');
      expect(names(kind)).not.toContain('start_checkout');
    }
    expect(pagePath('shopper', 'basket')).toBe('/basket');
    expect(pagePath('runner', 'basket')).toBeNull();
    expect(pagePath('runner', 'runner_home')).toBe('/runner/home');
  });

  it('the standing instructions ask for a real conversation, and never name a maker', () => {
    const text = talkInstructions(config, 'KNOWLEDGE');
    expect(text).toContain('KNOWLEDGE');
    expect(text).toMatch(/There is no script/);
    expect(text).toMatch(/start_checkout/);
    expect(text).not.toMatch(/under 60 words/);
    expect(text).not.toMatch(/\b(claude|anthropic|opus|sonnet|fable)\b/i);
  });

  it('never says a maker, hands insurance to customer service, and reads no long number', () => {
    expect(spokenSentence('I was made by Anthropic.', config)).toMatch(/own assistant/);
    expect(spokenSentence('This is the Sonnet model speaking.', config)).toMatch(/own assistant/);
    expect(spokenSentence('Your Runner is insured.', config)).toMatch(/customer service/);
    expect(spokenSentence('Ring 07700 900123 now.', config)).not.toMatch(/\d{5}/);
    const long = `${'A lovely slow-cooked stew. '.repeat(60)}`.trim();
    expect(spokenSentence(long, config)).toBe(long);
    expect(spokenSentence('Here is a haiku about rain.', config)).toBe(
      'Here is a haiku about rain.',
    );
  });
});

describe('one turn of the conversation', () => {
  it('speaks as the words arrive, uses a tool, and answers from what it found', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const brain = brainWith(
      [
        {
          deltas: ['Let me ', 'have a look. '],
          toolUse: [{ id: 't1', name: 'search_shop', input: { query: 'milk' } }],
        },
        { deltas: ["I've put two pints of semi skimmed in. ", 'Anything else?'] },
      ],
      sent,
    );
    const heard: string[] = [];
    const ran: Array<{ name: string; input: unknown }> = [];
    const outcome = await brain.talk!({
      text: 'can I have some milk',
      who: { kind: 'shopper', firstName: 'Ada' },
      channel: 'app',
      history: [{ heard: 'hello', said: 'Good morning, Ada.' }],
      basket: 'Their basket is empty.',
      run: async (name, input) => {
        ran.push({ name, input });
        return { result: { found: 1 } };
      },
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(heard).toEqual([
      'Let me have a look.',
      "I've put two pints of semi skimmed in.",
      'Anything else?',
    ]);
    expect(outcome).toEqual({ reply: heard.join(' '), awaitingYes: false });
    expect(ran).toEqual([{ name: 'search_shop', input: { query: 'milk' } }]);

    const first = sent[0]!;
    expect(first['model']).toBe('claude-sonnet-5-5');
    expect(first['tool_choice']).toEqual({ type: 'auto' });
    expect(first['output_config']).toEqual({ effort: 'low' });
    expect(first).not.toHaveProperty('thinking');
    expect(first).not.toHaveProperty('temperature');
    // Earlier turns go back as real turns; this moment goes in the last user turn.
    const messages = first['messages'] as Array<{ role: string; content: unknown }>;
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(String(messages[2]!.content)).toMatch(/signed-in Shopper called Ada/);
    expect(String(messages[2]!.content)).toMatch(/Their basket is empty/);
    expect(String(messages[2]!.content)).toMatch(/can I have some milk/);
    // The tools' answers go back in one user turn, after the model's own turn, untouched.
    const second = sent[1]!['messages'] as Array<{ role: string; content: unknown }>;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(JSON.stringify(second[4]!.content)).toMatch(/tool_result/);
    expect(sent[1]!['output_config']).toEqual({ effort: 'medium' });
  });

  it("ends on the server's exact read-back and waits for a yes", async () => {
    const brain = brainWith([
      {
        toolUse: [
          {
            id: 't1',
            name: 'set_reminder',
            input: { text: 'call the bank', when: 'tomorrow at 10', repeat: 'none', channel: null },
          },
        ],
      },
    ]);
    const outcome = await brain.talk!({
      text: 'remind me tomorrow at ten to call the bank',
      who: { kind: 'shopper', firstName: null },
      channel: 'app',
      history: [],
      basket: '',
      run: async () => ({
        result: { ok: true },
        readBack: 'A reminder tomorrow at 10 in the morning: call the bank. Shall I set it?',
      }),
    });
    expect(outcome).toEqual({
      reply: 'A reminder tomorrow at 10 in the morning: call the bank. Shall I set it?',
      awaitingYes: true,
    });
  });

  it('a tool that fails is told to the model, and the turn carries on', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const brain = brainWith(
      [
        { toolUse: [{ id: 't1', name: 'my_orders', input: {} }] },
        { deltas: ["I couldn't check just now, I'm sorry."] },
      ],
      sent,
    );
    const outcome = await brain.talk!({
      text: 'where is my order',
      who: { kind: 'shopper', firstName: null },
      channel: 'app',
      history: [],
      basket: '',
      run: async () => {
        throw new Error('the database is away');
      },
    });
    expect(outcome?.reply).toBe("I couldn't check just now, I'm sorry.");
    expect(JSON.stringify(sent[1]!['messages'])).toMatch(/"is_error":true/);
  });

  it('gives null when the model cannot answer, and the health record says why', async () => {
    const refused = Object.assign(
      new Error('output_config.format.schema: minimum is not supported'),
      { status: 400 },
    );
    const before = modelHealth();
    const brain = brainWith([{ fail: refused }]);
    const outcome = await brain.talk!({
      text: 'hello',
      who: { kind: 'visitor', firstName: null },
      channel: 'app',
      history: [],
      basket: '',
      run: async () => ({ result: {} }),
    });
    expect(outcome).toBeNull();
    const after = modelHealth();
    expect(after.failed).toBe(before.failed + 1);
    expect(after.lastError).toMatchObject({
      status: 400,
      kind: 'refused-request',
      where: 'claude-sonnet-5-5',
    });
    expect(after.lastError?.detail).toMatch(/minimum is not supported/);

    const fine = brainWith([{ deltas: ['Hello there.'] }]);
    await fine.talk!({
      text: 'hello',
      who: { kind: 'visitor', firstName: null },
      channel: 'app',
      history: [],
      basket: '',
      run: async () => ({ result: {} }),
    });
    expect(modelHealth().ok).toBe(after.ok + 1);
    expect(modelHealth().lastOkAt).not.toBeNull();
    // A key, a credit or a rate problem is named by kind, never with the provider's words.
    modelModule.noteModelFailure(
      'x',
      Object.assign(new Error('invalid x-api-key sk-secret'), { status: 401 }),
    );
    expect(modelHealth().lastError).toMatchObject({ kind: 'key', detail: null });
  });

  it('a refusal is said kindly, and nothing is done', async () => {
    const brain = brainWith([{ stop_reason: 'refusal' }]);
    const outcome = await brain.talk!({
      text: 'x',
      who: { kind: 'shopper', firstName: null },
      channel: 'app',
      history: [],
      basket: '',
      run: async () => ({ result: {} }),
    });
    expect(outcome?.reply).toMatch(/can't help with that one/);
  });
});

describe('POST /ozi/talk', () => {
  let harness: TestHarness;
  afterEach(async () => {
    await harness?.app.close();
  });

  it('a Shopper asks for milk: it is found, put in the basket on the phone, and said', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const script: Scripted[] = [];
    harness = await buildTestApp(undefined, { brain: brainWith(script, sent) });
    const ids = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);
    script.push(
      {
        deltas: ['Let me have a look. '],
        toolUse: [{ id: 't1', name: 'search_shop', input: { query: 'milk' } }],
      },
      {
        toolUse: [
          {
            id: 't2',
            name: 'add_to_basket',
            input: {
              items: [
                { product_id: ids.milk, quantity: 2 },
                { product_id: ids.wine, quantity: 1 },
                { product_id: 'nope', quantity: 1 },
              ],
            },
          },
        ],
      },
      {
        deltas: [
          "That's two lots of semi skimmed milk in your basket. ",
          'What else would you like?',
        ],
      },
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers: shopper.authHeader,
      payload: {
        text: 'two milks please',
        turn: 0,
        conversation: 'c1',
        basket: { lines: [], goodsPence: 0, feePence: 0, totalPence: 0 },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    const events = eventsOf(response.body);
    expect(events.filter((e) => e['type'] === 'sentence').map((e) => e['text'])).toEqual([
      'Let me have a look.',
      "That's two lots of semi skimmed milk in your basket.",
      'What else would you like?',
    ]);
    const actions = events.filter((e) => e['type'] === 'action').map((e) => e['action']);
    // The milk goes in; the wine never does (Rule Six), nor an id that is not a product.
    expect(actions).toEqual([
      {
        type: 'basket_add',
        items: [
          {
            item: expect.objectContaining({ id: ids.milk, name: 'Semi skimmed milk, 2 pints' }),
            quantity: 2,
          },
        ],
      },
    ]);
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: 'done', awaitingYes: false, unsaid: '' });
    expect(done['actions']).toEqual(actions);
    // The search found the milk for the model, with its shelf price, and never the wine.
    const searchResult = JSON.stringify((sent[1]!['messages'] as unknown[]).at(-1));
    expect(searchResult).toMatch(/Semi skimmed milk/);
    expect(searchResult).not.toMatch(/wine/i);
    expect(JSON.stringify((sent[2]!['messages'] as unknown[]).at(-1))).toMatch(/not_added/);
  });

  it('checkout is only handed to the app, for a signed-in Shopper with a basket', async () => {
    const script: Scripted[] = [];
    harness = await buildTestApp(undefined, { brain: brainWith(script) });
    const ids = await seedCatalogue(harness.repository);
    const basket = {
      lines: [{ id: ids.milk, name: 'Semi skimmed milk, 2 pints', quantity: 1, pricePence: 130 }],
      goodsPence: 180,
      feePence: 1099,
      totalPence: 1279,
    };
    // A visitor: refused, and told why, so the model offers an account.
    script.push(
      { toolUse: [{ id: 't1', name: 'start_checkout', input: {} }] },
      { deltas: ['You need an account first.'] },
    );
    const visitor = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      payload: { text: 'send my order', basket },
    });
    expect(eventsOf(visitor.body).some((e) => e['type'] === 'action')).toBe(false);

    const shopper = await signUpShopper(harness);
    script.push(
      { toolUse: [{ id: 't2', name: 'start_checkout', input: {} }] },
      { deltas: ['Right, let me read that back.'] },
    );
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers: shopper.authHeader,
      payload: { text: 'send my order', basket },
    });
    const events = eventsOf(signedIn.body);
    expect(events.filter((e) => e['type'] === 'action').map((e) => e['action'])).toEqual([
      { type: 'checkout' },
    ]);
    // Nothing was ordered or charged by the conversation itself.
    expect(await harness.repository.orders.listForShopper(shopper.shopperId)).toEqual([]);
  });

  it('a reminder is read back and set only on the yes', async () => {
    const script: Scripted[] = [];
    harness = await buildTestApp(undefined, { brain: brainWith(script) });
    const shopper = await signUpShopper(harness);
    script.push({
      toolUse: [
        {
          id: 't1',
          name: 'set_reminder',
          input: { text: 'call the bank', when: 'tomorrow at 10', repeat: 'none', channel: null },
        },
      ],
    });
    const asked = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers: shopper.authHeader,
      payload: { text: 'remind me tomorrow at ten to call the bank', conversation: 'c2' },
    });
    const done = eventsOf(asked.body).at(-1)!;
    expect(done).toMatchObject({ type: 'done', awaitingYes: true });
    expect(String(done['reply'])).toMatch(/call the bank/);
    expect(await harness.repository.reminders.listFor('shopper', shopper.shopperId)).toHaveLength(
      0,
    );
    // The yes goes to the server's own flow, with nothing asked of the model.
    const yes = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers: shopper.authHeader,
      payload: { text: 'yes please', conversation: 'c2', turn: 1 },
    });
    expect(eventsOf(yes.body).at(-1)).toMatchObject({ type: 'done' });
    expect(await harness.repository.reminders.listFor('shopper', shopper.shopperId)).toHaveLength(
      1,
    );
  });

  it('says unavailable when there is no model, or it fails, so the older parts answer', async () => {
    harness = await buildTestApp();
    const none = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      payload: { text: 'hello' },
    });
    expect(eventsOf(none.body)).toEqual([{ type: 'unavailable' }]);
    await harness.app.close();

    harness = await buildTestApp(undefined, {
      brain: brainWith([{ fail: Object.assign(new Error('no credit'), { status: 402 }) }]),
    });
    const failed = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      payload: { text: 'hello' },
    });
    expect(eventsOf(failed.body)).toEqual([{ type: 'unavailable' }]);
    const health = (await harness.app.inject({ method: 'GET', url: '/health' })).json() as {
      brain: { health: { lastError: { kind: string; detail: unknown } } };
    };
    expect(health.brain.health.lastError).toMatchObject({
      kind: 'credit-or-permission',
      detail: null,
    });
  });
});

describe('the founder on POST /ozi/talk (11 November 2026)', () => {
  let harness: TestHarness;
  afterEach(async () => {
    await harness?.app.close();
  });

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

  it('his instructions put his work first and shopping second, and never treat him as a customer', () => {
    const text = ownerInstructions(config, '');
    expect(text).toMatch(/His work comes first/);
    expect(text).toMatch(/Never treat him as a customer, never ask what he would like to order/);
    expect(text).toMatch(/Shopping is your second skill/);
    expect(text).not.toMatch(/orders are placed from a Shopper account in the shop/);
  });

  it('is answered by his own model with his desk tools, even with a Shopper signed in on the same phone', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const script: Scripted[] = [];
    harness = await buildTestApp(undefined, { brain: brainWith(script, sent) });
    const ids = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);
    const headers = { ...(await ownerHeaders()), ...shopper.authHeader };

    // "Hello Ozi": the desk, never bananas.
    script.push(
      { deltas: ['Good morning. '], toolUse: [{ id: 't1', name: 'needs_you', input: {} }] },
      { deltas: ['Nothing is waiting for you just now.'] },
    );
    const hello = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers,
      payload: {
        text: 'Hello Ozi',
        conversation: 'o1',
        basket: { lines: [], goodsPence: 0, feePence: 0, totalPence: 0 },
      },
    });
    const events = eventsOf(hello.body);
    expect(events.at(-1)).toMatchObject({ type: 'done', awaitingYes: false });
    expect(events.filter((e) => e['type'] === 'sentence').map((e) => e['text'])).toContain(
      'Nothing is waiting for you just now.',
    );
    const first = sent[0]!;
    expect(first['model']).toBe('claude-opus-5-5');
    const names = (first['tools'] as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'needs_you',
        'partner_approvals',
        'today_summary',
        'search_shop',
        'add_to_basket',
        'start_checkout',
        'open_page',
      ]),
    );
    // No tool twice: the provider refuses a request with two tools of one name.
    expect(new Set(names).size).toBe(names.length);
    expect(JSON.stringify(first['system'])).toMatch(/His work comes first/);
    const turn = String((first['messages'] as Array<{ content: unknown }>).at(-1)!.content);
    expect(turn).toMatch(/the owner and founder/);
    expect(turn).toMatch(/His own Shopper account is signed in on this phone/);
    // The desk was really read for him.
    expect(JSON.stringify((sent[1]!['messages'] as unknown[]).at(-1))).toMatch(/tool_result/);

    // When he asks for it in so many words, the same assistant shops, from his own account.
    script.push(
      {
        toolUse: [
          {
            id: 't2',
            name: 'add_to_basket',
            input: { items: [{ product_id: ids.bread, quantity: 1 }] },
          },
        ],
      },
      { deltas: ['A loaf of white sliced is in your basket.'] },
    );
    const bread = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers,
      payload: { text: 'put a loaf of bread in my basket', conversation: 'o1', turn: 1 },
    });
    expect(
      eventsOf(bread.body)
        .filter((e) => e['type'] === 'action')
        .map((e) => (e['action'] as { type: string }).type),
    ).toEqual(['basket_add']);
  });

  it('without a Shopper signed in he is told so, and a desk decision still waits for his yes', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const script: Scripted[] = [{ deltas: ['Three orders so far today.'] }];
    harness = await buildTestApp(undefined, { brain: brainWith(script, sent) });
    const headers = await ownerHeaders();
    const asked = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers,
      payload: { text: 'how is today going', conversation: 'o2' },
    });
    expect(eventsOf(asked.body).at(-1)).toMatchObject({
      type: 'done',
      reply: 'Three orders so far today.',
    });
    const turn = String((sent[0]!['messages'] as Array<{ content: unknown }>).at(-1)!.content);
    expect(turn).toMatch(/No Shopper account is signed in on this phone/);
    // Checkout without a Shopper account is refused to the model, never handed to the app.
    script.push(
      { toolUse: [{ id: 't1', name: 'start_checkout', input: {} }] },
      { deltas: ['You would need to sign in to your Shopper account first.'] },
    );
    const send = await harness.app.inject({
      method: 'POST',
      url: '/ozi/talk',
      headers,
      payload: { text: 'send my order', conversation: 'o2', turn: 1 },
    });
    expect(eventsOf(send.body).some((e) => e['type'] === 'action')).toBe(false);
  });
});
