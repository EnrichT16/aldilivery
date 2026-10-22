/**
 * The language model behind Ozi (ruling 69): the instructions name nothing from code, a stand-in client's
 * answer is understood, and a slow, broken or refusing model is treated as absent.
 */

import { describe, expect, it } from 'vitest';

import { loadStoreConfig } from '@aldilivery/core/node';

import {
  documentInstructions,
  instructions,
  productInstructions,
  itemWords,
  languageModel,
  ukNow,
  type BrainClient,
} from '../src/lib/language-model.js';

const config = loadStoreConfig();

function stubClient(answer: () => Promise<unknown>): BrainClient {
  return {
    messages: {
      create: async () => answer(),
    },
  } as unknown as BrainClient;
}

function message(json: unknown, stop_reason = 'end_turn') {
  return { stop_reason, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

describe('the instructions', () => {
  it('come from configuration, and ask for the JSON shape', () => {
    const text = instructions(config);
    expect(text).toContain(config.assistantName);
    expect(text).toContain(config.productName);
    expect(text).toContain(config.store.displayName);
    expect(text).toMatch(/"items"/);
    expect(text).toMatch(/never ask for a card number/i);
  });
});

describe('understanding', () => {
  it('hears shopping and tidies it', async () => {
    const brain = languageModel(
      { apiKey: 'test', config },
      stubClient(async () =>
        message({
          kind: 'items',
          items: [
            { name: ' flour ', quantity: 1, brand: null, detail: '2 kg' },
            { name: 'eggs', quantity: 2, brand: " Lion's Gate ", detail: 'crate' },
          ],
          reply: null,
        }),
      ),
    );
    expect(brain.model).toBe('claude-haiku-5-5');
    const heard = await brain.understand({
      text: "get me 2 kilos of flour, I've run out, and a couple of crates of Lion's Gate eggs",
      account: 'shopper',
      channel: 'app',
    });
    expect(heard).toEqual({
      kind: 'items',
      items: [
        { name: 'flour', quantity: 1, brand: null, detail: '2 kg' },
        { name: 'eggs', quantity: 2, brand: "Lion's Gate", detail: 'crate' },
      ],
      reply: null,
    });
    expect(heard!.items.map(itemWords)).toEqual(['1 flour', '2 eggs']);
  });

  it('is absent when the model is slow, broken, refuses or answers nonsense', async () => {
    const slow = languageModel(
      { apiKey: 'test', config },
      stubClient(() => Promise.reject(new Error('timed out'))),
    );
    expect(await slow.understand({ text: 'hello', account: 'shopper', channel: 'app' })).toBeNull();
    const refused = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => message({ kind: 'items', items: [], reply: null }, 'refusal')),
    );
    expect(
      await refused.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
    const nonsense = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      })),
    );
    expect(
      await nonsense.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
    const wrongShape = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => message({ kind: 'maybe', items: [], reply: null })),
    );
    expect(
      await wrongShape.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
  });
});

describe('the time in the UK', () => {
  it('is given to the model so "what is the time" can be answered', () => {
    expect(ukNow(new Date('2026-10-19T16:43:00.000Z'))).toBe('Monday, 19 October 2026 at 5:43 pm');
  });
});

interface Sent {
  messages: Array<{ content: Array<{ text?: string }> }>;
  tools?: unknown;
}

describe('prices (ruling 72)', () => {
  it('shows the model the receipt photo and the list, and keeps only lines on the list', async () => {
    let sent: Sent | null = null;
    const model = languageModel({ apiKey: 'test', config }, {
      messages: {
        create: async (body: unknown) => {
          sent = body as Sent;
          return message({
            shop: ' A shop ',
            lines: [
              { item: 1, unitPricePence: 120 },
              { item: 4, unitPricePence: 50 },
            ],
          });
        },
      },
    } as unknown as BrainClient);
    const reading = await model.readReceipt!({ data: 'AAAA', mediaType: 'image/jpeg' }, [
      '1 x Milk',
      '2 x Bread',
    ]);
    expect(reading).toEqual({ shop: 'A shop', lines: [{ item: 1, unitPricePence: 120 }] });
    expect(sent!.messages[0]!.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
    expect(sent!.messages[0]!.content[1]!.text).toContain('1. 1 x Milk\n2. 2 x Bread');
  });

  it('searches the web once, in the UK, and reads the price line', async () => {
    let sent: Sent | null = null;
    const model = languageModel({ apiKey: 'test', config }, {
      messages: {
        create: async (body: unknown) => {
          sent = body as Sent;
          return {
            stop_reason: 'end_turn',
            content: [
              { type: 'text', text: 'Found it.' },
              { type: 'text', text: '\nPRICE_PENCE=75; SHOP=A supermarket' },
            ],
          };
        },
      },
    } as unknown as BrainClient);
    expect(await model.webPrice!('Plain flour, 1.5kg')).toEqual({
      pricePence: 75,
      shop: 'A supermarket',
    });
    expect(sent!.tools).toEqual([
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 1,
        user_location: { type: 'approximate', country: 'GB' },
      },
    ]);
  });
});

describe('reading a shelf label (ruling 75)', () => {
  it('shows the model the photo, asks for the JSON shape, and tidies the answer', async () => {
    let sent: (Sent & { output_config?: { format?: { type?: string } } }) | null = null;
    const model = languageModel({ apiKey: 'test', config }, {
      messages: {
        create: async (body: unknown) => {
          sent = body as typeof sent;
          return message({
            name: '  Braeburn   apples ',
            size: '6 pack',
            pricePence: 240,
            barcode: '5 012345 678900',
          });
        },
      },
    } as unknown as BrainClient);
    const reading = await model.readLabel!({ data: 'AAAA', mediaType: 'image/jpeg' });
    expect(reading).toEqual({
      name: 'Braeburn apples',
      size: '6 pack',
      pricePence: 240,
      barcode: '5012345678900',
    });
    expect(sent!.output_config?.format?.type).toBe('json_schema');
    expect(sent!.messages[0]!.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
    expect(sent!.messages[0]!.content[1]!.text).toMatch(/never guess/);
  });

  it('gives no price and no barcode when they cannot be read, and nothing when it fails', async () => {
    const unclear = languageModel(
      { apiKey: 'test', config },
      stubClient(async () =>
        message({ name: 'Milk', size: null, pricePence: null, barcode: '12' }),
      ),
    );
    expect(await unclear.readLabel!({ data: 'AAAA', mediaType: 'image/png' })).toEqual({
      name: 'Milk',
      size: null,
      pricePence: null,
      barcode: null,
    });
    const broken = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => {
        throw new Error('network');
      }),
    );
    expect(await broken.readLabel!({ data: 'AAAA', mediaType: 'image/png' })).toBeNull();
  });
});

describe('the automatic check (ruling 74)', () => {
  it('shows the model the document photo, and the ID only for a face comparison', async () => {
    const sent: Array<{ messages: Array<{ content: Array<{ type: string }> }> }> = [];
    const model = languageModel({ apiKey: 'test', config }, {
      messages: {
        create: async (body: unknown) => {
          sent.push(body as (typeof sent)[number]);
          return message({
            kindMatches: true,
            readable: true,
            nameOnDocument: ' CHIDI OKAFOR ',
            expiresOn: null,
            dbsRecordsSomething: false,
            clearRealFace: null,
            samePerson: null,
            concern: null,
            confidence: 0.96,
          });
        },
      },
    } as unknown as BrainClient);
    const photo = { data: 'AAAA', mediaType: 'image/jpeg' as const };
    const reading = await model.checkDocument!({
      kind: 'dbs',
      photo,
      accountName: 'Chidi Okafor',
      today: '2026-10-22',
    });
    expect(reading).toEqual(
      expect.objectContaining({ nameOnDocument: 'CHIDI OKAFOR', confidence: 0.96 }),
    );
    expect(sent[0]!.messages[0]!.content.filter((part) => part.type === 'image')).toHaveLength(1);
    await model.checkDocument!({
      kind: 'face_photo',
      photo,
      idPhoto: photo,
      accountName: 'Chidi Okafor',
      today: '2026-10-22',
    });
    expect(sent[1]!.messages[0]!.content.filter((part) => part.type === 'image')).toHaveLength(2);
  });

  it('is absent when the model refuses or answers outside the shape', async () => {
    const refusing = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => message({}, 'refusal')),
    );
    expect(
      await refusing.checkProduct!({ name: 'Bread', tags: '', pricePence: 100, isService: false }),
    ).toBeNull();
    const nonsense = languageModel(
      { apiKey: 'test', config },
      stubClient(async () => message({ verdict: 'maybe' })),
    );
    expect(
      await nonsense.checkProduct!({ name: 'Bread', tags: '', pricePence: 100, isService: false }),
    ).toBeNull();
  });

  it('its instructions come from configuration and never name the maker', () => {
    for (const text of [documentInstructions(config), productInstructions(config)]) {
      expect(text).toContain(config.productName);
      expect(text).not.toMatch(/anthropic|claude/i);
    }
  });
});
