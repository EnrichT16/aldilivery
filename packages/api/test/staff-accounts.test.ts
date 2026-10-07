/**
 * Staff accounts (7 October 2026): each person has their own sign-in and sees only their job.
 * The founder sees everything and manages the team.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword, passwordMatches, signStaffToken } from '../src/lib/staff.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

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

async function signIn(username: string, password: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/staff/sign-in',
    payload: { username, password },
  });
}

describe('staff accounts', () => {
  it('stores passwords hashed, never as themselves', () => {
    const stored = hashPassword('a long password');
    expect(stored).not.toContain('a long password');
    expect(passwordMatches('a long password', stored)).toBe(true);
    expect(passwordMatches('another', stored)).toBe(false);
  });

  it('the founder adds someone; they sign in and see only their own job', async () => {
    const { password } = await addMember('customer_care', 'chidi');
    const signedIn = await signIn('Chidi', password);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.json()).toEqual(
      expect.objectContaining({
        name: 'Chidi',
        title: 'Customer care officer',
        areas: ['problems', 'feedback', 'learning'],
        mustChangePassword: true,
      }),
    );
    const headers = { 'x-staff-token': signedIn.json().token as string };

    const problems = await harness.app.inject({ method: 'GET', url: '/staff/problems', headers });
    expect(problems.statusCode).toBe(200);
    for (const url of [
      '/staff/documents',
      '/staff/recoveries',
      '/staff/find-it',
      '/staff/enquiries',
      '/staff/team',
    ]) {
      const refused = await harness.app.inject({ method: 'GET', url, headers });
      expect(refused.statusCode, url).toBe(403);
      expect(refused.json().error.message).toMatch(/not part of your job/);
    }
  });

  it('chooses their own password, and the old one stops working', async () => {
    const { password } = await addMember('finance', 'ngozi', 'Ngozi');
    const token = (await signIn('ngozi', password)).json().token as string;
    const short = await harness.app.inject({
      method: 'POST',
      url: '/staff/password',
      headers: { 'x-staff-token': token },
      payload: { current: password, password: 'short' },
    });
    expect(short.statusCode).toBe(400);
    const changed = await harness.app.inject({
      method: 'POST',
      url: '/staff/password',
      headers: { 'x-staff-token': token },
      payload: { current: password, password: 'my own good password' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await signIn('ngozi', password)).statusCode).toBe(401);
    const again = await signIn('ngozi', 'my own good password');
    expect(again.json().mustChangePassword).toBe(false);
  });

  it('waits after five wrong passwords', async () => {
    const { password } = await addMember('sourcing', 'emeka', 'Emeka');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn('emeka', 'wrong')).statusCode).toBe(401);
    }
    const locked = await signIn('emeka', password);
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.message).toMatch(/Please wait 15 minutes/);
    harness.setNow(new Date('2026-10-07T10:16:00.000Z'));
    expect((await signIn('emeka', password)).statusCode).toBe(200);
  });

  it('an account turned off stops working at once, even with a token in hand', async () => {
    const { member, password } = await addMember('onboarding', 'tunde', 'Tunde');
    const token = (await signIn('tunde', password)).json().token as string;
    await harness.app.inject({
      method: 'POST',
      url: `/staff/team/${member.id}`,
      headers: STAFF,
      payload: { active: false },
    });
    const refused = await harness.app.inject({
      method: 'GET',
      url: '/staff/documents',
      headers: { 'x-staff-token': token },
    });
    expect(refused.statusCode).toBe(403);
  });

  it('records the signed-in person as the one who decided, whatever the screen sent', async () => {
    const { password } = await addMember('finance', 'ada', 'Ada');
    const token = (await signIn('ada', password)).json().token as string;
    const runner = await harness.repository.runners.create({
      name: 'Bola',
      phone: '+447700900555',
    });
    const owed = await harness.repository.recoveries.create({
      runnerId: runner.id,
      reportId: 'report-1',
      amountPence: 150,
      recoveredPence: 0,
      writtenOff: false,
      writtenOffBy: null,
      writtenOffAt: null,
      createdAt: harness.now(),
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `/staff/runners/${runner.id}/write-off`,
      headers: { 'x-staff-token': token },
      payload: { by: 'Somebody else' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const [row] = await harness.repository.recoveries.listAllOutstanding();
    expect(row).toBeUndefined();
    void owed;
    const all = (
      await harness.app.inject({ method: 'GET', url: '/staff/recoveries', headers: STAFF })
    ).json();
    expect(JSON.stringify(all)).not.toContain('Somebody else');
  });

  it('a forged or expired token is refused', async () => {
    const { member } = await addMember('partnerships', 'joanne', 'Jo');
    const forged = signStaffToken(member.id, new Date('2026-10-08T00:00:00Z'), 'not the secret');
    const expired = signStaffToken(
      member.id,
      new Date('2026-10-07T09:00:00Z'),
      harness.app.ctx.env.authTokenSecret,
    );
    for (const token of [forged, expired, 'nonsense']) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/staff/enquiries',
        headers: { 'x-staff-token': token },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('only the founder manages the team, and resets a forgotten password', async () => {
    const { member } = await addMember('operations_manager', 'kemi', 'Kemi');
    const reset = await harness.app.inject({
      method: 'POST',
      url: `/staff/team/${member.id}/reset`,
      headers: STAFF,
    });
    const password = reset.json().password as string;
    const token = (await signIn('kemi', password)).json().token as string;
    const team = await harness.app.inject({
      method: 'GET',
      url: '/staff/team',
      headers: { 'x-staff-token': token },
    });
    expect(team.statusCode).toBe(403);
    const list = await harness.app.inject({ method: 'GET', url: '/staff/team', headers: STAFF });
    expect(JSON.stringify(list.json())).not.toContain('passwordHash');
    expect(list.json().team[0]).toEqual(expect.objectContaining({ title: 'Operations manager' }));
  });

  it('a username can only be used once', async () => {
    await addMember('finance', 'sam', 'Sam');
    const again = await harness.app.inject({
      method: 'POST',
      url: '/staff/team',
      headers: STAFF,
      payload: { name: 'Sam Two', username: 'sam', role: 'finance' },
    });
    expect(again.statusCode).toBe(409);
  });
});
