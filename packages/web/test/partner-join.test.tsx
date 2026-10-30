/**
 * Shops join by themselves (ruling 65): the join form with the mobile confirmed by a code, the
 * dashboard's pay and renew buttons through Stripe Checkout, Ozi listing shops its owner can claim,
 * and a Shopper asking a service for a quote.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import type { PartnerDashboard } from '../src/lib/api';
import { setScannerDevices, understandScanVoice } from '../src/components/ProductScanner';
import { heardKind, heardPlan, planQuestion } from '../src/pages/PartnerJoin';
import { durationWords, heardEnquiry } from '../src/pages/Shops';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let dashboard: PartnerDashboard;
/** How many free listings the join options say are left. */
let freeLeft: number;

const BAKERY_DASHBOARD: PartnerDashboard = {
  shop: {
    id: 'shop-1',
    name: 'Corner Bakery',
    address: '12 High Street',
    telephone: '',
    about: 'Fresh bread.',
    kind: 'shop',
    kindWords: 'Shop',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    status: 'pending',
    active: true,
    listed: false,
  },
  plan: {
    tier: 'free',
    monthlyPence: 0,
    plusMonthlyPence: 1499,
    paidUntil: null,
    paid: false,
    freeForever: true,
    firstMonthFree: true,
    productLimit: 10,
    productsListed: 0,
    canAddProduct: true,
    words:
      'Free listing: your name, address, hours and up to 10 products. Partner Plus, £14.99 a month, adds the full catalogue with photos, Shop of the Month, and first place among shops at the same distance, with the first month free.',
  },
  restaurant: null,
  enquiries: [],
  counts: { live: 0, waiting: 0, notAccepted: 0 },
  products: [],
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

beforeEach(() => {
  sent = [];
  dashboard = BAKERY_DASHBOARD;
  freeLeft = 97;
  window.sessionStorage.clear();
  window.localStorage.clear();
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
      if (path === '/partner/join/options') {
        return reply({
          kinds: [
            { kind: 'shop', words: 'Shop' },
            { kind: 'food', words: 'Café or takeaway' },
            { kind: 'service', words: 'Service' },
          ],
          freeListingsLeft: freeLeft,
          freeProductLimit: 10,
          plusMonthlyPence: 1499,
          plusFirstMonthFree: true,
          restaurantWords:
            'A restaurant, café or takeaway order has a flat restaurant fee of £12 in place of delivery, and the smallest order is £10 of dishes.',
          preferredDiscountPercent: 20,
          spotlightPence: 1999,
          spotlightPlusPence: 3999,
          excludedServiceKinds: ['credit', 'loans', 'mortgages', 'insurance'],
          mobileConfirmed: true,
        });
      }
      if (path === '/auth/request-code') {
        return reply({ sent: true, message: 'We have sent you a code. It lasts ten minutes.' });
      }
      if (path === '/auth/verify-code') {
        return reply({
          registrationRequired: true,
          phone: '+447700900222',
          phoneProof: 'proof.partner',
          message: 'Thank you, that is your number.',
        });
      }
      if (path === '/partner/join' && (body as { payNow?: boolean }).payNow) {
        return reply(
          {
            token: 'bz1.new.shop',
            kind: 'partner',
            name: 'Bola',
            office: '',
            business: 'Corner Bakery',
            mustChangePassword: false,
            shop: { id: 'shop-1', status: 'pending', plan: 'plus', freeForever: false },
            checkout: {
              url: 'https://checkout.rehearsal.invalid/cs_rehearsal_join',
              receipt: 'pc1.join.receipt',
            },
            message: 'Welcome, Bola. Taking you to pay £14.99 for Partner Plus.',
          },
          201,
        );
      }
      if (path === '/partner/scan/barcode') {
        return reply({
          draft: {
            name: 'Baked beans, 415g',
            pricePence: 85,
            priceEstimated: true,
            barcode: (body as { barcode: string }).barcode,
          },
        });
      }
      if (path === '/partner/scan/label') {
        return reply({
          draft: {
            name: 'Braeburn apples, 6 pack',
            pricePence: 240,
            priceEstimated: false,
            barcode: null,
          },
          message: '',
        });
      }
      if (path === '/partner/products' && method === 'POST') {
        return reply({ product: { id: 'p-new' }, message: 'Thank you.' }, 201);
      }
      if (path === '/partner/join') {
        return reply(
          {
            token: 'bz1.new.shop',
            kind: 'partner',
            name: 'Bola',
            office: '',
            business: 'Corner Bakery',
            mustChangePassword: false,
            shop: { id: 'shop-1', status: 'pending', plan: 'free', freeForever: true },
            message:
              'Welcome, Bola. Corner Bakery is set up. You can add products now; your page goes public once we have checked it, usually within one working day. Your basic listing is free, for ever.',
          },
          201,
        );
      }
      if (path === '/partner/dashboard') return reply(dashboard);
      if (path === '/partner/plan/checkout') {
        return reply({
          url: 'https://checkout.rehearsal.invalid/cs_rehearsal_1',
          receipt: 'pc1.receipt',
          message: 'Taking you to pay £14.99 for Partner Plus.',
        });
      }
      if (path === '/partner/plan/confirm') {
        return reply({
          recorded: true,
          message: 'Thank you. Partner Plus is paid, £14.99, until 17 November 2026.',
        });
      }
      if (path === '/business/me') {
        return reply({
          kind: 'partner',
          name: 'Bola',
          office: '',
          business: 'Corner Bakery',
          mustChangePassword: false,
        });
      }
      if (path === '/shops/seed-1') {
        return reply({
          shop: {
            id: 'seed-1',
            name: 'Big Shop Gillingham',
            about: 'Supermarket on the High Street.',
            address: 'High Street, Gillingham',
            kind: 'shop',
            kindWords: 'Shop',
            area: 'ME7',
            hours: 'Monday to Saturday 8am to 10pm, Sunday 10am to 4pm',
            listedByOzi: true,
            claimable: true,
          },
          products: [],
        });
      }
      if (path === '/shops/barber-1') {
        return reply({
          shop: {
            id: 'barber-1',
            name: 'Tony’s Barbers',
            about: 'Barber and hairdresser.',
            address: '3 High Street, Chatham',
            kind: 'service',
            kindWords: 'Service',
            area: 'ME4',
            hours: 'Tuesday to Saturday 9am to 6pm',
            listedByOzi: false,
            claimable: false,
          },
          products: [
            {
              id: 'svc-1',
              name: 'Haircut',
              pricePence: 1200,
              tags: '',
              expiresOn: null,
              hasPhoto: false,
              catalogueItemId: null,
              durationMinutes: 30,
            },
          ],
        });
      }
      if (path === '/shops/barber-1/enquiry') {
        return reply(
          {
            enquiry: { id: 'e1', kind: 'quote', what: 'a quote', status: 'open' },
            message:
              'Done. Tony’s Barbers has your request for a quote about Haircut, and will get back to you. Nothing is paid through us for this.',
          },
          201,
        );
      }
      if (path === '/shops' || path.startsWith('/shops?')) {
        return reply({
          shops: [
            {
              id: 'seed-1',
              name: 'Big Shop Gillingham',
              about: 'Supermarket on the High Street.',
              kind: 'shop',
              kindWords: 'Shop',
              area: 'ME7',
              hours: '',
              listedByOzi: true,
              products: 0,
            },
            {
              id: 'barber-1',
              name: 'Tony’s Barbers',
              about: 'Barber and hairdresser.',
              kind: 'service',
              kindWords: 'Service',
              area: 'ME4',
              hours: '',
              listedByOzi: false,
              products: 1,
            },
          ],
        });
      }
      if (path === '/me') return reply({ role: 'shopper', shopper: FAKE_SHOPPER });
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

describe('joining as a shop', () => {
  it('is offered from the business sign-in, and lists what it costs from config', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/business');
    await user.click(await screen.findByRole('link', { name: 'Join as a shop' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Join as a shop' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/for the next 97 shops to join/)).toBeInTheDocument();
    expect(
      screen.getByText('Shops: a basic listing, free, with no monthly fee'),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'What each plan gives a shop' })).toBeInTheDocument();
    // No commission for restaurants (30 October 2026); an optional discount instead.
    expect(
      screen.getByText('Restaurants, cafés and takeaways: no monthly fee and no commission.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/10% of each order/)).toBeNull();
    expect(
      screen.getByText(/We cannot list credit, loans, mortgages, insurance/),
    ).toBeInTheDocument();
  });

  it('confirms the mobile with a code, then joins and lands on the dashboard, pending', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/business/join');
    await screen.findByText(/for the next 97 shops to join/);
    await user.type(screen.getByLabelText('The business’s name'), 'Corner Bakery');
    await user.type(screen.getByLabelText('Address'), '12 High Street, Gillingham');
    await user.type(screen.getByLabelText('Postcode'), 'ME7 1AA');
    await user.type(screen.getByLabelText('Opening hours'), 'Monday to Saturday 7am to 5pm');
    await user.type(screen.getByLabelText('Who should we speak to?'), 'Bola');
    await user.type(screen.getByLabelText('Mobile number'), '07700 900 222');
    await user.type(screen.getByLabelText('Email address'), 'bola@example.com');
    await user.type(screen.getByLabelText('What do you sell?'), 'Fresh bread every morning.');
    // What Shoppers find it under (ruling 82), from the lists in config.
    await user.click(screen.getByLabelText('Turkish'));
    await user.type(screen.getByLabelText('Choose a username'), 'cornerbakery');
    await user.type(screen.getByLabelText('Choose a password'), 'a-long-enough-password');
    // The Shop Partner terms must be agreed first (30 October 2026).
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(
      await screen.findByRole('link', { name: 'Please tick to agree to the Shop Partner terms.' }),
    ).toBeInTheDocument();
    expect(sent.some((r) => r.path === '/auth/request-code')).toBe(false);
    expect(screen.getByRole('link', { name: 'Read the Shop Partner terms' })).toHaveAttribute(
      'href',
      '/partner/terms',
    );
    await user.click(screen.getByLabelText('I agree to the Shop Partner terms'));
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(
      await screen.findByText('We have sent you a code. It lasts ten minutes.'),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/auth/request-code')?.body).toEqual({
      phone: '07700 900 222',
      role: 'partner',
      channel: 'text',
      purpose: 'sign-up',
    });
    await user.type(screen.getByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and join' }));

    await waitFor(() => {
      expect(sent.find((r) => r.path === '/partner/join')?.body).toEqual({
        name: 'Corner Bakery',
        kind: 'shop',
        address: '12 High Street, Gillingham',
        postcode: 'ME7 1AA',
        hours: 'Monday to Saturday 7am to 5pm',
        contactName: 'Bola',
        mobile: '07700 900 222',
        email: 'bola@example.com',
        about: 'Fresh bread every morning.',
        username: 'cornerbakery',
        password: 'a-long-enough-password',
        plan: 'free',
        termsAgreed: true,
        phoneProof: 'proof.partner',
        specialities: ['Turkish'],
        convenience: false,
      });
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Corner Bakery' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your page is not public yet/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ozidelivery.business.token')).toBe('bz1.new.shop');
  });

  it('a shop Ozi listed invites its owner to claim it, with the details filled in', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/shops/seed-1');
    expect(await screen.findByText(/Listed by Ozi from public details/)).toBeInTheDocument();
    // Not a partner, said plainly, and its hours are typical ones to check (30 October 2026).
    expect(
      screen.getByText(/We don't have a partnership with this shop yet\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Typical hours, please check with the shop')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Claim this shop' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Claim Big Shop Gillingham' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('The business’s name')).toHaveValue('Big Shop Gillingham'),
    );
    expect(screen.getByLabelText('Address')).toHaveValue('High Street, Gillingham');
    expect(screen.getByRole('button', { name: 'Claim this shop' })).toBeInTheDocument();
  });

  it('understands which kind of business was said', () => {
    expect(heardKind('a café on the high street')).toBe('food');
    expect(heardKind("it's a barber shop")).toBe('service');
    expect(heardKind('a corner shop')).toBe('shop');
    expect(heardKind('something else')).toBeNull();
  });
});

describe('paying from the dashboard', () => {
  it('starts Partner Plus with the first month free, then renews through Stripe Checkout', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
    const user = userEvent.setup({ delay: null });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' });
    renderAt('/partner');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Corner Bakery' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Free listing: your name/)).toBeInTheDocument();
    expect(screen.getByText('Photos come with Partner Plus.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Partner Plus, first month free' }));
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/partner/plan/checkout')?.body).toEqual({
        kind: 'plan',
        months: 1,
        returnTo: '/partner',
      });
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.rehearsal.invalid/cs_rehearsal_1'),
    );
    expect(window.sessionStorage.getItem('ozidelivery.partner.receipt')).toBe('pc1.receipt');
    vi.unstubAllGlobals();
  });

  it('records the payment when Stripe sends the shop back', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
    window.sessionStorage.setItem('ozidelivery.partner.receipt', 'pc1.receipt');
    renderAt('/partner?paid=cs_rehearsal_1');
    expect(
      await screen.findByText('Thank you. Partner Plus is paid, £14.99, until 17 November 2026.'),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/partner/plan/confirm')?.body).toEqual({
      receipt: 'pc1.receipt',
      sessionId: 'cs_rehearsal_1',
    });
    expect(window.sessionStorage.getItem('ozidelivery.partner.receipt')).toBeNull();
  });

  it('shows a café no commission, its discount and its orders, with no pay button', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
    dashboard = {
      ...BAKERY_DASHBOARD,
      shop: {
        ...BAKERY_DASHBOARD.shop,
        name: 'Rainham Café',
        kind: 'food',
        kindWords: 'Café or takeaway',
        status: 'approved',
        listed: true,
      },
      plan: {
        ...BAKERY_DASHBOARD.plan,
        freeForever: false,
        productLimit: null,
        words: 'No monthly fee and no commission.',
      },
      restaurant: {
        discountPercent: 20,
        preferred: true,
        preferredDiscountPercent: 20,
        ordersThisMonth: 3,
        goodsThisMonthPence: 4500,
        words: 'You have agreed a 20% discount, so our Runners pay your shop price less 20%.',
      },
      spotlight: { ...BAKERY_DASHBOARD.spotlight, freeWeekLeft: true },
    };
    renderAt('/partner');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rainham Café' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`3 orders through ${storeConfig.productName}, £45.00 of food and drink`, {
        exact: false,
      }),
    ).toBeInTheDocument();
    // The 10% commission is replaced (30 October 2026): nothing owed, ever.
    expect(screen.getByText(/No commission: you owe/)).toBeInTheDocument();
    expect(screen.queryByText(/owed:/)).toBeNull();
    expect(
      screen.getByRole('heading', { name: `${storeConfig.assistantName} Preferred Partner` }),
    ).toBeInTheDocument();
    // Partner Plus is free, so there is no button to pay for it; the free Spotlight week is there.
    expect(screen.queryByRole('button', { name: /Partner Plus/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Start my free Spotlight week' }),
    ).toBeInTheDocument();
  });
});

describe('a Shopper and a service', () => {
  it('sees kinds and areas on the shops list', async () => {
    renderAt('/shops');
    expect(await screen.findByText(/Shop, ME7/)).toBeInTheDocument();
    expect(screen.getByText(/Service, ME4/)).toBeInTheDocument();
    expect(screen.getByText(/Listed by Ozi\./)).toBeInTheDocument();
    // The card says so for the shop Ozi listed, and only for that one.
    expect(screen.getAllByText("We don't have a partnership with this shop yet.")).toHaveLength(1);
  });

  it('asks for a quote from the service’s page, and nothing is paid here', async () => {
    window.localStorage.setItem('ozidelivery.session.token', 'test-token');
    const user = userEvent.setup({ delay: null });
    renderAt('/shops/barber-1');
    expect(await screen.findByText(/From £12\.00, about 30 minutes\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ask for a quote.*Haircut/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Ask for a quote: Haircut' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('What do you need?'), 'Saturday morning if you can.');
    await user.type(
      screen.getByLabelText('How should they reach you? A phone number or an email.'),
      '07700 900 001',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(/has your request for a quote about Haircut/),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/shops/barber-1/enquiry')?.body).toEqual({
      kind: 'quote',
      productId: 'svc-1',
      message: 'Saturday morning if you can.',
      contact: '07700 900 001',
    });
    expect(screen.queryByRole('button', { name: /Add to my basket/ })).toBeNull();
  });

  it('hears a quote or a call back, and says how long a service takes', () => {
    expect(heardEnquiry('can I get a quote')).toBe('quote');
    expect(heardEnquiry('book a call back please')).toBe('call_back');
    expect(heardEnquiry('add bread')).toBeNull();
    expect(durationWords(30)).toBe('30 minutes');
    expect(durationWords(90)).toBe('1 hour 30 minutes');
  });
});

describe('choosing free or paid at sign-up (ruling 75)', () => {
  it('compares the two plans side by side in a table, in plain words, and says it kindly', async () => {
    renderAt('/business/join');
    const table = await screen.findByRole('table', { name: 'What each plan gives a shop' });
    expect(
      within(table).getByRole('columnheader', { name: 'Basic listing (free)' }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Partner Plus (£14.99 a month)' }),
    ).toBeInTheDocument();
    const row = (name: string) =>
      within(table).getByRole('rowheader', { name }).closest('tr') as HTMLElement;
    expect(row('Products')).toHaveTextContent('Up to 10');
    expect(row('Products')).toHaveTextContent('Your full catalogue');
    expect(row('Photos of your products')).toHaveTextContent(/NoYes/);
    // Offers do not exist yet, so they are not promised (30 October 2026).
    expect(within(table).queryByRole('rowheader', { name: 'Offers' })).toBeNull();
    expect(row('Shop of the Month')).toHaveTextContent('Not eligible');
    expect(row('In search and on the shops list')).toHaveTextContent(
      'First among shops at the same distance',
    );
    expect(
      within(table).getByRole('rowheader', { name: /Spotlight \(£19\.99\) and Spotlight Plus/ }),
    ).toBeInTheDocument();
    // One rule everywhere: free, with no monthly fee, and never "may be taken off".
    expect(screen.queryByText(/may be reviewed|taken off/)).toBeNull();
    expect(screen.getByText(/A basic listing is free, with no monthly fee\./)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Which plan would you like?' });
    expect(
      within(group).getByRole('radio', { name: 'Basic listing, free, with no monthly fee' }),
    ).toBeChecked();
    expect(
      within(group).getByRole('radio', { name: /Partner Plus: start with the free month/ }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('radio', { name: /Partner Plus: start and pay today, £14\.99/ }),
    ).toBeInTheDocument();
    // Not for a café: no monthly plan to choose.
    await userEvent.setup({ delay: null }).click(screen.getByLabelText('A café or takeaway'));
    expect(screen.queryByRole('table', { name: 'What each plan gives a shop' })).toBeNull();
  });

  it('pay now: after the form, straight to Stripe Checkout with the receipt kept', async () => {
    const user = userEvent.setup({ delay: null });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' });
    renderAt('/business/join');
    await screen.findByRole('table', { name: 'What each plan gives a shop' });
    await user.type(screen.getByLabelText('The business’s name'), 'Corner Bakery');
    await user.click(screen.getByRole('radio', { name: /Partner Plus: start and pay today/ }));
    expect(
      screen.getByText(/we take you to Stripe’s secure page to pay £14\.99/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Address'), '12 High Street, Gillingham');
    await user.type(screen.getByLabelText('Postcode'), 'ME7 1AA');
    await user.type(screen.getByLabelText('Opening hours'), 'Monday to Saturday 7am to 5pm');
    await user.type(screen.getByLabelText('Who should we speak to?'), 'Bola');
    await user.type(screen.getByLabelText('Mobile number'), '07700 900 222');
    await user.type(screen.getByLabelText('Email address'), 'bola@example.com');
    await user.type(screen.getByLabelText('Choose a username'), 'cornerbakery');
    await user.type(screen.getByLabelText('Choose a password'), 'a-long-enough-password');
    await user.click(screen.getByLabelText('I agree to the Shop Partner terms'));
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await user.type(await screen.findByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and join' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.rehearsal.invalid/cs_rehearsal_join'),
    );
    expect(sent.find((r) => r.path === '/partner/join')?.body).toEqual(
      expect.objectContaining({ plan: 'plus', payNow: true }),
    );
    expect(window.sessionStorage.getItem('ozidelivery.partner.receipt')).toBe('pc1.join.receipt');
    vi.unstubAllGlobals();
  });

  it('hears free, free month or pay now, and reads the comparison briefly from config', () => {
    expect(heardPlan('free please')).toBe('free');
    expect(heardPlan('the basic one')).toBe('free');
    expect(heardPlan('free month')).toBe('free-month');
    expect(heardPlan("I'll take the free month, then pay")).toBe('free-month');
    expect(heardPlan('pay now')).toBe('pay-now');
    expect(heardPlan('I want to pay today')).toBe('pay-now');
    expect(heardPlan('something else')).toBeNull();
    const question = planQuestion({
      kinds: [],
      freeListingsLeft: 97,
      freeProductLimit: 10,
      plusMonthlyPence: 1499,
      plusFirstMonthFree: true,
      restaurantWords: '',
      preferredDiscountPercent: 20,
      spotlightPence: 1999,
      spotlightPlusPence: 3999,
      excludedServiceKinds: [],
      mobileConfirmed: true,
    });
    expect(question).toMatch(/free, with no monthly fee: .*up to 10 products, with no photos\./);
    expect(question).not.toMatch(/offers/);
    expect(question).toMatch(/Partner Plus is £14\.99 a month/);
    expect(question).toMatch(/first among shops at the same distance/);
    expect(question).toMatch(/Say free, free month, or pay now\.$/);
    // Once the free listings have all gone, Ozi says so and offers only Partner Plus.
    const gone = planQuestion({
      kinds: [],
      freeListingsLeft: 0,
      freeProductLimit: 10,
      plusMonthlyPence: 1499,
      plusFirstMonthFree: true,
      restaurantWords: '',
      preferredDiscountPercent: 20,
      spotlightPence: 1999,
      spotlightPlusPence: 3999,
      excludedServiceKinds: [],
      mobileConfirmed: true,
    });
    expect(gone).toMatch(/free basic listings have all gone/);
    expect(gone).toMatch(/Say free month, or pay now\.$/);
  });

  it('hides the free choice once the free listings have all gone, and says so', async () => {
    freeLeft = 0;
    renderAt('/business/join');
    const group = await screen.findByRole('group', { name: 'Which plan would you like?' });
    expect(
      await screen.findByText(/The free basic listings have all gone, so we cannot offer one now/),
    ).toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: /Basic listing/ })).toBeNull();
    await waitFor(() =>
      expect(
        within(group).getByRole('radio', { name: /Partner Plus: start with the free month/ }),
      ).toBeChecked(),
    );
    expect(screen.getByText('Shops: the free basic listings have all gone')).toBeInTheDocument();
    expect(screen.queryByText(/for the next 0 shops/)).toBeNull();
  });
});

describe('scanning products into the dashboard (ruling 75)', () => {
  it('captures a barcode by itself with a stand-in detector, and adds nothing until Add all', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const stopped = vi.fn();
    setScannerDevices({
      openCamera: async () => ({ getTracks: () => [{ stop: stopped }] }) as unknown as MediaStream,
      findCodes: async () => ({ find: async () => '5000000000001' }),
    });
    try {
      const user = userEvent.setup({ delay: null });
      renderAt('/partner');
      await user.click(
        await screen.findByRole('button', { name: 'Start scanning with the camera' }),
      );
      expect(
        await screen.findByRole('heading', { level: 4, name: 'Baked beans, 415g' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Got it: Baked beans, 415g, £0.85, an estimate, please check.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Estimate, please check the price/)).toBeInTheDocument();
      expect(sent.filter((r) => r.path === '/partner/scan/barcode')).toHaveLength(1);
      expect(sent.some((r) => r.path === '/partner/products')).toBe(false);

      await user.click(screen.getByRole('button', { name: 'Stop scanning' }));
      expect(stopped).toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Add all (1) to be checked' }));
      await waitFor(() =>
        expect(sent.find((r) => r.path === '/partner/products')?.body).toEqual({
          name: 'Baked beans, 415g',
          pricePence: 85,
          tags: '',
          barcode: '5000000000001',
          priceEstimated: true,
        }),
      );
      expect(await screen.findByText(/Sent 1 product to be checked/)).toBeInTheDocument();
    } finally {
      setScannerDevices(null);
    }
  });

  it('lists the same product once: a second capture is "already added"', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
    const user = userEvent.setup({ delay: null });
    renderAt('/partner');
    const upload = await screen.findByLabelText('Or upload photos of labels');
    await user.upload(upload, [
      new File(['one'], 'label-1.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'label-2.jpg', { type: 'image/jpeg' }),
    ]);
    expect(await screen.findByText('Already added: Braeburn apples, 6 pack.')).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 4, name: 'Braeburn apples, 6 pack' }),
    ).toHaveLength(1);
    expect(sent.filter((r) => r.path === '/partner/scan/label')).toHaveLength(2);

    // Corrected by typing before it is sent.
    const price = screen.getByLabelText('Price in pounds for Braeburn apples, 6 pack');
    await user.clear(price);
    await user.type(price, '2.50');
    await user.click(screen.getByRole('button', { name: 'Add all (1) to be checked' }));
    await waitFor(() =>
      expect(sent.find((r) => r.path === '/partner/products')?.body).toEqual({
        name: 'Braeburn apples, 6 pack',
        pricePence: 250,
        tags: '',
      }),
    );
  });

  it('understands corrections said about the list', () => {
    expect(understandScanVoice('add all')).toEqual({ kind: 'add-all' });
    expect(understandScanVoice('change the price of apples to £2.40')).toEqual({
      kind: 'price',
      name: 'apples',
      pricePence: 240,
    });
    expect(understandScanVoice('the price is two pounds')).toEqual({
      kind: 'price',
      name: null,
      pricePence: 200,
    });
    expect(understandScanVoice('call it Welsh cakes')).toEqual({
      kind: 'rename',
      name: null,
      to: 'Welsh cakes',
    });
    expect(understandScanVoice('remove the beans')).toEqual({ kind: 'remove', name: 'beans' });
    expect(understandScanVoice('scan products')).toEqual({ kind: 'start' });
    expect(understandScanVoice('what is the weather')).toBeNull();
  });
});
