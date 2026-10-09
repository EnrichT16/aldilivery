/**
 * The admin panel's newer parts (Section Q): orders with their timelines, Runners working
 * now, the reports, the owner's Shopper accounts and audit log, and two-step codes for every
 * staff sign-in. Each screen is also checked with axe (Rule Seven).
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

let sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let who: 'owner' | 'chidi';
let setupNeeded: boolean;

const OWNER_AREAS = ['overview', 'orders', 'runners', 'reports', 'accounts', 'audit', 'money'];

beforeEach(() => {
  sent = [];
  who = 'owner';
  setupNeeded = false;
  window.sessionStorage.clear();
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
      blob: async () => Promise.resolve(new Blob(['"section"'])),
    }) as unknown as Response;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:the-file' }));
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
      const twoStep = {
        on: false,
        dueAt: '2026-10-31T00:00:00.000Z',
        setupNeeded,
        recoveryCodesLeft: 0,
      };
      if (path === '/staff/sign-in') {
        return reply({
          token: who === 'owner' ? 'st1.owner.sig' : 'st1.chidi.sig',
          name: who === 'owner' ? 'Anthony' : 'Chidi',
          role: who === 'owner' ? 'founder' : 'customer_care',
          title: '',
          areas: [],
          mustChangePassword: false,
          twoStep,
        });
      }
      if (path === '/staff/me') {
        const fresh = headers['x-staff-token'] === 'st1.fresh.sig';
        return who === 'owner'
          ? reply({
              name: 'Anthony',
              role: 'founder',
              title: 'Founder',
              areas: OWNER_AREAS,
              account: true,
              mustChangePassword: false,
              isOwner: true,
              viewOnly: false,
              twoStep,
            })
          : reply({
              name: 'Chidi',
              role: 'customer_care',
              title: 'Customer care officer',
              areas: setupNeeded && !fresh ? [] : ['problems', 'orders'],
              account: true,
              mustChangePassword: false,
              isOwner: false,
              viewOnly: false,
              twoStep: { ...twoStep, setupNeeded: setupNeeded && !fresh, on: fresh },
            });
      }
      if (path === '/staff/overview') {
        return reply({
          people: {
            shoppers: 1,
            runners: 1,
            runnersOnShiftNow: 1,
            shopPartners: 0,
            organisations: 0,
            staff: 1,
          },
          staffByJob: [],
          work: {
            ordersLastDay: 1,
            ordersLastWeek: 1,
            problemsWaiting: 0,
            documentsWaiting: 0,
            shopProductsWaiting: 0,
            findItWaiting: 0,
          },
        });
      }
      if (path.startsWith('/staff/orders/o1')) {
        return reply({
          order: {
            id: 'o1',
            reference: 'ABC123',
            status: 'accepted',
            statusWords: 'A Runner has it',
            createdAt: '2026-10-14T09:00:00.000Z',
            shopperName: 'Margaret',
            shopperHandle: 'margaret',
            runnerName: 'Bola',
            itemCount: 2,
            totalEstimatePence: 1600,
            finalTotalPence: null,
            paidBy: 'card',
            area: 'ME7',
            cancelReason: null,
            goodsEstimatePence: 250,
            feePence: 1350,
            receiptTotalPence: null,
            items: [{ name: 'Milk', quantity: 2, outcome: 'pending' }],
          },
          timeline: [
            { at: '2026-10-14T09:00:00.000Z', what: 'The order was started.' },
            { at: '2026-10-14T09:01:00.000Z', what: 'Offered to Bola.' },
          ],
        });
      }
      if (path.startsWith('/staff/orders')) {
        return reply({
          orders: [
            {
              id: 'o1',
              reference: 'ABC123',
              status: 'accepted',
              statusWords: 'A Runner has it',
              createdAt: '2026-10-14T09:00:00.000Z',
              shopperName: 'Margaret',
              shopperHandle: 'margaret',
              runnerName: 'Bola',
              itemCount: 2,
              totalEstimatePence: 1600,
              finalTotalPence: null,
              paidBy: 'card',
              area: 'ME7',
              cancelReason: null,
            },
          ],
          statuses: [{ status: 'accepted', words: 'A Runner has it' }],
        });
      }
      if (path === '/staff/runners/now') {
        return reply({
          activeNow: 1,
          onShift: 1,
          onAJob: 0,
          runners: [
            {
              id: 'r1',
              name: 'Bola Adeyemi',
              onShift: true,
              activeNow: true,
              travel: 'bicycle',
              job: null,
              jobsCompleted: 12,
              jobsToday: 2,
              earnedTodayPence: 1000,
              earnedWeekPence: 3500,
              earnedAllTimePence: 6000,
            },
          ],
        });
      }
      if (path.startsWith('/staff/reports/signups')) {
        return reply({
          period: 'month',
          between: null,
          buckets: [
            {
              label: 'October 2026',
              from: '2026-10-01T00:00:00.000Z',
              to: '2026-11-01T00:00:00.000Z',
              shoppers: 12,
              runners: 3,
            },
          ],
        });
      }
      if (path.startsWith('/staff/reports/cancellations')) {
        return reply({
          from: '',
          to: '',
          count: 1,
          byReason: [{ reason: 'The Shopper cancelled before paying.', count: 1 }],
          cancellations: [
            {
              id: 'o2',
              reference: 'DEF456',
              at: '2026-10-13T09:00:00.000Z',
              reason: 'The Shopper cancelled before paying.',
            },
          ],
        });
      }
      if (path.startsWith('/staff/reports/refunds')) {
        return reply({
          from: '',
          to: '',
          count: 1,
          totalPence: 250,
          ownerOnlyAbovePence: 2500,
          byReason: [{ reason: 'complaints', count: 1 }],
          refunds: [
            {
              at: '2026-10-13T09:00:00.000Z',
              amountPence: 250,
              kind: 'problem',
              group: 'complaints',
              reason: 'A complaint: "The eggs were broken".',
              orderId: 'o1',
              decidedBy: 'Kemi',
            },
          ],
        });
      }
      if (path === '/staff/reports/prices') {
        return reply({
          catalogue: { total: 10, fresh: 8, ageing: 1, stale: 1, oldest: [] },
          shops: [],
        });
      }
      if (path.startsWith('/staff/shoppers/s1/export.csv')) return reply({});
      if (path.startsWith('/staff/shoppers/s1')) {
        return reply({
          account: {
            id: 's1',
            displayName: 'Margaret Okafor',
            handle: 'margaret',
            phone: '+447700900123',
            deliveryAddress: '12 Example Street, ME7 1AA',
            createdAt: '2026-10-01T09:00:00.000Z',
          },
          savedAddresses: [],
          cards: [{ brand: 'visa', lastFour: '4242', isDefault: true }],
          orders: [],
          regularOrders: [],
          problems: [],
          findIt: [],
          giftCardsBought: [],
        });
      }
      if (path.startsWith('/staff/shoppers')) {
        return reply({
          shoppers: [
            {
              id: 's1',
              displayName: 'Margaret Okafor',
              handle: 'margaret',
              createdAt: '2026-10-01T09:00:00.000Z',
            },
          ],
        });
      }
      if (path.startsWith('/staff/audit')) {
        return reply({
          entries: [
            {
              id: 'a1',
              at: '2026-10-14T09:30:00.000Z',
              actorId: 'm1',
              actorName: 'Kemi',
              actorRole: 'founder',
              action: 'POST /staff/problems/:id/decide',
              words: 'Decided a complaint',
              target: 'id=p1',
              detail: '{"decision":"no_fault"}',
              ip: '203.0.113.7',
            },
          ],
        });
      }
      if (path === '/staff/two-step/start') {
        return reply({
          secret: 'ABCDEFGHIJKLMNOP',
          otpauth: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
          message: 'Add this key.',
        });
      }
      if (path === '/staff/two-step/confirm') {
        return reply({
          message: 'Two-step codes are on.',
          recoveryCodes: ['abcd-efgh', 'jkmn-pqrs'],
          token: 'st1.fresh.sig',
        });
      }
      if (path === '/staff/problems') return reply({ reports: [] });
      if (path.startsWith('/staff/share')) return reply({ url: '', joined: 0 });
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

async function signIn(): Promise<HTMLElement> {
  const user = userEvent.setup({ delay: null });
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
  await user.type(await screen.findByLabelText('Username'), who === 'owner' ? 'anthony' : 'chidi');
  await user.type(screen.getByLabelText('Password'), 'a long password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return document.body;
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

describe('the owner’s admin panel, the newer tabs', () => {
  it('has the tabs at the top, and each one passes axe', async () => {
    await signIn();
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Orders', 'Runners', 'Reports', 'Shopper accounts', 'Audit log']),
    );
    const user = userEvent.setup({ delay: null });

    await user.click(within(nav).getByRole('button', { name: 'Orders' }));
    expect(await screen.findByRole('heading', { name: 'ABC123: A Runner has it' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Open the timeline/ }));
    expect(await screen.findByText(/Offered to Bola\./)).toBeInTheDocument();
    await noViolations();

    await user.click(within(nav).getByRole('button', { name: 'Runners' }));
    expect(await screen.findByText('1 active now: 1 on shift, 0 on a job.')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Bola Adeyemi' })).toBeInTheDocument();
    await noViolations();

    await user.click(within(nav).getByRole('button', { name: 'Reports' }));
    expect(await screen.findByRole('rowheader', { name: 'October 2026' })).toBeInTheDocument();
    expect(await screen.findByText('1 went out, £2.50 altogether.')).toBeInTheDocument();
    expect(screen.getByText('1: The Shopper cancelled before paying.')).toBeInTheDocument();
    expect(
      screen.getByText(/Of 10 prices: 8 seen in the last week, 1 in the last month/),
    ).toBeInTheDocument();
    await noViolations();

    await user.click(within(nav).getByRole('button', { name: 'Audit log' }));
    expect(await screen.findByText(/Kemi, Decided a complaint \(id=p1\)\./)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Search: a name/), 'kemi');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(sent.some((row) => row.path === '/staff/audit?search=kemi')).toBe(true),
    );
    await noViolations();
  });

  it('opens a Shopper’s account and exports their data', async () => {
    await signIn();
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    const user = userEvent.setup({ delay: null });
    await user.click(within(nav).getByRole('button', { name: 'Shopper accounts' }));
    await user.type(screen.getByLabelText('Name, username or phone number'), 'okafor');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await user.click(await screen.findByRole('button', { name: /Open Margaret Okafor/ }));
    expect(await screen.findByText('+447700900123')).toBeInTheDocument();
    expect(screen.getByText(/visa ending 4242/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export everything we hold about them' }));
    const link = await screen.findByRole('link', { name: 'Save the file' });
    expect(link).toHaveAttribute('href', 'blob:the-file');
    expect(link.getAttribute('download')).toMatch(/^shopper-margaret-/);
    expect(sent.some((row) => row.path === '/staff/shoppers/s1/export.csv')).toBe(true);
    await noViolations();
  });
});

describe('two-step codes for staff', () => {
  it('after the grace period, sign-in opens only the set-up, then the job', async () => {
    who = 'chidi';
    setupNeeded = true;
    await signIn();
    expect(
      await screen.findByRole('heading', { name: 'Please set up two-step codes' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin pages' })).not.toBeInTheDocument();
    await noViolations();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Set up two-step codes' }));
    expect(await screen.findByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('The 6-digit code it shows'), '123456');
    await user.click(screen.getByRole('button', { name: 'Switch two-step codes on' }));
    expect(await screen.findByText('abcd-efgh')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I have written them down' }));
    // The fresh session opens their job.
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(within(nav).getByRole('button', { name: 'Orders' })).toBeInTheDocument();
    expect(
      sent.some(
        (row) => row.path === '/staff/me' && row.headers['x-staff-token'] === 'st1.fresh.sig',
      ),
    ).toBe(true);
  });

  it('a staff member has a Two-step codes tab of their own', async () => {
    who = 'chidi';
    await signIn();
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    const user = userEvent.setup({ delay: null });
    await user.click(within(nav).getByRole('button', { name: 'Two-step codes' }));
    expect(
      await screen.findByText(/Off\. They are a must from 31 October 2026\./),
    ).toBeInTheDocument();
    await noViolations();
  });
});
