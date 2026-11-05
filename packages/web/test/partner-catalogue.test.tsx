/**
 * The Shop Partner catalogue on the screens (ruling 96, 5 November 2026): the three packages on
 * the dashboard with their buttons, the add form with the camera or a chosen photo and the
 * taxonomy, variants and featuring on each product, the spreadsheet upload for Pro only, the
 * shop page's gallery, size chooser, unit price, allergens and stepper, and the staff review
 * with every photo.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import type {
  PartnerDashboard,
  PartnerPackage,
  PartnerProductRow,
  ProductPhoto,
  PublicShopPage,
} from '../src/lib/api';
import { productGroups, variantCards } from '../src/pages/Shops';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown }>;

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

function pathOf(url: string): string {
  return String(url)
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api(?=\/|$)/, '');
}

function photo(id: string, alt: string): ProductPhoto {
  const base = `/shops/shop-1/products/p1/photos/${id}`;
  return {
    id,
    alt,
    width: 1200,
    height: 900,
    thumb: `${base}/thumb/webp`,
    medium: `${base}/medium/webp`,
    full: `${base}/full/webp`,
    thumbJpeg: `${base}/thumb/jpg`,
    mediumJpeg: `${base}/medium/jpg`,
    fullJpeg: `${base}/full/jpg`,
  };
}

const LIMITS = {
  free: {
    name: 'Free listing',
    products: 10,
    photosPerProduct: 1,
    variants: false,
    featured: false,
    bulkAdd: false,
    runnerCalls: false,
    approvalPriority: 'normal' as const,
  },
  plus: {
    name: 'Shop Partner Plus',
    products: 300,
    photosPerProduct: 3,
    variants: true,
    featured: false,
    bulkAdd: false,
    runnerCalls: true,
    approvalPriority: 'normal' as const,
  },
  pro: {
    name: 'Shop Partner Pro',
    products: 3000,
    photosPerProduct: 6,
    variants: true,
    featured: true,
    bulkAdd: true,
    runnerCalls: true,
    approvalPriority: 'high' as const,
  },
};

function packages(current: 'free' | 'plus' | 'pro'): PartnerPackage[] {
  return (['free', 'plus', 'pro'] as const).map((tier) => ({
    tier,
    name: LIMITS[tier].name,
    monthlyPence: tier === 'free' ? 0 : tier === 'plus' ? 1499 : 2999,
    payPence: tier === 'free' ? 0 : tier === 'plus' ? 1499 : 2999,
    limits: LIMITS[tier],
    gives: [`Up to ${LIMITS[tier].products.toLocaleString('en-GB')} products`, `${LIMITS[tier].photosPerProduct} photos a product`],
    current: tier === current,
    paid: tier === current,
    action: tier === 'free' ? 'none' : tier === current ? 'renew' : current === 'free' ? 'start' : 'upgrade',
    firstMonthFree: current === 'free',
  }));
}

const CATALOGUE = {
  categories: [
    { id: 'fruit-veg', name: 'Fruit and vegetables', kind: 'grocery', requires: ['unit' as const] },
    { id: 'bakery', name: 'Bakery', kind: 'grocery', requires: ['allergens' as const] },
  ],
  allergens: ['Celery', 'Cereals containing gluten', 'Eggs', 'Milk'],
  units: ['g', 'kg', 'ml', 'l', 'each', 'pack'],
  descriptionMaxLength: 600,
  photoRules: ['One product in the photo, in the middle, filling most of it.'],
  bulkColumns: ['name', 'price', 'category', 'unit quantity', 'unit', 'allergens', 'barcode', 'description'],
};

const BANANAS: PartnerProductRow = {
  id: 'p1',
  name: 'Bananas',
  pricePence: 120,
  tags: '',
  expiresOn: null,
  hasPhoto: true,
  status: 'approved',
  note: null,
  catalogueItemId: 'c1',
  createdAt: '2026-11-05T10:00:00.000Z',
  durationMinutes: null,
  description: 'Five ripe bananas.',
  category: { id: 'fruit-veg', name: 'Fruit and vegetables' },
  unit: { quantity: 5, unit: 'each', quantityWords: '5 each', perPence: 24, per: 'each', words: '£0.24 each' },
  allergens: [],
  allergenWords: 'No listed allergens',
  featured: false,
  sortOrder: 0,
  variantGroupId: null,
  variantLabel: null,
  photos: [photo('ph1', 'Bananas'), photo('ph2', 'Bananas, photo 2')],
};

function dashboardOn(tier: 'free' | 'plus' | 'pro'): PartnerDashboard {
  return {
    shop: {
      id: 'shop-1',
      name: 'Corner Shop',
      address: '12 High Street',
      telephone: '',
      about: 'Groceries.',
      kind: 'shop',
      kindWords: 'Shop',
      postcode: 'ME7 1AA',
      hours: '',
      status: 'approved',
      active: true,
      listed: true,
    },
    plan: {
      tier,
      monthlyPence: tier === 'free' ? 0 : tier === 'plus' ? 1499 : 2999,
      plusMonthlyPence: 1499,
      proMonthlyPence: 2999,
      paidUntil: tier === 'free' ? null : '2026-12-05T10:00:00.000Z',
      paid: tier !== 'free',
      freeForever: tier === 'free',
      firstMonthFree: tier === 'free',
      productLimit: LIMITS[tier].products,
      productsListed: 1,
      canAddProduct: true,
      words: `${LIMITS[tier].name} words.`,
      limits: LIMITS[tier],
      packages: packages(tier),
    },
    catalogue: CATALOGUE,
    restaurant: null,
    enquiries: [],
    counts: { live: 1, waiting: 0, notAccepted: 0 },
    products: [BANANAS, { ...BANANAS, id: 'p2', name: 'Apples', photos: [], hasPhoto: false }],
    sharePath: '/shops/shop-1',
    spotlight: {
      level: 'none',
      until: null,
      mentionsThisMonth: 0,
      prices: { spotlightPence: 1999, plusPence: 3999, spotlightPerWeek: 1, plusPerWeek: 3 },
    },
    payments: [],
    referrals: 0,
    numbers: { purchasesThisWeek: 0, purchasesThisMonth: 0, itemsThisMonth: 0 },
  };
}

const SHOP_PAGE: PublicShopPage = {
  shop: {
    id: 'shop-1',
    name: 'Corner Shop',
    about: 'Groceries.',
    address: '12 High Street',
    kind: 'shop',
    kindWords: 'Shop',
    area: 'ME7',
    hours: '',
    listedByOzi: false,
    claimable: false,
    packageName: 'Shop Partner Pro',
    featuredOrdering: true,
  },
  categories: [
    { id: 'fruit-veg', name: 'Fruit and vegetables' },
    { id: 'cupboard', name: 'Cupboard' },
  ],
  products: [
    {
      id: 'rice1',
      name: 'Rice',
      pricePence: 200,
      tags: '',
      expiresOn: null,
      hasPhoto: false,
      catalogueItemId: 'c-rice1',
      description: 'Basmati.',
      category: { id: 'cupboard', name: 'Cupboard' },
      unit: { quantity: 1, unit: 'kg', quantityWords: '1 kg', perPence: 200, per: 'kg', words: '£2.00 per kg' },
      allergens: [],
      allergenWords: 'No listed allergens',
      featured: true,
      sortOrder: 0,
      variantGroupId: 'rice1',
      variantLabel: null,
      photos: [],
    },
    {
      id: 'rice5',
      name: 'Rice',
      pricePence: 700,
      tags: '',
      expiresOn: null,
      hasPhoto: false,
      catalogueItemId: 'c-rice5',
      unit: { quantity: 5, unit: 'kg', quantityWords: '5 kg', perPence: 140, per: 'kg', words: '£1.40 per kg' },
      allergens: [],
      allergenWords: 'No listed allergens',
      featured: false,
      sortOrder: 1,
      variantGroupId: 'rice1',
      variantLabel: '5 kg',
      photos: [],
    },
    {
      id: 'p1',
      name: 'Bananas',
      pricePence: 120,
      tags: '',
      expiresOn: null,
      hasPhoto: true,
      catalogueItemId: 'c1',
      description: 'Five ripe bananas.',
      category: { id: 'fruit-veg', name: 'Fruit and vegetables' },
      unit: { quantity: 5, unit: 'each', quantityWords: '5 each', perPence: 24, per: 'each', words: '£0.24 each' },
      allergens: ['Milk'],
      allergenWords: 'Contains milk',
      featured: false,
      sortOrder: 2,
      variantGroupId: null,
      variantLabel: null,
      photos: [photo('ph1', 'Bananas'), photo('ph2', 'Bananas, photo 2')],
    },
  ],
};

let dashboard: PartnerDashboard;

beforeEach(() => {
  sent = [];
  dashboard = dashboardOn('pro');
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      if (path === '/business/me') {
        return json({ kind: 'partner', name: 'Bola', office: '', business: 'Corner Shop', mustChangePassword: false });
      }
      if (path === '/partner/dashboard') return json(dashboard);
      if (path === '/partner/plan/checkout') return json({ url: null, message: 'Shop Partner Pro is on.' });
      if (path === '/partner/products' && method === 'POST') {
        return json({ product: BANANAS, photoNotes: [], message: 'Thank you. Pears, £1.00, is waiting to be checked.' }, 201);
      }
      if (path === '/partner/products/p1/featured') return json({ product: BANANAS, message: 'Bananas is featured: Shoppers see it first.' });
      if (path === '/partner/products/order') return json({ message: 'Your order is saved. Shoppers see your page in that order.' });
      if (path === '/partner/products/bulk') {
        return json({
          results: [
            { row: 2, ok: true, name: 'Pears', status: 'pending' },
            { row: 3, ok: false, name: 'Lager', error: 'We never bring alcohol.' },
          ],
          added: 1,
          failed: 1,
          message: '1 added, 1 not: see each row below, put it right, and send those rows again.',
        });
      }
      if (path === '/shops/shop-1') return json(SHOP_PAGE);
      if (path.startsWith('/catalogue/c')) {
        const id = path.slice('/catalogue/'.length);
        const product = SHOP_PAGE.products.find((row) => row.catalogueItemId === id);
        return json({
          found: true,
          item: { id, name: `${product?.name ?? 'Thing'} (Corner Shop)`, category: 'From Corner Shop', estimatedPricePence: product?.pricePence ?? 100 },
        });
      }
      if (path === '/me') return json({ role: 'shopper', shopper: FAKE_SHOPPER });
      if (path === '/orders/current') return json({ order: null });
      if (path.startsWith('/config')) return json({ push: { publicKey: null } });
      // Staff (the review of waiting products).
      const me = { name: 'Bola', role: 'partnerships', title: 'Partnerships officer', areas: ['enquiries', 'partners'], mustChangePassword: false };
      if (path === '/staff/sign-in') return json({ token: 'st1.bola.sig', ...me });
      if (path === '/staff/me') return json({ ...me, account: true });
      if (path === '/staff/enquiries') return json({ enquiries: [] });
      if (path === '/staff/partner-products') {
        return json({
          products: [
            {
              ...BANANAS,
              status: 'pending',
              catalogueItemId: null,
              photos: [
                { ...photo('ph1', 'Bananas'), thumb: 'https://cdn.example/ph1-thumb.webp', thumbJpeg: 'https://cdn.example/ph1-thumb.jpg', fullJpeg: 'https://cdn.example/ph1-full.jpg' },
                { ...photo('ph2', 'Bananas, photo 2'), thumb: 'https://cdn.example/ph2-thumb.webp', thumbJpeg: 'https://cdn.example/ph2-thumb.jpg', fullJpeg: 'https://cdn.example/ph2-full.jpg' },
              ],
              shopName: 'Corner Shop',
              shopKind: 'shop',
              packageName: 'Shop Partner Pro',
              priority: 'high',
            },
          ],
        });
      }
      if (path === '/staff/partners') {
        return json({
          shops: [],
          organisations: [],
          plusMonthlyPence: 1499,
          freeListingCount: 100,
          freeListed: 3,
          freeProductLimit: 10,
          restaurantWords: '',
          preferredDiscountPercent: 20,
          maximumDiscountPercent: 30,
          maximumMarkupPercent: 50,
          spotlightPence: 1999,
          spotlightPlusPence: 3999,
          seedShops: 0,
        });
      }
      return json({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function openDashboard() {
  window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
  renderAt('/partner');
  expect(await screen.findByRole('heading', { level: 1, name: 'Corner Shop' })).toBeInTheDocument();
}

describe('the plan page', () => {
  it('shows the three packages, what each gives, and one button each; moving up posts the package', async () => {
    dashboard = dashboardOn('plus');
    const user = userEvent.setup({ delay: null });
    await openDashboard();
    const list = screen.getByRole('list', { name: 'The packages' });
    expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Free listing',
      'Shop Partner Plus (your package)',
      'Shop Partner Pro',
    ]);
    expect(within(list).getByText('Up to 3,000 products')).toBeInTheDocument();
    expect(within(list).getByText('£29.99 a month')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Renew Shop Partner Plus, £14.99 for a month' })).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Move to Shop Partner Pro, £29.99 a month' }));
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/partner/plan/checkout')?.body).toEqual({ kind: 'pro', months: 1, returnTo: '/partner' });
    });
    expect(await screen.findByText('Shop Partner Pro is on.')).toBeInTheDocument();
  });

  it('a Free shop is offered a start on Plus or Pro with the first month free', async () => {
    dashboard = dashboardOn('free');
    await openDashboard();
    expect(screen.getByRole('button', { name: 'Start Shop Partner Plus, first month free' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Shop Partner Pro, first month free' })).toBeInTheDocument();
  });
});

describe('the add form', () => {
  it('offers the camera or a chosen photo, the category, the size, the allergens and the photo rules, and sends the details', async () => {
    const user = userEvent.setup({ delay: null });
    await openDashboard();
    const form = screen.getByRole('form', { name: 'Add a product' });
    expect(within(form).getByLabelText('Take a photo')).toHaveAttribute('capture', 'environment');
    expect(within(form).getByLabelText('Choose a photo')).toHaveAttribute('type', 'file');
    expect(within(form).getByText('One product in the photo, in the middle, filling most of it.')).toBeInTheDocument();
    expect(within(form).getByText(/Photos: up to 6 on your package/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText('What it is'), 'Pears');
    await user.type(within(form).getByLabelText('Your counter price, in pounds'), '1.00');
    await user.selectOptions(within(form).getByLabelText('Category'), 'fruit-veg');
    expect(within(form).getByText(/Size, so Shoppers see the price per kilo/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText('How much'), '4');
    await user.selectOptions(within(form).getByLabelText('In what'), 'each');
    await user.type(within(form).getByLabelText(/A few words about it/), 'Conference pears.');
    await user.click(within(form).getByLabelText('None of the fourteen'));
    await user.click(within(form).getByRole('button', { name: 'Send it to be checked' }));
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/partner/products' && r.method === 'POST')?.body).toEqual({
        name: 'Pears',
        pricePence: 100,
        tags: '',
        description: 'Conference pears.',
        categoryId: 'fruit-veg',
        unitQuantity: 4,
        unitKind: 'each',
        allergens: [],
      });
    });
    expect(await screen.findByText(/Pears, £1\.00, is waiting to be checked/)).toBeInTheDocument();
  });

  it('a Free shop sees one photo and no sizes-and-packs, no featuring and no spreadsheet', async () => {
    dashboard = dashboardOn('free');
    await openDashboard();
    expect(screen.getByText(/Photos: up to 1 on your package/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a size or pack of this/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Feature it/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Add products from a spreadsheet' })).toBeNull();
  });
});

describe('each product on a Pro dashboard', () => {
  it('shows its details and photos, features it, moves it, and opens the form for a size or pack', async () => {
    const user = userEvent.setup({ delay: null });
    await openDashboard();
    const list = screen.getByRole('heading', { name: 'Your products' }).parentElement!;
    // Both products (Apples is a copy of Bananas) carry the details line.
    expect(within(list).getAllByText(/Fruit and vegetables\. Size 5 each\. £0\.24 each\. No listed allergens/)).toHaveLength(2);
    expect(within(list).getByRole('img', { name: 'Bananas (the cover)' })).toBeInTheDocument();
    expect(within(list).getByRole('img', { name: 'Bananas, photo 2' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Make it the cover of Bananas, photo 2' })).toBeInTheDocument();
    expect(within(list).getByLabelText('Take another photo')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Feature it.*Bananas/ }));
    await waitFor(() => expect(sent.find((r) => r.path === '/partner/products/p1/featured')?.body).toEqual({ featured: true }));
    expect(within(list).getByRole('button', { name: /Move up.*Bananas/ })).toBeDisabled();
    await user.click(within(list).getByRole('button', { name: /Move down.*Bananas/ }));
    await waitFor(() => expect(sent.find((r) => r.path === '/partner/products/order')?.body).toEqual({ ids: ['p2', 'p1'] }));
    await user.click(within(list).getByRole('button', { name: /Add a size or pack of this.*Bananas/ }));
    const form = await screen.findByRole('form', { name: 'Add a size or pack of Bananas' });
    expect(within(form).getByLabelText(/Which size or pack/)).toBeInTheDocument();
    expect(within(form).getByLabelText('What it is')).toHaveValue('Bananas');
  });

  it('a Pro shop uploads a spreadsheet and reads each row’s outcome', async () => {
    const user = userEvent.setup({ delay: null });
    await openDashboard();
    const section = screen.getByRole('heading', { name: 'Add products from a spreadsheet' }).parentElement!;
    expect(within(section).getByRole('button', { name: 'Download the template (CSV)' })).toBeInTheDocument();
    await user.type(
      within(section).getByLabelText('Or paste the lines here'),
      'name,price,category,unit quantity,unit,allergens,barcode,description\nPears,1.00,Fruit and vegetables,4,each,none,,',
    );
    await user.click(within(section).getByRole('button', { name: 'Add these products' }));
    await waitFor(() => expect(sent.some((r) => r.path === '/partner/products/bulk')).toBe(true));
    const outcomes = await screen.findByRole('list', { name: 'What happened to each row' });
    expect(within(outcomes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Row 2, Pears: added, waiting to be checked.',
      'Row 3, Lager: We never bring alcohol.',
    ]);
  });
});

describe('the shop page', () => {
  it('groups by category, puts featured first, shows the gallery, the unit price and the allergens, and chooses a size', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/shops/shop-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Corner Shop' })).toBeInTheDocument();
    // The taxonomy's order: Fruit and vegetables before Cupboard.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => t === 'Fruit and vegetables' || t === 'Cupboard')).toEqual(['Fruit and vegetables', 'Cupboard']);
    expect(screen.getByText('Five ripe bananas.')).toBeInTheDocument();
    expect(screen.getByText('Contains milk.')).toBeInTheDocument();
    // The unit price beside the shown price, worked from the price with the item charge.
    expect(screen.getByText(/About £1\.70 for 5 each\. £0\.34 each\./)).toBeInTheDocument();
    // The gallery: two photos, next and previous, each with its alt text.
    const gallery = screen.getByRole('group', { name: 'Photos of Bananas, 2' });
    expect(within(gallery).getByRole('img', { name: 'Bananas' })).toBeInTheDocument();
    await user.click(within(gallery).getByRole('button', { name: 'Next photo of Bananas' }));
    expect(within(gallery).getByRole('img', { name: 'Bananas, photo 2' })).toBeInTheDocument();
    // Sizes and packs of one product as one card with a chooser; "Featured" on the group's lead.
    expect(screen.getByText('Featured')).toBeInTheDocument();
    const chooser = screen.getByRole('combobox', { name: 'Size or pack' });
    expect(
      within(chooser)
        .getAllByRole('option')
        .map((o) => o.textContent?.replace(/\s+/g, ' ').trim()),
    // The item charge is in the shown price: 50p, plus 50p for the whole £6 in £7.00 (Rule Three).
    ).toEqual(['Standard, about £2.50', '5 kg, about £8.00']);
    await user.selectOptions(chooser, 'rice5');
    expect(screen.getByText(/About £8\.00 for 5 kg\. £1\.60 per kg\./)).toBeInTheDocument();
    // The stepper: plus adds, the count is read out, minus takes one away.
    const stepper = screen.getByRole('group', { name: 'How many Rice, 5 kg' });
    expect(within(stepper).getByRole('button', { name: 'One fewer Rice, 5 kg' })).toBeDisabled();
    await user.click(within(stepper).getByRole('button', { name: 'Add to my basket: Rice, 5 kg' }));
    expect(await screen.findByText(/I've put Rice in your basket/)).toBeInTheDocument();
    await waitFor(() => expect(within(stepper).getByText('1')).toBeInTheDocument());
    await user.click(within(stepper).getByRole('button', { name: 'One more Rice, 5 kg' }));
    expect(within(stepper).getByText('2')).toBeInTheDocument();
    await user.click(within(stepper).getByRole('button', { name: 'One fewer Rice, 5 kg' }));
    expect(within(stepper).getByText('1')).toBeInTheDocument();
  });

  it('groups and cards are worked out plainly', () => {
    const cards = variantCards(SHOP_PAGE.products);
    expect(cards.map((card) => card.variants.map((v) => v.id))).toEqual([['rice1', 'rice5'], ['p1']]);
    expect(productGroups(cards, SHOP_PAGE.categories ?? [], 'Products').map((g) => [g.name, g.cards.length])).toEqual([
      ['Fruit and vegetables', 1],
      ['Cupboard', 1],
    ]);
  });
});

describe('the staff review', () => {
  it('shows every photo, the details, the package and that a Pro product is checked first', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'bola');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('tab', { name: 'Shops and organisations' }));
    const heading = await screen.findByRole('heading', { level: 4, name: /Bananas, £1\.20, from Corner Shop/ });
    expect(heading).toHaveTextContent('Checked first');
    const card = heading.parentElement!;
    expect(within(card).getByText(/Shop Partner Pro\. Fruit and vegetables\. Size 5 each, £0\.24 each\. No listed allergens\./)).toBeInTheDocument();
    expect(within(card).getByText('Five ripe bananas.')).toBeInTheDocument();
    const photos = within(card).getByRole('list', { name: 'Photos of Bananas' });
    expect(within(photos).getByRole('img', { name: 'Bananas (the cover)' })).toHaveAttribute('src', 'https://cdn.example/ph1-thumb.jpg');
    expect(within(photos).getByRole('img', { name: 'Bananas, photo 2' })).toBeInTheDocument();
    await user.click(within(photos).getAllByRole('button', { name: /Show it large/ })[0]!);
    expect(within(photos).getByRole('img', { name: 'Bananas (the cover)' })).toHaveAttribute('src', 'https://cdn.example/ph1-full.jpg');
    expect(within(card).getByRole('button', { name: 'Accept Bananas' })).toBeInTheDocument();
  });
});
