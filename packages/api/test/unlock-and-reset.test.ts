/**
 * Unlocking anybody, and resetting a PIN or a password (ruling 81, Anthony, 24 October 2026):
 * only the owner and the staff he lets unlock; a Shopper's PIN unlocked or reset; a staff member
 * unlocked from signing in and from message and call codes; a staff member's password reset, the
 * owner's account never by anyone else; the limits on sign-in codes cleared for an account's
 * phone; one "Locked out" list; each written in the audit log and told to the person by text with
 * no secret in it. And a Shopper changing their own PIN with the current one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STAFF,
  buildTestApp,
  signUpRunner,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;
let shopper: SignedInShopper;

const NOW = new Date('2026-10-24T09:00:00.000Z');

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(NOW, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  shopper = await signUpShopper(harness, { displayName: 'Yvette' });
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object = {}, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
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
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { 'x-staff-token': signedIn.json().token as string };
}

async function staffMember(
  role: string,
  username: string,
  name = username,
): Promise<{ id: string; password: string; headers: Record<string, string> }> {
  const made = await post('/staff/team', { name, username, role });
  expect(made.statusCode, made.body).toBe(201);
  const password = made.json().password as string;
  const signedIn = await post('/staff/sign-in', { username, password });
  return {
    id: made.json().member.id as string,
    password,
    headers: { 'x-staff-token': signedIn.json().token as string },
  };
}

/** The Shopper chooses a PIN, then gets it wrong three times, so it locks. */
async function lockShopperPin(): Promise<void> {
  expect((await post('/me/pin', { pin: '2759' }, shopper.authHeader)).statusCode).toBe(201);
  for (let i = 0; i < 3; i += 1) {
    await post(
      '/me/addresses',
      { address: '1 Elsewhere Road, ME7 1AA', pin: '8146' },
      shopper.authHeader,
    );
  }
  const locked = await harness.repository.shoppers.findById(shopper.shopperId);
  expect(locked?.pinLockedUntil).not.toBeNull();
}

async function auditActions(): Promise<string[]> {
  const entries = await harness.repository.audit.list({ limit: 200 });
  return entries.map((entry) => entry.action);
}

describe('who may unlock', () => {
  it('refuses a staff member the owner has not let unlock, and allows the owner and the staff key', async () => {
    await lockShopperPin();
    const owner = await ownerHeaders();
    const kemi = await staffMember('operations_manager', 'kemi', 'Kemi');
    for (const url of [
      `/staff/shoppers/${shopper.shopperId}/pin/unlock`,
      `/staff/shoppers/${shopper.shopperId}/pin/reset`,
      `/staff/shoppers/${shopper.shopperId}/sign-in-codes/clear`,
      `/staff/team/${kemi.id}/unlock`,
      `/staff/team/${kemi.id}/reset`,
    ]) {
      expect((await post(url, {}, kemi.headers)).statusCode, url).toBe(403);
    }
    expect((await get('/staff/locked-out', kemi.headers)).statusCode).toBe(403);
    expect((await get('/staff/unlock/find?search=yv', kemi.headers)).statusCode).toBe(403);
    expect((await get('/staff/me', kemi.headers)).json().canUnlock).toBe(false);

    expect((await get('/staff/me', owner)).json().canUnlock).toBe(true);
    expect((await get('/staff/locked-out', owner)).statusCode).toBe(200);
    expect((await get('/staff/locked-out')).statusCode).toBe(200);
  });

  it('only the owner gives the permission, in Team, and then it works', async () => {
    const owner = await ownerHeaders();
    const kemi = await staffMember('operations_manager', 'kemi', 'Kemi');
    // The staff key is the founder, but giving permissions is the owner's own.
    expect((await post(`/staff/team/${kemi.id}/can-unlock`, { canUnlock: true })).statusCode).toBe(
      403,
    );
    const given = await post(`/staff/team/${kemi.id}/can-unlock`, { canUnlock: true }, owner);
    expect(given.statusCode, given.body).toBe(200);
    expect(given.json().member.canUnlock).toBe(true);
    expect((await get('/staff/me', kemi.headers)).json().canUnlock).toBe(true);
    await lockShopperPin();
    const unlocked = await post(
      `/staff/shoppers/${shopper.shopperId}/pin/unlock`,
      {},
      kemi.headers,
    );
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    const taken = await post(`/staff/team/${kemi.id}/can-unlock`, { canUnlock: false }, owner);
    expect(taken.json().member.canUnlock).toBe(false);
    expect((await get('/staff/locked-out', kemi.headers)).statusCode).toBe(403);
  });

  it('never lets a family or investor account unlock', async () => {
    const owner = await ownerHeaders();
    const viewer = await post(
      '/staff/viewers',
      { name: 'Ada', username: 'ada', kind: 'family' },
      owner,
    );
    const refused = await post(
      `/staff/team/${viewer.json().viewer.id as string}/can-unlock`,
      { canUnlock: true },
      owner,
    );
    expect(refused.statusCode).toBe(400);
  });
});

describe("a Shopper's PIN", () => {
  it('unlocks it: tries back to none, the lock gone, audited, and the Shopper texted with no PIN', async () => {
    await lockShopperPin();
    const owner = await ownerHeaders();
    const listed = (await get('/staff/locked-out', owner)).json().lockedOut as Array<{
      kind: string;
      id: string;
      words: string;
    }>;
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'shopper_pin', id: shopper.shopperId }),
      ]),
    );
    const response = await post(`/staff/shoppers/${shopper.shopperId}/pin/unlock`, {}, owner);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().told).toBe(true);
    const after = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(after?.pinFailedAttempts).toBe(0);
    expect(after?.pinLockedUntil).toBeNull();
    expect(after?.pinHash).not.toBeNull();
    expect(texts.at(-1)?.body).toContain(`Your PIN was unlocked by ${harness.config.productName}`);
    expect(texts.at(-1)?.body).not.toContain('2759');
    expect(await auditActions()).toContain('unlock.shopper-pin');
    const entry = (await harness.repository.audit.list({ limit: 50 })).find(
      (row) => row.action === 'unlock.shopper-pin',
    );
    expect(entry).toEqual(
      expect.objectContaining({ actorName: 'Anthony', target: `shopper=${shopper.shopperId}` }),
    );
    // The Shopper can use the PIN again.
    const saved = await post(
      '/me/addresses',
      { address: '1 Elsewhere Road, ME7 1AA', pin: '2759' },
      shopper.authHeader,
    );
    expect(saved.statusCode).toBe(201);
    expect((await get('/staff/locked-out', owner)).json().lockedOut).toEqual([]);
  });

  it('resets it, so the Shopper chooses a new one the next time, and texts them the words Anthony chose', async () => {
    await lockShopperPin();
    const owner = await ownerHeaders();
    const response = await post(`/staff/shoppers/${shopper.shopperId}/pin/reset`, {}, owner);
    expect(response.statusCode, response.body).toBe(200);
    const after = await harness.repository.shoppers.findById(shopper.shopperId);
    expect(after?.pinHash).toBeNull();
    expect(after?.pinLockedUntil).toBeNull();
    expect(texts.at(-1)?.body).toBe(
      `Your PIN was reset by ${harness.config.productName}. You will be asked to choose a new one the next time it is needed. If you did not ask for this, ring ${harness.config.contact.telephonePlaceholder}.`,
    );
    expect(await auditActions()).toContain('unlock.shopper-pin-reset');
    const book = await harness.app.inject({
      method: 'GET',
      url: '/me/addresses',
      headers: shopper.authHeader,
    });
    expect(book.json().hasPin).toBe(false);
    // A new PIN can be chosen, as the first time.
    expect((await post('/me/pin', { pin: '8146' }, shopper.authHeader)).statusCode).toBe(201);
  });
});

describe('a staff member', () => {
  it('unlocks signing in after five wrong passwords, audited', async () => {
    const owner = await ownerHeaders();
    const kemi = await staffMember('operations_manager', 'kemi', 'Kemi');
    for (let i = 0; i < 5; i += 1) {
      await post('/staff/sign-in', { username: 'kemi', password: 'not the password' });
    }
    expect(
      (await post('/staff/sign-in', { username: 'kemi', password: kemi.password })).statusCode,
    ).toBe(401);
    const listed = (await get('/staff/locked-out', owner)).json().lockedOut as Array<{
      kind: string;
      id: string;
    }>;
    expect(listed).toEqual([expect.objectContaining({ kind: 'staff_sign_in', id: kemi.id })]);
    const team = (await get('/staff/team', owner)).json().team as Array<{
      id: string;
      lockedOut: boolean;
    }>;
    expect(team.find((row) => row.id === kemi.id)?.lockedOut).toBe(true);

    const unlocked = await post(`/staff/team/${kemi.id}/unlock`, {}, owner);
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    expect(unlocked.json().message).toContain('signing in');
    expect(
      (await post('/staff/sign-in', { username: 'kemi', password: kemi.password })).statusCode,
    ).toBe(200);
    expect(await auditActions()).toContain('unlock.staff');
  });

  it('unlocks message and call codes after five wrong codes (ruling 77)', async () => {
    const owner = await ownerHeaders();
    const chidi = await staffMember('customer_care', 'chidi', 'Chidi');
    for (let i = 0; i < 5; i += 1) {
      await post('/staff/contact/call-code', { code: '000000' }, chidi.headers);
    }
    expect(
      (await post('/staff/contact/call-code', { code: '000000' }, chidi.headers)).statusCode,
    ).toBe(429);
    const listed = (await get('/staff/locked-out', owner)).json().lockedOut as Array<{
      kind: string;
      id: string;
    }>;
    expect(listed).toEqual([expect.objectContaining({ kind: 'staff_codes', id: chidi.id })]);
    const unlocked = await post(`/staff/team/${chidi.id}/unlock`, {}, owner);
    expect(unlocked.json().message).toContain('message and call codes');
    // Tried again: wrong, but no longer locked.
    expect(
      (await post('/staff/contact/call-code', { code: '000000' }, chidi.headers)).statusCode,
    ).toBe(403);
  });

  it('resets a password: a temporary one shown once, to be changed at the next sign-in, audited without it', async () => {
    const owner = await ownerHeaders();
    const kemi = await staffMember('operations_manager', 'kemi', 'Kemi');
    const reset = await post(`/staff/team/${kemi.id}/reset`, {}, owner);
    expect(reset.statusCode, reset.body).toBe(200);
    const password = reset.json().password as string;
    const member = await harness.repository.staffMembers.findById(kemi.id);
    expect(member?.mustChangePassword).toBe(true);
    const signedIn = await post('/staff/sign-in', { username: 'kemi', password });
    expect(signedIn.json().mustChangePassword).toBe(true);
    const entries = await harness.repository.audit.list({ limit: 100 });
    expect(entries.map((row) => row.action)).toContain('unlock.staff-password-reset');
    expect(JSON.stringify(entries)).not.toContain(password);
  });

  it("never lets anyone else reset the owner's account, the staff key or a staff member who may unlock", async () => {
    const owner = await ownerHeaders();
    const team = (await get('/staff/team', owner)).json().team as Array<{
      id: string;
      isOwner: boolean;
    }>;
    const ownerId = team.find((row) => row.isOwner)!.id;
    const kemi = await staffMember('operations_manager', 'kemi', 'Kemi');
    await post(`/staff/team/${kemi.id}/can-unlock`, { canUnlock: true }, owner);
    expect((await post(`/staff/team/${ownerId}/reset`, {}, kemi.headers)).statusCode).toBe(403);
    expect((await post(`/staff/team/${ownerId}/reset`)).statusCode).toBe(403);
    // The owner himself may.
    expect((await post(`/staff/team/${ownerId}/reset`, {}, owner)).statusCode).toBe(200);
  });
});

describe('sign-in codes', () => {
  it("clears the limits for an account's phone, found by the account, and texts them", async () => {
    const owner = await ownerHeaders();
    for (let i = 0; i < 3; i += 1) {
      const sent = await post('/auth/request-code', { phone: '07700 900001', role: 'shopper' }, {});
      expect(sent.statusCode, sent.body).toBe(200);
    }
    expect(
      (await post('/auth/request-code', { phone: '07700 900001', role: 'shopper' }, {})).statusCode,
    ).toBe(429);
    const listed = (await get('/staff/locked-out', owner)).json().lockedOut as Array<{
      kind: string;
      id: string;
      words: string;
    }>;
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'sign_in_codes', id: shopper.shopperId }),
    ]);
    expect(JSON.stringify(listed)).not.toContain('900001');
    const found = await get('/staff/unlock/find?search=Yvet', owner);
    expect(found.json().people[0]).toEqual(
      expect.objectContaining({ id: shopper.shopperId, signInCodesLocked: true }),
    );
    expect(JSON.stringify(found.json())).not.toContain('7700900001');

    const cleared = await post(
      `/staff/shoppers/${shopper.shopperId}/sign-in-codes/clear`,
      {},
      owner,
    );
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(texts.at(-1)?.body).toContain('cleared the limit on sign-in codes');
    expect(
      (await post('/auth/request-code', { phone: '07700 900001', role: 'shopper' }, {})).statusCode,
    ).toBe(200);
    expect(await auditActions()).toContain('unlock.sign-in-codes');
  });

  it("clears a Runner's too", async () => {
    const runner = await signUpRunner(harness, { name: 'Tomasz' });
    for (let i = 0; i < 3; i += 1) {
      await post('/auth/request-code', { phone: '07700 900101', role: 'runner' }, {});
    }
    const listed = (await get('/staff/locked-out')).json().lockedOut as Array<{
      kind: string;
      account: string;
      id: string;
    }>;
    expect(listed).toEqual([
      expect.objectContaining({ kind: 'sign_in_codes', account: 'runner', id: runner.runnerId }),
    ]);
    const cleared = await post(`/staff/runners/${runner.runnerId}/sign-in-codes/clear`);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((await get('/staff/locked-out')).json().lockedOut).toEqual([]);
  });
});

describe('the Shopper changes their own PIN', () => {
  it('with the current PIN, by the same rules as the first, and is texted with no PIN in it', async () => {
    await post('/me/pin', { pin: '2759' }, shopper.authHeader);
    const easy = await post('/me/pin/change', { current: '2759', pin: '1234' }, shopper.authHeader);
    expect(easy.statusCode).toBe(400);
    const same = await post('/me/pin/change', { current: '2759', pin: '2759' }, shopper.authHeader);
    expect(same.statusCode).toBe(400);
    const changed = await post(
      '/me/pin/change',
      { current: '2759', pin: '8146' },
      shopper.authHeader,
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(texts.at(-1)?.body).toContain('PIN was changed');
    expect(texts.at(-1)?.body).not.toMatch(/2759|8146/);
    const saved = await post(
      '/me/addresses',
      { address: '1 Elsewhere Road, ME7 1AA', pin: '8146' },
      shopper.authHeader,
    );
    expect(saved.statusCode).toBe(201);
  });

  it('locks after three wrong current PINs', async () => {
    await post('/me/pin', { pin: '2759' }, shopper.authHeader);
    const first = await post(
      '/me/pin/change',
      { current: '1111', pin: '8146' },
      shopper.authHeader,
    );
    expect(first.statusCode).toBe(403);
    await post('/me/pin/change', { current: '1112', pin: '8146' }, shopper.authHeader);
    const third = await post(
      '/me/pin/change',
      { current: '1113', pin: '8146' },
      shopper.authHeader,
    );
    expect(third.statusCode).toBe(429);
    // Even the right one waits while it is locked.
    const right = await post(
      '/me/pin/change',
      { current: '2759', pin: '8146' },
      shopper.authHeader,
    );
    expect(right.statusCode).toBe(429);
    expect((await get('/staff/locked-out')).json().lockedOut).toEqual([
      expect.objectContaining({ kind: 'shopper_pin', id: shopper.shopperId }),
    ]);
  });

  it('needs a PIN first, when there is none', async () => {
    const response = await post(
      '/me/pin/change',
      { current: '2759', pin: '8146' },
      shopper.authHeader,
    );
    expect(response.statusCode).toBe(409);
  });
});
