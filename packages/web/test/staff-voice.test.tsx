/**
 * Ozi in the admin panel (Anthony, 7 October 2026): everything can be heard and done by voice,
 * so a blind person can be employed in any job here.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { spokenDate } from '../src/components/StaffVoice';
import type { RefundsReport, StaffProblem } from '../src/lib/api';
import { setVoiceEngine } from '../src/voice';
import {
  cancellationsWords,
  periodRange,
  readItem,
  refundsWords,
  runnersNowWords,
  signupsWords,
  spokenMoney,
  spokenPeriod,
  summary,
  toOwner,
  understand,
} from '../src/voice/staff-voice';
import { fakeEngine, type FakeEngine } from './fake-voice';

const COMPLAINT: StaffProblem = {
  id: 'p1',
  orderId: 'o1',
  reportedBy: 'shopper',
  reporterName: 'Mr Table',
  summary: 'The eggs were broken.',
  refundRequestedPence: 250,
  decideBy: '2026-10-09T10:00:00.000Z',
  overdue: false,
  evidence: [
    { id: 'e1', kind: 'photo', addedBy: 'shopper', text: null, contentType: 'image/jpeg' },
  ],
};

describe('what Ozi says in the admin panel', () => {
  it('sums up what is waiting, by name', () => {
    const words = summary(
      'Chidi',
      'Customer care officer',
      ['problems', 'feedback'],
      {
        problems: [COMPLAINT, { ...COMPLAINT, id: 'p2', reporterName: 'Mrs Smith', overdue: true }],
        feedback: [
          { id: 'f1', message: 'Great app.', createdAt: '2026-10-07T10:00:00.000Z', runner: null },
        ],
      },
      new Date('2026-10-07T09:00:00'),
    );
    expect(words).toBe(
      'Good morning, Chidi. You\'re signed in as Customer care officer. You have 2 complaints to decide, from Mr Table and Mrs Smith. 1 is overdue and 1 feedback message. Say, for example, "read me the complaints", or "help".',
    );
  });

  it('says plainly when nothing is waiting', () => {
    expect(summary('Ngozi', 'Finance officer', ['owed'], { owed: [] })).toMatch(
      /Nothing is waiting for you right now/,
    );
  });

  it('reads a complaint in full', () => {
    expect(readItem('problems', COMPLAINT, '1 of 2')).toMatch(
      /^Complaint 1 of 2\. Mr Table, a Shopper, says: The eggs were broken\. They ask for £2\.50 back\. With it: 1 photo\. Decide it by Friday 9 October\./,
    );
  });

  it('understands what admins say', () => {
    expect(understand('read me the complaints')).toEqual({ kind: 'open', area: 'problems' });
    expect(understand('look at all the web mail that came through')).toEqual({
      kind: 'open',
      area: 'enquiries',
    });
    expect(understand('any feedback?')).toEqual({ kind: 'open', area: 'feedback' });
    expect(understand("what's waiting")).toEqual({ kind: 'summary' });
    expect(understand('next')).toEqual({ kind: 'next' });
    expect(understand('nobody was at fault, refund 2 pounds 50')).toEqual({
      kind: 'decide',
      decision: 'no_fault',
      refundPence: 250,
    });
    expect(understand('the shopper was at fault')).toEqual({
      kind: 'decide',
      decision: 'shopper_at_fault',
      refundPence: 0,
    });
    expect(understand('write it off')).toEqual({ kind: 'write-off' });
    expect(understand("I've rung them back")).toEqual({ kind: 'rung-back' });
  });

  it('hears money and dates as people say them', () => {
    expect(spokenMoney('£2.50')).toBe(250);
    expect(spokenMoney('five pounds')).toBe(500);
    expect(spokenMoney('3 pounds and 20 pence')).toBe(320);
    expect(spokenMoney('80p')).toBe(80);
    expect(spokenMoney('no idea')).toBeNull();
    expect(spokenDate('31st of March 2027')).toBe('2027-03-31');
    expect(spokenDate('31/3/2027')).toBe('2027-03-31');
    expect(spokenDate('soon')).toBeNull();
  });
});

describe('using the admin panel by voice', () => {
  let sent: Array<{ method: string; path: string; body: unknown }>;
  let decided: boolean;

  beforeEach(() => {
    sent = [];
    decided = false;
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
        sent.push({ method, path, body });
        if (path === '/staff/sign-in') {
          return reply({
            token: 'st1.chidi.sig',
            name: 'Chidi',
            role: 'customer_care',
            title: 'Customer care officer',
            areas: ['problems', 'feedback'],
            mustChangePassword: false,
          });
        }
        if (path === '/staff/me') {
          return reply({
            name: 'Chidi',
            role: 'customer_care',
            title: 'Customer care officer',
            areas: ['problems', 'feedback'],
            account: true,
            mustChangePassword: false,
          });
        }
        if (path === '/staff/problems') return reply({ reports: decided ? [] : [COMPLAINT] });
        if (path === '/staff/problems/p1/decide') {
          decided = true;
          return reply({ report: {} });
        }
        if (path === '/staff/feedback') {
          return reply({
            feedback: [
              {
                id: 'f1',
                message: 'Mrs Smith says thank you.',
                createdAt: '2026-10-07T10:00:00.000Z',
                runner: null,
              },
            ],
          });
        }
        if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
        if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
        return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
      }),
    );
  });

  function spoken(engine: FakeEngine): string {
    return engine.spoken.map((s) => s.text).join(' | ');
  }

  async function say(engine: FakeEngine, text: string): Promise<void> {
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear(text);
  }

  it('says what is waiting, reads the complaint, and decides it after a yes', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Username'), 'chidi');
    await user.type(screen.getByLabelText('Password'), 'chidis own password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(spoken(engine)).toMatch(
        /You have 1 complaint to decide, from Mr Table and 1 feedback message/,
      );
    });

    await say(engine, 'read me the complaints');
    await waitFor(() => {
      expect(spoken(engine)).toContain(
        'Complaint 1 of 1. Mr Table, a Shopper, says: The eggs were broken.',
      );
    });

    await say(engine, 'nobody was at fault, refund 2 pounds 50');
    await waitFor(() => {
      expect(spoken(engine)).toContain(
        'Decide that nobody was at fault, and refund £2.50? Say yes to confirm.',
      );
    });
    expect(sent.some((r) => r.path === '/staff/problems/p1/decide')).toBe(false);

    await say(engine, 'yes');
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/staff/problems/p1/decide')?.body).toEqual({
        decision: 'no_fault',
        refundPence: 250,
        note: 'Decided by voice.',
        by: 'Chidi',
      });
    });
    await waitFor(() => {
      expect(spoken(engine)).toContain('Decided. That is everything here.');
    });

    // Never taken as a shopping order, and a job's limits apply by voice too.
    await say(engine, 'open the team');
    await waitFor(() => {
      expect(spoken(engine)).toContain("Team isn't part of your job, so I can't open it.");
    });
  });
});

describe('Ozi and the owner (ruling 44)', () => {
  it('ends with sir, and says yes sir first when he asked for something', () => {
    expect(toOwner('There are no complaints right now.')).toBe(
      'There are no complaints right now, sir.',
    );
    expect(toOwner('Signing you out. Goodbye.', 'Okay, sir.')).toBe(
      'Okay, sir. Signing you out. Goodbye, sir.',
    );
    expect(toOwner('Only you, sir.', 'Yes, sir.')).toBe('Yes, sir. Only you, sir.');
    expect(toOwner('Accept this? Say yes to confirm')).toBe(
      'Accept this? Say yes to confirm, sir.',
    );
  });

  it('greets him as Mr Anthony, and answers everyday words from the server', async () => {
    window.sessionStorage.clear();
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    const asked: unknown[] = [];
    const reply = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => Promise.resolve(body),
      }) as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        if (path === '/staff/sign-in') {
          return reply({
            token: 'st1.owner.sig',
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            mustChangePassword: false,
          });
        }
        if (path === '/staff/me') {
          return reply({
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            account: true,
            mustChangePassword: false,
            isOwner: true,
            address: 'Mr Anthony',
          });
        }
        if (path === '/staff/team') return reply({ members: [] });
        if (path === '/ozi/reply') {
          asked.push({ headers: init?.headers, body: JSON.parse(String(init?.body)) });
          return reply({ reply: 'My pleasure, Mr Anthony. Always, sir.' });
        }
        return reply({});
      }),
    );
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Username'), 'anthony');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(
        /, Mr Anthony\. You're signed in as Founder\..*, sir\./,
      );
    });
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear('thank you');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe('My pleasure, Mr Anthony. Always, sir.');
    });
    expect(asked[0]).toMatchObject({
      headers: expect.objectContaining({ 'x-staff-token': 'st1.owner.sig' }),
      body: { text: 'thank you', mode: 'exact', turn: 0 },
    });
  });
});

describe('the owner’s spoken questions about the business (Section Q)', () => {
  it('understands them, and the periods people say', () => {
    expect(understand('how many signups this month')).toEqual({
      kind: 'signups',
      period: 'month',
    });
    expect(understand('how many new shoppers joined last week?')).toEqual({
      kind: 'signups',
      period: 'last-week',
    });
    expect(understand('what refunds went out yesterday and why')).toEqual({
      kind: 'refunds',
      period: 'yesterday',
    });
    expect(understand('read me the cancellations')).toEqual({
      kind: 'cancellations',
      period: 'seven-days',
    });
    expect(understand('how many Runners are active right now?')).toEqual({ kind: 'runners-now' });
    // A decision with a refund is still a decision, not a question about refunds.
    expect(understand('nobody was at fault, refund 2 pounds 50')).toEqual(
      expect.objectContaining({ kind: 'decide' }),
    );
    expect(understand('read me the orders')).toEqual({ kind: 'open', area: 'orders' });
    expect(understand('open the audit log')).toEqual({ kind: 'open', area: 'audit' });
    expect(spokenPeriod('this year')).toBe('year');
    expect(spokenPeriod('whenever')).toBeNull();
  });

  it('works out the moments a period runs between', () => {
    const now = new Date(2026, 9, 14, 10, 0, 0); // Wednesday 14 October 2026, local time
    const yesterday = periodRange('yesterday', now);
    expect(yesterday.from).toEqual(new Date(2026, 9, 13));
    expect(yesterday.to).toEqual(new Date(2026, 9, 14));
    expect(periodRange('week', now).from).toEqual(new Date(2026, 9, 12));
    expect(periodRange('month', now).from).toEqual(new Date(2026, 9, 1));
    expect(periodRange('last-month', now)).toEqual(
      expect.objectContaining({ from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }),
    );
  });

  it('answers with numbers, totals and patterns, never a name', () => {
    expect(signupsWords('This month', 12, 1)).toBe(
      'This month, 12 Shoppers and 1 Runner signed up.',
    );
    expect(signupsWords('Today', 0, 0)).toBe('Today, nobody has signed up.');
    const refunds: RefundsReport = {
      from: '',
      to: '',
      count: 3,
      totalPence: 1250,
      ownerOnlyAbovePence: 2500,
      byReason: [
        { reason: 'complaints', count: 2 },
        { reason: 'the till coming to less than the estimate', count: 1 },
      ],
      refunds: [
        {
          at: '',
          amountPence: 500,
          kind: 'problem',
          group: 'complaints',
          reason: 'A complaint: "Mrs Smith says the eggs broke".',
          orderId: 'o1',
          decidedBy: 'Kemi',
        },
      ],
    };
    const said = refundsWords('Yesterday', refunds);
    expect(said).toBe(
      'Yesterday, 3 refunds went out: 2 for complaints and 1 for the till coming to less than the estimate. £12.50 altogether.',
    );
    expect(said).not.toContain('Smith');
    // Anyone but the owner: the server leaves the total out, and so does Ozi.
    expect(refundsWords('Yesterday', { ...refunds, totalPence: null })).not.toContain('£');
    expect(refundsWords('Today', { ...refunds, count: 0, byReason: [] })).toBe(
      'Today, no refunds went out.',
    );
    expect(
      cancellationsWords('In the last seven days', {
        from: '',
        to: '',
        count: 3,
        byReason: [
          { reason: 'The Shopper cancelled before paying.', count: 2 },
          { reason: 'The card payment failed at the bank.', count: 1 },
        ],
        cancellations: [],
      }),
    ).toBe(
      'In the last seven days, 3 orders were cancelled. Twice, the Shopper cancelled before paying and once, the card payment failed at the bank.',
    );
    expect(runnersNowWords({ activeNow: 3, onShift: 2, onAJob: 1, runners: [] })).toBe(
      '3 Runners are active right now: 2 on shift and 1 on a job.',
    );
  });

  it('answers the owner aloud, with sir, from the actual data', async () => {
    window.sessionStorage.clear();
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
    const asked: string[] = [];
    const reply = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => Promise.resolve(body),
      }) as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        asked.push(path);
        if (path === '/staff/sign-in') {
          return reply({
            token: 'st1.owner.sig',
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['reports'],
            mustChangePassword: false,
          });
        }
        if (path === '/staff/me') {
          return reply({
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['reports'],
            account: true,
            mustChangePassword: false,
            isOwner: true,
            address: 'Mr Anthony',
          });
        }
        if (path.startsWith('/staff/reports/signups')) {
          return reply({
            period: 'month',
            buckets: [],
            between: { from: '', to: '', shoppers: 12, runners: 3 },
          });
        }
        // The Reports tab opens on the screen too.
        if (path.startsWith('/staff/reports/refunds')) {
          return reply({
            from: '',
            to: '',
            count: 0,
            totalPence: 0,
            ownerOnlyAbovePence: 2500,
            byReason: [],
            refunds: [],
          });
        }
        if (path.startsWith('/staff/reports/prices')) {
          return reply({
            catalogue: { total: 0, fresh: 0, ageing: 0, stale: 0, oldest: [] },
            shops: [],
          });
        }
        if (path.startsWith('/staff/reports/cancellations')) {
          return reply({
            from: '',
            to: '',
            count: 1,
            byReason: [{ reason: 'The payment link ran out unpaid.', count: 1 }],
            cancellations: [],
          });
        }
        return reply({});
      }),
    );
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Username'), 'anthony');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(/Mr Anthony/);
    });
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear('how many signups this month');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(
        /^(Yes|Okay|All right), sir\. This month, 12 Shoppers and 3 Runners signed up, sir\.$/,
      );
    });
    expect(asked.some((path) => /\/staff\/reports\/signups\?period=month&from=/.test(path))).toBe(
      true,
    );
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    engine.hear('read me the cancellations');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toContain(
        'In the last seven days, 1 order was cancelled. Once, the payment link ran out unpaid, sir.',
      );
    });
  });
});
