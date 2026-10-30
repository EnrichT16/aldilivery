/**
 * Restaurant pricing, Ozi Preferred Partners and checkout insights on the screen (Anthony, 30
 * October 2026): a restaurant basket shows the £12 restaurant fee in place of delivery and the
 * item charge on each dish, is refused below £10 in words Ozi says too, is kept apart from
 * groceries; grocery pricing is unchanged; a Preferred Partner wears its badge, with the reason
 * said next to the list; the Confirm page records the checkout it shows, and leaving it asks once
 * "Can we ask what stopped you?"; and the staff pages for restaurants and checkout insights.
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { CheckoutInsightsPage, RestaurantPartners } from '../src/components/StaffRestaurants';
import { storeConfig } from '../src/config';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_CARD, FAKE_CATALOGUE, FAKE_SHOPPER, stubApi } from './setup';
import { pageTabs } from './staff-tabs';

const MAMA = { shopId: 'mama', name: 'Mama Joy' };
const JOLLOF = {
  id: 'item-jollof',
  name: 'Jollof rice (Mama Joy)',
  category: 'From Mama Joy',
  estimatedPricePence: 650,
  restaurant: MAMA,
};

const originalItems = [...FAKE_CATALOGUE.items];
let engine: FakeEngine;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
  engine = fakeEngine();
  setVoiceEngine(engine);
  FAKE_CATALOGUE.items.push(JOLLOF as (typeof FAKE_CATALOGUE.items)[number]);
});

afterEach(() => {
  FAKE_CATALOGUE.items.splice(0, FAKE_CATALOGUE.items.length, ...originalItems);
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function addToBasket(user: ReturnType<typeof userEvent.setup>, name: RegExp, times = 1) {
  const button = await screen.findByRole('button', { name });
  for (let n = 0; n < times; n += 1) await user.click(button);
}

describe('a restaurant basket', () => {
  it('has the £12 restaurant fee in place of delivery, and the item charge on each dish', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await addToBasket(user, /Add Jollof rice/, 2);
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Restaurant fee, in place of delivery')).toBeInTheDocument();
    expect(within(table).queryByText('Delivery')).toBeNull();
    expect(within(table).getByText('£12.00')).toBeInTheDocument();
    // Two £6.50 dishes, £1 item charge on each, and the £12 fee: £27.
    expect(within(table).getByText('£27.00')).toBeInTheDocument();
    expect(screen.getByText(/A restaurant order from Mama Joy/)).toBeInTheDocument();
  });

  it('is refused below £10, on the screen and by Ozi', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await addToBasket(user, /Add Jollof rice/);
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const words = 'The smallest restaurant order is £10. Please add something more.';
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByRole('link', { name: 'Check and send my order' })).toBeNull();
    await waitFor(() => expect(engine.spoken.map((one) => one.text)).toContain(words));
  });

  it('is kept apart from groceries, in plain words', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await addToBasket(user, /Add Jollof rice/, 2);
    await addToBasket(user, /Add Semi skimmed milk/);
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Restaurant dishes go as their own order',
    );
  });

  it('leaves grocery pricing as it was', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await addToBasket(user, /Add Semi skimmed milk/);
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Delivery')).toBeInTheDocument();
    expect(within(table).getByText('£10.99')).toBeInTheDocument();
    expect(within(table).getByText(`£${((125 + 50 + 1099) / 100).toFixed(2)}`)).toBeInTheDocument();
  });
});

describe('the checkout, and what stopped people', () => {
  async function toConfirm(options: { askWhy?: boolean } = {}) {
    const recorded = stubApi({
      shopper: FAKE_SHOPPER,
      paymentMethods: [FAKE_CARD],
      ...options,
    });
    const user = userEvent.setup();
    renderAt('/shop');
    await addToBasket(user, /Add Jollof rice/, 2);
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(await screen.findByRole('link', { name: 'Check and send my order' }));
    await screen.findByRole('heading', { level: 1, name: 'Send your order' });
    return { recorded, user };
  }

  it('shows the whole breakdown before paying, and records the checkout it showed', async () => {
    const { recorded } = await toConfirm();
    expect(screen.getByText(/Restaurant fee, £12\.00, in place of delivery/)).toBeInTheDocument();
    expect(screen.getByText(/£13\.00 at the shop/)).toBeInTheDocument();
    expect(screen.getByText('Altogether, about £27.00.')).toBeInTheDocument();
    await waitFor(() =>
      expect(recorded.filter((call) => call.path === '/checkout/viewed')).toHaveLength(1),
    );
    expect(recorded.find((call) => call.path === '/checkout/viewed')?.body).toEqual({
      goodsPence: 1300,
      itemChargesPence: 200,
      feePence: 1200,
      totalPence: 2700,
      restaurant: true,
      area: FAKE_SHOPPER.deliveryAddress,
      noRunnerWarning: false,
      channel: 'web',
    });
  });

  it('asks once, when they go back without paying, and a tap records the answer', async () => {
    const { recorded, user } = await toConfirm({ askWhy: true });
    await user.click(screen.getByRole('link', { name: 'Go back and change something' }));
    const question = await screen.findByRole('region', { name: 'Can we ask what stopped you?' });
    await user.click(within(question).getByRole('button', { name: 'The price' }));
    expect(
      await screen.findByText('Thank you. That helps us get our prices right.'),
    ).toBeInTheDocument();
    expect(recorded.find((call) => call.path === '/checkout/why')?.body).toEqual({
      answer: 'price',
      restaurant: true,
      totalPence: 2700,
      area: FAKE_SHOPPER.deliveryAddress,
    });
    // Back to the checkout and away again: the server says not today, so it is not asked.
    await user.click(await screen.findByRole('link', { name: 'Check and send my order' }));
    await screen.findByRole('heading', { level: 1, name: 'Send your order' });
    await user.click(screen.getByRole('link', { name: 'Go back and change something' }));
    await waitFor(() =>
      expect(recorded.filter((call) => call.path === '/checkout/why/ask')).toHaveLength(2),
    );
    expect(screen.queryByRole('region', { name: 'Can we ask what stopped you?' })).toBeNull();
  });

  it('may be skipped, and is accessible', async () => {
    const { recorded, user } = await toConfirm({ askWhy: true });
    await user.click(screen.getByRole('link', { name: 'Go back and change something' }));
    const question = await screen.findByRole('region', { name: 'Can we ask what stopped you?' });
    const results = await axe.run(question, {
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await user.click(within(question).getByRole('button', { name: 'No thanks' }));
    expect(screen.queryByRole('region', { name: 'Can we ask what stopped you?' })).toBeNull();
    expect(recorded.some((call) => call.path === '/checkout/why')).toBe(false);
  });
});

describe('Ozi Preferred Partner on the Restaurants page', () => {
  const place = (id: string, name: string, preferredPartner: boolean) => ({
    id,
    name,
    about: '',
    kind: 'food',
    kindWords: 'Café or takeaway',
    area: 'ME7',
    hours: '',
    listedByOzi: false,
    products: 1,
    section: 'restaurants',
    cuisines: ['African'],
    preferredPartner,
    nearYou: null,
  });

  it('shows the badge, and says next to the list why it comes first', async () => {
    stubApi({
      shops: {
        shops: [place('a', 'Spice Hut', true), place('b', 'Bangkok House', false)],
        ranking: `Preferred Partners, who give ${storeConfig.assistantName} a better price, are shown first.`,
      },
    });
    renderAt('/restaurants');
    const first = await screen.findByRole('button', { name: /Spice Hut/ });
    expect(first).toHaveTextContent('Preferred Partner');
    expect(screen.getByRole('button', { name: /Bangkok House/ })).not.toHaveTextContent(
      'Preferred Partner',
    );
    expect(
      screen.getByText('Preferred Partners, who give Ozi a better price, are shown first.'),
    ).toBeInTheDocument();
  });
});

describe('the staff pages', () => {
  const reply = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;

  it('lists restaurants by discount, sortable by any column', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(String(url));
        return reply({
          restaurants: [
            {
              id: 'a',
              name: 'Spice Hut',
              area: 'ME7',
              listed: true,
              discountPercent: 25,
              preferredPartner: true,
              ordersLast30Days: 4,
            },
            {
              id: 'b',
              name: 'Bangkok House',
              area: 'DA1',
              listed: true,
              discountPercent: 0,
              preferredPartner: false,
              ordersLast30Days: 9,
            },
          ],
          sort: 'discount',
          order: 'desc',
          preferredDiscountPercent: 20,
          withDiscount: 1,
          withoutDiscount: 1,
          preferred: 1,
        });
      }),
    );
    const user = userEvent.setup();
    render(<RestaurantPartners staffKey="key" />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Spice Hut, ME7');
    expect(rows[1]).toHaveTextContent('25%');
    expect(rows[1]).toHaveTextContent('Yes');
    expect(rows[2]).toHaveTextContent('None');
    expect(screen.getByText(/1 give Ozi a discount and 1 do not/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Orders, last 30 days/ }));
    await waitFor(() =>
      expect(asked.some((url) => url.includes('/staff/restaurants?sort=orders&order=desc'))).toBe(
        true,
      ),
    );
  });

  it('shows the checkout insights for the period chosen, in plain words', async () => {
    const asked: string[] = [];
    const row = (label: string, viewed: number, paid: number) => ({
      label,
      viewed,
      paid,
      abandoned: viewed - paid,
      paidPercent: viewed === 0 ? null : Math.round((paid / viewed) * 100),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(String(url));
        return reply({
          days: 30,
          periods: [7, 30, 90],
          viewed: 4,
          paid: 2,
          abandoned: 2,
          paidPercent: 50,
          byTotal: [row('Under £20', 1, 1), row('Over £60', 3, 1)],
          byKind: [row('Restaurant', 1, 0), row('Groceries', 3, 2)],
          byArea: [row('Areas with fewer than 10 Shoppers', 4, 2)],
          byWarning: [row('With the no-Runner warning', 1, 0), row('Without the warning', 3, 2)],
          byShopper: [row('Returning Shoppers', 1, 1), row('New Shoppers', 3, 1)],
          byChannel: [row('On the screen', 4, 2)],
          reasons: [
            { answer: 'price', label: 'The price', count: 3 },
            { answer: 'looking', label: 'Just looking', count: 1 },
          ],
          summary:
            'In the last 30 days, 4 checkouts were viewed and 2 paid, 50%. 2 were left without paying.',
        });
      }),
    );
    const user = userEvent.setup();
    render(<CheckoutInsightsPage staffKey="key" />);
    expect(
      await screen.findByText(
        'In the last 30 days, 4 checkouts were viewed and 2 paid, 50%. 2 were left without paying.',
      ),
    ).toBeInTheDocument();
    const byTotal = screen.getByRole('table', { name: 'By the total shown' });
    const over = within(byTotal).getByRole('rowheader', { name: 'Over £60' }).closest('tr')!;
    expect(
      within(over)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['3', '1', '2', '33% paid']);
    expect(screen.getByRole('table', { name: 'Restaurant or groceries' })).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'With or without the no-Runner warning' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'New or returning' })).toBeInTheDocument();
    expect(screen.getByText('The price: 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(asked.some((url) => url.includes('/staff/checkout-insights?days=7'))).toBe(true),
    );
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});

describe('who may open Checkout insights', () => {
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;

  async function signInWith(areas: string[]) {
    const me = {
      name: 'Kemi',
      role: 'operations_manager',
      title: 'Operations manager',
      areas,
      account: true,
      isOwner: false,
      viewOnly: false,
      mustChangePassword: false,
      twoStep: {
        on: true,
        dueAt: '2026-12-31T00:00:00.000Z',
        setupNeeded: false,
        recoveryCodesLeft: 8,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        if (path === '/staff/sign-in') return reply({ token: 'st1.k.sig', ...me });
        if (path === '/staff/me') return reply(me);
        return reply({ error: { message: 'Not stubbed' } }, 404);
      }),
    );
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'kemi');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Admin pages' });
    return user;
  }

  it('is a page for staff given it (the founder and the operations manager)', async () => {
    const user = await signInWith(['orders', 'insights']);
    expect(await pageTabs(user)).toContain('Checkout insights');
  });

  it('is not there for staff without it', async () => {
    const user = await signInWith(['orders', 'partners']);
    expect(await pageTabs(user)).not.toContain('Checkout insights');
  });
});
