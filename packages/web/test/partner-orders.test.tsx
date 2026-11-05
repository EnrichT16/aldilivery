/**
 * Partners see their orders and reach their Runner (ruling 97, 5 November 2026): the orders
 * section on the partner dashboard, Ready for pickup, the set messages, the call button by
 * package, and the spoken commands; the speakable ID shown with "read it out"; and the Shopper's
 * notes by voice.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { orderSpoken, spokenReference } from '../src/components/PartnerOrders';
import type { PartnerOrdersPage } from '../src/lib/partner-orders-api';
import { noteCommand } from '../src/state/voice-order';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';

const ORDER = {
  id: 'order-1',
  reference: 'OZ-ABC123',
  status: 'accepted' as const,
  statusWords: 'A Runner is on the way to you',
  active: true,
  waiting: false,
  placedAt: '2026-11-05T09:40:00.000Z',
  acceptedAt: '2026-11-05T09:45:00.000Z',
  deliveringAt: null,
  deliveredAt: null,
  readyAt: null,
  runner: { firstName: 'Tomasz', runnerId: 'RABCD234' },
  runnerAtShop: false,
  lines: [{ id: 'l1', name: 'Sourdough loaf (Corner Bakery)', quantity: 2, runnerPaysPence: 350 }],
  messages: [],
  canReady: true,
  canMessage: true,
  canCall: true,
};

function page(paid: boolean): PartnerOrdersPage {
  return {
    shop: {
      id: 'shop-1',
      name: 'Corner Bakery',
      publicId: 'P-7K4M2X',
      paidPlan: paid,
      callWords: paid ? null : 'Calls to your Runner come with Shop Partner Plus.',
    },
    messageKinds: [
      { kind: 'ready', words: 'Ready for pickup' },
      { kind: 'late', words: 'Running 10 minutes late' },
      { kind: 'side_door', words: 'Please come to the side door' },
      { kind: 'substituted', words: "We've substituted one item, please check with the Shopper" },
    ],
    active: [ORDER],
    recent: [
      {
        ...ORDER,
        id: 'order-0',
        reference: 'OZ-OLD999',
        status: 'delivered',
        statusWords: 'Delivered',
        active: false,
        deliveredAt: '2026-11-04T12:00:00.000Z',
        canReady: false,
        canMessage: false,
        canCall: false,
      },
    ],
    page: 1,
    pages: 1,
    total: 1,
    historyDays: 90,
  };
}

let sent: Array<{ method: string; path: string; body: unknown }>;
let paid: boolean;
let readyAt: string | null;

beforeEach(() => {
  sent = [];
  paid = true;
  readyAt = null;
  window.sessionStorage.setItem('ozidelivery.business.token', 'bz1.x.y');
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
      if (path === '/business/me') {
        return reply({
          kind: 'partner',
          name: 'Bola',
          office: '',
          business: 'Corner Bakery',
          publicId: 'P-7K4M2X',
          mustChangePassword: false,
        });
      }
      if (path === '/partner/dashboard') {
        return reply({
          shop: {
            id: 'shop-1',
            name: 'Corner Bakery',
            address: '',
            telephone: '',
            about: '',
            kind: 'shop',
            kindWords: 'Shop',
            postcode: 'ME7 1AA',
            hours: '',
            status: 'approved',
            active: true,
            listed: true,
          },
          plan: {
            tier: paid ? 'plus' : 'free',
            monthlyPence: paid ? 1499 : 0,
            plusMonthlyPence: 1499,
            paidUntil: paid ? '2026-12-05T10:00:00.000Z' : null,
            paid,
            freeForever: false,
            firstMonthFree: false,
            productLimit: paid ? null : 10,
            productsListed: 1,
            canAddProduct: true,
            words: paid ? 'Partner Plus, £14.99 a month.' : 'A free listing.',
          },
          restaurant: null,
          enquiries: [],
          counts: { live: 1, waiting: 0, notAccepted: 0 },
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
        });
      }
      if (path.startsWith('/partner/orders?')) {
        const current = page(paid);
        return reply({
          ...current,
          active: current.active.map((order) => ({
            ...order,
            readyAt,
            canReady: readyAt === null,
          })),
        });
      }
      if (path === '/partner/orders/order-1/ready' && method === 'POST') {
        readyAt = '2026-11-05T09:50:00.000Z';
        return reply({
          order: { ...ORDER, readyAt, canReady: false },
          message:
            'Thank you. Your Runner has been told: "Corner Bakery says your order OZ-ABC123 is ready for pickup."',
          told: 'push',
        });
      }
      if (path === '/partner/orders/order-1/message' && method === 'POST') {
        return reply({
          order: ORDER,
          message:
            'Sent. Your Runner has been told: "Corner Bakery says: Running 10 minutes late. Order OZ-ABC123."',
          told: 'push',
        });
      }
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderDashboard(): void {
  render(
    <MemoryRouter initialEntries={['/partner']}>
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

describe('a partner sees its orders on the dashboard', () => {
  it('shows each order with its reference, the Runner by first name and ID, its own lines, and the Partner ID', async () => {
    renderDashboard();
    expect(
      await screen.findByRole('heading', { level: 3, name: /Order OZ-ABC123/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A Runner is on the way to you\. Runner: Tomasz, Runner ID RABCD234\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 × Sourdough loaf \(Corner Bakery\), £3\.50 each at your counter/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your Partner ID:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read my Partner ID out' })).toBeInTheDocument();
    // The history, folded away.
    expect(screen.getByText('Order history: 1 in the last 90 days')).toBeInTheDocument();
    expect(sent.find((r) => r.path.startsWith('/partner/orders?'))).toBeDefined();
  });

  it('says ready for pickup with one press, sends the set messages, and calls on a paid package', async () => {
    const user = userEvent.setup({ delay: null });
    renderDashboard();
    await screen.findByRole('heading', { level: 3, name: /Order OZ-ABC123/ });
    const ready = await screen.findByRole('button', { name: /Ready for pickup.*OZ-ABC123/ });
    await user.click(ready);
    await waitFor(() => {
      expect(
        sent.find((r) => r.method === 'POST' && r.path === '/partner/orders/order-1/ready'),
      ).toBeDefined();
    });
    expect(
      await screen.findByText(
        /Your Runner has been told: "Corner Bakery says your order OZ-ABC123 is ready for pickup\."/,
      ),
    ).toBeInTheDocument();
    // Once per order: the button is gone after it is said.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Ready for pickup.*OZ-ABC123/ })).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: /Running 10 minutes late/ }));
    await waitFor(() => {
      expect(
        sent.find((r) => r.method === 'POST' && r.path === '/partner/orders/order-1/message')?.body,
      ).toEqual({ kind: 'late' });
    });

    const call = screen.getByRole('button', { name: /Call Tomasz/ });
    expect(call).toBeEnabled();
  });

  it('shows the call button disabled on the free listing, with the plain words why', async () => {
    paid = false;
    renderDashboard();
    const call = await screen.findByRole('button', { name: /Call Tomasz/ });
    expect(call).toBeDisabled();
    expect(
      screen.getByText('Calls to your Runner come with Shop Partner Plus.'),
    ).toBeInTheDocument();
    expect(call).toHaveAccessibleDescription('Calls to your Runner come with Shop Partner Plus.');
  });

  it('reads the orders by voice, and marks one ready after confirming which and hearing yes', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    renderDashboard();
    await screen.findByRole('heading', { level: 3, name: /Order OZ-ABC123/ });
    await say(engine, 'read my orders');
    await waitFor(() => {
      expect(spoken(engine)).toContain(
        'You have 1 order under way. Order O Z, A B C, 1 2 3: A Runner is on the way to you, Runner Tomasz, 2 of your things.',
      );
    });
    await say(engine, 'order ready');
    await waitFor(() => {
      expect(spoken(engine)).toContain(
        'Shall I tell Tomasz that order O Z, A B C, 1 2 3 is ready for pickup?',
      );
    });
    expect(sent.find((r) => r.method === 'POST' && r.path.endsWith('/ready'))).toBeUndefined();
    await say(engine, 'yes');
    await waitFor(() => {
      expect(
        sent.find((r) => r.method === 'POST' && r.path === '/partner/orders/order-1/ready'),
      ).toBeDefined();
    });
    await waitFor(() => {
      expect(spoken(engine)).toContain('Your Runner has been told');
    });
  });

  it('reads an ID out spelt in groups', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    renderDashboard();
    await user.click(await screen.findByRole('button', { name: 'Read my Partner ID out' }));
    await waitFor(() => {
      expect(spoken(engine)).toContain('Your Partner ID is P, 7 K 4, M 2 X.');
    });
  });
});

describe('the words', () => {
  it('spells a reference and describes an order for Ozi', () => {
    expect(spokenReference('OZ-ABC123')).toBe('O Z, A B C, 1 2 3');
    expect(orderSpoken({ ...ORDER, readyAt: '2026-11-05T09:50:00.000Z' })).toBe(
      'Order O Z, A B C, 1 2 3: A Runner is on the way to you, Runner Tomasz, 2 of your things, marked ready.',
    );
  });
});

describe("a Shopper's notes by voice", () => {
  const lines = [
    { item: { id: 'b', name: 'Bananas, loose' } },
    { item: { id: 'm', name: 'Semi skimmed milk, 2 pints' } },
  ];

  it('puts "ripe bananas, not green" on the bananas', () => {
    expect(noteCommand('ripe bananas, not green', lines)).toEqual({
      kind: 'item',
      itemId: 'b',
      name: 'Bananas, loose',
      note: 'ripe, not green',
    });
    expect(noteCommand('a note on the milk: the blue one please', lines)).toEqual({
      kind: 'item',
      itemId: 'm',
      name: 'Semi skimmed milk, 2 pints',
      note: 'the blue one please',
    });
  });

  it('keeps "add a note: leave it with the neighbour" for the whole order', () => {
    expect(noteCommand('add a note: leave it with the neighbour', lines)).toEqual({
      kind: 'order',
      note: 'leave it with the neighbour',
    });
    expect(noteCommand('note for the runner, ring the bell twice', lines)).toEqual({
      kind: 'order',
      note: 'ring the bell twice',
    });
  });

  it('is not fooled by ordinary shopping', () => {
    expect(noteCommand('two pints of milk', lines)).toBeNull();
    expect(noteCommand('bananas, please', lines)).toBeNull();
    expect(noteCommand('ripe pears, not hard', lines)).toBeNull();
  });
});
