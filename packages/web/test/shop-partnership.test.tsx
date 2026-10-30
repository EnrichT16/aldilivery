/**
 * What every shop page and card says (Anthony, 30 October 2026): a shop Ozi listed says it is
 * not a partner and that its hours are typical ones to check, and a national chain's branch
 * invites no claim; prices are "shop prices plus a small item charge, always shown", never on
 * a café's card; delivery is "from" the lowest price in config; the award badge says it is the
 * Shoppers' award, with a word that reviewers earn points for any honest rating; and the
 * Halloween panel no longer leads to an empty offers page.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliveryPriceRange } from '@aldilivery/core';

import { App } from '../src/App';
import { seasonFor } from '../src/components/ShopHome';
import { storeConfig } from '../src/config';
import { money } from '../src/lib/money';
import { FAKE_CATALOGUE } from './setup';

const ROW = {
  about: '',
  area: 'ME7',
  hours: 'Monday to Saturday 8am to 10pm',
  products: 0,
  cuisines: [],
  specialities: [],
  categories: [],
  convenience: false,
  ofstedNumber: '',
  awards: [] as string[],
};

const CHAIN = {
  ...ROW,
  id: 'chain-1',
  name: 'Big Chain Gillingham',
  kind: 'shop',
  kindWords: 'Shop',
  section: 'shops',
  listedByOzi: true,
};
const PARTNER = {
  ...ROW,
  id: 'partner-1',
  name: 'Corner Bakery',
  kind: 'shop',
  kindWords: 'Shop',
  section: 'shops',
  listedByOzi: false,
  awards: ['Shop of the Month, September 2026'],
};
const CAFE = {
  ...ROW,
  id: 'cafe-1',
  name: 'Rainham Café',
  kind: 'food',
  kindWords: 'Café or takeaway',
  section: 'restaurants',
  listedByOzi: false,
};

beforeEach(() => {
  window.localStorage.clear();
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
    vi.fn(async (url: string) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const page = (shop: typeof CHAIN) =>
        reply({ shop: { ...shop, address: 'High Street', claimable: false }, products: [] });
      if (path === '/shops/chain-1') return page(CHAIN);
      if (path === '/shops/partner-1') return page(PARTNER);
      if (path === '/shops/cafe-1') return page(CAFE);
      if (path === '/shops' || path.startsWith('/shops?')) {
        return reply({ shops: [CHAIN, PARTNER, CAFE], near: null });
      }
      if (path.startsWith('/catalogue/search')) return reply(FAKE_CATALOGUE);
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
      if (path === '/ozi/reply') return reply({ reply: null });
      return reply({ error: { message: `Nothing stubbed for ${path}` } }, 404);
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

const NOT_PARTNER = "We don't have a partnership with this shop yet.";

describe('a shop Ozi listed', () => {
  it('says it is not a partner, gives typical hours, and has no claim link for a chain', async () => {
    renderAt('/shops/chain-1');
    expect(await screen.findByText(/Listed by Ozi from public details/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(NOT_PARTNER))).toBeInTheDocument();
    expect(screen.getByText('Typical hours, please check with the shop')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Claim this shop' })).toBeNull();
  });

  it('says so on its card on the shops list, and not on a partner’s', async () => {
    renderAt('/shops');
    const item = (await screen.findByText('Big Chain Gillingham')).closest('li') as HTMLElement;
    expect(within(item).getByText(NOT_PARTNER)).toBeInTheDocument();
    expect(
      within(item).getByText(/Typical hours, please check with the shop: /),
    ).toBeInTheDocument();
    const partner = screen.getByText('Corner Bakery').closest('li') as HTMLElement;
    expect(within(partner).queryByText(NOT_PARTNER)).toBeNull();
  });
});

describe('a partner’s page', () => {
  it('has the shop-prices line, delivery from the lowest price, and the Shoppers’ award', async () => {
    renderAt('/shops/partner-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Corner Bakery' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Shop prices plus a small item charge, always shown'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Till prices|no mark-up/)).toBeNull();
    const lowest = deliveryPriceRange(storeConfig.fees).lowestPence;
    expect(lowest).toBe(699);
    expect(screen.getByText(`Delivery from ${money(lowest)}`)).toBeInTheDocument();
    expect(screen.getByText("Ozi Shoppers' Shop of the Month, September 2026")).toBeInTheDocument();
    expect(screen.getByText('Reviewers earn points for any honest rating.')).toBeInTheDocument();
    expect(screen.queryByText(NOT_PARTNER)).toBeNull();
    expect(screen.getByText('Opens')).toBeInTheDocument();
  });

  it('leaves the shop-prices line off a café, which sets its own prices', async () => {
    renderAt('/shops/cafe-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rainham Café' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Shop prices plus a small item charge, always shown')).toBeNull();
  });
});

describe('the home page', () => {
  it('cards say who is not a partner, no café gets the shop-prices line, and no panel leads to empty offers', async () => {
    renderAt('/shop');
    const heading = await screen.findByRole('heading', { name: 'Stock up at local shops' });
    const section = heading.closest('section') as HTMLElement;
    const card = (await within(section).findByText('Big Chain Gillingham')).closest(
      'a',
    ) as HTMLElement;
    expect(within(card).getByText(NOT_PARTNER)).toBeInTheDocument();
    const cafe = within(section).getByText('Rainham Café').closest('a') as HTMLElement;
    expect(within(cafe).queryByText(/Shop prices|Till prices/)).toBeNull();
    const bakery = within(section).getByText('Corner Bakery').closest('a') as HTMLElement;
    expect(
      within(bakery).getByText('Shop prices plus a small item charge, always shown'),
    ).toBeInTheDocument();
    expect(
      within(bakery).getByText("Ozi Shoppers' Shop of the Month, September 2026"),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See the offers' })).toBeNull();
    if (seasonFor(new Date()) === 'halloween') {
      expect(screen.getByRole('link', { name: 'Search the shop' })).toHaveAttribute(
        'href',
        '/shop?q=sweets',
      );
    }
  });
});
