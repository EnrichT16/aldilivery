/**
 * Ordering by voice alone (docs/BUILD_PROMPT.md, Sections D and E), end to end against a
 * stand-in engine and a stand-in server: what Ozi asks, what it reads back, the address it
 * says aloud, the two separate yeses, and what goes on the wire.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import {
  parseChoice,
  parseQuantity,
  parseYesNo,
  splitItems,
  wantsToStop,
} from '../src/voice/ordering';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_CARD, FAKE_SHOPPER } from './setup';

const BANANAS = {
  id: 'item-bananas',
  name: 'Bananas, loose',
  category: 'Fruit',
  estimatedPricePence: 20,
  ageRestricted: false,
};
const MILK = [
  {
    id: 'item-milk',
    name: 'Semi skimmed milk, 2 pints',
    category: 'Dairy',
    estimatedPricePence: 125,
    ageRestricted: false,
  },
  {
    id: 'item-milk-whole',
    name: 'Whole milk, 2 pints',
    category: 'Dairy',
    estimatedPricePence: 130,
    ageRestricted: false,
  },
];

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function stubShop(options: { cards?: Array<typeof FAKE_CARD>; signedIn?: boolean } = {}): Sent[] {
  const sent: Sent[] = [];
  if (options.signedIn !== false) {
    window.localStorage.setItem('ozidelivery.session.token', 'test-token');
  }
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      if (path === '/me') {
        return options.signedIn === false
          ? reply({ error: { message: 'You are not signed in.' } }, 401)
          : reply({ role: 'shopper', shopper: FAKE_SHOPPER });
      }
      if (path.startsWith('/catalogue/search')) {
        const q = new URLSearchParams(path.split('?')[1]).get('q')?.toLowerCase() ?? '';
        const items = q.includes('banana') ? [BANANAS] : q.includes('milk') ? MILK : [];
        return reply({ items, source: { mode: 'community', attribution: 'x' } });
      }
      if (path === '/payment-methods') {
        return reply({ paymentMethods: options.cards ?? [FAKE_CARD] });
      }
      if (path === '/orders' && method === 'POST') {
        return reply(
          {
            order: { id: 'order-9', status: 'paid' },
            payment: { requiresAction: false },
            message: 'Thank you. Your order is on its way to a Runner.',
          },
          201,
        );
      }
      if (path === '/config') {
        return reply({
          push: { publicKey: null },
          payments: { mode: 'rehearsal', publishableKey: null, supportedCardRegions: ['GB'] },
          signIn: { byText: true },
        });
      }
      if (path === '/orders/current') return reply({ order: null });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
  return sent;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/shop']}>
      <App />
    </MemoryRouter>,
  );
}

/** Say something once Ozi is listening, and wait for Ozi to finish answering. */
async function say(engine: FakeEngine, text: string): Promise<string> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  const before = engine.spoken.length;
  act(() => {
    engine.hear(text);
  });
  await waitFor(() => {
    expect(engine.spoken.length).toBeGreaterThan(before);
  });
  return engine.spoken.at(-1)?.text ?? '';
}

describe('understanding a spoken order', () => {
  it('takes the things asked for out of a whole sentence, and the shop separately', () => {
    expect(
      splitItems(
        'Hey Ozi, place an order of bananas, grapes, apples and oranges from Iceland, or the nearest available shop',
      ),
    ).toEqual({ items: ['bananas', 'grapes', 'apples', 'oranges'], shopAskedFor: 'Iceland' });
    expect(splitItems('Ozi', 'Ozi').items).toEqual([]);
    expect(splitItems('Hey Ozi.', 'Ozi').items).toEqual([]);
    expect(splitItems("I'd like two pints of milk and some bread").items).toEqual([
      'two pints of milk',
      'bread',
    ]);
  });

  it('hears how many', () => {
    expect(parseQuantity('two please')).toBe(2);
    expect(parseQuantity('6')).toBe(6);
    expect(parseQuantity('a dozen')).toBe(12);
    expect(parseQuantity('I am not sure')).toBeNull();
  });

  it('hears which, yes and no — and no wins when both are said', () => {
    expect(parseChoice('the second one', 2)).toBe(1);
    expect(parseChoice('three', 2)).toBeNull();
    expect(parseYesNo('yes that is right')).toBe('yes');
    expect(parseYesNo("no that's not right")).toBe('no');
    expect(parseYesNo('yes, no, wait')).toBe('no');
    expect(parseYesNo('pardon')).toBeNull();
    expect(wantsToStop('cancel the order')).toBe(true);
  });
});

describe('ordering by voice alone', () => {
  it('asks which and how many, reads it back with the address, and sends it on a second yes', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();

    expect(await say(engine, "I'd like bananas and milk")).toBe(
      'How many Bananas, loose would you like?',
    );
    expect(await say(engine, 'six')).toMatch(
      /^I found 2 kinds of milk: one, Semi skimmed milk, 2 pints, about £1\.25; two, Whole milk, 2 pints, about £1\.30\. Which would you like\?/,
    );
    expect(await say(engine, 'the first one')).toBe(
      'How many Semi skimmed milk, 2 pints would you like?',
    );

    // 6 x 20p + 2 x £1.25 = £3.70 of shopping, £13.50 delivery: £17.20.
    const readBack = await say(engine, 'two');
    expect(readBack).toBe(
      `Here is your order: 6 Bananas, loose, and 2 Semi skimmed milk, 2 pints. Your shopping comes to about £3.70, and delivery is £13.50, so about £17.20 altogether. It will be delivered to your home address: ${FAKE_SHOPPER.deliveryAddress}. Is that right?`,
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);

    expect(await say(engine, 'yes')).toBe(
      'Shall I send your order now, and charge about £17.20 to your card ending 4242? You pay what the till says. Say yes to send it, or no to stop.',
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);

    expect(await say(engine, 'yes please')).toMatch(/^Thank you\. Your order is on its way/);
    const order = sent.find((r) => r.method === 'POST' && r.path === '/orders');
    expect(order?.body).toMatchObject({
      lines: [
        { catalogueItemId: 'item-bananas', quantity: 6 },
        { catalogueItemId: 'item-milk', quantity: 2 },
      ],
      deliveryAddress: FAKE_SHOPPER.deliveryAddress,
      paymentMethodId: FAKE_CARD.id,
      confirmation: {
        confirmed: true,
        channel: 'voice',
        addressConfirmed: true,
        agreedTotalPence: 1720,
        statement:
          'Shall I send your order now, and charge about £17.20 to your card ending 4242? You pay what the till says.',
      },
    });
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
  });

  it('takes a number said with the item, and says when something cannot be found', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    const readBack = await say(engine, 'Ozi, three bananas and a pineapple');
    expect(readBack).toMatch(
      /^I couldn't find pineapple, so I'll leave it out\. Here is your order: 3 Bananas, loose\./,
    );
  });

  it('never sends a voice order anywhere but home: a no to the address goes to the screen', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await say(engine, 'I want three bananas');
    expect(await say(engine, "no, that's not right")).toMatch(
      /^An order by voice can only go to your home address, to keep your account safe\./,
    );
    expect(await screen.findByRole('heading', { name: 'Send your order' })).toBeInTheDocument();
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
  });

  it('stops at once, sending nothing, when told to', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await say(engine, 'I want three bananas');
    await say(engine, 'yes');
    expect(await say(engine, 'cancel the order')).toBe(
      "All right, I've stopped. Nothing has been sent, and nothing has been charged.",
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
  });

  it('a no to sending sends nothing, and leaves the shopping in the basket', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await say(engine, 'I want three bananas');
    await say(engine, 'yes');
    expect(await say(engine, 'no')).toMatch(/^All right\. Nothing has been sent/);
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
  });

  it('asks for an account first when nobody is signed in', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({ signedIn: false });
    renderApp();
    expect(await say(engine, 'I would like bananas')).toMatch(
      /^To order, you need an account first\. Would you like to open one now, just by talking with me\? Just say yes or no\./,
    );
  });

  it('needs a saved card, and opens the screen to add one', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({ cards: [] });
    renderApp();
    expect(await say(engine, 'I want three bananas')).toMatch(/you need a card saved/);
    expect(await screen.findByRole('heading', { name: /card/i })).toBeInTheDocument();
  });
});

describe('waiting for an order, but not for ever', () => {
  it('takes the next words as an order for thirty seconds after asking, and not after', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    expect(await say(engine, 'Ozi')).toBe(
      'What would you like? You can say, for example, bananas and milk.',
    );

    // Thirty-one seconds later, a conversation in the room is not an order.
    const later = Date.now() + 31_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    const before = engine.spoken.length;
    act(() => {
      engine.hear('bananas are cheaper at the market');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.spoken.length).toBe(before);

    // Asked again, the answer within thirty seconds is taken.
    clock.mockReturnValue(later + 1000);
    expect(await say(engine, 'Ozi')).toMatch(/^What would you like\?/);
    expect(await say(engine, 'bananas')).toBe('How many Bananas, loose would you like?');
    clock.mockRestore();
  });
});
