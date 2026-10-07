/**
 * Shop Partners and organisations (7 October 2026): their own sign-in, their own dashboards,
 * and Ozi with each dashboard's own commands only.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import type { OrganisationDashboard } from '../src/lib/api';
import { savedWords, statementCsv } from '../src/pages/OrganisationDashboard';
import { setVoiceEngine } from '../src/voice';
import { understandOrganisation, understandPartner } from '../src/voice/business-voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_SHOPPER } from './setup';

const ORG: OrganisationDashboard = {
  organisation: {
    id: 'org-1',
    name: 'Medway Care Home',
    joinCode: 'K7M3QX',
    monthlyBudgetPence: 50000,
    staffTripCostPence: 2500,
  },
  totals: {
    spentThisMonthPence: 3200,
    spentLastMonthPence: 1600,
    spentAllTimePence: 4800,
    deliveriesThisMonth: 2,
    budgetLeftPence: 46800,
    savedThisMonthPence: 2300,
    upcomingWeeklyPence: 1600,
  },
  byOffice: [{ office: 'Ward B', pence: 3200 }],
  people: [{ id: 's1', name: 'Mr Table', office: 'Ward B' }],
  orders: [
    {
      id: 'o1',
      person: 'Mr Table',
      office: 'Ward B',
      createdAt: '2026-10-06T10:00:00.000Z',
      status: 'delivered',
      items: 3,
      paidPence: 1600,
    },
  ],
  upcoming: [{ person: 'Mr Table', office: 'Ward B', dayOfWeek: 2, estimatePence: 1600 }],
  deliveryFeePence: 1350,
  sharePath: '/join/organisation/K7M3QX',
  referrals: 1,
};

let sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let kind: 'partner' | 'organisation';

beforeEach(() => {
  sent = [];
  kind = 'partner';
  window.sessionStorage.clear();
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
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
      const headers = (init?.headers as Record<string, string> | undefined) ?? {};
      sent.push({ method, path, body, headers });
      if (path === '/business/sign-in') {
        return reply({
          token: 'bz1.x.y',
          kind,
          name: 'Bola',
          office: '',
          business: 'Corner Bakery',
          mustChangePassword: false,
        });
      }
      if (path === '/business/me') {
        return reply({
          kind,
          name: kind === 'partner' ? 'Bola' : 'Jo',
          office: kind === 'partner' ? '' : 'Head office',
          business: '',
          mustChangePassword: false,
        });
      }
      if (path === '/partner/dashboard') {
        return reply({
          shop: { id: 'shop-1', name: 'Corner Bakery', address: '', telephone: '', about: '' },
          plan: { monthlyPence: 2999, paidUntil: '2026-11-07T10:00:00.000Z', paid: true },
          counts: { live: 1, waiting: 0, notAccepted: 0 },
          products: [
            {
              id: 'p1',
              name: 'Sourdough loaf',
              pricePence: 350,
              tags: '',
              expiresOn: null,
              hasPhoto: false,
              status: 'approved',
              note: null,
              catalogueItemId: 'c1',
              createdAt: '2026-10-07T10:00:00.000Z',
            },
          ],
          sharePath: '/shops/shop-1',
          spotlight: {
            level: 'spotlight',
            until: '2026-11-07T10:00:00.000Z',
            mentionsThisMonth: 4,
            prices: { spotlightPence: 1999, plusPence: 3999, spotlightPerWeek: 1, plusPerWeek: 3 },
          },
          payments: [
            {
              id: 'pay1',
              kind: 'plan',
              what: 'Shop Partner plan',
              amountPence: 2999,
              months: 1,
              coversUntil: '2026-11-07T10:00:00.000Z',
              paidAt: '2026-10-07T10:00:00.000Z',
            },
            {
              id: 'pay2',
              kind: 'spotlight',
              what: 'Spotlight',
              amountPence: 1999,
              months: 1,
              coversUntil: '2026-11-07T10:00:00.000Z',
              paidAt: '2026-10-07T10:00:00.000Z',
            },
          ],
          referrals: 7,
          numbers: { purchasesThisWeek: 3, purchasesThisMonth: 9, itemsThisMonth: 14 },
        });
      }
      if (path === '/partner/products') {
        return reply(
          {
            product: {},
            message:
              'Thank you. Welsh cakes, £2.50, is waiting to be checked. It usually goes live within one working day.',
          },
          201,
        );
      }
      if (path === '/organisation/dashboard') return reply(ORG);
      if (path === '/shops/shop-1') {
        return reply({
          shop: { id: 'shop-1', name: 'Corner Bakery', about: 'Fresh bread.', address: '' },
          products: [
            {
              id: 'p1',
              name: 'Sourdough loaf',
              pricePence: 350,
              tags: '',
              expiresOn: null,
              hasPhoto: false,
              catalogueItemId: 'c1',
            },
          ],
        });
      }
      if (path === '/catalogue/c1') {
        return reply({
          found: true,
          item: {
            id: 'c1',
            name: 'Sourdough loaf (Corner Bakery)',
            category: 'From Corner Bakery',
            estimatedPricePence: 350,
          },
        });
      }
      if (path === '/me' && method === 'PATCH') {
        return reply({ shopper: { ...FAKE_SHOPPER, ...(body as object) } });
      }
      if (path === '/me') return reply({ role: 'shopper', shopper: FAKE_SHOPPER });
      if (path.startsWith('/spotlight')) {
        return reply({
          advert: {
            shopId: 'shop-1',
            shopName: 'Corner Bakery',
            productName: 'Sourdough loaf',
            pricePence: 350,
            catalogueItemId: 'c1',
            words: 'Advert: Sourdough loaf is in stock at Corner Bakery, about £3.50.',
          },
        });
      }
      if (path.startsWith('/catalogue/search')) {
        return reply({
          items: [
            {
              id: 'b1',
              name: 'White sliced bread, 800g',
              category: 'Bakery',
              estimatedPricePence: 89,
            },
          ],
          attribution: '',
          source: 'community',
        });
      }
      if (path === '/me/organisation' && method === 'GET') return reply({ organisation: null });
      if (path === '/me/organisation' && method === 'POST') {
        return reply({
          organisation: { name: 'Medway Care Home' },
          message: "You're now linked to Medway Care Home.",
        });
      }
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
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

async function say(engine: FakeEngine, text: string): Promise<void> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  engine.hear(text);
}

function spoken(engine: FakeEngine): string {
  return engine.spoken.map((s) => s.text).join(' | ');
}

async function signIn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText('Username'), 'cornerbakery');
  await user.type(screen.getByLabelText('Password'), 'their own password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('a Shop Partner', () => {
  it('signs in to their own area, hears what is live, and adds a product by voice', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    renderAt('/business');
    await signIn(user);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Corner Bakery' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/£29\.99 a month\. Paid until/)).toBeInTheDocument();
    expect(screen.getByText(/Spotlight, 1 month, £19\.99/)).toBeInTheDocument();
    expect(screen.getByText(/Mentioned 4 times this month/)).toBeInTheDocument();
    expect(
      screen.getByRole('meter', { name: '7 of 100 people have joined through your link' }),
    ).toHaveAttribute('value', '7');
    expect(screen.getByRole('button', { name: 'Download my statement (PDF)' })).toBeInTheDocument();
    await waitFor(() => {
      expect(spoken(engine)).toMatch(
        /Shop Partner area for Corner Bakery\. You have 1 product live and 0 waiting/,
      );
    });
    expect(sent.find((r) => r.path === '/partner/dashboard')?.headers).toEqual(
      expect.objectContaining({ 'x-business-token': 'bz1.x.y' }),
    );

    await say(engine, 'add a product');
    await waitFor(() => expect(spoken(engine)).toContain('What is the product?'));
    await say(engine, 'Welsh cakes');
    await waitFor(() => expect(spoken(engine)).toContain('And the price of Welsh cakes?'));
    await say(engine, '£2.50');
    await waitFor(() => expect(spoken(engine)).toContain('best before'));
    await say(engine, 'no');
    await waitFor(() =>
      expect(spoken(engine)).toContain('Send Welsh cakes, £2.50, to be checked?'),
    );
    await say(engine, 'yes');
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/partner/products')?.body).toEqual({
        name: 'Welsh cakes',
        pricePence: 250,
        tags: '',
      });
    });
  });

  it('a Shopper sees the shop’s page and adds its product to the basket', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/shops/shop-1');
    await user.click(
      await screen.findByRole('button', { name: /Add to my basket.*Sourdough loaf/ }),
    );
    expect(await screen.findByText(/I've put Sourdough loaf in your basket/)).toBeInTheDocument();
  });
});

describe('an organisation', () => {
  it('sees spending, savings and who ordered, and Ozi reads it aloud', async () => {
    kind = 'organisation';
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    renderAt('/business');
    await signIn(user);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Medway Care Home' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved this month').nextSibling).toHaveTextContent('£23.00');
    expect(screen.getByText(/for Mr Table \(Ward B\), 3 items, £16\.00/)).toBeInTheDocument();
    await waitFor(() => expect(spoken(engine)).toMatch(/This month, £32\.00 on 2 deliveries/));

    await say(engine, 'how much have we saved');
    await waitFor(() => expect(spoken(engine)).toContain('About £23.00 saved this month'));
    await say(engine, 'who ordered');
    await waitFor(() => expect(spoken(engine)).toContain('for Mr Table, Ward B, £16.00'));
  });

  it('a Shopper links to one only after agreeing what it will see', async () => {
    window.localStorage.setItem('ozidelivery.session.token', 'test-token');
    const user = userEvent.setup({ delay: null });
    renderAt('/settings');
    const button = await screen.findByRole('button', { name: 'Link my account' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('The organisation’s code'), 'k7m3qx');
    await user.click(
      screen.getByLabelText('I agree that they will see my orders and what they cost.'),
    );
    await user.click(button);
    expect(await screen.findByText(/now linked to Medway Care Home/)).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/me/organisation' && r.method === 'POST')?.body).toEqual({
      code: 'k7m3qx',
      agreed: true,
    });
  });
});

describe('what each dashboard understands', () => {
  it('keeps a shop’s words and an organisation’s words apart', () => {
    expect(understandPartner('add a product')).toEqual({ kind: 'add' });
    expect(understandPartner('change the price of sourdough loaf to £3.99')).toEqual({
      kind: 'price',
      name: 'sourdough loaf',
      pricePence: 399,
    });
    expect(understandPartner('remove the welsh cakes')).toEqual({
      kind: 'remove',
      name: 'welsh cakes',
    });
    expect(understandPartner('share my link')).toEqual({ kind: 'share' });
    expect(understandOrganisation('how much have we spent this month')).toEqual({ kind: 'spent' });
    expect(understandOrganisation("what's left in the budget")).toEqual({ kind: 'budget' });
    expect(understandOrganisation('read the orders')).toEqual({ kind: 'orders' });
  });

  it('writes a statement and says the saving honestly', () => {
    expect(statementCsv(ORG).split('\n')).toEqual([
      'Date,Person,Office,Items,Paid (GBP),Status,Order reference',
      '2026-10-06,"Mr Table","Ward B",3,16.00,delivered,o1',
    ]);
    expect(savedWords({ ...ORG, totals: { ...ORG.totals, savedThisMonthPence: null } })).toMatch(
      /tell me what one of your own staff/,
    );
  });
});

describe('Spotlight, age group and share links for Shoppers', () => {
  it('shows one advert after the genuine results, called an advert, and Ozi says so', async () => {
    window.localStorage.setItem('ozidelivery.session.token', 'test-token');
    const engine = fakeEngine();
    setVoiceEngine(engine);
    renderAt('/shop?q=bread');
    expect(await screen.findByText('White sliced bread, 800g')).toBeInTheDocument();
    const advert = await screen.findByRole('complementary', { name: 'Advert' });
    expect(advert).toHaveTextContent('Sourdough loaf is in stock at Corner Bakery, about £3.50.');
    expect(advert).toHaveTextContent('Corner Bakery pays for this mention.');
    await waitFor(() =>
      expect(spoken(engine)).toContain('Advert: Sourdough loaf is in stock at Corner Bakery'),
    );
  });

  it('lets a Shopper give an age group, or take it away', async () => {
    window.localStorage.setItem('ozidelivery.session.token', 'test-token');
    const user = userEvent.setup({ delay: null });
    renderAt('/settings');
    await user.selectOptions(await screen.findByLabelText('Age group'), '65_plus');
    expect(await screen.findByText('Saved. Thank you.')).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/me' && r.method === 'PATCH')?.body).toEqual({
      ageBand: '65_plus',
    });
  });

  it('counts a new account for the shop whose link brought them', async () => {
    window.localStorage.removeItem('ozidelivery.session.token');
    renderAt('/shops/shop-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Corner Bakery' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('partner:shop-1'),
    );
  });
});
