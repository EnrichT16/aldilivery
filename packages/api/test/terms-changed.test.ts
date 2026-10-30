/**
 * Agreeing again when the Shop Partner terms change (Anthony, 30 October 2026). A partner whose
 * agreed version is older is told at sign-in and on the dashboard, "Our terms have changed.
 * Please read and agree to keep going." Until they agree, their listing stays live for Shoppers,
 * but every change from the dashboard but agreeing is paused. Agreeing keeps the new version and
 * the moment. A partner who never agreed (listed by staff) is not stopped.
 */

import { SHOP_PARTNER_TERMS_VERSION, TERMS_CHANGED_WORDS } from '@aldilivery/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-30T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function call(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  payload?: object,
) {
  return harness.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
}

async function partner(termsVersion: string | null) {
  const shop = (
    await call('POST', '/staff/partners', STAFF, {
      name: 'Corner Bakery',
      about: 'Fresh bread every morning.',
      plan: 'free',
    })
  ).json().shop as { id: string };
  await call('POST', `/staff/partners/${shop.id}`, STAFF, { status: 'approved' });
  await harness.repository.partnerShops.update(shop.id, {
    termsVersion,
    termsAgreedAt: termsVersion ? new Date('2026-10-01T10:00:00.000Z') : null,
  });
  const user = (
    await call('POST', `/staff/partners/${shop.id}/users`, STAFF, {
      name: 'Bola',
      username: 'cornerbakery',
    })
  ).json() as { password: string };
  const signedIn = await harness.app.inject({
    method: 'POST',
    url: '/business/sign-in',
    payload: { username: 'cornerbakery', password: user.password },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return {
    shop,
    signedIn: signedIn.json(),
    headers: { 'x-business-token': signedIn.json().token as string },
  };
}

const PRODUCT = { name: 'Sourdough loaf', pricePence: 350, tags: 'bread' };

describe('a partner on older Shop Partner terms', () => {
  it('is told at sign-in and on the dashboard, with the terms to read', async () => {
    const { signedIn, headers } = await partner('shop-partner-terms-2026-11-05');
    expect(signedIn).toMatchObject({
      termsChanged: true,
      termsChangedWords: 'Our terms have changed. Please read and agree to keep going.',
    });
    const dashboard = (await call('GET', '/partner/dashboard', headers)).json();
    expect(dashboard.terms).toEqual({
      changed: true,
      words: TERMS_CHANGED_WORDS,
      version: SHOP_PARTNER_TERMS_VERSION,
      path: '/partner/terms',
    });
    expect(SHOP_PARTNER_TERMS_VERSION).toBe('shop-partner-terms-2026-10-30b');
  });

  it('keeps the listing live, but pauses every change but agreeing', async () => {
    const { shop, headers } = await partner('shop-partner-terms-2026-11-05');
    // Shoppers still see the shop.
    const listed = await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` });
    expect(listed.statusCode, listed.body).toBe(200);

    for (const [url, payload] of [
      ['/partner/products', PRODUCT],
      ['/partner/profile', { about: 'New words.' }],
      ['/partner/plan/checkout', {}],
      ['/partner/spotlight/free-week', {}],
      ['/partner/scan/barcode', { barcode: '5000000000001' }],
    ] as const) {
      const paused = await call('POST', url, headers, payload);
      expect(paused.statusCode, url).toBe(409);
      expect(paused.json().error).toMatchObject({
        code: 'terms_changed',
        message: TERMS_CHANGED_WORDS,
      });
    }
    // Looking is never paused.
    expect((await call('GET', '/partner/dashboard', headers)).statusCode).toBe(200);
  });

  it('agrees with a tick: the new version and the moment are kept, and changes work again', async () => {
    const { shop, headers } = await partner('shop-partner-terms-2026-11-05');
    // No tick, or an old version: nothing is kept.
    expect(
      (
        await call('POST', '/partner/terms/agree', headers, {
          termsAgreed: false,
          termsVersion: SHOP_PARTNER_TERMS_VERSION,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/partner/terms/agree', headers, {
          termsAgreed: true,
          termsVersion: 'shop-partner-terms-2026-11-05',
        })
      ).statusCode,
    ).toBe(400);

    harness.setNow(new Date('2026-10-30T11:00:00.000Z'));
    const agreed = await call('POST', '/partner/terms/agree', headers, {
      termsAgreed: true,
      termsVersion: SHOP_PARTNER_TERMS_VERSION,
    });
    expect(agreed.statusCode, agreed.body).toBe(200);
    expect(await harness.repository.partnerShops.findById(shop.id)).toMatchObject({
      termsVersion: SHOP_PARTNER_TERMS_VERSION,
      termsAgreedAt: new Date('2026-10-30T11:00:00.000Z'),
    });
    expect((await call('GET', '/partner/dashboard', headers)).json().terms.changed).toBe(false);
    const added = await call('POST', '/partner/products', headers, PRODUCT);
    expect(added.statusCode, added.body).toBe(201);
  });
});

describe('a partner on today’s terms, or one who never agreed', () => {
  it('is not stopped', async () => {
    const today = await partner(SHOP_PARTNER_TERMS_VERSION);
    expect(today.signedIn.termsChanged).toBe(false);
    expect((await call('POST', '/partner/products', today.headers, PRODUCT)).statusCode).toBe(201);
  });

  it('is not stopped when listed by staff without an agreement', async () => {
    const never = await partner(null);
    expect(never.signedIn.termsChanged).toBe(false);
    expect((await call('POST', '/partner/products', never.headers, PRODUCT)).statusCode).toBe(201);
  });
});
