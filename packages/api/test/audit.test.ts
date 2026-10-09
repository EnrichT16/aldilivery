/**
 * The audit log (Section Q, docs/STILL_TO_DO.md item 13): every change made in the admin panel
 * is written down with who, what, when, the target and the internet address; it is only ever
 * added to, in the code and in the database; and only the owner sees it, with a search.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryRepository } from '../src/data/memory.js';
import { redactedDetail } from '../src/lib/audit.js';
import { STAFF, buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-14T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({
    method: 'POST',
    url,
    payload,
    headers,
    remoteAddress: '203.0.113.7',
  });
}

function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}

async function ownerHeaders(): Promise<Record<string, string>> {
  await post('/staff/owner', {
    name: 'Anthony',
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  return { 'x-staff-token': signedIn.json().token as string };
}

describe('the audit log', () => {
  it('writes down every change: who, what, the target, when and from where', async () => {
    const owner = await ownerHeaders();
    const made = await post('/staff/team', { name: 'Chidi', username: 'chidi', role: 'finance' });
    const memberId = made.json().member.id as string;
    const signedIn = await post('/staff/sign-in', {
      username: 'chidi',
      password: made.json().password,
    });
    const chidi = { 'x-staff-token': signedIn.json().token as string };
    const changed = await post(
      '/staff/password',
      { current: made.json().password, password: 'my own good password' },
      chidi,
    );
    expect(changed.statusCode).toBe(200);
    await post(`/staff/team/${memberId}`, { active: false }, owner);

    const entries = (await get('/staff/audit', owner)).json().entries as Array<{
      actorName: string;
      actorRole: string;
      action: string;
      words: string;
      target: string;
      detail: string;
      ip: string;
      at: string;
    }>;
    // Newest first.
    expect(entries[0]).toEqual(
      expect.objectContaining({
        actorName: 'Anthony',
        action: 'POST /staff/team/:id',
        words: "Changed someone's job or turned their account on or off",
        target: `id=${memberId}`,
        detail: '{"active":false}',
        ip: '203.0.113.7',
        at: '2026-10-14T10:00:00.000Z',
      }),
    );
    const passwordChange = entries.find((entry) => entry.action === 'POST /staff/password');
    expect(passwordChange).toEqual(
      expect.objectContaining({ actorName: 'Chidi', actorRole: 'finance' }),
    );
    // Passwords are never written down, not even the old one.
    expect(JSON.stringify(entries)).not.toContain('my own good password');
    expect(JSON.stringify(entries)).not.toContain(made.json().password);
    expect(passwordChange?.detail).toContain('[hidden]');
    // The staff key is named as such.
    expect(entries.find((entry) => entry.action === 'POST /staff/team')?.actorName).toBe(
      'Founder (staff key)',
    );
    // Sign-ins, and refused ones.
    expect(entries.map((entry) => entry.action)).toContain('staff.signed-in');
  });

  it('writes down a refused sign-in, but not the password tried', async () => {
    const owner = await ownerHeaders();
    await post('/staff/sign-in', { username: 'anthony', password: 'a wrong guess' });
    const entries = (await get('/staff/audit?search=refused', owner)).json().entries;
    expect(entries).toEqual([
      expect.objectContaining({ action: 'staff.sign-in-refused', detail: 'wrong password' }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('a wrong guess');
  });

  it('leaves out looks, talking to Ozi, and changes that were refused', async () => {
    const owner = await ownerHeaders();
    await get('/staff/team', STAFF);
    await post('/ozi/reply', { text: 'thank you', mode: 'exact', turn: 0 }, owner);
    await post('/staff/team', { name: 'X', username: 'no', role: 'finance' });
    const entries = (await get('/staff/audit', owner)).json().entries as Array<{ action: string }>;
    expect(entries.map((entry) => entry.action)).not.toContain('GET /staff/team');
    expect(entries.map((entry) => entry.action)).not.toContain('POST /ozi/reply');
    expect(entries.filter((entry) => entry.action === 'POST /staff/team')).toHaveLength(0);
  });

  it('is searched by who, what or the target', async () => {
    const owner = await ownerHeaders();
    await post('/staff/team', { name: 'Ngozi', username: 'ngozi', role: 'finance' });
    await post('/staff/team', { name: 'Tunde', username: 'tunde', role: 'onboarding' });
    const found = (await get('/staff/audit?search=tunde', owner)).json().entries;
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('tunde');
    const none = (await get('/staff/audit?search=nothing-like-this', owner)).json().entries;
    expect(none).toEqual([]);
  });

  it('is seen by the owner alone', async () => {
    await ownerHeaders();
    expect((await get('/staff/audit', STAFF)).statusCode).toBe(403);
    const made = await post('/staff/team', { name: 'Kemi', username: 'kemi', role: 'founder' });
    const kemi = await post('/staff/sign-in', { username: 'kemi', password: made.json().password });
    const refused = await get('/staff/audit', { 'x-staff-token': kemi.json().token as string });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toBe('Only the owner can open that.');
  });

  it('has no way to change or remove an entry', async () => {
    const owner = await ownerHeaders();
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await harness.app.inject({ method, url: '/staff/audit', headers: owner });
      expect(response.statusCode).toBe(404);
    }
    const repository = memoryRepository();
    expect(Object.keys(repository.audit).sort()).toEqual(['list', 'record']);
    const entry = await repository.audit.record({
      at: new Date(),
      actorId: null,
      actorName: 'Someone',
      actorRole: 'founder',
      action: 'test',
      target: '',
      detail: '',
      ip: '',
    });
    // What was read back is a copy: changing it changes nothing kept.
    entry.action = 'changed';
    expect((await repository.audit.list({}))[0]?.action).toBe('test');
  });

  it('is refused at the database too: no update, delete or truncate', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'prisma',
        'migrations',
        '20261017090000_admin_audit_and_two_step',
        'migration.sql',
      ),
      'utf8',
    );
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "AuditEntry"/);
    expect(migration).toMatch(/BEFORE TRUNCATE ON "AuditEntry"/);
    expect(migration).toMatch(/RAISE EXCEPTION/);
  });

  it('takes out anything secret before writing it down', () => {
    expect(
      redactedDetail({
        password: 'a',
        passcode: '1',
        code: '123456',
        current: 'b',
        note: 'fine',
      }),
    ).toBe(
      '{"password":"[hidden]","passcode":"[hidden]","code":"[hidden]","current":"[hidden]","note":"fine"}',
    );
    expect(redactedDetail(undefined)).toBe('');
    expect(redactedDetail({})).toBe('');
    expect(redactedDetail({ note: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(501);
  });
});
