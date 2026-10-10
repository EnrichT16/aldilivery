/**
 * The owner's account (ruling 43): passcode, two-step codes, the money only he sees, the
 * family and investor switches, and the kill switch.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isPasscode, totpCode } from '../src/lib/staff.js';
import { buildTestApp, seedCatalogue, signUpShopper, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string>) {
  return harness.app.inject({ method: 'GET', url, headers });
}

async function makeOwner() {
  const made = await post(
    '/staff/owner',
    { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
}

async function signIn(payload: object) {
  return post('/staff/sign-in', payload);
}

async function ownerHeaders() {
  const response = await signIn({
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
  });
  expect(response.statusCode, response.body).toBe(200);
  return { 'x-staff-token': response.json().token as string };
}

describe('the owner’s passcode', () => {
  it('is six numbers and one special character', () => {
    expect(isPasscode('123456#')).toBe(true);
    expect(isPasscode('123456')).toBe(false);
    expect(isPasscode('12345a#')).toBe(false);
    expect(isPasscode('123456a')).toBe(false);
  });

  it('is asked for after the password, and only the owner’s session sees the money', async () => {
    await makeOwner();
    const first = await signIn({ username: 'anthony', password: 'a long password' });
    expect(first.statusCode).toBe(401);
    expect(first.json().error).toEqual(
      expect.objectContaining({ code: 'more_needed', details: { needs: ['passcode'] } }),
    );
    const wrong = await signIn({
      username: 'anthony',
      password: 'a long password',
      passcode: '654321#',
    });
    expect(wrong.statusCode).toBe(401);

    const headers = await ownerHeaders();
    expect((await get('/staff/money', headers)).statusCode).toBe(200);
    // Not the staff key, and not a founder-role account made by someone else.
    expect((await get('/staff/money', STAFF)).statusCode).toBe(403);
    const other = (
      await post('/staff/team', { name: 'Kemi', username: 'kemi', role: 'founder' }, STAFF)
    ).json();
    const kemi = (await signIn({ username: 'kemi', password: other.password })).json()
      .token as string;
    expect((await get('/staff/money', { 'x-staff-token': kemi })).statusCode).toBe(403);
  });

  it('can be changed with the current one, and only one owner account can exist', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    const changed = await post(
      '/staff/owner/passcode',
      { current: '123456#', passcode: '999888!' },
      headers,
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      (await signIn({ username: 'anthony', password: 'a long password', passcode: '999888!' }))
        .statusCode,
    ).toBe(200);
    const again = await post(
      '/staff/owner',
      { name: 'Someone', username: 'someone', password: 'a long password', passcode: '111111@' },
      STAFF,
    );
    expect(again.statusCode).toBe(409);
  });
});

describe('two-step codes', () => {
  it('when switched on, a code from the authenticator app is needed too', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    const started = (await post('/staff/owner/two-step/start', {}, headers)).json();
    expect(started.otpauth).toMatch(/^otpauth:\/\/totp\//);
    const code = totpCode(started.secret, harness.now());
    expect((await post('/staff/owner/two-step/confirm', { code }, headers)).statusCode).toBe(200);

    const missing = await signIn({
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
    });
    expect(missing.json().error.details).toEqual({ needs: ['passcode', 'code'] });
    const ok = await signIn({
      username: 'anthony',
      password: 'a long password',
      passcode: '123456#',
      code: totpCode(started.secret, harness.now()),
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('the money', () => {
  it('lists every payment in and refund out, by gateway and kind', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    const items = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness);
    await post(
      '/orders',
      {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send it.',
          agreedTotalPence: 250 + 100 + 799,
        },
      },
      shopper.authHeader,
    );
    await post('/extras/recipe-pass', { priceAccepted: true }, shopper.authHeader);
    const money = (await get('/staff/money', headers)).json();
    expect(money.today.inPence).toBe(1149 + 199);
    expect(money.today.byKind).toEqual(
      expect.arrayContaining([
        { name: 'order', pence: 1149 },
        { name: 'recipe-pass', pence: 199 },
      ]),
    );
    expect(money.today.byGateway[0].name).toBe('Rehearsal (no real money)');
  });
});

describe('family and investors', () => {
  it('see only what the owner switches on, never the money, and change nothing', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    const added = (
      await post('/staff/viewers', { name: 'Yvette', username: 'yvette', kind: 'family' }, headers)
    ).json();
    expect(added.message).toMatch(/Everything is switched off until you switch it on/);
    const wife = {
      'x-staff-token': (await signIn({ username: 'yvette', password: added.password })).json()
        .token as string,
    };

    expect((await get('/staff/overview', wife)).statusCode).toBe(403);
    await post(`/staff/viewers/${added.viewer.id}`, { areas: ['overview', 'problems'] }, headers);
    expect((await get('/staff/overview', wife)).statusCode).toBe(200);
    expect((await get('/staff/problems', wife)).statusCode).toBe(200);
    expect((await get('/staff/analytics', wife)).statusCode).toBe(403);

    // All on: still never the money, and never a change.
    await post(`/staff/viewers/${added.viewer.id}`, { all: true }, headers);
    expect((await get('/staff/analytics', wife)).statusCode).toBe(200);
    expect((await get('/staff/money', wife)).statusCode).toBe(403);
    const change = await post('/staff/partners', { name: 'Nope' }, wife);
    expect(change.statusCode).toBe(403);
    expect(change.json().error.message).toMatch(/can look, but not change/);
    // Their own password they can change.
    const own = await post(
      '/staff/password',
      { current: added.password, password: 'yvettes own password' },
      wife,
    );
    expect(own.statusCode).toBe(200);

    // Only the owner adds them.
    expect(
      (await post('/staff/team', { name: 'X', username: 'xavier', role: 'investor' }, STAFF))
        .statusCode,
    ).toBe(400);
  });

  it('the overview counts people and work, with no money in it', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    await signUpShopper(harness);
    const overview = (await get('/staff/overview', headers)).json();
    expect(overview.people).toEqual(expect.objectContaining({ shoppers: 1, runners: 0, staff: 1 }));
    expect(JSON.stringify(overview)).not.toMatch(/Pence/);
  });
});

describe('the kill switch', () => {
  it('turns every switch off and signs every admin session out, with the passcode', async () => {
    await makeOwner();
    const headers = await ownerHeaders();
    const added = (
      await post(
        '/staff/viewers',
        { name: 'Investor', username: 'investor', kind: 'investor' },
        headers,
      )
    ).json();
    await post(`/staff/viewers/${added.viewer.id}`, { all: true }, headers);
    const investor = {
      'x-staff-token': (await signIn({ username: 'investor', password: added.password })).json()
        .token as string,
    };

    expect(
      (await post('/staff/owner/kill-switch', { passcode: '000000#' }, headers)).statusCode,
    ).toBe(401);
    expect(
      (await post('/staff/owner/kill-switch', { passcode: '123456#' }, headers)).statusCode,
    ).toBe(200);

    expect((await get('/staff/me', investor)).statusCode).toBe(403);
    expect((await get('/staff/me', headers)).statusCode).toBe(403);
    const again = {
      'x-staff-token': (await signIn({ username: 'investor', password: added.password })).json()
        .token as string,
    };
    expect((await get('/staff/overview', again)).statusCode).toBe(403);
  });
});
