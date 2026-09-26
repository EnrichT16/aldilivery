/**
 * Signing back in, by a code sent in a text.
 *
 * Until 26 Sep 2026 an account could only be reached from the device it was made on. What
 * follows is what it takes for that to change safely: one form for every phone number, texts
 * sent only to British mobiles, limits that stop the sign-in screen being used to run up the
 * bill, and no codes in the log of a production server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CODE_LIMITS } from '../src/routes/auth.js';
import { isUkMobile, ukPhone } from '../src/lib/phone.js';
import { codeMessage, twilioSender } from '../src/lib/sms.js';
import { buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp();
});

afterEach(async () => {
  await harness.close();
});

function requestCode(phone: string, address = '203.0.113.1') {
  return harness.app.inject({
    method: 'POST',
    url: '/auth/request-code',
    headers: { 'do-connecting-ip': address },
    payload: { phone },
  });
}

describe('phone numbers, in one form', () => {
  it('reads every usual way of writing a British number as the same number', () => {
    for (const typed of [
      '07700 900123',
      '07700900123',
      '+44 7700 900123',
      '+447700900123',
      '447700900123',
      '0044 7700 900123',
      '+44 (0)7700 900123',
      '(07700) 900-123',
    ]) {
      expect(ukPhone(typed), typed).toBe('+447700900123');
    }
  });

  it('refuses a number that is not British, rather than guessing', () => {
    expect(ukPhone('+1 212 555 0100')).toBeUndefined();
    expect(ukPhone('+33 6 12 34 56 78')).toBeUndefined();
    expect(ukPhone('12345')).toBeUndefined();
    expect(ukPhone('07700 9001')).toBeUndefined();
  });

  it('knows a mobile from a landline', () => {
    expect(isUkMobile('+447700900123')).toBe(true);
    expect(isUkMobile('+442079460000')).toBe(false);
  });

  it('keeps a new account under the +44 form, whatever was typed', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '07700 900123' },
    });
    expect(created.statusCode).toBe(201);
    expect(await harness.repository.shoppers.findByPhone('+447700900123')).not.toBeNull();
  });

  it('will not make a second account for the same number written differently', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '07700 900123' },
    });
    const again = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+44 7700 900123' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('says plainly that only British numbers work, at sign up', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '+1 212 555 0100' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/United Kingdom/);
  });
});

describe('signing back in on another device', () => {
  it('finds the account however the number is typed the second time', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Margaret', phone: '07700 900123' },
    });

    expect((await requestCode('+44 7700 900123')).statusCode).toBe(200);
    expect(harness.deliveredCodes[0]!.phone).toBe('+447700900123');

    const verified = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '07700900123', code: harness.deliveredCodes[0]!.code },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ registrationRequired: false });
    expect(verified.json().token).toEqual(expect.any(String));
  });

  it('still finds an account made before numbers were tidied, typed as it was stored', async () => {
    // Made directly, the way accounts were kept until 26 Sep 2026: exactly as typed.
    await harness.repository.shoppers.create({
      displayName: 'Old account',
      handle: 'old-account',
      phone: '07700 900124',
      spokenCodeHash: null,
      preferredLanguage: 'en-GB',
      doorstepProtocol: '',
      deliveryAddress: '',
      substitutionDefault: 'ask_me',
      budgetCapPence: null,
    });

    await requestCode('07700 900124');
    const verified = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: '07700 900124', code: harness.deliveredCodes[0]!.code },
    });
    expect(verified.json()).toMatchObject({ registrationRequired: false });
  });

  it('only sends a code to a mobile, and says so', async () => {
    const response = await requestCode('020 7946 0000');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/mobile/);
    expect(harness.deliveredCodes).toHaveLength(0);
  });

  it('never sends a code abroad', async () => {
    const response = await requestCode('+1 212 555 0100');
    expect(response.statusCode).toBe(400);
    expect(harness.deliveredCodes).toHaveLength(0);
  });
});

describe('limits, so the sign-in screen cannot run up the bill', () => {
  it(`sends at most ${CODE_LIMITS.perNumberShort.count} codes to one number in a quarter of an hour`, async () => {
    for (let i = 0; i < CODE_LIMITS.perNumberShort.count; i += 1) {
      expect((await requestCode('07700 900123')).statusCode).toBe(200);
    }
    const refused = await requestCode('07700 900123');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.message).toMatch(/wait a few minutes/);
    expect(harness.deliveredCodes).toHaveLength(CODE_LIMITS.perNumberShort.count);

    harness.setNow(new Date(harness.now().getTime() + 16 * 60_000));
    expect((await requestCode('07700 900123')).statusCode).toBe(200);
  });

  it(`sends at most ${CODE_LIMITS.perNumberDay.count} codes to one number in a day`, async () => {
    for (let i = 0; i < CODE_LIMITS.perNumberDay.count; i += 1) {
      expect((await requestCode('07700 900123')).statusCode).toBe(200);
      harness.setNow(new Date(harness.now().getTime() + 16 * 60_000));
    }
    expect((await requestCode('07700 900123')).statusCode).toBe(429);
  });

  it(`takes at most ${CODE_LIMITS.perAddressHour.count} requests an hour from one internet address`, async () => {
    for (let i = 0; i < CODE_LIMITS.perAddressHour.count; i += 1) {
      const phone = `07700 900${String(100 + i)}`;
      expect((await requestCode(phone, '198.51.100.7')).statusCode).toBe(200);
    }
    expect((await requestCode('07700 900999', '198.51.100.7')).statusCode).toBe(429);
    // Somebody else, somewhere else, is not held up by it.
    expect((await requestCode('07700 900999', '198.51.100.8')).statusCode).toBe(200);
  });
});

describe('when texts cannot be sent', () => {
  it('says signing in by text is not switched on, and writes no code anywhere', async () => {
    await harness.close();
    harness = await buildTestApp(undefined, { codeDelivery: 'off' });

    const response = await requestCode('07700 900123');
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toMatch(/not switched on yet/);
    expect(harness.deliveredCodes).toHaveLength(0);

    const config = await harness.app.inject({ method: 'GET', url: '/config' });
    expect(config.json().signIn).toEqual({ byText: false });
  });

  it('tells the web app that signing in by text works when it does', async () => {
    const config = await harness.app.inject({ method: 'GET', url: '/config' });
    expect(config.json().signIn).toEqual({ byText: true });
  });

  it('turns a failure at Twilio into a sentence, not a five hundred', async () => {
    await harness.close();
    harness = await buildTestApp(undefined, {
      codeDelivery: 'sms',
      deliverCode: async () => {
        throw new Error('Twilio 21608: unverified number');
      },
    });

    const response = await requestCode('07700 900123');
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toBe(
      'We could not send a text just now. Please try again in a minute.',
    );
  });
});

describe('Twilio', () => {
  function fakeFetch(status = 201, body: unknown = { sid: 'SM1' }) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it('sends one form POST to the account, from the number given', async () => {
    const fetchImpl = fakeFetch();
    const send = twilioSender(
      { accountSid: 'AC123', authToken: 'secret', from: '+447700900000' },
      fetchImpl as unknown as typeof fetch,
    );

    await send('+447700900123', 'Hello');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get('To')).toBe('+447700900123');
    expect(form.get('From')).toBe('+447700900000');
    expect(form.get('Body')).toBe('Hello');
  });

  it('uses a Messaging Service when given one', async () => {
    const fetchImpl = fakeFetch();
    const send = twilioSender(
      { accountSid: 'AC123', authToken: 'secret', from: 'MG456' },
      fetchImpl as unknown as typeof fetch,
    );
    await send('+447700900123', 'Hello');
    const form = new URLSearchParams(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(form.get('MessagingServiceSid')).toBe('MG456');
    expect(form.get('From')).toBeNull();
  });

  it("fails with Twilio's own reason, for the log", async () => {
    const send = twilioSender(
      { accountSid: 'AC123', authToken: 'secret', from: 'Aldilivery' },
      fakeFetch(400, {
        code: 21608,
        message: 'The number is unverified',
      }) as unknown as typeof fetch,
    );
    await expect(send('+447700900123', 'Hello')).rejects.toThrow(
      'Twilio 21608: The number is unverified',
    );
  });

  it('writes a short text, with the line that lets a phone fill the code in', () => {
    const text = codeMessage({
      productName: 'Aldilivery',
      code: '123456',
      minutes: 10,
      origin: 'https://lobster-app-3ilv6.ondigitalocean.app',
    });
    expect(text).toBe(
      'Aldilivery: your code is 123456. It lasts 10 minutes.\n' +
        'We will never phone you to ask for it.\n' +
        '\n' +
        '@lobster-app-3ilv6.ondigitalocean.app #123456',
    );
  });

  it('leaves that line off when the site is not on https', () => {
    const text = codeMessage({
      productName: 'Aldilivery',
      code: '123456',
      minutes: 10,
      origin: 'http://localhost:5173',
    });
    expect(text).not.toContain('#123456');
  });
});
