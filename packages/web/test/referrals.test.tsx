/**
 * Referral links for everybody, reward levels and Ozi Ambassadors, on the screen (Anthony, 30
 * October 2026; the Ambassador money ruled again the same day): each dashboard's referral card
 * with its share button, progress and levels, a voucher earned, said once by Ozi; becoming an
 * Ambassador only by agreeing to the terms; the Ambassador's money as pending, available and
 * paid, with refunds taken off and withdrawals; the link kept on any page until sign-up; the
 * Ambassador terms page; and the staff Referrals page, and who may open it.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { AMBASSADOR_EDUCATION, ReferralCard } from '../src/components/ReferralCard';
import { storeConfig } from '../src/config';
import { rememberLinkFrom } from '../src/lib/referral';
import { AmbassadorTerms } from '../src/pages/AmbassadorTerms';
import { Referrals } from '../src/pages/StaffAdmin';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine } from './fake-voice';
import { FAKE_SHOPPER, fakeReferrals, stubApi, type RecordedRequest } from './setup';
import { pageTabs } from './staff-tabs';

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

/** A fetch that answers these paths, and records what was sent, with its headers. */
function stubPaths(
  answer: (method: string, path: string, body: unknown) => Response | null,
): Array<RecordedRequest & { headers: Record<string, string> }> {
  const recorded: Array<RecordedRequest & { headers: Record<string, string> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      recorded.push({ method, path, body, headers } as RecordedRequest & {
        headers: Record<string, string>;
      });
      return answer(method, path, body) ?? reply({ error: { message: 'Not stubbed' } }, 404);
    }),
  );
  return recorded;
}

async function noViolations(container: HTMLElement = document.body): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  } as axe.RunOptions);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the referral card on a dashboard', () => {
  it('gives the link with a share button, the counts, progress and the levels, never who joined', async () => {
    const news = vi.fn();
    stubPaths((_method, path) =>
      path === '/referrals/me'
        ? reply(fakeReferrals('https://example.test/join?via=shopper-margaret'))
        : null,
    );
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <MemoryRouter>
        <ReferralCard as="shopper" onNews={news} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Your referral link' })).toBeInTheDocument();
    expect(screen.getByText('https://example.test/join?via=shopper-margaret')).toBeInTheDocument();
    expect(
      screen.getByText('2 people have joined through your link, and 1 is active.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 20 active referrals for your £10 voucher.')).toBeInTheDocument();
    expect(screen.getByText('20 active referrals: a £10 voucher')).toBeInTheDocument();
    expect(screen.getByText('40 active referrals: a £20 voucher')).toBeInTheDocument();

    // No share sheet on this device: the link is copied instead.
    await user.click(screen.getByRole('button', { name: 'Share my referral link' }));
    expect(await navigator.clipboard.readText()).toBe(
      'https://example.test/join?via=shopper-margaret',
    );
    expect(news).toHaveBeenCalledWith('Your link is copied. You can paste it into a message.');
    await noViolations(container);
  });

  it('shows a voucher earned', async () => {
    stubPaths((_method, path) =>
      path === '/referrals/me'
        ? reply(
            fakeReferrals('https://example.test/join?ref=RABCD234', {
              referrals: {
                earned: [
                  {
                    id: 'l1',
                    label: '£10 voucher',
                    words: "You've earned a £10 shopping voucher. We'll be in touch.",
                    given: false,
                  },
                ],
              },
            }),
          )
        : null,
    );
    render(
      <MemoryRouter>
        <ReferralCard as="runner" onNews={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("You've earned a £10 shopping voucher. We'll be in touch."),
    ).toBeInTheDocument();
  });

  it('uses the business sign-in on a shop’s or an organisation’s dashboard', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'biz-token');
    const sent = stubPaths((_method, path) =>
      path === '/referrals/me'
        ? reply(fakeReferrals('https://example.test/join?via=partner-shop1'))
        : null,
    );
    render(
      <MemoryRouter>
        <ReferralCard as="business" onNews={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('https://example.test/join?via=partner-shop1'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/referrals/me')?.headers['x-business-token']).toBe(
      'biz-token',
    );
  });

  it('is on a signed-in Shopper’s Settings, and Ozi says a voucher earned once', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const recorded = stubApi({ shopper: FAKE_SHOPPER });
    const base = globalThis.fetch;
    let heard = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/referrals/me/heard')) {
          heard = true;
          recorded.push({ method: 'POST', path: '/referrals/me/heard', body: {} });
          return reply({ told: 1 });
        }
        if (String(url).endsWith('/referrals/me')) {
          return reply(
            fakeReferrals('https://example.test/join?via=shopper-margaret', {
              referrals: {
                news: heard ? '' : "You've earned a £10 shopping voucher. We'll be in touch.",
              },
            }),
          );
        }
        return base(url, init);
      }),
    );
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Your referral link' })).toBeInTheDocument();
    await waitFor(() => expect(heard).toBe(true), { timeout: 9000 });
    expect(
      engine.spoken.filter((said) => said.text.includes("You've earned a £10 shopping voucher"))
        .length,
    ).toBeLessThanOrEqual(1);
  }, 15000);
});

describe('becoming an Ozi Ambassador', () => {
  it('explains it with the rates from the settings and the education note, and needs the terms ticked', async () => {
    let joined = false;
    const sent = stubPaths((method, path) => {
      if (path === '/referrals/me') {
        return reply(
          fakeReferrals('https://example.test/join?via=shopper-margaret', {
            ambassador: joined
              ? {
                  joined: true,
                  link: 'https://example.test/business/join?ambassador=shopper-margaret',
                }
              : {},
          }),
        );
      }
      if (path === '/ambassador/join' && method === 'POST') {
        joined = true;
        return reply({
          link: 'https://example.test/business/join?ambassador=shopper-margaret',
          message: 'Welcome, you are now an Ozi Ambassador.',
        });
      }
      return null;
    });
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <ReferralCard as="shopper" onNews={news} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Introduce a business' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/act as an independent marketer/)).toBeInTheDocument();
    expect(
      screen.getByText(/The more businesses you introduce, the more you earn/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /2% of our profit on every order from a business you introduce, for 12 months/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/0\.5% on another branch of the same business/)).toBeInTheDocument();
    expect(screen.getByText(AMBASSADOR_EDUCATION)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the Ozi Ambassador terms' })).toHaveAttribute(
      'href',
      '/ambassador/terms',
    );
    // No link to introduce a business before they choose to be an Ambassador.
    expect(screen.queryByText(/business\/join\?ambassador=/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Become an Ozi Ambassador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please tick to agree to the Ozi Ambassador terms first.',
    );
    expect(sent.some((row) => row.path === '/ambassador/join')).toBe(false);

    await user.click(screen.getByLabelText('I have read and agree to the Ozi Ambassador terms'));
    await user.click(screen.getByRole('button', { name: 'Become an Ozi Ambassador' }));
    expect(
      await screen.findByText('https://example.test/business/join?ambassador=shopper-margaret'),
    ).toBeInTheDocument();
    expect(sent.find((row) => row.path === '/ambassador/join')?.body).toEqual({
      termsAgreed: true,
      termsVersion: '2026-10-30b',
    });
    expect(news).toHaveBeenCalledWith('Welcome, you are now an Ozi Ambassador.');
    expect(
      screen.getByRole('button', { name: 'Share my Introduce a business link' }),
    ).toBeInTheDocument();
  });

  it('shows their businesses and money as pending, available and paid, with refunds taken off, and withdraws', async () => {
    let withdrawn = false;
    const sent = stubPaths((method, path) => {
      if (path === '/referrals/me') {
        return reply(
          fakeReferrals('https://example.test/join?via=shopper-margaret', {
            ambassador: {
              joined: true,
              link: 'https://example.test/business/join?ambassador=shopper-margaret',
              businesses: [
                { name: 'Corner Shop', approved: true },
                { name: 'Bakery', approved: false },
              ],
              earnedPence: 2500,
              pendingPence: 300,
              availablePence: withdrawn ? 0 : 1200,
              paidPence: withdrawn ? 2200 : 1000,
              deductions: [
                {
                  at: '2026-11-01T10:00:00.000Z',
                  words:
                    'A refund on an order from Corner Shop came after your share was available: £0.30 taken off.',
                },
              ],
              canWithdraw: !withdrawn,
              bankReady: true,
              withdrawals: withdrawn
                ? [
                    {
                      id: 'w1',
                      requestedAt: '2026-11-10T10:00:00.000Z',
                      words: '£12.00: sent to your bank.',
                    },
                  ]
                : [],
            },
          }),
        );
      }
      if (path === '/ambassador/withdraw' && method === 'POST') {
        withdrawn = true;
        return reply({
          status: 'sent',
          amountPence: 1200,
          message: '£12.00 is on its way to your bank.',
        });
      }
      return null;
    });
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <MemoryRouter>
        <ReferralCard as="shopper" onNews={news} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Corner Shop: approved')).toBeInTheDocument();
    expect(screen.getByText('Bakery: waiting for approval')).toBeInTheDocument();
    expect(
      screen.getByText('Pending (waiting for the refund window to pass): £3.00'),
    ).toBeInTheDocument();
    expect(screen.getByText('Available: £12.00')).toBeInTheDocument();
    expect(screen.getByText('Paid: £10.00')).toBeInTheDocument();
    expect(screen.getByText(/£0\.30 taken off\./)).toBeInTheDocument();
    await noViolations(container);

    await user.click(screen.getByRole('button', { name: 'Withdraw £12.00 to my bank' }));
    expect(await screen.findByText('£12.00: sent to your bank.')).toBeInTheDocument();
    expect(sent.some((row) => row.path === '/ambassador/withdraw')).toBe(true);
    expect(news).toHaveBeenCalledWith('£12.00 is on its way to your bank.');
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it('asks for bank details on Stripe’s own form before a withdrawal', async () => {
    stubPaths((_method, path) => {
      if (path === '/referrals/me') {
        return reply(
          fakeReferrals('https://example.test/join?via=shopper-margaret', {
            ambassador: {
              joined: true,
              link: 'https://example.test/business/join?ambassador=shopper-margaret',
              availablePence: 1200,
              canWithdraw: true,
              bankReady: false,
            },
          }),
        );
      }
      return null;
    });
    render(
      <MemoryRouter>
        <ReferralCard as="shopper" onNews={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('button', { name: 'Set up my bank details with Stripe' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).not.toBeInTheDocument();
  });
});

describe('a referral link, kept until sign-up', () => {
  it('keeps anybody’s link from any page, and an Ambassador’s for /business/join', () => {
    rememberLinkFrom(new URLSearchParams('via=shopper-margaret'));
    expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('shopper:margaret');
    rememberLinkFrom(new URLSearchParams('via=partner-shop1'));
    expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('partner:shop1');
    rememberLinkFrom(new URLSearchParams('ref=rabcd234'));
    expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('runner:RABCD234');
    rememberLinkFrom(new URLSearchParams('ambassador=runner-RABCD234'));
    expect(window.localStorage.getItem('ozidelivery.joined.ambassador')).toBe('runner:RABCD234');
  });

  it('keeps a Shopper’s link that lands on the Runner sign-up page', async () => {
    stubApi();
    render(
      <MemoryRouter initialEntries={['/runner/sign-up?via=shopper-margaret']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('shopper:margaret'),
    );
  });
});

describe('the Ozi Ambassador terms page', () => {
  it('says plainly what an Ambassador is, earns and must not do, from the settings', async () => {
    const { container } = render(
      <MemoryRouter>
        <AmbassadorTerms />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ozi Ambassador terms' }),
    ).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).toMatch(/not our employee, worker or\s+agent/);
    expect(text).toMatch(/2% of our profit/);
    expect(text).toMatch(/for 12 months from the day we approve/);
    expect(text).toMatch(/0\.5%, a quarter of the rate/);
    expect(text).toMatch(/A one-off 5% of the business.s first Partner Plus payment/);
    expect(text).toMatch(/never the delivery fee/i);
    expect(text).toMatch(/stay pending for 30 days/);
    expect(text).toMatch(/There is no limit on what you can earn/);
    expect(text).toMatch(/over £500, a person\s+checks them/);
    expect(text).toMatch(/at\s+least £10 is available/);
    expect(text).toMatch(/HM Revenue and Customs/);
    expect(text).toMatch(/Do not introduce your own business/);
    expect(text).toMatch(/Do not promise anything on our behalf/);
    expect(text).toMatch(/misleading claims/);
    expect(text).toMatch(/law of England and/);
    expect(text).toMatch(/Become an Ozi\s+Ambassador/);
    expect(text).toContain(storeConfig.store.legalEntityName);
    expect(text.toLowerCase()).not.toContain('insurance');
    await noViolations(container);
  });

  it('has its own address', async () => {
    stubApi();
    render(
      <MemoryRouter initialEntries={['/ambassador/terms']}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ozi Ambassador terms' }),
    ).toBeInTheDocument();
  });
});

const STAFF_REFERRALS = {
  levels: [
    { activeReferrals: 20, rewardPence: 1000, label: '£10 voucher' },
    { activeReferrals: 30, rewardPence: 1500, label: '£15 voucher' },
    { activeReferrals: 40, rewardPence: 2000, label: '£20 voucher' },
  ],
  minimumActivePercent: 70,
  givenAs: 'Amazon voucher',
  referrers: [
    {
      kind: 'shopper',
      id: 's1',
      name: 'Ada Obi',
      kindWords: 'Shopper',
      area: 'Medway',
      joined: 28,
      active: 20,
      percent: '71%',
      meetsShare: true,
      level: { id: 'l1', label: '£10 voucher', rewardPence: 1000, given: false },
      levels: [
        {
          id: 'l1',
          label: '£10 voucher',
          activeReferrals: 20,
          rewardPence: 1000,
          reachedAt: '2026-11-01T10:00:00.000Z',
          givenAt: null,
          givenBy: null,
        },
      ],
    },
    {
      kind: 'runner',
      id: 'r1',
      name: 'Tomasz',
      kindWords: 'Runner',
      area: 'Leeds',
      joined: 1,
      active: 0,
      percent: '0%',
      meetsShare: false,
      level: null,
      levels: [],
    },
  ],
  ambassadors: [
    {
      kind: 'shopper',
      id: 's1',
      name: 'Ada Obi',
      kindWords: 'Shopper',
      area: 'Medway',
      businesses: [
        { id: 'p1', name: 'Corner Shop', approved: true, branch: false, earnedPence: 1500 },
        { id: 'p2', name: 'Corner Shop Strood', approved: true, branch: true, earnedPence: 100 },
      ],
      earnedPence: 1600,
      earnedThisMonthPence: 700,
      pendingPence: 300,
      availablePence: 1270,
      paidPence: 0,
      deductionsPence: 30,
      deductions: [
        {
          at: '2026-11-05T10:00:00.000Z',
          amountPence: 30,
          words:
            'A refund on an order from Corner Shop came after your share was available: £0.30 taken off.',
        },
      ],
      withdrawingPence: 0,
      shortfallPence: 0,
      payable: true,
      flagged: false,
      flagReason: null,
      waitingWithdrawals: [
        {
          id: 'w1',
          amountPence: 60000,
          requestedAt: '2026-11-09T10:00:00.000Z',
          waitingReason: 'Withdrawals over £500 in a month are checked by a person first.',
        },
      ],
    },
  ],
};

describe('the staff Referrals page', () => {
  it('lists who referred people, most first, searches, shows each referral, and marks a reward given', async () => {
    const sent = stubPaths((method, path) => {
      if (path.startsWith('/staff/referrals?search=tom')) {
        return reply({
          ...STAFF_REFERRALS,
          referrers: [STAFF_REFERRALS.referrers[1]],
          ambassadors: [],
        });
      }
      if (path === '/staff/referrals') return reply(STAFF_REFERRALS);
      if (path === '/staff/referrals/shopper/s1') {
        return reply({
          referrer: {
            name: 'Ada Obi',
            kindWords: 'Shopper',
            area: 'Medway',
            joined: 28,
            active: 20,
            percent: '71%',
          },
          people: [
            {
              name: 'Bea',
              kindWords: 'Shopper',
              joinedAt: '2026-10-20T10:00:00.000Z',
              active: true,
              reason: 'Has had an order delivered.',
            },
            {
              name: 'Dan',
              kindWords: 'Runner',
              joinedAt: '2026-10-21T10:00:00.000Z',
              active: false,
              reason: 'Not approved yet.',
            },
          ],
        });
      }
      if (path === '/staff/referrals/levels/l1/given' && method === 'POST') {
        return reply({ message: 'The £10 voucher for Ada Obi is marked given, by Kemi.' });
      }
      if (path === '/staff/ambassadors/shopper/s1/paid' && method === 'POST') {
        return reply({ message: 'Ada Obi is marked paid £12.70, by Kemi.' });
      }
      if (path === '/staff/ambassadors/withdrawals/w1/approve' && method === 'POST') {
        return reply({ message: 'The withdrawal of £600.00 is approved and sent, by Kemi.' });
      }
      return null;
    });
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Referrals staffKey="k" by="Kemi" onNews={news} />);

    const list = await screen.findByRole('heading', { name: 'Who has referred people' });
    const section = list.closest('section')!;
    const names = within(section)
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(['Ada Obi (Shopper)', 'Tomasz (Runner)']);
    expect(
      within(section).getByText(
        'Medway. 28 joined, 20 active (71%). Reached the £10 voucher level: reward not given yet.',
      ),
    ).toBeInTheDocument();
    await noViolations(container);

    await user.click(
      within(section).getByRole('button', { name: 'Show the people Ada Obi referred' }),
    );
    expect(
      await screen.findByText(/Bea, Shopper, joined .*: active\. Has had an order delivered\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Dan, Runner, joined .*: not active\. Not approved yet\./),
    ).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', {
        name: 'Mark reward given: the £10 voucher for Ada Obi',
      }),
    );
    await waitFor(() =>
      expect(news).toHaveBeenCalledWith('The £10 voucher for Ada Obi is marked given, by Kemi.'),
    );
    expect(sent.find((row) => row.path === '/staff/referrals/levels/l1/given')?.body).toEqual({
      by: 'Kemi',
    });

    // The Ambassadors: pending, available, paid and refunds taken off; Mark paid and approvals.
    const ambassadors = screen
      .getByRole('heading', { name: 'Ozi Ambassadors' })
      .closest('section')!;
    expect(within(ambassadors).getByText('Pending: £3.00')).toBeInTheDocument();
    expect(within(ambassadors).getByText('Available: £12.70')).toBeInTheDocument();
    expect(within(ambassadors).getByText('Paid: £0.00')).toBeInTheDocument();
    expect(within(ambassadors).getByText('Refunds taken off: £0.30')).toBeInTheDocument();
    expect(within(ambassadors).getByText('This month: £7.00')).toBeInTheDocument();
    expect(
      within(ambassadors).getByText('Corner Shop Strood, approved, another branch: £1.00 earned'),
    ).toBeInTheDocument();
    await user.click(
      within(ambassadors).getByRole('button', { name: 'Mark paid £12.70 to Ada Obi' }),
    );
    await waitFor(() =>
      expect(news).toHaveBeenCalledWith('Ada Obi is marked paid £12.70, by Kemi.'),
    );
    await user.click(
      within(ambassadors).getByRole('button', { name: 'Approve and send Ada Obi’s withdrawal' }),
    );
    await waitFor(() =>
      expect(news).toHaveBeenCalledWith('The withdrawal of £600.00 is approved and sent, by Kemi.'),
    );

    await user.type(screen.getByLabelText('Search by name, kind or area'), 'tom');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(
        within(section)
          .getAllByRole('heading', { level: 4 })
          .map((heading) => heading.textContent),
      ).toEqual(['Tomasz (Runner)']),
    );
  });
});

describe('who may open the Referrals page', () => {
  function stubStaff(areas: string[]) {
    stubPaths((_method, path) => {
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
      if (path === '/staff/sign-in') return reply({ token: 'st1.k.sig', ...me });
      if (path === '/staff/me') return reply(me);
      if (path === '/staff/referrals') return reply(STAFF_REFERRALS);
      return null;
    });
  }

  async function signIn() {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Username'), 'kemi');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('navigation', { name: 'Admin pages' });
    return user;
  }

  it('is a page for staff given the Referrals area', async () => {
    stubStaff(['orders', 'referrals']);
    const user = await signIn();
    expect(await pageTabs(user)).toContain('Referrals');
  });

  it('is not there for staff without it', async () => {
    stubStaff(['orders', 'problems']);
    const user = await signIn();
    expect(await pageTabs(user)).not.toContain('Referrals');
  });
});
