/**
 * Nobody is signed out while using the app (ruling 88, 2 November 2026, Anthony).
 *
 * A Runner signed in on his phone was signed out within minutes: his page forgot its token on
 * any refusal whose words mentioned signing in, and the server's everyday 401 does. Here the
 * screens are held to the ruling: a 500, a 429, no answer, and a plain 401 all keep the
 * sign-in; only the server's own `session_invalid`, said twice in a row, ends it; and a fresh
 * token handed back by "me" is kept where the old one was.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { secondLook } from '../src/lib/session-guard';
import { SessionProvider, useSession } from '../src/state/session';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine } from './fake-voice';
import { fakeReferrals, FAKE_SHOPPER } from './setup';

/** What `/me` answers, one per call; the last answer repeats. */
type Answer = { status: number; body: unknown } | 'network';
/** `'good'` stands for the Runner's own account, answered well. */
type Scripted = Answer | 'good';

const RUNNER_TOKEN_KEY = 'ozidelivery.runner.token';
const SHOPPER_TOKEN_KEY = 'ozidelivery.session.token';

const SESSION_INVALID: Answer = {
  status: 401,
  body: {
    error: {
      code: 'unauthorised',
      message: 'Your sign-in has ended. Please sign in again.',
      details: { code: 'session_invalid', reason: 'expired' },
    },
  },
};
/** The server's everyday 401, whose words signed the Runner out before ruling 88. */
const PLAIN_401: Answer = {
  status: 401,
  body: {
    error: { code: 'unauthorised', message: 'You need to sign in again before doing that.' },
  },
};
const FIVE_HUNDRED: Answer = {
  status: 500,
  body: { error: { code: 'internal', message: 'Something went wrong at our end.' } },
};
const TOO_MANY: Answer = {
  status: 429,
  body: {
    error: {
      code: 'too_many_requests',
      message: 'Too many tries from here. Please wait ten minutes and try again.',
    },
  },
};

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

function answerWith(answer: Answer): Response {
  if (answer === 'network') throw new TypeError('Failed to fetch');
  return reply(answer.body, answer.status);
}

/** The Runner's server, with `/me` scripted and everything else quiet. */
function stubRunnerApi(meAnswers: Scripted[], goodRunner: unknown = runnerBody()): string[] {
  const meCalls: string[] = [];
  window.localStorage.setItem(RUNNER_TOKEN_KEY, 'runner-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      if (path === '/me') {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        meCalls.push(auth.replace('Bearer ', ''));
        const next = meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0]!;
        return next === 'good' ? reply(goodRunner) : answerWith(next);
      }
      if (path === '/referrals/me') {
        return reply(fakeReferrals('https://ozidelivery.co.uk/join?ref=RABCD234'));
      }
      if (path === '/jobs/mine') return reply({ offers: [] });
      if (path === '/jobs/current') return reply({ job: null });
      if (path === '/runners/me/queue-position') {
        return reply({ position: null, reason: 'off_shift', words: 'You are off shift.' });
      }
      if (path === '/runners/me/payouts') {
        return reply({
          setup: 'ready',
          totalEarnedPence: 0,
          owedPence: 0,
          owedDeliveries: 0,
          completedDeliveryCount: 0,
        });
      }
      if (path === '/runners/me/card') {
        return reply({
          enabled: false,
          cardName: 'Ozi card',
          payMethod: 'own',
          chosen: 'own',
          termsAccepted: false,
          card: null,
        });
      }
      if (path === '/runners/me/documents') return reply({ documents: [], stillNeeded: [] });
      if (path === '/runners/me/dashboard') {
        return reply({
          runnerId: 'RABCD234',
          shareLink: 'https://ozidelivery.co.uk/join?ref=RABCD234',
          travelling: 'on_foot',
          travelModes: ['on_foot'],
          canDrive: false,
          earnings: { todayPence: 0, weekPence: 0, allTimePence: 0, jobsToday: 0 },
          jobs: [],
        });
      }
      return reply({ error: { message: `Nothing stubbed for ${path}` } }, 404);
    }),
  );
  return meCalls;
}

function runnerBody(extra: Record<string, unknown> = {}): unknown {
  return {
    role: 'runner',
    runner: {
      id: 'r1',
      name: 'Tomasz',
      phone: '+447700900101',
      rightToWorkVerified: true,
      criminalRecordCheckVerified: true,
      available: false,
      agreementCurrent: true,
      agreementAcceptedAt: '2026-10-01T10:00:00.000Z',
    },
    ...extra,
  };
}

function renderRunnerHome(): void {
  render(
    <MemoryRouter initialEntries={['/runner/home']}>
      <App />
    </MemoryRouter>,
  );
}

/** One more poll of the Runner page (every five seconds). */
async function nextPoll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5_000);
}

describe('the Runner page keeps its sign-in through anything but the end of the sign-in itself', () => {
  beforeEach(() => {
    setVoiceEngine(fakeEngine());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<[string, Answer]>([
    ['a 500', FIVE_HUNDRED],
    ['a 429', TOO_MANY],
    ['no answer at all', 'network'],
    ['a plain 401 without session_invalid', PLAIN_401],
  ])(
    '%s keeps the token, says the problem, and the next poll brings the page back',
    async (_name, failure) => {
      stubRunnerApi([failure, 'good']);
      renderRunnerHome();

      // The problem is said, and the Runner is told he is still signed in: never "not signed in".
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('You are still signed in. We keep trying.')).toBeInTheDocument();
      expect(
        screen.queryByText(/not signed in as a Runner on this device/),
      ).not.toBeInTheDocument();
      expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');

      await nextPoll();
      expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
      expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');
    },
  );

  it('one session_invalid keeps the token: a brief hiccup is not the end of a shift', async () => {
    stubRunnerApi([SESSION_INVALID, 'good']);
    renderRunnerHome();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your sign-in has ended. Please sign in again.',
    );
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');

    await nextPoll();
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');
  });

  it('two session_invalid answers in a row end the sign-in, and only then', async () => {
    stubRunnerApi([SESSION_INVALID, SESSION_INVALID]);
    renderRunnerHome();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');

    await nextPoll();
    expect(await screen.findByText(/not signed in as a Runner on this device/)).toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBeNull();
  });

  it('a good answer between two session_invalid answers starts the count again', async () => {
    stubRunnerApi([SESSION_INVALID, 'good', SESSION_INVALID, 'good']);
    renderRunnerHome();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await nextPoll();
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
    await nextPoll();
    await nextPoll();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
  });

  it('a fresh token from /me takes the old one’s place and is used from then on', async () => {
    const meCalls = stubRunnerApi([
      {
        status: 200,
        body: runnerBody({
          refreshedToken: 'runner-token-2',
          expiresAt: '2026-12-02T09:00:00.000Z',
        }),
      },
      'good',
    ]);
    renderRunnerHome();
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token-2');
    await nextPoll();
    await waitFor(() => expect(meCalls.length).toBeGreaterThanOrEqual(2));
    expect(meCalls[meCalls.length - 1]).toBe('runner-token-2');
  });
});

/* ------------------------------------------------------------------ the Shopper's session */

function Probe(): JSX.Element {
  const { shopper, restoring } = useSession();
  return (
    <p>
      {restoring ? 'Restoring' : shopper ? `Signed in as ${shopper.displayName}` : 'Signed out'}
    </p>
  );
}

function stubShopperApi(meAnswers: Answer[]): string[] {
  const meCalls: string[] = [];
  window.localStorage.setItem(SHOPPER_TOKEN_KEY, 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      if (path === '/me') {
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';
        meCalls.push(auth.replace('Bearer ', ''));
        const next = meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0]!;
        return answerWith(next);
      }
      return reply({ error: { message: `Nothing stubbed for ${path}` } }, 404);
    }),
  );
  return meCalls;
}

const GOOD_SHOPPER: Answer = { status: 200, body: { role: 'shopper', shopper: FAKE_SHOPPER } };

describe('the Shopper’s session', () => {
  beforeEach(() => {
    // The second look comes at once here, rather than ten seconds later.
    secondLook.ms = 0;
  });

  afterEach(() => {
    secondLook.ms = 10_000;
  });

  it('keeps the token through a 500: down is not the same as refused', async () => {
    stubShopperApi([FIVE_HUNDRED]);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(window.localStorage.getItem(SHOPPER_TOKEN_KEY)).toBe('test-token');
  });

  it('keeps the token through a plain 401, a 429 and no answer', async () => {
    for (const failure of [PLAIN_401, TOO_MANY, 'network' as const]) {
      stubShopperApi([failure]);
      const { unmount } = render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      expect(await screen.findByText('Signed out')).toBeInTheDocument();
      expect(window.localStorage.getItem(SHOPPER_TOKEN_KEY)).toBe('test-token');
      unmount();
    }
  });

  it('clears the token only when session_invalid is said twice', async () => {
    const meCalls = stubShopperApi([SESSION_INVALID, SESSION_INVALID]);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(SHOPPER_TOKEN_KEY)).toBeNull());
    expect(meCalls).toHaveLength(2);
  });

  it('a session_invalid answered well on the second look keeps the token', async () => {
    stubShopperApi([SESSION_INVALID, GOOD_SHOPPER]);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText('Signed out');
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(window.localStorage.getItem(SHOPPER_TOKEN_KEY)).toBe('test-token');
  });

  it('keeps a fresh token handed back by /me where the old one was', async () => {
    stubShopperApi([
      {
        status: 200,
        body: {
          role: 'shopper',
          shopper: FAKE_SHOPPER,
          refreshedToken: 'test-token-2',
          expiresAt: '2026-12-02T09:00:00.000Z',
        },
      },
    ]);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText('Signed in as Ada')).toBeInTheDocument();
    expect(window.localStorage.getItem(SHOPPER_TOKEN_KEY)).toBe('test-token-2');
  });
});
