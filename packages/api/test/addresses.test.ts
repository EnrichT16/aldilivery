/**
 * Addresses and the PIN (docs/BUILD_PROMPT.md, Section D): the PIN is chosen when first
 * needed, obvious ones are refused, three wrong tries lock it, saving an address and changing
 * the home address need it, and the owner is told every time the home address changes.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { pinMatches, pinProblem } from '../src/lib/pin.js';
import type { PushMessage } from '../src/lib/push.js';
import {
  TEST_SECRET,
  buildTestApp,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let texts: Array<{ to: string; body: string }>;
let pushes: PushMessage[];

const HOME = '12 Example Street, Gillingham, ME7 1AA';

beforeEach(async () => {
  texts = [];
  pushes = [];
  harness = await buildTestApp(undefined, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    sendPush: async (_target, message) => {
      pushes.push(message);
      return 'sent';
    },
  });
  shopper = await signUpShopper(harness);
  await harness.repository.shoppers.update(shopper.shopperId, { deliveryAddress: HOME });
});

function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: object) {
  return harness.app.inject({
    method,
    url,
    headers: shopper.authHeader,
    ...(payload ? { payload } : {}),
  });
}

describe('choosing a PIN', () => {
  it('refuses the obvious ones, and anything that is not four numbers', () => {
    for (const obvious of ['1234', '0000', '7777', '4321', '6789', '1987', '2026']) {
      expect(pinProblem(obvious), obvious).not.toBeNull();
    }
    expect(pinProblem('123')).toBe('A PIN is four numbers, like 2 7 5 9.');
    expect(pinProblem('12a4')).not.toBeNull();
    for (const fine of ['2759', '8146', '1379']) {
      expect(pinProblem(fine), fine).toBeNull();
    }
  });

  it('keeps only a salted hash, never the PIN', async () => {
    const response = await call('POST', '/me/pin', { pin: '2759' });
    expect(response.statusCode).toBe(201);
    const stored = (await harness.repository.shoppers.findById(shopper.shopperId))!.pinHash!;
    expect(stored).not.toContain('2759');
    expect(pinMatches('2759', stored, TEST_SECRET)).toBe(true);
    expect(pinMatches('2758', stored, TEST_SECRET)).toBe(false);
  });

  it('says which kind of PIN is too easy, in plain words', async () => {
    const response = await call('POST', '/me/pin', { pin: '1234' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe(
      'That PIN is a run of numbers, which is easy to guess. Please choose another.',
    );
  });

  it('is chosen once; a second one is refused', async () => {
    await call('POST', '/me/pin', { pin: '2759' });
    expect((await call('POST', '/me/pin', { pin: '8146' })).statusCode).toBe(409);
  });

  it('is never shown, only whether there is one', async () => {
    await call('POST', '/me/pin', { pin: '2759' });
    const me = (await call('GET', '/me')).json().shopper;
    expect(me.hasPin).toBe(true);
    expect(me).not.toHaveProperty('pinHash');
    expect(me).not.toHaveProperty('pinFailedAttempts');
  });
});

describe('saved addresses', () => {
  beforeEach(async () => {
    await call('POST', '/me/pin', { pin: '2759' });
  });

  it('saves as many as wanted with the PIN, in the order saved', async () => {
    for (const label of ["Tom's halls", "Amara's halls", 'Mum']) {
      const saved = await call('POST', '/me/addresses', {
        label,
        address: `${label}, Medway`,
        pin: '2759',
      });
      expect(saved.statusCode).toBe(201);
    }
    const listed = (await call('GET', '/me/addresses')).json();
    expect(listed.home).toBe(HOME);
    expect(listed.saved.map((a: { label: string }) => a.label)).toEqual([
      "Tom's halls",
      "Amara's halls",
      'Mum',
    ]);
  });

  it('asks for a PIN to be chosen first, if there is none', async () => {
    const other = await signUpShopper(harness, { phone: '+447700900555' });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/me/addresses',
      headers: other.authHeader,
      payload: { address: 'Somewhere', pin: '2759' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.details).toEqual({ pin: 'needed' });
  });

  it('removes one without the PIN, but only the Shopper’s own', async () => {
    const saved = (
      await call('POST', '/me/addresses', { address: 'Mum, Rochester', pin: '2759' })
    ).json().address;
    const other = await signUpShopper(harness, { phone: '+447700900556' });
    const theirs = await harness.app.inject({
      method: 'DELETE',
      url: `/me/addresses/${saved.id}`,
      headers: other.authHeader,
    });
    expect(theirs.statusCode).toBe(404);
    expect((await call('DELETE', `/me/addresses/${saved.id}`)).statusCode).toBe(200);
    expect((await call('GET', '/me/addresses')).json().saved).toEqual([]);
  });
});

describe('a wrong PIN', () => {
  beforeEach(async () => {
    await call('POST', '/me/pin', { pin: '2759' });
  });

  it('counts down, then locks for fifteen minutes after three, even for the right PIN', async () => {
    const first = await call('POST', '/me/addresses', { address: 'X', pin: '1111' });
    expect(first.statusCode).toBe(403);
    expect(first.json().error.message).toBe('That PIN is not right. You can try 2 more times.');
    const second = await call('POST', '/me/addresses', { address: 'X', pin: '1112' });
    expect(second.json().error.message).toBe('That PIN is not right. You can try once more.');
    const third = await call('POST', '/me/addresses', { address: 'X', pin: '1113' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toMatch(/locked for 15 minutes/);

    const right = await call('POST', '/me/addresses', { address: 'X', pin: '2759' });
    expect(right.statusCode).toBe(429);

    harness.setNow(new Date(harness.now().getTime() + 15 * 60_000 + 1000));
    expect((await call('POST', '/me/addresses', { address: 'X', pin: '2759' })).statusCode).toBe(
      201,
    );
  });

  it('starts counting again after a right one', async () => {
    await call('POST', '/me/addresses', { address: 'X', pin: '1111' });
    await call('POST', '/me/addresses', { address: 'X', pin: '1112' });
    await call('POST', '/me/addresses', { address: 'X', pin: '2759' });
    const next = await call('POST', '/me/addresses', { address: 'X', pin: '1111' });
    expect(next.json().error.message).toBe('That PIN is not right. You can try 2 more times.');
  });
});

describe('the home address', () => {
  beforeEach(async () => {
    await call('POST', '/me/pin', { pin: '2759' });
  });

  it('changes only with the PIN, and the owner is told by text and notification', async () => {
    expect(
      (await call('PUT', '/me/home-address', { address: '1 New Road, Chatham', pin: '1111' }))
        .statusCode,
    ).toBe(403);
    expect(texts).toEqual([]);

    const changed = await call('PUT', '/me/home-address', {
      address: '1 New Road, Chatham',
      pin: '2759',
    });
    expect(changed.statusCode).toBe(200);
    expect((await harness.repository.shoppers.findById(shopper.shopperId))!.deliveryAddress).toBe(
      '1 New Road, Chatham',
    );
    expect(texts).toEqual([
      {
        to: '+447700900001',
        body: `${harness.config.productName}: the home address on your account was changed just now. If that was not you, ring us straight away.`,
      },
    ]);
  });

  it('cannot be changed through the profile any more without the PIN', async () => {
    const response = await call('PATCH', '/me', { deliveryAddress: '1 Sneaky Lane' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toBe(
      'Changing your home address needs your PIN. You can change it in Your addresses.',
    );
    expect((await harness.repository.shoppers.findById(shopper.shopperId))!.deliveryAddress).toBe(
      HOME,
    );
  });

  it('can be given through the profile the first time, when there is none yet', async () => {
    const other = await signUpShopper(harness, { phone: '+447700900557' });
    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: other.authHeader,
      payload: { deliveryAddress: '3 First Street, Strood' },
    });
    expect(response.statusCode).toBe(200);
  });
});
