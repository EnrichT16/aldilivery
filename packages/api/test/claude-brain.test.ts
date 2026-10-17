/**
 * Claude behind Ozi (ruling 69): the instructions name nothing from code, a stand-in client's
 * answer is understood, and a slow, broken or refusing model is treated as absent.
 */

import { describe, expect, it } from 'vitest';

import { loadStoreConfig } from '@aldilivery/core/node';

import { claudeBrain, instructions, itemWords, type BrainClient } from '../src/lib/claude-brain.js';

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
    const brain = claudeBrain(
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
    const slow = claudeBrain(
      { apiKey: 'test', config },
      stubClient(() => Promise.reject(new Error('timed out'))),
    );
    expect(await slow.understand({ text: 'hello', account: 'shopper', channel: 'app' })).toBeNull();
    const refused = claudeBrain(
      { apiKey: 'test', config },
      stubClient(async () => message({ kind: 'items', items: [], reply: null }, 'refusal')),
    );
    expect(
      await refused.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
    const nonsense = claudeBrain(
      { apiKey: 'test', config },
      stubClient(async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      })),
    );
    expect(
      await nonsense.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
    const wrongShape = claudeBrain(
      { apiKey: 'test', config },
      stubClient(async () => message({ kind: 'maybe', items: [], reply: null })),
    );
    expect(
      await wrongShape.understand({ text: 'hello', account: 'shopper', channel: 'app' }),
    ).toBeNull();
  });
});
