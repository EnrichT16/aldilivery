/**
 * Accounts, signing in, and the seven day recycle bin.
 *
 * Also Rule Ten, checked at the only place a card could possibly enter the system.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, signUpShopper, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp();
});

describe('signing in with a phone and a one time code', () => {
  it('sends a code and says nothing about whether the number is known', async () => {
    const unknown = await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900555' },
    });
    expect(unknown.statusCode).toBe(200);
    expect(harness.deliveredCodes).toHaveLength(1);
  });

  it('never stores the code itself', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900555' },
    });
    const code = harness.deliveredCodes[0]!.code;
    const stored = await harness.repository.oneTimeCodes.findLatestUnconsumed(
      '+447700900555',
      'shopper',
    );
    expect(stored).not.toBeNull();
    expect(stored?.codeHash).not.toBe(code);
    expect(stored?.codeHash).not.toContain(code);
  });

  it('refuses a wrong code', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900555' },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '+447700900555', code: '000000' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('tells a new person that they need to register, rather than failing', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900555' },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '+447700900555', code: harness.deliveredCodes[0]!.code },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ registrationRequired: true });
  });

  it('signs in a known Shopper and hands back a token', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });

    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900001' },
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '+447700900001', code: harness.deliveredCodes[0]!.code },
    });

    const body = response.json() as { token?: string; registrationRequired: boolean };
    expect(body.registrationRequired).toBe(false);
    expect(body.token).toBeTruthy();

    const me = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.json()).toMatchObject({ role: 'shopper' });
  });

  it('will not let a code be used twice', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: '+447700900001' },
    });
    const code = harness.deliveredCodes[0]!.code;

    const first = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '+447700900001', code },
    });
    expect(first.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '+447700900001', code },
    });
    expect(second.statusCode).toBe(401);
  });
});

describe('registration', () => {
  it('gives a Shopper a handle if they do not want to invent one', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret Okonkwo', phone: '+447700900001' },
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as { shopper: { handle: string } }).shopper.handle).toMatch(
      /^margaret-okonkwo-\d+$/,
    );
  });

  it('never hands back the spoken code hash', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001', spokenCode: 'bluebell' },
    });
    expect(response.body).not.toContain('bluebell');
    expect(response.body).not.toContain('spokenCodeHash');
  });

  it('starts a Runner with both checks unverified', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/runners',
      payload: { name: 'Tomasz', phone: '+447700900101' },
    });
    const body = response.json() as {
      runner: { rightToWorkVerified: boolean; criminalRecordCheckVerified: boolean };
    };
    expect(body.runner.rightToWorkVerified).toBe(false);
    expect(body.runner.criminalRecordCheckVerified).toBe(false);
  });
});

describe('the seven day recycle bin', () => {
  it('schedules deletion rather than deleting', async () => {
    const signUp = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    const { shopper, token } = signUp.json() as { shopper: { id: string }; token: string };
    const auth = { authorization: `Bearer ${token}` };

    const response = await harness.app.inject({
      method: 'POST',
      url: '/account/delete',
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { recycleBinDays: number }).recycleBinDays).toBe(7);

    // The account is still there.
    const stored = await harness.repository.shoppers.findById(shopper.id);
    expect(stored).not.toBeNull();
    expect(stored?.deletionScheduledFor).not.toBeNull();

    const days =
      (stored!.deletionScheduledFor!.getTime() - harness.now().getTime()) / (24 * 3600 * 1000);
    expect(days).toBeCloseTo(7, 5);
  });

  it('lets the Shopper change their mind', async () => {
    const signUp = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    const { shopper, token } = signUp.json() as { shopper: { id: string }; token: string };
    const auth = { authorization: `Bearer ${token}` };

    await harness.app.inject({ method: 'POST', url: '/account/delete', headers: auth });
    const restore = await harness.app.inject({
      method: 'POST',
      url: '/account/restore',
      headers: auth,
    });

    expect(restore.json()).toMatchObject({ restored: true });
    const stored = await harness.repository.shoppers.findById(shopper.id);
    expect(stored?.deletionScheduledFor).toBeNull();
  });
});

describe('Rule Ten: no card numbers, anywhere', () => {
  it('has no field in the data model that could hold one', () => {
    const schemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));

    // Comments are stripped first. The schema says in prose that there is no CVC field;
    // what matters is that no field declaration exists, so only declarations are read.
    const declarations = readFileSync(schemaPath, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    const forbidden = [
      /cardNumber/i,
      /\bpan\b/i,
      /\bcvc\b/i,
      /\bcvv\b/i,
      /securityCode/i,
      /expiry/i,
    ];
    for (const pattern of forbidden) {
      expect(declarations, `${String(pattern)} must not appear in the data model`).not.toMatch(
        pattern,
      );
    }
  });

  it('keeps only a Stripe identifier and the last four digits', async () => {
    const signUp = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    const { token } = signUp.json() as { token: string };

    const saved = await harness.app.inject({
      method: 'POST',
      url: '/payment-methods',
      headers: { authorization: `Bearer ${token}` },
      payload: { stripePaymentMethodId: 'pm_test_visa', lastFour: '4242', region: 'UK' },
    });

    expect(saved.statusCode).toBe(201);
    const method = (saved.json() as { paymentMethod: Record<string, unknown> }).paymentMethod;
    expect(Object.keys(method).sort()).toEqual(
      [
        'brand',
        'createdAt',
        'id',
        'isDefault',
        'lastFour',
        'region',
        'shopperId',
        'stripePaymentMethodId',
        'updatedAt',
      ].sort(),
    );
  });

  it('refuses anything that is not exactly four digits as the last four', async () => {
    const signUp = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    const { token } = signUp.json() as { token: string };

    const response = await harness.app.inject({
      method: 'POST',
      url: '/payment-methods',
      headers: { authorization: `Bearer ${token}` },
      payload: { stripePaymentMethodId: 'pm_test_visa', lastFour: '4242424242424242' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a card from an unsupported region', async () => {
    const signUp = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900001' },
    });
    const { token } = signUp.json() as { token: string };

    const response = await harness.app.inject({
      method: 'POST',
      url: '/payment-methods',
      headers: { authorization: `Bearer ${token}` },
      payload: { stripePaymentMethodId: 'pm_test_visa', lastFour: '4242', region: 'US' },
    });
    expect(response.statusCode).toBe(400);
  });
});

/**
 * Where the shopping goes.
 *
 * `deliveryAddress` was on Order from the start but never on Shopper, so nothing could
 * prefill an order and the sign-up screen had nowhere to put an address. It now lives on the
 * account, typed once, and shown back for checking before every order.
 */
describe('the delivery address', () => {
  it('is kept when the account is set up, and given back', async () => {
    const harness = await buildTestApp();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: {
        displayName: 'Margaret',
        phone: '+447700900123',
        deliveryAddress: '12 Example Street, Birmingham, B1 1AA',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().shopper.deliveryAddress).toBe('12 Example Street, Birmingham, B1 1AA');

    await harness.close();
  });

  it('is empty rather than missing when nobody gave one', async () => {
    const harness = await buildTestApp();

    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+447700900124' },
    });

    // An account can exist before there is anywhere to deliver to. Empty is a real state,
    // and the order route refuses a blank address, so nothing can be sent to nowhere.
    expect(response.json().shopper.deliveryAddress).toBe('');

    await harness.close();
  });

  it('can be corrected later without touching anything else', async () => {
    const harness = await buildTestApp();
    const them = await signUpShopper(harness);

    const response = await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: them.authHeader,
      payload: { deliveryAddress: '9 New Road, Leeds, LS1 1AA' },
    });

    expect(response.statusCode).toBe(200);
    const shopper = response.json().shopper;
    expect(shopper.deliveryAddress).toBe('9 New Road, Leeds, LS1 1AA');
    // The doorstep instructions are a different promise and must not have moved.
    expect(shopper.doorstepProtocol).toBe('Knock loudly and wait.');

    await harness.close();
  });

  it('is never sent back with the spoken code hash, which is nobody else business', async () => {
    const harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: {
        displayName: 'Margaret',
        phone: '+447700900125',
        deliveryAddress: '12 Example Street',
        spokenCode: 'bluebell',
      },
    });

    expect(Object.keys(response.json().shopper)).not.toContain('spokenCodeHash');

    await harness.close();
  });
});
