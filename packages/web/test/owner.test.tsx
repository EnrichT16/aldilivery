/**
 * The owner's admin panel (ruling 43): the passcode at sign-in, the money only he sees, and
 * the switches for family and investors.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

let sent: Array<{ method: string; path: string; body: unknown }>;
let who: 'owner' | 'family';
let familyAreas: string[];
let ownerAreas: string[];
let payBackWaiting: boolean;

const MONEY_TOTALS = {
  inPence: 1799,
  outPence: 0,
  netPence: 1799,
  byGateway: [{ name: 'Stripe', pence: 1799 }],
  byKind: [
    { name: 'order', pence: 1600 },
    { name: 'recipe-pass', pence: 199 },
  ],
};

beforeEach(() => {
  sent = [];
  who = 'owner';
  familyAreas = ['overview'];
  ownerAreas = ['overview', 'money', 'team'];
  payBackWaiting = true;
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
        const given = body as { passcode?: string };
        if (who === 'owner' && !given.passcode) {
          return reply(
            {
              error: {
                code: 'more_needed',
                message: 'Now your passcode, please.',
                details: { needs: ['passcode'] },
              },
            },
            401,
          );
        }
        return reply({
          token: 'st1.t.s',
          name: who === 'owner' ? 'Anthony' : 'Yvette',
          role: who === 'owner' ? 'founder' : 'family',
          title: '',
          areas: [],
          mustChangePassword: false,
        });
      }
      if (path === '/staff/me') {
        return who === 'owner'
          ? reply({
              name: 'Anthony',
              role: 'founder',
              title: 'Founder',
              areas: ownerAreas,
              account: true,
              mustChangePassword: false,
              isOwner: true,
              viewOnly: false,
            })
          : reply({
              name: 'Yvette',
              role: 'family',
              title: 'Family',
              areas: familyAreas,
              account: true,
              mustChangePassword: false,
              isOwner: false,
              viewOnly: true,
            });
      }
      if (path === '/staff/overview') {
        return reply({
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
          today: MONEY_TOTALS,
          week: MONEY_TOTALS,
          month: MONEY_TOTALS,
          year: MONEY_TOTALS,
          allTime: MONEY_TOTALS,
          runnerPayBack: {
            todayPence: 320,
            weekPence: 1520,
            monthPence: 4020,
            allTimePence: 4020,
            waitingCount: 1,
            waitingPence: 1200,
            owedCount: 0,
            owedPence: 0,
          },
          recent: [],
        });
      }
      if (path === '/staff/payments') return reply({ waiting: [], received: [] });
      if (path === '/staff/reimbursements') {
        const row = {
          orderId: 'order-9',
          reference: 'OZ-DEF456',
          transferReference: 'reimburse:order-9',
          runnerName: 'Tomasz',
          goodsEstimatePence: 600,
          receiptTotalPence: 1200,
          amountPence: 1200,
          reason: 'over the limit',
          approvedBy: null,
          paidAt: null,
        };
        return reply({
          waiting: payBackWaiting ? [{ ...row, status: 'waiting' }] : [],
          owed: [],
          paid: payBackWaiting ? [] : [{ ...row, status: 'paid', approvedBy: 'Anthony' }],
        });
      }
      if (path === '/staff/reimbursements/order-9/approve') {
        payBackWaiting = false;
        return reply({ message: 'Approved: £12.00 paid back to Tomasz.' });
      }
      if (path === '/staff/viewers' && method === 'GET') {
        return reply({
          viewers: [
            {
              id: 'v1',
              name: 'Yvette',
              username: 'yvette',
              kind: 'family',
              active: true,
              areas: ['overview'],
              lastSignInAt: null,
            },
          ],
          areas: [
            'overview',
            'analytics',
            'team',
            'documents',
            'problems',
            'feedback',
            'finds',
            'enquiries',
            'partners',
          ],
        });
      }
      if (path === '/staff/viewers/v1') return reply({ viewer: {} });
      if (path === '/staff/team') return reply({ team: [] });
      if (path === '/staff/roles') return reply({ roles: [] });
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderStaff() {
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
}

async function signIn(user: ReturnType<typeof userEvent.setup>, passcode?: string) {
  await user.type(await screen.findByLabelText('Username'), who === 'owner' ? 'anthony' : 'yvette');
  await user.type(screen.getByLabelText('Password'), 'a long password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  if (passcode) {
    await user.type(
      await screen.findByLabelText('Your passcode: six numbers, then your special character'),
      passcode,
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  }
}

describe('the owner', () => {
  it('is asked for the passcode after the password, then sees the money and his settings', async () => {
    const user = userEvent.setup({ delay: null });
    renderStaff();
    await signIn(user, '123456#');
    expect(sent.filter((r) => r.path === '/staff/sign-in').at(-1)?.body).toEqual(
      expect.objectContaining({ username: 'anthony', passcode: '123456#' }),
    );
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Money', 'Team', 'My settings']);
    await user.click(within(nav).getByRole('button', { name: 'Money' }));
    expect(
      await screen.findByText('Only you see this. Not staff, not family, not investors.'),
    ).toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: 'My settings' }));
    const switchOn = await screen.findByRole('switch', { name: 'Complaints' });
    expect(switchOn).not.toBeChecked();
    await user.click(switchOn);
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/staff/viewers/v1')?.body).toEqual({
        areas: ['overview', 'problems'],
      });
    });
    await user.click(screen.getByRole('button', { name: 'Switch all on for Yvette' }));
    await waitFor(() => {
      expect(sent.filter((r) => r.path === '/staff/viewers/v1').at(-1)?.body).toEqual({
        all: true,
      });
    });
    expect(screen.getByText('The money: always off. Only you see it.')).toBeInTheDocument();
  });
});

describe('paying Runners back for the shopping (ruling 55)', () => {
  it('shows the owner what was paid back, and approves one that waits for a person', async () => {
    ownerAreas = ['overview', 'money', 'payments'];
    const user = userEvent.setup({ delay: null });
    renderStaff();
    await signIn(user, '123456#');
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });

    await user.click(within(nav).getByRole('button', { name: 'Money' }));
    expect(
      await screen.findByRole('heading', { name: 'Runners paid back for the shopping' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/altogether £40.20/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for you to approve: 1 \(£12.00\)/)).toBeInTheDocument();

    await user.click(within(nav).getByRole('button', { name: 'Payments' }));
    expect(await screen.findByText('£12.00 to Tomasz, order OZ-DEF456')).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting because the till came to a lot more than the estimate/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve and pay back\b.*OZ-DEF456$/ }));
    await waitFor(() => {
      expect(sent.some((r) => r.path === '/staff/reimbursements/order-9/approve')).toBe(true);
    });
    expect(await screen.findByText(/approved by Anthony/)).toBeInTheDocument();
  });
});

describe('family', () => {
  it('sees only what is switched on, and is told they can only look', async () => {
    who = 'family';
    const user = userEvent.setup({ delay: null });
    renderStaff();
    await signIn(user);
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
      // Their own two-step codes are theirs to set up, like every admin sign-in (Section Q).
    ).toEqual(['Overview', 'Two-step codes']);
    expect(screen.getByText(/You can look, but not change anything\./)).toBeInTheDocument();
    expect((await screen.findByText('Shoppers')).nextSibling).toHaveTextContent('120');
    expect(screen.queryByRole('button', { name: 'Money' })).not.toBeInTheDocument();
  });
});

describe('the advert square', () => {
  it('is off until the owner switches it on', async () => {
    render(
      <MemoryRouter initialEntries={['/shop']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('complementary', { name: 'Advert' })).not.toBeInTheDocument();
  });
});
