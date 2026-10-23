/**
 * Ordering by voice alone (docs/BUILD_PROMPT.md, Sections D and E), end to end against a
 * stand-in engine and a stand-in server: what Ozi asks, what it reads back, the address it
 * says aloud, the two separate yeses, and what goes on the wire.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { dayWords, parseSpokenDay } from '@aldilivery/core';

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

const PAWPAW = {
  id: 'item-pawpaw',
  name: 'Pawpaw, each',
  category: 'Fruit',
  estimatedPricePence: 150,
  ageRestricted: false,
};

function stubShop(
  options: {
    cards?: Array<typeof FAKE_CARD>;
    signedIn?: boolean;
    shelf?: boolean;
    /** What the server's phrase book answers to a sentence looked within (ruling 49). */
    oziReply?: (text: string) => string | null;
    /** What the server says about something not in the list (19 October 2026). */
    suggest?: (name: string) => unknown;
    /** What the language model hears in a sentence the phrase book had nothing for (ruling 69). */
    oziHears?: (text: string) => { kind: string; items: unknown[]; reply: string | null } | null;
  } = {},
): Sent[] {
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
        const items = q.includes('banana')
          ? [BANANAS]
          : q.includes('milk')
            ? MILK
            : q.includes('pawpaw')
              ? [PAWPAW]
              : options.shelf && q === ''
                ? [MILK[0]!]
                : [];
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
      // The server's phrase book (ruling 49): nothing is a whole phrase, and a sentence looked
      // within is answered only when the test says so; otherwise the server keeps it to learn.
      if (path === '/ozi/known') return reply({ fingerprints: [] });
      if (path === '/catalogue/suggest' && options.suggest) {
        return reply(options.suggest((body as { name: string }).name));
      }
      if (path === '/ozi/reply') {
        const { text, mode } = body as { text: string; mode: 'exact' | 'within' };
        if (mode !== 'within') return reply({ reply: null });
        const known = options.oziReply?.(text) ?? null;
        if (known) return reply({ reply: known });
        const understood = options.oziHears?.(text) ?? null;
        return reply(understood ? { reply: understood.reply, understood } : { reply: null });
      }
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
  it('shops for what the language model heard when the parser would have chopped the sentence (ruling 69)', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop({
      oziHears: (text) =>
        /run out of/i.test(text)
          ? {
              kind: 'items',
              items: [{ name: 'bananas', quantity: 6, brand: null, detail: null }],
              reply: null,
            }
          : /moon/i.test(text)
            ? { kind: 'question', items: [], reply: 'Not yet. We stay on this planet.' }
            : null,
    });
    renderApp();
    expect(await say(engine, 'Ozi, do you deliver to the moon')).toBe(
      'Not yet. We stay on this planet.',
    );
    expect(await say(engine, "Ozi, I've run out of bananas, could you get me some please")).toMatch(
      /^Here is your order: 6 Bananas, loose\./,
    );
    const asked = sent.filter(
      (r) => r.path === '/ozi/reply' && (r.body as { mode: string }).mode === 'within',
    );
    expect(asked.length).toBeGreaterThan(0);
    expect((asked[0]!.body as { basket?: string[] }).basket).toBeUndefined();
  });

  it('recommends a breakfast and adds its things only after a yes (19 October 2026)', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop({
      oziHears: (text) =>
        /recommend/i.test(text)
          ? {
              kind: 'recommend',
              items: [
                { name: 'bananas', quantity: 6, brand: null, detail: null },
                { name: 'milk', quantity: 1, brand: null, detail: null },
              ],
              reply: 'How about porridge with bananas and milk? Shall I add them?',
            }
          : null,
    });
    renderApp();
    expect(await say(engine, 'Ozi, can you recommend a breakfast for me')).toBe(
      'How about porridge with bananas and milk? Shall I add them?',
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
    expect(await say(engine, 'yes please')).toMatch(/^I found 2 kinds of milk/);
  });

  it('adds something not in the list at a typical price instead of leaving it out (19 October 2026)', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({
      suggest: (name) =>
        name === 'pawpaws'
          ? { outcome: 'refused', reply: 'Not that.' }
          : {
              outcome: 'added',
              item: {
                id: 'item-quinoa',
                name: 'Quinoa, 300g',
                category: 'Cupboard',
                estimatedPricePence: 199,
                source: 'community',
                lastSeenAt: '2026-10-19T12:00:00.000Z',
              },
            },
    });
    renderApp();
    expect(await say(engine, 'I would like 2 quinoa and 3 bananas')).toMatch(
      /^Quinoa, 300g wasn't in my list yet, so I've added it at about £2\.\d\d\. You pay what the till says\. Here is your order: 2 Quinoa, 300g, and 3 Bananas, loose\./,
    );
  });

  it("tells the server what it heard and what it said, for Ozi's memory (ruling 68)", async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();

    expect(await say(engine, "I'd like bananas")).toBe('How many Bananas, loose would you like?');
    await waitFor(() => {
      const kept = sent.filter((r) => r.method === 'POST' && r.path === '/ozi/heard');
      expect(kept.length).toBeGreaterThan(0);
      expect(kept[kept.length - 1]!.body).toMatchObject({
        heard: "I'd like bananas",
        said: 'How many Bananas, loose would you like?',
        brain: 'shopping',
        outcome: 'asked',
      });
      expect((kept[kept.length - 1]!.body as { conversation: string }).conversation).toMatch(
        /^visit:/,
      );
    });
  });

  it('asks which and how many, reads it back with the address, and sends it on a second yes', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();

    expect(await say(engine, "I'd like bananas and milk")).toBe(
      'How many Bananas, loose would you like?',
    );
    expect(await say(engine, 'six')).toMatch(
      /^I found 2 kinds of milk: one, Semi skimmed milk, 2 pints, about £1\.75; two, Whole milk, 2 pints, about £1\.80\. Which would you like\?/,
    );
    expect(await say(engine, 'the first one')).toBe(
      'How many Semi skimmed milk, 2 pints would you like?',
    );

    // 6 x 20p + 2 x £1.25 = £3.70 of shopping, with eight item charges of 50p is £7.70; pay as
    // you go, £30 or less, so £10.99 delivery: £18.69 (ruling 73).
    const readBack = await say(engine, 'two');
    expect(readBack).toBe(
      `Here is your order: 6 Bananas, loose, and 2 Semi skimmed milk, 2 pints. Your shopping comes to about £7.70, with the item charges included, and delivery is £10.99, so about £18.69 altogether. It will be delivered to your home address: ${FAKE_SHOPPER.deliveryAddress}. Is that right?`,
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);

    expect(await say(engine, 'yes')).toBe(
      'Shall I send your order and pay now, charging about £18.69 to your card ending 4242? You pay what the till says. Say yes to send it and pay, or no to stop. To have it on another day, say the day, like deliver it on Saturday morning.',
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
        agreedTotalPence: 1869,
        statement:
          'Shall I send your order and pay now, charging about £18.69 to your card ending 4242? You pay what the till says.',
      },
    });
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
  });

  it('books a later day and a payday by voice, saying both before the one yes (ruling 78)', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await say(engine, 'Ozi, three bananas please');
    await say(engine, 'yes');
    const asked = await say(
      engine,
      'deliver it on Saturday morning and take the money tomorrow at five past midnight',
    );
    const saturday = parseSpokenDay('Saturday', new Date())!;
    const tomorrow = parseSpokenDay('tomorrow', new Date())!;
    expect(asked).toContain(`Shall I send your order for ${dayWords(saturday)}, in the morning,`);
    expect(asked).toContain(`from your card ending 4242 on ${dayWords(tomorrow)} at 00:05?`);
    expect(asked).toContain('The final amount is what the till says on the day');
    expect(asked).toContain('if prices have gone up, the difference is taken from your card');
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);

    await say(engine, 'yes please');
    const order = sent.find((r) => r.method === 'POST' && r.path === '/orders');
    expect(order?.body).toMatchObject({
      schedule: {
        deliveryDay: saturday,
        window: 'morning',
        pay: 'scheduled',
        chargeDay: tomorrow,
        chargeTime: '00:05',
      },
      confirmation: { channel: 'voice', statement: expect.stringContaining(dayWords(saturday)) },
    });
  });

  it('adds to what is already in the basket, reads the whole basket back, and sends all of it', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop({ shelf: true });
    renderApp();
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole('button', { name: /Add Semi skimmed milk/ }));

    // The milk chosen on the screen stays (16 October 2026): a voice order adds, never replaces.
    const readBack = await say(engine, 'Ozi, three bananas please');
    expect(readBack).toMatch(
      /^Here is your order: 1 Semi skimmed milk, 2 pints, and 3 Bananas, loose\. Your shopping comes to about £3\.85/,
    );
    await say(engine, 'yes');
    expect(await say(engine, 'yes please')).toMatch(/^Thank you\. Your order is on its way/);
    const order = sent.find((r) => r.method === 'POST' && r.path === '/orders');
    expect(order?.body).toMatchObject({
      lines: [
        { catalogueItemId: 'item-milk', quantity: 1 },
        { catalogueItemId: 'item-bananas', quantity: 3 },
      ],
    });
  });

  it('takes a number said with the item, and says when something cannot be found', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    const readBack = await say(engine, 'Ozi, three bananas and a pineapple');
    expect(readBack).toMatch(
      /^I don't have pineapple in my list yet\. I've noted it so we can add it\. Here is your order: 3 Bananas, loose\./,
    );
  });

  it('never sends a voice order anywhere but home: a no to the address goes to the screen', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await say(engine, 'I want three bananas');
    await say(engine, "no, that's not right");
    // The confirmation screen then puts the address to them too, so Ozi's words about the
    // home address are among what was said, not always the very last thing.
    expect(engine.spoken.map((s) => s.text)).toContainEqual(
      expect.stringMatching(
        /^An order by voice can only go to your home address, to keep your account safe\./,
      ),
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
      /^To order, you need an account first\. Would you like to create an account, or sign in\? Just say create account, or sign in\./,
    );
  });

  it('needs a saved card, and opens the screen to add one', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({ cards: [] });
    renderApp();
    await say(engine, 'I want three bananas');
    expect(await screen.findByRole('heading', { name: /card/i })).toBeInTheDocument();
    // Said in full first, then the card page explains itself.
    const spoken = engine.spoken.map((s) => s.text);
    const needs = spoken.findIndex((text) => /you need a card saved/.test(text));
    expect(needs).toBeGreaterThan(-1);
  });
});

describe('waiting for an order, but not for ever', () => {
  it('takes the next words as an order for thirty seconds after asking, and not after', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    // "Ozi" on its own is answered, and opens the thirty seconds.
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");

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
    expect(await say(engine, 'Ozi')).toMatch(/What would you like\?/);
    expect(await say(engine, 'bananas')).toBe('How many Bananas, loose would you like?');
    clock.mockRestore();
  });
});

describe('small talk and general statements are not shopping (ruling 66)', () => {
  /** Say something and give Ozi a moment, without expecting it to answer. */
  async function sayQuietly(engine: FakeEngine, text: string): Promise<void> {
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear(text);
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  it('answers small talk warmly while waiting for an order, instead of "I haven\'t added"', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");
    expect(await say(engine, 'how are you doing today?')).toBe(
      "I'm very well, thank you. How are you?",
    );
    expect(await say(engine, 'where are you')).toBe(
      "Right here with you. Just say an item when you're ready.",
    );
    expect(await say(engine, "I'm tired")).toMatch(/^Sorry to hear that\./);
    expect(engine.spoken.some((s) => /haven't added|couldn't find/.test(s.text))).toBe(false);
    // None of it was looked up as a product (the shop page loads its own shelf).
    expect(
      sent.some((r) => r.path.startsWith('/catalogue/search') && /how|where|tired/.test(r.path)),
    ).toBe(false);
    // The thirty seconds still stand: an item said next is an order.
    expect(await say(engine, 'bananas')).toBe('How many Bananas, loose would you like?');
  });

  it('says one gentle line to a sentence that is not shopping, keeps it to learn, then stays quiet', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");

    expect(await say(engine, 'I was just saying to Margaret the bus was late again')).toBe(
      "I'm here when you're ready to order. Say an item, like milk or bread.",
    );
    // The catalogue was checked first, and the sentence went to the server to learn from.
    expect(sent.some((r) => r.path.startsWith('/catalogue/search'))).toBe(true);
    const learned = sent.filter((r) => r.path === '/ozi/reply');
    expect(learned).toHaveLength(1);
    expect(learned[0]!.body).toMatchObject({
      mode: 'within',
      text: 'I was just saying to Margaret the bus was late again',
    });

    // More chatter in the next twenty seconds: nothing said, but still sent to learn from.
    clock.mockReturnValue(start + 10_000);
    const before = engine.spoken.length;
    await sayQuietly(engine, 'did you see the match last night');
    expect(engine.spoken.length).toBe(before);
    expect(sent.filter((r) => r.path === '/ozi/reply')).toHaveLength(2);
    expect(engine.spoken.some((s) => /haven't added|couldn't find/.test(s.text))).toBe(false);

    // After the twenty seconds, the gentle line again; and an item is still an order.
    clock.mockReturnValue(start + 21_000);
    expect(await say(engine, 'what are we doing tomorrow then')).toBe(
      "I'm here when you're ready to order. Say an item, like milk or bread.",
    );
    expect(await say(engine, 'bananas')).toBe('How many Bananas, loose would you like?');
    clock.mockRestore();
  });

  it('lets the server answer a sentence it knows, from its phrase book', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({
      oziReply: (text) => (/refund/.test(text) ? 'Refunds go back to your card.' : null),
    });
    renderApp();
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");
    expect(await say(engine, 'could you tell me how refunds actually work')).toBe(
      'Refunds go back to your card.',
    );
  });

  it('still orders when a product is in the sentence, or in the shop, however it is asked', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");
    // A question with a grocery word in it is shopping.
    expect(await say(engine, 'have you got any bananas')).toBe(
      'How many Bananas, loose would you like?',
    );
    expect(await say(engine, 'two')).toMatch(/^Here is your order: 2 Bananas, loose\./);
    expect(await say(engine, 'cancel')).toMatch(/^All right, I've stopped\./);
    // A sentence shaped like chatter, naming something the shop has: the catalogue wins.
    expect(await say(engine, 'Ozi')).toMatch(/I'm here|What would you like/);
    expect(await say(engine, 'could you see whether they have any pawpaw')).toBe(
      'How many Pawpaw, each would you like?',
    );
  });

  it('keeps saying what it could not find for a word that may be a product', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop();
    renderApp();
    expect(await say(engine, 'Ozi')).toBe("I'm here. How can I help?");
    expect(await say(engine, 'quinoa')).toBe(
      "I don't have quinoa in my list yet. I've noted it so we can add it. I haven't added anything, so there is no order.",
    );
  });
});
