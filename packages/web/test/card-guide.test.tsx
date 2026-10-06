/**
 * The card page, guided by Ozi one box at a time, and Ozi answering questions about the
 * shopping (Anthony, 6 October 2026).
 */

import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import { answerShoppingQuestion, findLine, orderWhere } from '../src/voice/shopping-questions';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_SHOPPER, stubApi } from './setup';

const stripeFake = vi.hoisted(() => {
  const handlers: Record<
    string,
    (event: { complete: boolean; error?: { message: string } }) => void
  > = {};
  return {
    handlers,
    stripe: {
      elements: () => ({
        create: (kind: string) => ({
          mount: () => undefined,
          unmount: () => undefined,
          clear: () => undefined,
          on: (_: string, handler: (event: { complete: boolean }) => void) => {
            handlers[kind] = handler;
          },
        }),
      }),
    },
  };
});

vi.mock('../src/lib/stripe', async () => {
  const real = await vi.importActual<typeof import('../src/lib/stripe')>('../src/lib/stripe');
  return {
    ...real,
    prepareCardEntry: vi.fn(async () =>
      Promise.resolve({ ready: true, stripe: stripeFake.stripe, supportedRegions: ['ANY'] }),
    ),
    createCardPaymentMethod: vi.fn(async () =>
      Promise.resolve({ stripePaymentMethodId: 'pm_1', lastFour: '4242', brand: 'visa' }),
    ),
  };
});

const clicks = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/lib/alert', () => ({
  chime: () => undefined,
  buzz: () => undefined,
  click: () => {
    clicks.count += 1;
  },
}));

function introHeard(): void {
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
}

const lastSaid = (engine: FakeEngine): string => engine.spoken.at(-1)?.text ?? '';

function fill(box: 'cardNumber' | 'cardExpiry' | 'cardCvc'): void {
  act(() => {
    stripeFake.handlers[box]?.({ complete: true });
  });
}

describe('the card page, one box at a time', () => {
  it('guides each box with a click, asks to save, then goes back to the shopping', async () => {
    introHeard();
    clicks.count = 0;
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubApi({
      shopper: FAKE_SHOPPER,
      paymentsMode: 'stripe',
      publishableKey: 'pk_test',
    });
    render(
      <MemoryRouter initialEntries={['/card']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(/First, the long number on the front of the card/);
    });

    fill('cardNumber');
    expect(clicks.count).toBe(1);
    expect(lastSaid(engine)).toMatch(/^Got the card number\. Next, the expiry date/);

    fill('cardExpiry');
    expect(lastSaid(engine)).toMatch(/Now turn the card over\./);

    fill('cardCvc');
    expect(clicks.count).toBe(3);
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(/Shall I save this card\?/);
    });

    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('yes please');
    });
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(/Shall we carry on with the shopping\?$/);
    });
    expect(sent.find((r) => r.path === '/payment-methods' && r.method === 'POST')).toBeTruthy();

    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('yes');
    });
    await waitFor(() => {
      expect(lastSaid(engine)).toBe("I'm listening. What would you like?");
    });
  });
});

describe('questions about the shopping', () => {
  const milk = {
    id: 'm',
    name: 'Semi skimmed milk, 2 pints',
    category: 'Dairy',
    estimatedPricePence: 125,
  };
  const bananas = { id: 'b', name: 'Bananas, loose', category: 'Fruit', estimatedPricePence: 20 };
  const basket = {
    lines: [
      { item: milk, quantity: 3 },
      { item: bananas, quantity: 6 },
    ],
    goodsPence: 495,
    feePence: 1350,
    totalPence: 1845,
  };

  it('says how many of something are in the basket', () => {
    expect(answerShoppingQuestion('Ozi, how many milk is in the basket?', basket)).toEqual({
      kind: 'say',
      text: 'You have 3 Semi skimmed milk, 2 pints in your basket.',
    });
    expect(answerShoppingQuestion('how many eggs are in my basket', basket)).toMatchObject({
      text: "There's no eggs in your basket yet. Would you like some?",
    });
  });

  it('reads the basket, and the total', () => {
    expect(answerShoppingQuestion("what's in my basket", basket)).toMatchObject({
      text: "In your basket: 3 Semi skimmed milk, 2 pints, and 6 Bananas, loose. That's about £18.45 with delivery.",
    });
    expect(answerShoppingQuestion('how much will it cost', basket)).toMatchObject({
      text: expect.stringMatching(/^About £4\.95 for the shopping, plus £13\.50 delivery/),
    });
  });

  it('takes something out', () => {
    expect(answerShoppingQuestion('take out the bananas', basket)).toEqual({
      kind: 'remove',
      itemId: 'b',
      text: "I've taken the Bananas, loose out of your basket.",
    });
    expect(answerShoppingQuestion('cancel my order', basket)).toBeNull();
  });

  it('knows a question about the order', () => {
    expect(answerShoppingQuestion("where's my runner", basket)).toEqual({ kind: 'order-status' });
    expect(answerShoppingQuestion('when will my shopping arrive', basket)).toEqual({
      kind: 'order-status',
    });
    expect(orderWhere(null)).toMatch(/don't have an order on its way/);
  });

  it('leaves everything else alone', () => {
    expect(answerShoppingQuestion('I would like bread', basket)).toBeNull();
    expect(findLine(basket.lines, 'milks')?.item.id).toBe('m');
  });

  it('answers by voice', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER });
    render(
      <MemoryRouter initialEntries={['/shop']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear("what's in my basket");
    });
    await waitFor(() => {
      expect(lastSaid(engine)).toBe('Your basket is empty. What would you like?');
    });
  });
});
