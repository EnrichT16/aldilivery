/**
 * Nobody is signed out while using the app (ruling 88, 2 November 2026, Anthony).
 *
 * A Runner signed in on his phone was signed out within minutes. Here the server's side of the
 * fix is proved: a sign-in past half its life is renewed by every "me" route; only a token that
 * is bad or has ended, or an account switched off, answers `session_invalid`; nothing sent at
 * all answers `no_session`; a Shopper's or Runner's token lasts at least thirty days whatever
 * the environment says; and the health check shows the lifetimes and the model ids.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signBusinessToken } from '../src/lib/business.js';
import {
  MINIMUM_SESSION_HOURS,
  pastHalfLife,
  sessionTtlHours,
  sessionTtlRaised,
} from '../src/lib/sessions.js';
import { signStaffToken } from '../src/lib/staff.js';
import { signSession, verifySession } from '../src/lib/tokens.js';
import {
  buildTestApp,
  signUpRunner,
  signUpShopper,
  STAFF,
  TEST_SECRET,
  testEnv,
  type TestHarness,
} from './helpers.js';

const START = new Date('2026-11-02T09:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let harness: TestHarness;

beforeEach(async () => {
  // Thirty days, as production has it.
  harness = await buildTestApp(START, { env: { authTokenTtlHours: 720 } });
});

afterEach(async () => {
  await harness.close();
});

function me(headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url: '/me', headers });
}

describe('a Shopper or Runner using the app is never timed out', () => {
  it('a fresh token gets no new one from /me', async () => {
    const runner = await signUpRunner(harness);
    const answer = await me(runner.authHeader);
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).not.toHaveProperty('refreshedToken');
  });

  it('a token past half its life gets a fresh one, good for the full thirty days again', async () => {
    const runner = await signUpRunner(harness);
    harness.setNow(new Date(START.getTime() + 16 * DAY));
    const answer = await me(runner.authHeader);
    expect(answer.statusCode).toBe(200);
    const { refreshedToken, expiresAt } = answer.json() as {
      refreshedToken: string;
      expiresAt: string;
    };
    expect(refreshedToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(new Date(expiresAt).getTime()).toBe(START.getTime() + 16 * DAY + 30 * DAY);
    // The same account, the same role, and it works at once.
    const claims = verifySession(refreshedToken, TEST_SECRET, harness.now());
    expect(claims).toMatchObject({ accountId: runner.runnerId, role: 'runner' });
    const again = await me({ authorization: `Bearer ${refreshedToken}` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).not.toHaveProperty('refreshedToken');
    // So a Runner who opens the app once a fortnight is never signed out.
    harness.setNow(new Date(START.getTime() + 40 * DAY));
    expect((await me({ authorization: `Bearer ${refreshedToken}` })).statusCode).toBe(200);
  });

  it('a Shopper is renewed the same way', async () => {
    const shopper = await signUpShopper(harness);
    harness.setNow(new Date(START.getTime() + 20 * DAY));
    const answer = await me(shopper.authHeader);
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ role: 'shopper' });
    expect(typeof answer.json().refreshedToken).toBe('string');
  });

  it('a token from before 2 November 2026, with no issue time, is renewed from the configured life', () => {
    const lifetime = 720 * HOUR;
    const expiresAtMs = START.getTime() + 10 * DAY;
    expect(pastHalfLife({ expiresAtMs, issuedAtMs: null }, lifetime, START)).toBe(true);
    expect(
      pastHalfLife({ expiresAtMs: START.getTime() + 20 * DAY, issuedAtMs: null }, lifetime, START),
    ).toBe(false);
  });
});

describe('only the end of the sign-in itself says session_invalid', () => {
  it('an expired token answers 401 with session_invalid and the reason', async () => {
    const expired = signSession(
      {
        accountId: 'r1',
        role: 'runner',
        issuedAt: Math.floor(START.getTime() / 1000) - 7200,
        expiresAt: Math.floor(START.getTime() / 1000) - 3600,
      },
      TEST_SECRET,
    );
    const answer = await me({ authorization: `Bearer ${expired}` });
    expect(answer.statusCode).toBe(401);
    expect(answer.json().error.details).toEqual({ code: 'session_invalid', reason: 'expired' });
    // Said for a person, with nothing technical in it.
    expect(answer.json().error.message).toBe('Your sign-in has ended. Please sign in again.');
  });

  it('a forged token answers session_invalid too', async () => {
    const forged = signSession(
      { accountId: 'r1', role: 'runner', expiresAt: Math.floor(START.getTime() / 1000) + 3600 },
      'not the secret',
    );
    const answer = await me({ authorization: `Bearer ${forged}` });
    expect(answer.statusCode).toBe(401);
    expect(answer.json().error.details).toEqual({ code: 'session_invalid', reason: 'invalid' });
  });

  it('no header at all answers no_session, which never ends a sign-in', async () => {
    const answer = await me({});
    expect(answer.statusCode).toBe(401);
    expect(answer.json().error.details).toEqual({ code: 'no_session' });
    expect(answer.json().error.message).toBe('You need to sign in again before doing that.');
  });

  it('the wrong kind of account is a plain refusal, not the end of the sign-in', async () => {
    const shopper = await signUpShopper(harness);
    const answer = await harness.app.inject({
      method: 'GET',
      url: '/jobs/mine',
      headers: shopper.authHeader,
    });
    expect(answer.statusCode).toBe(401);
    expect(answer.json().error.details?.code).not.toBe('session_invalid');
  });
});

describe('staff sessions', () => {
  async function addMember(role: string, username: string, name = 'Chidi') {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/staff/team',
      headers: STAFF,
      payload: { name, username, role },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { member: { id: string }; password: string };
  }

  async function signIn(username: string, password: string, remember = false) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/staff/sign-in',
      payload: { username, password, ...(remember ? { remember: true } : {}) },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { token: string; expiresAt: string };
  }

  function staffMe(token: string) {
    return harness.app.inject({
      method: 'GET',
      url: '/staff/me',
      headers: { 'x-staff-token': token },
    });
  }

  it('a tab session past half its working day is renewed for a working day again', async () => {
    const { password } = await addMember('customer_care', 'chidi');
    const { token } = await signIn('chidi', password);
    expect((await staffMe(token)).json()).not.toHaveProperty('refreshedToken');

    harness.setNow(new Date(START.getTime() + 7 * HOUR));
    const renewed = await staffMe(token);
    expect(renewed.statusCode).toBe(200);
    const { refreshedToken, expiresAt } = renewed.json() as {
      refreshedToken: string;
      expiresAt: string;
    };
    expect(refreshedToken).toMatch(/^st1\./);
    expect(new Date(expiresAt).getTime()).toBe(START.getTime() + 7 * HOUR + 12 * HOUR);
    // Past the old token's end, the new one still works, and the old one does not.
    harness.setNow(new Date(START.getTime() + 13 * HOUR));
    expect((await staffMe(refreshedToken)).statusCode).toBe(200);
    expect((await staffMe(token)).statusCode).toBe(401);
    expect((await staffMe(token)).json().error.details).toEqual({
      code: 'session_invalid',
      reason: 'expired',
    });
  });

  it('a remembered session keeps its remembered flag and its thirty days', async () => {
    const { password } = await addMember('finance', 'ngozi', 'Ngozi');
    const { token } = await signIn('ngozi', password, true);
    const days = harness.config.admin.staffRememberDays;
    harness.setNow(new Date(START.getTime() + (days / 2 + 1) * DAY));
    const renewed = await staffMe(token);
    expect(renewed.statusCode).toBe(200);
    const { refreshedToken, expiresAt } = renewed.json() as {
      refreshedToken: string;
      expiresAt: string;
    };
    expect(new Date(expiresAt).getTime()).toBe(harness.now().getTime() + days * DAY);
    // "Sign out of this phone" still ends it: it is a remembered session like the first.
    const out = await harness.app.inject({
      method: 'POST',
      url: '/staff/sign-out-phone',
      headers: { 'x-staff-token': refreshedToken },
    });
    expect(out.statusCode, out.body).toBe(200);
    expect((await staffMe(refreshedToken)).statusCode).toBe(401);
  });

  it('the staff key is never renewed: it has no session', async () => {
    const answer = await harness.app.inject({ method: 'GET', url: '/staff/me', headers: STAFF });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).not.toHaveProperty('refreshedToken');
  });

  it('a switched-off account gets session_invalid; a bad token too; no token gets no_session', async () => {
    const { member, password } = await addMember('onboarding', 'tunde', 'Tunde');
    const { token } = await signIn('tunde', password);
    await harness.app.inject({
      method: 'POST',
      url: `/staff/team/${member.id}`,
      headers: STAFF,
      payload: { active: false },
    });
    const off = await staffMe(token);
    expect(off.statusCode).toBe(401);
    expect(off.json().error.details).toEqual({ code: 'session_invalid', reason: 'invalid' });

    const expired = signStaffToken(member.id, new Date(START.getTime() - HOUR), TEST_SECRET);
    expect((await staffMe(expired)).json().error.details).toEqual({
      code: 'session_invalid',
      reason: 'expired',
    });

    const none = await harness.app.inject({ method: 'GET', url: '/staff/me' });
    expect(none.statusCode).toBe(403);
    expect(none.json().error.details).toEqual({ code: 'no_session' });
  });
});

describe('business sessions', () => {
  async function partnerUser() {
    const shop = (
      await harness.app.inject({
        method: 'POST',
        url: '/staff/partners',
        headers: STAFF,
        payload: { name: 'Corner Bakery', about: 'Fresh bread every morning.', plan: 'free' },
      })
    ).json().shop as { id: string };
    const user = (
      await harness.app.inject({
        method: 'POST',
        url: `/staff/partners/${shop.id}/users`,
        headers: STAFF,
        payload: { name: 'Bola', username: 'cornerbakery' },
      })
    ).json() as { password: string };
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/business/sign-in',
      payload: { username: 'cornerbakery', password: user.password },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    return signedIn.json().token as string;
  }

  function businessMe(token: string) {
    return harness.app.inject({
      method: 'GET',
      url: '/business/me',
      headers: { 'x-business-token': token },
    });
  }

  it('is renewed past half its working day, and refused plainly when it has ended', async () => {
    const token = await partnerUser();
    expect((await businessMe(token)).json()).not.toHaveProperty('refreshedToken');
    harness.setNow(new Date(START.getTime() + 7 * HOUR));
    const renewed = await businessMe(token);
    expect(renewed.statusCode).toBe(200);
    const { refreshedToken } = renewed.json() as { refreshedToken: string };
    expect(refreshedToken).toMatch(/^bz1\./);
    harness.setNow(new Date(START.getTime() + 13 * HOUR));
    expect((await businessMe(refreshedToken)).statusCode).toBe(200);
    const ended = await businessMe(token);
    expect(ended.statusCode).toBe(401);
    expect(ended.json().error.details).toEqual({ code: 'session_invalid', reason: 'expired' });

    const forged = signBusinessToken('u1', new Date(START.getTime() + DAY), 'not the secret');
    expect((await businessMe(forged)).json().error.details).toEqual({
      code: 'session_invalid',
      reason: 'invalid',
    });
    const none = await harness.app.inject({ method: 'GET', url: '/business/me' });
    expect(none.statusCode).toBe(403);
    expect(none.json().error.details).toEqual({ code: 'no_session' });
  });
});

describe('the least a sign-in lasts', () => {
  it('a short AUTH_TOKEN_TTL_HOURS is raised to thirty days unless short sessions are allowed', () => {
    expect(sessionTtlHours({ authTokenTtlHours: 1, allowShortSessions: false })).toBe(
      MINIMUM_SESSION_HOURS,
    );
    expect(sessionTtlRaised({ authTokenTtlHours: 1, allowShortSessions: false })).toBe(true);
    expect(sessionTtlHours({ authTokenTtlHours: 1, allowShortSessions: true })).toBe(1);
    expect(sessionTtlHours({ authTokenTtlHours: 2000, allowShortSessions: false })).toBe(2000);
    expect(sessionTtlRaised({ authTokenTtlHours: 720, allowShortSessions: false })).toBe(false);
  });

  it('a server told to give one-hour sign-ins gives thirty days anyway', async () => {
    const short = await buildTestApp(START, { env: { authTokenTtlHours: 1 } });
    try {
      const runner = await signUpRunner(short);
      const claims = verifySession(runner.token, TEST_SECRET, START);
      expect(claims?.expiresAt).toBe(Math.floor(START.getTime() / 1000) + 720 * 3600);
      expect(claims?.issuedAt).toBe(Math.floor(START.getTime() / 1000));
      // Ten minutes later, as the Runner's phone found, he is still signed in.
      short.setNow(new Date(START.getTime() + 10 * 60_000));
      expect(
        (await short.app.inject({ method: 'GET', url: '/me', headers: runner.authHeader }))
          .statusCode,
      ).toBe(200);
    } finally {
      await short.close();
    }
  });
});

describe('GET /health says how long sign-ins last, and which model ids are configured', () => {
  it('without a model', async () => {
    const answer = await harness.app.inject({ method: 'GET', url: '/health' });
    expect(answer.json()).toMatchObject({
      sessions: {
        shopperRunnerHours: 720,
        staffTabHours: 12,
        staffRememberDays: harness.config.admin.staffRememberDays,
      },
      brain: null,
    });
  });

  it('with a model, and a raised lifetime', async () => {
    const other = await buildTestApp(START, {
      env: { ...testEnv, authTokenTtlHours: 24 },
      brain: {
        name: 'model',
        model: 'test-model-small',
        ownerModel: 'test-model-large',
        understand: async () => null,
      },
    });
    try {
      const answer = await other.app.inject({ method: 'GET', url: '/health' });
      expect(answer.json()).toMatchObject({
        sessions: { shopperRunnerHours: 720 },
        brain: { model: 'test-model-small', ownerModel: 'test-model-large' },
      });
    } finally {
      await other.close();
    }
  });
});
