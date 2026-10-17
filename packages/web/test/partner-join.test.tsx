/**
 * Shops join by themselves (ruling 65): the join form with the mobile confirmed by a code, the
 * dashboard's pay and renew buttons through Stripe Checkout, Ozi listing shops its owner can claim,
 * and a Shopper asking a service for a quote.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import type { PartnerDashboard } from '../src/lib/api';
import { heardKind } from '../src/pages/PartnerJoin';
import { durationWords, heardEnquiry } from '../src/pages/Shops';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let dashboard: PartnerDashboard;

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
      'Free listing, for ever: your name, address, hours and up to 10 products. Partner Plus, £14.99 a month, adds the full catalogue with photos, offers and Shop of the Month, with the first month free.',
  },
  commission: null,
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
          freeListingsLeft: 97,
          freeProductLimit: 10,
          plusMonthlyPence: 1499,
          plusFirstMonthFree: true,
          foodCommissionWords: '10%',
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
      if (path === '/shops') {
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
    expect(await screen.findByText(/for ever for the next 97 shops to join/)).toBeInTheDocument();
    expect(
      screen.getByText(/first month free: the full catalogue with photos/),
    ).toBeInTheDocument();
    expect(screen.getByText(/10% of each order placed through/)).toBeInTheDocument();
    expect(
      screen.getByText(/We cannot list credit, loans, mortgages, insurance/),
    ).toBeInTheDocument();
  });

  it('confirms the mobile with a code, then joins and lands on the dashboard, pending', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/business/join');
    await screen.findByText(/for ever for the next 97 shops/);
    await user.type(screen.getByLabelText('The business’s name'), 'Corner Bakery');
    await user.type(screen.getByLabelText('Address'), '12 High Street, Gillingham');
    await user.type(screen.getByLabelText('Postcode'), 'ME7 1AA');
    await user.type(screen.getByLabelText('Opening hours'), 'Monday to Saturday 7am to 5pm');
    await user.type(screen.getByLabelText('Who should we speak to?'), 'Bola');
    await user.type(screen.getByLabelText('Mobile number'), '07700 900 222');
    await user.type(screen.getByLabelText('Email address'), 'bola@example.com');
    await user.type(screen.getByLabelText('What do you sell?'), 'Fresh bread every morning.');
    await user.type(screen.getByLabelText('Choose a username'), 'cornerbakery');
    await user.type(screen.getByLabelText('Choose a password'), 'a-long-enough-password');
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
        phoneProof: 'proof.partner',
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
    expect(screen.getByText(/Free listing, for ever/)).toBeInTheDocument();
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

  it('shows a café its commission and a service its enquiries, with no pay button', async () => {
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
        words: `No monthly fee. 10% of each order placed through ${storeConfig.productName} is owed as commission.`,
      },
      commission: {
        basisPoints: 1000,
        words: '10%',
        ordersThisMonth: 3,
        goodsThisMonthPence: 4500,
        owedThisMonthPence: 450,
      },
    };
    renderAt('/partner');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rainham Café' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`3 orders through ${storeConfig.productName}, £45.00 of food and drink.`, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('£4.50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Partner Plus/ })).toBeNull();
  });
});

describe('a Shopper and a service', () => {
  it('sees kinds and areas on the shops list', async () => {
    renderAt('/shops');
    expect(await screen.findByText(/Shop, ME7\./)).toBeInTheDocument();
    expect(screen.getByText(/Service, ME4\./)).toBeInTheDocument();
    expect(screen.getByText(/Listed by Ozi\./)).toBeInTheDocument();
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
