/**
 * Codes by automatic phone call, for landlines, and a new account's number confirmed with a
 * code (rulings 27 and 33, 4 October 2026).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { callScript, codeInTwos, twilioCaller } from '../src/lib/sms.js';
import { signPhoneProof, verifyPhoneProof } from '../src/lib/tokens.js';
import { buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness.close();
});

function requestCode(payload: object) {
  return harness.app.inject({ method: 'POST', url: '/auth/request-code', payload });
}

function verify(phone: string, code: string) {
  return harness.app.inject({
    method: 'POST',
    url: '/auth/verify-code',
    payload: { phone, code },
  });
}

const LANDLINE = '01634 123456';

describe('a code by phone call', () => {
  it('rings a landline to confirm a new account, and the code it says works', async () => {
    harness = await buildTestApp();
    const asked = await requestCode({ phone: LANDLINE, channel: 'call', purpose: 'sign-up' });
    expect(asked.statusCode, asked.body).toBe(200);
    expect(asked.json().message).toMatch(/^We are phoning you now\./);
    expect(harness.calledCodes).toEqual([{ phone: '+441634123456', code: expect.any(String) }]);
    expect(harness.deliveredCodes).toEqual([]);

    const checked = await verify(LANDLINE, harness.calledCodes[0]!.code);
    expect(checked.json()).toMatchObject({
      registrationRequired: true,
      phoneProof: expect.any(String),
    });
  });

  it('to sign in, rings only a number already on an account, and says the same either way', async () => {
    harness = await buildTestApp();
    const stranger = await requestCode({ phone: LANDLINE, channel: 'call' });
    expect(stranger.statusCode).toBe(200);
    expect(harness.calledCodes).toEqual([]);

    await harness.repository.shoppers.create({
      displayName: 'David',
      handle: 'david',
      phone: '+441634123456',
    } as never);
    const known = await requestCode({ phone: LANDLINE, channel: 'call' });
    expect(known.json().message).toBe(stranger.json().message);
    expect(harness.calledCodes).toHaveLength(1);
  });

  it('tells somebody with a landline to choose a call, not a text', async () => {
    harness = await buildTestApp();
    const response = await requestCode({ phone: LANDLINE });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/Call me with the code/);
  });

  it('is refused while calls are not set up', async () => {
    harness = await buildTestApp(undefined, { callDelivery: 'off' });
    const response = await requestCode({ phone: LANDLINE, channel: 'call', purpose: 'sign-up' });
    expect(response.statusCode).toBe(503);
  });

  it('says the code in twos, three times, in British English', () => {
    expect(codeInTwos('472913')).toBe('four seven, two nine, one three');
    const twiml = callScript({ productName: 'Example Shop', code: '472913', minutes: 10 });
    expect(twiml.split('four seven, two nine, one three')).toHaveLength(4);
    expect(twiml).toContain('language="en-GB"');
    expect(twiml).toContain('We will never phone you to ask for it.');
  });

  it('places the call with Twilio, the words inline, never in a web address', async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const call = twilioCaller(
      { accountSid: 'AC123', authToken: 'secret', from: '+441634000000' },
      (code) => `<Response><Say>${code}</Say></Response>`,
      (async (url: string, init: RequestInit) => {
        sent.push({ url, body: String(init.body) });
        return { ok: true, status: 201 } as Response;
      }) as typeof fetch,
    );
    await call('+441634123456', '123456');
    expect(sent[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json');
    const form = new URLSearchParams(sent[0]!.body);
    expect(form.get('To')).toBe('+441634123456');
    expect(form.get('From')).toBe('+441634000000');
    expect(form.get('Twiml')).toBe('<Response><Say>123456</Say></Response>');
  });
});

describe('confirming a new account’s number', () => {
  const shopper = (phoneProof?: string) => ({
    displayName: 'Margaret',
    phone: '07700 900123',
    deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
    ...(phoneProof ? { phoneProof } : {}),
  });

  it('is not asked for until codes really go out, so nothing breaks before launch', async () => {
    harness = await buildTestApp();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: shopper(),
    });
    expect(response.statusCode).toBe(201);
  });

  it('once texts go out, needs the proof from the code, for that same number', async () => {
    harness = await buildTestApp(undefined, { codeDelivery: 'sms' });
    const without = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: shopper(),
    });
    expect(without.statusCode).toBe(400);
    expect(without.json().error.message).toMatch(/confirm your phone number/);

    await requestCode({ phone: '07700 900123', purpose: 'sign-up' });
    const proof = (await verify('07700 900123', harness.deliveredCodes[0]!.code)).json()
      .phoneProof as string;
    const opened = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: shopper(proof),
    });
    expect(opened.statusCode, opened.body).toBe(201);

    const otherNumber = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { ...shopper(proof), phone: '07700 900999' },
    });
    expect(otherNumber.statusCode).toBe(400);
  });

  it('cannot be forged or kept for ever', () => {
    const proof = signPhoneProof(
      { phone: '+447700900123', role: 'shopper', expiresAt: 2_000_000_000 },
      'secret',
    );
    expect(verifyPhoneProof(proof, 'secret', new Date('2026-10-05'))).toEqual({
      phone: '+447700900123',
      role: 'shopper',
    });
    expect(verifyPhoneProof(proof, 'other-secret', new Date('2026-10-05'))).toBeNull();
    expect(verifyPhoneProof(`${proof}x`, 'secret', new Date('2026-10-05'))).toBeNull();
    expect(verifyPhoneProof(proof, 'secret', new Date(2_000_000_001_000))).toBeNull();
  });
});
