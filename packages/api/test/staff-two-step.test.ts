/**
 * Two-step codes for every staff sign-in (Section Q, docs/STILL_TO_DO.md item 14), the same
 * authenticator app codes the owner already had (ruling 43): set up with an app, recovery
 * codes for a lost phone, and a must for everyone once their grace period is over.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hashRecoveryCodes,
  newRecoveryCodes,
  totpCode,
  twoStepDueAt,
  useRecoveryCode,
} from '../src/lib/staff.js';
import { STAFF, buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

// Inside everyone's grace period: it starts on 17 October 2026 and lasts fourteen days.
const BEFORE = new Date('2026-10-20T10:00:00.000Z');
const AFTER = new Date('2026-11-01T10:00:00.000Z');

beforeEach(async () => {
  harness = await buildTestApp(BEFORE);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}

/** Someone on the team, made before the grace period began. */
async function addMember(role = 'customer_care', username = 'chidi') {
  const made = await post('/staff/team', { name: 'Chidi', username, role });
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().member.id as string;
  await harness.repository.staffMembers.update(id, {
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
  });
  return { id, username, password: made.json().password as string };
}

async function signIn(username: string, password: string, code?: string) {
  return post('/staff/sign-in', { username, password, ...(code ? { code } : {}) });
}

async function setUp(headers: Record<string, string>) {
  const started = await post('/staff/two-step/start', {}, headers);
  expect(started.statusCode, started.body).toBe(200);
  expect(started.json().otpauth).toMatch(/^otpauth:\/\/totp\//);
  const secret = started.json().secret as string;
  const confirmed = await post(
    '/staff/two-step/confirm',
    { code: totpCode(secret, harness.now()) },
    headers,
  );
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return { secret, recoveryCodes: confirmed.json().recoveryCodes as string[] };
}

describe('two-step codes for every staff sign-in', () => {
  it('are set up with an authenticator app, then asked for at every sign-in', async () => {
    const member = await addMember();
    const first = await signIn(member.username, member.password);
    expect(first.json().twoStep).toEqual(
      expect.objectContaining({ on: false, setupNeeded: false, dueAt: '2026-10-31T00:00:00.000Z' }),
    );
    const headers = { 'x-staff-token': first.json().token as string };
    const { secret, recoveryCodes } = await setUp(headers);
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);

    const missing = await signIn(member.username, member.password);
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toEqual(
      expect.objectContaining({
        code: 'more_needed',
        message: 'Now the 6-digit code from your authenticator app, please.',
        details: { needs: ['code'] },
      }),
    );
    const wrong = await signIn(member.username, member.password, '000000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe('That code was not right.');
    const right = await signIn(member.username, member.password, totpCode(secret, harness.now()));
    expect(right.statusCode, right.body).toBe(200);
    expect(right.json().twoStep).toEqual(
      expect.objectContaining({ on: true, recoveryCodesLeft: 8 }),
    );
    // The team list shows who has them on.
    const team = (await get('/staff/team', STAFF)).json().team;
    expect(team[0]).toEqual(expect.objectContaining({ twoStepOn: true }));
    // The secret and the recovery codes are never shown again.
    expect(JSON.stringify(team)).not.toContain(secret);
  });

  it('take a recovery code once, in place of the app', async () => {
    const member = await addMember();
    const token = (await signIn(member.username, member.password)).json().token as string;
    const { recoveryCodes } = await setUp({ 'x-staff-token': token });
    const code = recoveryCodes[3]!;
    const used = await signIn(member.username, member.password, code.toUpperCase());
    expect(used.statusCode, used.body).toBe(200);
    expect(used.json().message).toMatch(/cannot be used again\. You have 7 left/);
    const again = await signIn(member.username, member.password, code);
    expect(again.statusCode).toBe(401);
  });

  it('wrong codes count towards the fifteen-minute wait', async () => {
    const member = await addMember();
    const token = (await signIn(member.username, member.password)).json().token as string;
    const { secret } = await setUp({ 'x-staff-token': token });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(member.username, member.password, '000000');
    }
    const locked = await signIn(member.username, member.password, totpCode(secret, harness.now()));
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.message).toMatch(/Please wait 15 minutes/);
  });

  it('after the grace period, someone without them can only set them up', async () => {
    const member = await addMember();
    harness.setNow(AFTER);
    const signedIn = await signIn(member.username, member.password);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.json().areas).toEqual([]);
    expect(signedIn.json().twoStep).toEqual(expect.objectContaining({ setupNeeded: true }));
    const headers = { 'x-staff-token': signedIn.json().token as string };

    const refused = await get('/staff/problems', headers);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('two_step_needed');
    const me = (await get('/staff/me', headers)).json();
    expect(me.areas).toEqual([]);
    expect(me.twoStep.setupNeeded).toBe(true);

    const started = await post('/staff/two-step/start', {}, headers);
    const confirmed = await post(
      '/staff/two-step/confirm',
      { code: totpCode(started.json().secret as string, harness.now()) },
      headers,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    // The fresh session it gives opens their job.
    const fresh = { 'x-staff-token': confirmed.json().token as string };
    expect((await get('/staff/problems', fresh)).statusCode).toBe(200);
    expect((await get('/staff/problems', headers)).statusCode).toBe(403);
  });

  it('can be switched off with the password during the grace period, but not after it', async () => {
    const member = await addMember();
    const token = (await signIn(member.username, member.password)).json().token as string;
    const headers = { 'x-staff-token': token };
    await setUp(headers);
    const wrong = await post('/staff/two-step/off', { password: 'not it' }, headers);
    expect(wrong.statusCode).toBe(401);
    const off = await post('/staff/two-step/off', { password: member.password }, headers);
    expect(off.statusCode, off.body).toBe(200);

    const { secret } = await setUp(headers);
    harness.setNow(AFTER);
    const later = await signIn(member.username, member.password, totpCode(secret, AFTER));
    const late = await post(
      '/staff/two-step/off',
      { password: member.password },
      { 'x-staff-token': later.json().token as string },
    );
    expect(late.statusCode).toBe(403);
    expect(late.json().error.message).toMatch(/a must for every admin sign-in now/);
  });

  it('a fresh set of recovery codes needs a code from the app, and the old ones stop', async () => {
    const member = await addMember();
    const token = (await signIn(member.username, member.password)).json().token as string;
    const headers = { 'x-staff-token': token };
    const { secret, recoveryCodes } = await setUp(headers);
    expect(
      (await post('/staff/two-step/recovery-codes', { code: '000000' }, headers)).statusCode,
    ).toBe(400);
    const fresh = await post(
      '/staff/two-step/recovery-codes',
      { code: totpCode(secret, harness.now()) },
      headers,
    );
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect((await signIn(member.username, member.password, recoveryCodes[0])).statusCode).toBe(401);
    const newCode = (fresh.json().recoveryCodes as string[])[0]!;
    expect((await signIn(member.username, member.password, newCode)).statusCode).toBe(200);
  });

  it('the founder resets someone’s lost codes, signing them out; never the owner’s', async () => {
    const member = await addMember();
    const token = (await signIn(member.username, member.password)).json().token as string;
    await setUp({ 'x-staff-token': token });
    const reset = await post(`/staff/team/${member.id}/two-step-reset`, {});
    expect(reset.statusCode, reset.body).toBe(200);
    expect((await get('/staff/problems', { 'x-staff-token': token })).statusCode).toBe(403);
    expect((await signIn(member.username, member.password)).statusCode).toBe(200);

    await post('/staff/owner', {
      name: 'Anthony',
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    const owner = (await harness.repository.staffMembers.findByUsername('anthony'))!;
    const refused = await post(`/staff/team/${owner.id}/two-step-reset`, {});
    expect(refused.statusCode).toBe(403);
  });

  it('the owner too: after the grace period, his own sign-in opens only the set-up', async () => {
    await post('/staff/owner', {
      name: 'Anthony',
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    const owner = (await harness.repository.staffMembers.findByUsername('anthony'))!;
    await harness.repository.staffMembers.update(owner.id, {
      createdAt: new Date('2026-10-01T09:00:00.000Z'),
    });
    harness.setNow(AFTER);
    const signedIn = await post('/staff/sign-in', {
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    const headers = { 'x-staff-token': signedIn.json().token as string };
    expect((await get('/staff/money', headers)).json().error.code).toBe('two_step_needed');
    expect(
      (await post('/staff/owner/kill-switch', { passcode: '123456#' }, headers)).statusCode,
    ).toBe(403);
    const started = await post('/staff/owner/two-step/start', {}, headers);
    expect(started.statusCode, started.body).toBe(200);
    const confirmed = await post(
      '/staff/owner/two-step/confirm',
      { code: totpCode(started.json().secret as string, harness.now()) },
      headers,
    );
    expect(confirmed.json().recoveryCodes).toHaveLength(8);
    const fresh = { 'x-staff-token': confirmed.json().token as string };
    expect((await get('/staff/money', fresh)).statusCode).toBe(200);
  });

  it('family and investors, who only look, set their own up too', async () => {
    const member = await addMember('customer_care', 'ada');
    await harness.repository.staffMembers.update(member.id, { role: 'family' });
    harness.setNow(AFTER);
    const signedIn = await signIn(member.username, member.password);
    expect(signedIn.json().twoStep.setupNeeded).toBe(true);
    const headers = { 'x-staff-token': signedIn.json().token as string };
    const started = await post('/staff/two-step/start', {}, headers);
    expect(started.statusCode, started.body).toBe(200);
    const confirmed = await post(
      '/staff/two-step/confirm',
      { code: totpCode(started.json().secret as string, harness.now()) },
      headers,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
  });
});

describe('the grace period and recovery codes', () => {
  it('counts from the later of the start day and the day the account was made', () => {
    const config = harness.config;
    expect(twoStepDueAt({ createdAt: new Date('2026-01-01T00:00:00Z') }, config)).toEqual(
      new Date('2026-10-31T00:00:00.000Z'),
    );
    expect(twoStepDueAt({ createdAt: new Date('2026-12-01T12:00:00Z') }, config)).toEqual(
      new Date('2026-12-15T12:00:00.000Z'),
    );
  });

  it('keeps recovery codes hashed, each good once', () => {
    const codes = newRecoveryCodes();
    expect(codes.every((code) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code))).toBe(true);
    const stored = hashRecoveryCodes(codes);
    expect(stored).not.toContain(codes[0]);
    const left = useRecoveryCode(stored, codes[0]!.replace('-', ''));
    expect(left?.split(',')).toHaveLength(7);
    expect(useRecoveryCode(left!, codes[0]!)).toBeNull();
    expect(useRecoveryCode(stored, 'nonsense')).toBeNull();
  });
});
