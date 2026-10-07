/**
 * Spotlight and Spotlight Plus, payment history and statements, share links, and business
 * analysis with no names (ruling 42).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { district, personKey } from '../src/lib/analytics.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  STAFF,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function staff(method: 'GET' | 'POST', url: string, payload?: object) {
  return harness.app.inject({ method, url, headers: STAFF, ...(payload ? { payload } : {}) });
}

async function partner(paidMonths = 1) {
  const shop = (
    await staff('POST', '/staff/partners', { name: 'Corner Bakery', paidMonths })
  ).json().shop as { id: string };
  const user = (
    await staff('POST', `/staff/partners/${shop.id}/users`, {
      name: 'Bola',
      username: 'cornerbakery',
    })
  ).json() as { password: string };
  const token = (
    await harness.app.inject({
      method: 'POST',
      url: '/business/sign-in',
      payload: { username: 'cornerbakery', password: user.password },
    })
  ).json().token as string;
  const headers = { 'x-business-token': token };
  const added = await harness.app.inject({
    method: 'POST',
    url: '/partner/products',
    headers,
    payload: { name: 'Sourdough loaf', pricePence: 350, tags: 'bread' },
  });
  const id = (await staff('GET', '/staff/partner-products')).json().products[0]?.id as string;
  if (id) await staff('POST', `/staff/partner-products/${id}/decide`, { approve: true });
  return { shop, headers, added };
}

function advert(shopper: SignedInShopper, q = 'bread') {
  return harness.app.inject({
    method: 'GET',
    url: `/spotlight?q=${q}`,
    headers: shopper.authHeader,
  });
}

describe('Spotlight and Spotlight Plus', () => {
  it('only for paid Shop Partners, mentioned when someone looks for what they sell, once a week', async () => {
    const { shop } = await partner();
    const shopper = await signUpShopper(harness);
    expect((await advert(shopper)).json().advert).toBeNull();

    const paid = await staff('POST', `/staff/partners/${shop.id}`, {
      kind: 'spotlight',
      paidMonths: 1,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    const first = (await advert(shopper)).json().advert;
    expect(first).toEqual(
      expect.objectContaining({
        shopName: 'Corner Bakery',
        words: 'Advert: Sourdough loaf is in stock at Corner Bakery, about £3.50.',
      }),
    );
    // Once a week to the same Shopper, and never for something the shop does not sell.
    expect((await advert(shopper)).json().advert).toBeNull();
    const other = await signUpShopper(harness, { phone: '+447700900444' });
    expect((await advert(other, 'batteries')).json().advert).toBeNull();
    harness.setNow(new Date('2026-10-14T10:01:00.000Z'));
    expect((await advert(shopper)).json().advert).not.toBeNull();
  });

  it('Spotlight Plus may be mentioned three times a week', async () => {
    const { shop } = await partner();
    await staff('POST', `/staff/partners/${shop.id}`, { kind: 'plus', paidMonths: 1 });
    const shopper = await signUpShopper(harness);
    const heard = [];
    for (let index = 0; index < 4; index += 1) heard.push((await advert(shopper)).json().advert);
    expect(heard.filter(Boolean)).toHaveLength(3);
  });

  it('cannot be bought without a paid plan', async () => {
    const { shop } = await partner(0);
    const refused = await staff('POST', `/staff/partners/${shop.id}`, {
      kind: 'spotlight',
      paidMonths: 1,
    });
    expect(refused.statusCode).toBe(409);
  });
});

describe('what a Shop Partner has paid', () => {
  it('is listed in their area, with Spotlight separate from the plan, and downloads as a PDF', async () => {
    const { shop, headers } = await partner();
    await staff('POST', `/staff/partners/${shop.id}`, { kind: 'plan', paidMonths: 1 });
    await staff('POST', `/staff/partners/${shop.id}`, { kind: 'spotlight', paidMonths: 1 });
    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(
      dashboard.payments.map((row: { what: string; amountPence: number }) => [
        row.what,
        row.amountPence,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['Shop Partner plan', 2999],
        ['Shop Partner plan', 2999],
        ['Spotlight', 1999],
      ]),
    );
    expect(dashboard.spotlight.level).toBe('spotlight');

    const pdf = await harness.app.inject({ method: 'GET', url: '/partner/statement.pdf', headers });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 8).toString()).toBe('%PDF-1.4');
    expect(pdf.rawPayload.toString('latin1')).toContain('Total paid: £79.97');
  });
});

describe('share links', () => {
  it('count the accounts opened through them', async () => {
    const { shop, headers } = await partner();
    const opened = await harness.app.inject({
      method: 'POST',
      url: '/shoppers',
      payload: { displayName: 'Ada', phone: '+447700900555', joinedVia: `partner:${shop.id}` },
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.referrals).toBe(1);
  });
});

describe('business analysis', () => {
  it('keeps postcode districts and one-way codes, never names, numbers or addresses', async () => {
    expect(district('12 Example Street, Gillingham ME7 1AA')).toBe('ME7');
    expect(personKey('shopper-1', 'secret')).toBe(personKey('shopper-1', 'secret'));
    expect(personKey('shopper-1', 'secret')).not.toContain('shopper');

    const items = await seedCatalogue(harness.repository);
    const shopper = await signUpShopper(harness, { displayName: 'Margaret Example' });
    await harness.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: shopper.authHeader,
      payload: { ageBand: '65_plus' },
    });
    const order = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order.',
          agreedTotalPence: 250 + 1350,
        },
      },
    });
    expect(order.statusCode, order.body).toBe(201);
    await harness.app.inject({
      method: 'GET',
      url: '/catalogue/search?q=unicorn+food',
      headers: shopper.authHeader,
    });

    const events = await harness.repository.analytics.list({ since: new Date('2026-01-01') });
    const paid = events.find((event) => event.kind === 'order_paid');
    expect(paid).toEqual(
      expect.objectContaining({
        shop: harness.config.store.displayName,
        toArea: 'ME7',
        ageBand: '65_plus',
        itemCount: 2,
        goodsPence: 250,
      }),
    );
    expect(events.find((event) => event.kind === 'search_unmet')?.query).toBe('unicorn food');
    const everything = JSON.stringify(events);
    for (const personal of ['Margaret', 'Example Street', '+44770090', shopper.shopperId]) {
      expect(everything).not.toContain(personal);
    }
  });

  it('shows staff the numbers, hiding any group of fewer than ten people', async () => {
    const at = harness.now();
    for (let index = 0; index < 12; index += 1) {
      await harness.repository.analytics.record({
        kind: 'order_paid',
        shopperKey: `key-${index}`,
        runnerKey: 'runner-a',
        shop: 'Corner Bakery',
        area: null,
        toArea: index < 11 ? 'ME7' : 'ME4',
        ageBand: index < 10 ? '65_plus' : '25_44',
        viaOrganisation: false,
        itemCount: 2,
        goodsPence: 500,
        categories: 'From Corner Bakery',
        query: null,
        travelMode: 'bicycle',
        at: new Date(at.getTime() - index * 60_000),
      });
    }
    const response = await staff('GET', '/staff/analytics?period=week');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.shops).toEqual([
      expect.objectContaining({ shop: 'Corner Bakery', purchases: 12, people: 12 }),
    ]);
    expect(body.ageBands.rows).toEqual([expect.objectContaining({ key: '65_plus', people: 10 })]);
    expect(body.ageBands.hiddenGroups).toBe(1);
    expect(body.areas.rows).toEqual([expect.objectContaining({ key: 'ME7', people: 11 })]);
    expect(body.windows.find((row: { window: string }) => row.window === 'hour').purchases).toBe(
      12,
    );
    expect(body.windows.find((row: { window: string }) => row.window === 'minute').purchases).toBe(
      1,
    );
  });

  it('is only for the founder and the business analyst', async () => {
    const care = (
      await staff('POST', '/staff/team', {
        name: 'Chidi',
        username: 'chidi',
        role: 'customer_care',
      })
    ).json();
    const token = (
      await harness.app.inject({
        method: 'POST',
        url: '/staff/sign-in',
        payload: { username: 'chidi', password: care.password },
      })
    ).json().token as string;
    const refused = await harness.app.inject({
      method: 'GET',
      url: '/staff/analytics',
      headers: { 'x-staff-token': token },
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('an organisation’s statement', () => {
  it('downloads as a PDF', async () => {
    const created = (
      await staff('POST', '/staff/organisations', { name: 'Medway Care Home', contactName: 'Jo' })
    ).json().organisation as { id: string };
    const user = (
      await staff('POST', `/staff/organisations/${created.id}/users`, {
        name: 'Jo',
        username: 'medwaycare',
      })
    ).json();
    const token = (
      await harness.app.inject({
        method: 'POST',
        url: '/business/sign-in',
        payload: { username: 'medwaycare', password: user.password },
      })
    ).json().token as string;
    const pdf = await harness.app.inject({
      method: 'GET',
      url: '/organisation/statement.pdf',
      headers: { 'x-business-token': token },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const dashboard = (
      await harness.app.inject({
        method: 'GET',
        url: '/organisation/dashboard',
        headers: { 'x-business-token': token },
      })
    ).json();
    expect(dashboard.sharePath).toMatch(/^\/join\/organisation\/[A-Z2-9]{6}$/);
  });
});
