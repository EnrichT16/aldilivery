/**
 * The admin panel after the 16 October 2026 review: the first screen says what needs a person
 * now, most urgent first, and jumps to the right tab; the twenty tabs sit in four groups with
 * the keyboard and screen reader semantics of tab lists; the order rescue tools cancel, refund
 * and reassign with a reason the Shopper will read; and the technical words are gone.
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { groupTabs, openPage, pageTabs } from './staff-tabs';

let sent: Array<{ method: string; path: string; body: unknown }>;
let needsYou: unknown[];

const AREAS = [
  'overview',
  'problems',
  'orders',
  'runners',
  'payments',
  'documents',
  'owed',
  'finds',
  'enquiries',
  'partners',
  'analytics',
  'feedback',
  'learning',
  'reports',
  'team',
  'accounts',
  'audit',
  'money',
];

const ORDER = {
  id: 'order-1',
  reference: 'ABC123',
  status: 'accepted',
  statusWords: 'A Runner has it',
  createdAt: '2026-10-16T09:00:00.000Z',
  shopperName: 'Margaret',
  shopperHandle: 'margaret',
  runnerName: 'Bola',
  itemCount: 2,
  totalEstimatePence: 1149,
  finalTotalPence: null,
  paidBy: 'card',
  area: 'ME7',
  cancelReason: null,
};

beforeEach(() => {
  sent = [];
  needsYou = [
    {
      key: 'sos',
      count: 1,
      words: 'one SOS',
      title: 'Runner SOS, on now',
      action: 'Open the SOS',
      tab: 'problems',
    },
    {
      key: 'bank-transfers',
      count: 2,
      words: 'two bank transfers to check',
      title: 'Bank transfers to check',
      action: 'Open the payments',
      tab: 'payments',
    },
  ];
  window.sessionStorage.clear();
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
      if (path === '/staff/sign-in') {
        return reply({
          token: 'st1.owner.sig',
          name: 'Anthony',
          role: 'founder',
          title: 'Founder',
          areas: AREAS,
          mustChangePassword: false,
        });
      }
      if (path === '/staff/me') {
        return reply({
          name: 'Anthony',
          role: 'founder',
          title: 'Founder',
          areas: AREAS,
          account: true,
          isOwner: true,
          viewOnly: false,
          mustChangePassword: false,
          twoStep: {
            on: true,
            dueAt: '2026-10-31T00:00:00.000Z',
            setupNeeded: false,
            recoveryCodesLeft: 8,
          },
        });
      }
      if (path === '/staff/overview') {
        return reply({
          needsYou,
          splitAfterMinutes: 10,
          people: {
            shoppers: 120,
            runners: 14,
            runnersOnShiftNow: 3,
            shopPartners: 5,
            organisations: 2,
            staff: 6,
          },
          staffByJob: [],
          work: {
            ordersLastDay: 9,
            ordersLastWeek: 40,
            problemsWaiting: 1,
            documentsWaiting: 2,
            shopProductsWaiting: 0,
            findItWaiting: 1,
          },
        });
      }
      if (path === '/staff/money') {
        return reply({
          gateways: [{ name: 'Stripe', connected: true }],
          today: { inPence: 0, outPence: 0, netPence: 0, byGateway: [], byKind: [] },
          week: { inPence: 0, outPence: 0, netPence: 0, byGateway: [], byKind: [] },
          month: { inPence: 0, outPence: 0, netPence: 0, byGateway: [], byKind: [] },
          year: { inPence: 0, outPence: 0, netPence: 0, byGateway: [], byKind: [] },
          allTime: { inPence: 0, outPence: 0, netPence: 0, byGateway: [], byKind: [] },
          runnerPayBack: null,
          runnerCards: {
            enabled: false,
            cards: [],
            orders: [
              {
                orderId: 'order-9f8e7d6c5b4a',
                reference: '5B4A',
                runnerName: 'Bola',
                loadedPence: 1000,
                spentPence: null,
                merchant: null,
                receiptPence: null,
                needsPerson: false,
                at: '2026-10-16T09:00:00.000Z',
              },
            ],
            declines: [],
          },
          recent: [],
        });
      }
      if (path === '/staff/sos') return reply({ sos: [] });
      if (path === '/staff/problems') {
        return reply({
          reports: [
            {
              id: 'p1',
              orderId: 'order-1',
              reportedBy: 'shopper',
              reporterName: 'Margaret',
              summary: 'Half the shopping was missing.',
              refundRequestedPence: 800,
              decideBy: '2026-10-20T10:00:00Z',
              overdue: false,
              evidence: [],
              order: {
                reference: 'ABC123',
                status: 'delivered',
                runnerName: 'Bola',
                items: [
                  { name: 'Semi skimmed milk, 2 pints', quantity: 2, outcome: 'pending' },
                  { name: 'Eggs, 6', quantity: 1, outcome: 'omitted' },
                ],
                goodsEstimatePence: 350,
                feePence: 799,
                totalEstimatePence: 1149,
                receiptTotalPence: 250,
                finalTotalPence: 1049,
                paidBy: 'card',
              },
            },
          ],
        });
      }
      if (path.startsWith('/staff/orders/order-1/runners')) {
        return reply({ runners: [{ id: 'r2', name: 'Tomasz', onShift: true, travel: 'bicycle' }] });
      }
      if (path === '/staff/orders/order-1/cancel') {
        return reply({
          message: 'Cancelled order ABC123. £11.49 is going back to the card.',
          refundedPence: 1149,
          bankRefundPence: 0,
        });
      }
      if (path === '/staff/orders/order-1/goodwill') {
        return reply({ message: '£3.00 is going back to the card for order ABC123.' });
      }
      if (path === '/staff/orders/order-1/reassign') {
        return reply({
          message: 'Bola has been released from order ABC123. It is offered to Tomasz now.',
          released: 'Bola',
          offeredTo: 'Tomasz',
        });
      }
      if (path === '/staff/orders/order-1') {
        return reply({
          order: {
            ...ORDER,
            goodsEstimatePence: 350,
            feePence: 799,
            receiptTotalPence: null,
            runnerId: 'r1',
            refundablePence: 1149,
            goodwillRefundedPence: 0,
            items: [{ name: 'Semi skimmed milk, 2 pints', quantity: 2, outcome: 'pending' }],
          },
          timeline: [{ at: '2026-10-16T09:00:00.000Z', what: 'The order was started.' }],
        });
      }
      if (path.startsWith('/staff/orders')) {
        return reply({
          orders: [ORDER],
          statuses: [{ status: 'accepted', words: 'A Runner has it' }],
        });
      }
      if (path.startsWith('/staff/share')) return reply({ url: '', joined: 0 });
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      // Every other list is empty.
      return reply({
        documents: [],
        reports: [],
        feedback: [],
        recoveries: [],
        requests: [],
        enquiries: [],
        products: [],
        waiting: [],
        received: [],
        owed: [],
        paid: [],
        team: [],
        tinyExtras: [],
        settled: [],
        runners: [],
        entries: [],
        shoppers: [],
        buckets: [],
        between: null,
        refunds: [],
        cancellations: [],
        byReason: [],
        count: 0,
        totalPence: null,
        ownerOnlyAbovePence: 2500,
        catalogue: { total: 0, fresh: 0, ageing: 0, stale: 0, oldest: [] },
        shops: [],
        referrers: [],
        rewardPence: 1000,
        needed: 3,
        deposits: [],
        activeNow: 0,
        onShift: 0,
        onAJob: 0,
      });
    }),
  );
});

async function signIn(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup({ delay: null });
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
  await user.type(await screen.findByLabelText('Username'), 'anthony');
  await user.type(screen.getByLabelText('Password'), 'a long password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('navigation', { name: 'Admin pages' });
  return user;
}

async function noViolations(): Promise<void> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
  });
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

describe('needs you now', () => {
  it('is the first screen: each thing as a card, most urgent first, with a button to its tab', async () => {
    const user = await signIn();
    expect(await screen.findByRole('heading', { name: 'Needs you now' })).toBeInTheDocument();
    expect(screen.getByText('2 things need you, most urgent first.')).toBeInTheDocument();
    const cards = screen
      .getAllByRole('listitem')
      .filter((item) => within(item).queryByRole('button'));
    expect(cards.map((card) => card.textContent)).toEqual([
      '1 Runner SOS, on nowOpen the SOS',
      '2 Bank transfers to checkOpen the payments',
    ]);
    // The figures follow, in plain words.
    expect(screen.getByText('Problems to decide')).toBeInTheDocument();
    expect(screen.queryByText('Complaints waiting')).not.toBeInTheDocument();
    await noViolations();

    await user.click(screen.getByRole('button', { name: 'Open the payments' }));
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument();
    const groups = screen.getByRole('tablist', { name: 'Parts of the admin panel' });
    expect(within(groups).getByRole('tab', { name: 'Money' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const pages = screen.getByRole('tablist', { name: 'Money pages' });
    expect(within(pages).getByRole('tab', { name: 'Payments' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('says plainly when nothing needs anybody', async () => {
    needsYou = [];
    await signIn();
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
  });
});

describe('the tabs, in four groups', () => {
  it('keeps every page, and works as tab lists do from the keyboard', async () => {
    const user = await signIn();
    expect(await groupTabs()).toEqual(['Today', 'Money', 'People', 'Settings']);
    const pages = await pageTabs(user);
    // Every page of the owner's panel is here; the staff member's own Two-step codes page
    // belongs to accounts other than his, which have no My settings.
    expect(pages).toEqual([
      'Needs you now',
      'Problems',
      'Orders',
      'Runners',
      'Finds It',
      'Learning',
      'Money',
      'Payments',
      'Money owed',
      'Reports',
      'Analytics',
      'Documents',
      'Team',
      'Shops and organisations',
      'Enquiries',
      'Feedback',
      'Shopper accounts',
      'Audit log',
      'My settings',
    ]);
    // One tab stop per list; arrows move along it and choose as they go; the ends join up.
    const groups = screen.getByRole('tablist', { name: 'Parts of the admin panel' });
    const today = within(groups).getByRole('tab', { name: 'Today' });
    await user.click(today);
    expect(today).toHaveAttribute('aria-selected', 'true');
    expect(today).toHaveAttribute('tabindex', '0');
    expect(within(groups).getByRole('tab', { name: 'Money' })).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowRight}');
    expect(within(groups).getByRole('tab', { name: 'Money' })).toHaveFocus();
    expect(within(groups).getByRole('tab', { name: 'Money' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Money' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(within(groups).getByRole('tab', { name: 'Settings' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(within(groups).getByRole('tab', { name: 'Today' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Today' })).toBeInTheDocument();
    const pagesList = screen.getByRole('tablist', { name: 'Today pages' });
    await user.click(within(pagesList).getByRole('tab', { name: 'Needs you now' }));
    await user.keyboard('{ArrowRight}');
    expect(within(pagesList).getByRole('tab', { name: 'Problems' })).toHaveFocus();
    expect(await screen.findByRole('heading', { name: /Problems to decide/ })).toBeInTheDocument();
    await noViolations();
  });
});

describe('plain words', () => {
  it('names card payments and the Runner cards without the names of systems', async () => {
    const user = await signIn();
    await openPage(user, 'Money');
    expect(await screen.findByText('Card payments: Stripe.')).toBeInTheDocument();
    expect(screen.queryByText(/Flutterwave|Paystack|gateway/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Runner spending cards are switched off, so Runners pay with their own card and we pay them back.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/STRIPE_ISSUING_ENABLED/)).not.toBeInTheDocument();
    // The short reference, never the whole system id.
    expect(screen.getByRole('rowheader', { name: '5B4A' })).toBeInTheDocument();
    expect(screen.queryByText('order-9f8e7d6c5b4a')).not.toBeInTheDocument();
  });

  it('always offers the founder’s staff key, typed username or not', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByLabelText('Username');
    const founder = { name: 'Founder: sign in with the staff key' };
    expect(screen.getByRole('button', founder)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'a');
    expect(screen.getByRole('button', founder)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Username'));
    expect(screen.getByRole('button', founder)).toBeInTheDocument();
  });
});

describe('a problem shows the order', () => {
  it('lists its items, Runner and totals beside the complaint', async () => {
    const user = await signIn();
    await openPage(user, 'Problems');
    const card = await screen.findByRole('article', { name: /Half the shopping was missing/ });
    expect(within(card).getByText('Order ABC123, Runner Bola.')).toBeInTheDocument();
    expect(within(card).getByText('2 x Semi skimmed milk, 2 pints')).toBeInTheDocument();
    expect(within(card).getByText('1 x Eggs, 6 (left out)')).toBeInTheDocument();
    expect(
      within(card).getByText(
        /Shopping estimated at £3\.50, the till said £2\.50; delivery £7\.99; charged £10\.49\./,
      ),
    ).toBeInTheDocument();
  });
});

describe('the order rescue tools', () => {
  async function openOrder(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = await signIn();
    await openPage(user, 'Orders');
    await user.click(await screen.findByRole('button', { name: /Open the timeline/ }));
    await screen.findByRole('heading', { name: 'Put it right' });
    return user;
  }

  it('cancels an order with a reason the Shopper will read, in the person’s name', async () => {
    const user = await openOrder();
    const form = screen.getByRole('form', { name: 'Cancel order ABC123' });
    await user.click(
      within(form).getByRole('button', { name: 'Cancel the order and send the money back' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please say why, in words the Shopper will read.',
    );
    await user.type(
      within(form).getByLabelText('Cancel this order: why?'),
      'The shop is shut today.',
    );
    await noViolations();
    await user.click(
      within(form).getByRole('button', { name: 'Cancel the order and send the money back' }),
    );
    expect(
      await screen.findByText('Cancelled order ABC123. £11.49 is going back to the card.'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/staff/orders/order-1/cancel')?.body).toEqual({
      reason: 'The shop is shut today.',
      by: 'Anthony',
    });
  });

  it('gives a goodwill refund of a stated amount', async () => {
    const user = await openOrder();
    const form = screen.getByRole('form', { name: 'Goodwill refund on order ABC123' });
    await user.type(
      within(form).getByLabelText(/Goodwill refund, in pounds \(up to £11\.49\)/),
      '3',
    );
    await user.type(
      within(form).getByLabelText('Why, in words the Shopper will read'),
      'Sorry it came late.',
    );
    await user.click(within(form).getByRole('button', { name: 'Send the goodwill refund' }));
    expect(
      await screen.findByText('£3.00 is going back to the card for order ABC123.'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/staff/orders/order-1/goodwill')?.body).toEqual({
      amountPence: 300,
      reason: 'Sorry it came late.',
      by: 'Anthony',
    });
  });

  it('gives a stuck order to a chosen Runner', async () => {
    const user = await openOrder();
    const form = screen.getByRole('form', { name: 'Give order ABC123 to another Runner' });
    const choose = within(form).getByLabelText('Give it to another Runner');
    await user.click(choose);
    await waitFor(() =>
      expect(sent.some((row) => row.path === '/staff/orders/order-1/runners')).toBe(true),
    );
    await user.selectOptions(
      choose,
      await within(form).findByRole('option', { name: 'Tomasz, on shift, by bicycle' }),
    );
    await user.click(
      within(form).getByRole('button', { name: 'Release the Runner and offer it again' }),
    );
    expect(await screen.findByText(/Bola has been released from order ABC123/)).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/staff/orders/order-1/reassign')?.body).toEqual({
      runnerId: 'r2',
      by: 'Anthony',
    });
  });
});
