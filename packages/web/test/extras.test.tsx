/**
 * Ozi Recipes, Little Gifts and ordering the same shopping again (Anthony, 6 October 2026).
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown }>;
let shopper: Record<string, unknown> | null;
let passWorks: boolean;

beforeEach(() => {
  sent = [];
  shopper = { ...FAKE_SHOPPER, recipePassUntil: null };
  passWorks = true;
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
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
        return shopper
          ? reply({ role: 'shopper', shopper })
          : reply({ error: { message: 'You are not signed in.' } }, 401);
      }
      if (path.startsWith('/catalogue/search')) {
        const name = decodeURIComponent(path.split('q=')[1] ?? '');
        const items =
          name === 'Gift bag'
            ? []
            : [{ id: `item-${name}`, name, category: 'Food', estimatedPricePence: 100 }];
        return reply({ items, attribution: '', source: 'community' });
      }
      if (path === '/extras/recipe-pass' && method === 'POST') {
        if (!passWorks) {
          return reply(
            { error: { message: 'Your card was declined, so nothing was taken.' } },
            503,
          );
        }
        return reply({
          recipePassUntil: '2099-11-05T09:00:00.000Z',
          message:
            'Recipes is unlocked until Thursday 5 November. £1.99 was taken from your card ending 4242. It does not renew by itself.',
        });
      }
      if (path === '/orders' && method === 'GET') {
        return reply({
          orders: [
            {
              id: 'order-7',
              status: 'completed',
              totalEstimatePence: 1720,
              finalTotalPence: 1695,
              createdAt: '2026-10-03T09:00:00.000Z',
              deliveredAt: '2026-10-03T11:00:00.000Z',
              items: [
                { id: 'i1', name: 'Bananas, loose', quantity: 6 },
                { id: 'i2', name: 'Semi skimmed milk, 2 pints', quantity: 2 },
              ],
            },
          ],
        });
      }
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
      if (path.startsWith('/basket/price')) {
        return reply({ goodsEstimatePence: 0, feePence: 0, totalEstimatePence: 0 });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Opens the basket from the menu and finds an item in it. */
async function expectInBasket(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('link', { name: 'Basket' }));
  const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const main = await screen.findByRole('main');
  expect((await within(main).findAllByText(pattern)).length).toBeGreaterThan(0);
}

describe('Ozi Recipes', () => {
  it('shows every recipe and its ingredients, but keeps the method for the Recipe Pass', async () => {
    renderAt('/recipes');
    expect(await screen.findByRole('heading', { name: 'Spaghetti bolognese' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Recipe Pass: £1.99 for 30 days' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Method' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add all the ingredients to my basket' }),
    ).not.toBeInTheDocument();
  });

  it('asks before taking the price, then unlocks the method and the one-press basket', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/recipes');
    await user.click(await screen.findByRole('button', { name: 'Unlock Recipes' }));
    expect(sent.some((r) => r.path === '/extras/recipe-pass')).toBe(false);
    expect(
      screen.getByText(/£1.99 will be taken from your saved card now, for 30 days/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, unlock Recipes for £1.99' }));
    expect(
      await screen.findByText(/Recipes is unlocked until Thursday 5 November/),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/extras/recipe-pass')?.body).toEqual({
      priceAccepted: true,
    });
    expect(screen.getAllByRole('heading', { name: 'Method' }).length).toBeGreaterThan(0);

    const pancakes = screen.getByRole('article', { name: 'Pancakes with lemon' });
    await user.click(
      within(pancakes).getByRole('button', { name: 'Add all the ingredients to my basket' }),
    );
    expect(
      await screen.findByText(/I've put the ingredients for Pancakes with lemon in your basket/),
    ).toBeInTheDocument();
    await expectInBasket(user, 'Plain flour, 1.5kg');
  });

  it('says so, and unlocks nothing, when the card is declined', async () => {
    passWorks = false;
    const user = userEvent.setup({ delay: null });
    renderAt('/recipes');
    await user.click(await screen.findByRole('button', { name: 'Unlock Recipes' }));
    await user.click(screen.getByRole('button', { name: 'Yes, unlock Recipes for £1.99' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nothing was taken');
    expect(screen.queryByRole('heading', { name: 'Method' })).not.toBeInTheDocument();
  });

  it('sends someone who is not signed in to set up an account first', async () => {
    shopper = null;
    window.localStorage.removeItem('ozidelivery.session.token');
    renderAt('/recipes');
    expect(await screen.findByRole('link', { name: 'Set up an account first' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});

describe('Little Gifts', () => {
  it('puts a whole gift in the basket, and says what it could not find', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/gifts');
    const birthday = await screen.findByRole('article', { name: 'Birthday treat' });
    await user.click(within(birthday).getByRole('button', { name: 'Add this gift to my basket' }));
    expect(
      await screen.findByText(
        "I've put the Birthday treat gift in your basket: Birthday card and Box of milk chocolates, 200g. I couldn't find Gift bag. Shall we look at your basket?",
      ),
    ).toBeInTheDocument();
    await expectInBasket(user, 'Birthday card');
  });
});

describe('ordering the same shopping again', () => {
  it('puts a past order back in the basket with one press', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/orders');
    await user.click(
      await screen.findByRole('button', { name: 'Order these again from Saturday 3 October' }),
    );
    expect(
      await screen.findByText(
        "I've put the same shopping in your basket: Bananas, loose and Semi skimmed milk, 2 pints. Shall we look at your basket?",
      ),
    ).toBeInTheDocument();
    await expectInBasket(user, 'Semi skimmed milk, 2 pints');
  });
});

describe('asking Ozi', () => {
  async function say(engine: FakeEngine, text: string): Promise<void> {
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear(text);
  }
  function spoken(engine: FakeEngine): string {
    return engine.spoken.map((s) => s.text).join(' | ');
  }
  function voiceReady(): FakeEngine {
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    const engine = fakeEngine();
    setVoiceEngine(engine);
    return engine;
  }

  it('"same as last time" puts the last order back in the basket, and offers to show it', async () => {
    const engine = voiceReady();
    renderAt('/shop');
    await screen.findByRole('link', { name: 'Your order' });
    await say(engine, 'Hey Ozi, same as last time please');
    await waitFor(() => {
      expect(spoken(engine)).toContain(
        "I've put the same shopping as last time in your basket: Bananas, loose and Semi skimmed milk, 2 pints. Shall we look at your basket?",
      );
    });
    await say(engine, 'yes please');
    expect(await screen.findByRole('heading', { level: 1, name: /basket/i })).toBeInTheDocument();
  });

  it('"repeat my order" orders again, while "repeat" on its own still says the last thing again', async () => {
    const engine = voiceReady();
    renderAt('/shop');
    await screen.findByRole('link', { name: 'Your order' });
    await say(engine, 'repeat my order');
    await waitFor(() => {
      expect(spoken(engine)).toContain("I've put the same shopping as last time in your basket");
    });
  });

  it('"what can I cook?" opens the recipes, and "a present" opens the gifts', async () => {
    const engine = voiceReady();
    renderAt('/shop');
    await screen.findByRole('link', { name: 'Your order' });
    await say(engine, 'Ozi, what can I cook tonight?');
    expect(await screen.findByRole('heading', { level: 1, name: /Recipes/ })).toBeInTheDocument();
    await say(engine, 'I need a present for my wife');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Little Gifts' }),
    ).toBeInTheDocument();
  });
});
