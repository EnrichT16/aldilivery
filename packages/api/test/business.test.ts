/**
 * Partner shops and organisations (7 October 2026, ruling 41): their own sign-ins, each seeing
 * only its own things; products checked before Shoppers see them; organisations seeing only
 * the people who chose to link to them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

async function signIn(username: string, password: string): Promise<{ 'x-business-token': string }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/business/sign-in',
    payload: { username, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { 'x-business-token': response.json().token as string };
}

async function partnerShop(paidMonths = 1) {
  const shop = (
    await staff('POST', '/staff/partners', {
      name: 'Corner Bakery',
      about: 'Fresh bread every morning.',
      paidMonths,
    })
  ).json().shop as { id: string };
  const user = (
    await staff('POST', `/staff/partners/${shop.id}/users`, {
      name: 'Bola',
      username: 'cornerbakery',
    })
  ).json() as { password: string };
  return { shop, headers: await signIn('cornerbakery', user.password) };
}

describe('partner shops', () => {
  it('pay monthly, add products that wait to be checked, and appear once approved', async () => {
    const { shop, headers } = await partnerShop();
    const dashboard = await harness.app.inject({
      method: 'GET',
      url: '/partner/dashboard',
      headers,
    });
    expect(dashboard.json().plan).toEqual(
      expect.objectContaining({ monthlyPence: 2999, paid: true }),
    );
    expect(dashboard.json().sharePath).toBe(`/shops/${shop.id}`);

    const added = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: {
        name: 'Sourdough loaf',
        pricePence: 350,
        tags: 'bread, bakery',
        expiresOn: '2026-10-10',
        photo: Buffer.from('a photo').toString('base64'),
        photoType: 'image/jpeg',
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().message).toMatch(/waiting to be checked/);
    expect((await harness.repository.catalogue.search('Sourdough')).length).toBe(0);
    expect(
      (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json().products,
    ).toEqual([]);

    const pending = (await staff('GET', '/staff/partner-products')).json().products;
    expect(pending).toEqual([
      expect.objectContaining({
        name: 'Sourdough loaf',
        shopName: 'Corner Bakery',
        hasPhoto: true,
      }),
    ]);
    const decided = await staff('POST', `/staff/partner-products/${pending[0].id}/decide`, {
      approve: true,
    });
    expect(decided.statusCode, decided.body).toBe(200);

    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shop.id}` })).json();
    expect(page.products).toEqual([
      expect.objectContaining({ name: 'Sourdough loaf', pricePence: 350, hasPhoto: true }),
    ]);
    const [item] = await harness.repository.catalogue.search('Sourdough');
    expect(item).toEqual(
      expect.objectContaining({
        name: 'Sourdough loaf (Corner Bakery)',
        category: 'From Corner Bakery',
      }),
    );
    const photo = await harness.app.inject({
      method: 'GET',
      url: `/shops/${shop.id}/products/${pending[0].id}/photo`,
    });
    expect(photo.headers['content-type']).toBe('image/jpeg');

    // A new price applies at once; taking it off removes it from searches and baskets.
    await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${pending[0].id}/price`,
      headers,
      payload: { pricePence: 399 },
    });
    expect((await harness.repository.catalogue.findById(item!.id))?.estimatedPricePence).toBe(399);
    await harness.app.inject({
      method: 'POST',
      url: `/partner/products/${pending[0].id}/remove`,
      headers,
    });
    expect((await harness.repository.catalogue.search('Sourdough')).length).toBe(0);
    const shopper = await signUpShopper(harness);
    const price = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      headers: shopper.authHeader,
      payload: { lines: [{ catalogueItemId: item!.id, quantity: 1 }] },
    });
    expect(price.statusCode).toBe(404);
  });

  it('cannot add products when the plan is not paid, and never lists restricted goods', async () => {
    const unpaid = await partnerShop(0);
    const refused = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers: unpaid.headers,
      payload: { name: 'Bread', pricePence: 100 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/£29\.99 a month/);
    expect((await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops).toEqual([]);

    await staff('POST', `/staff/partners/${unpaid.shop.id}`, { paidMonths: 1 });
    const wine = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers: unpaid.headers,
      payload: { name: 'Red wine', pricePence: 600 },
    });
    expect(wine.statusCode).toBe(400);
  });

  it('a partner shop cannot reach an organisation, the admin panel or a Shopper’s things', async () => {
    const { headers } = await partnerShop();
    for (const url of ['/organisation/dashboard', '/staff/partners', '/me']) {
      const response = await harness.app.inject({ method: 'GET', url, headers });
      expect(response.statusCode, url).toBeGreaterThanOrEqual(401);
    }
  });
});

describe('organisations', () => {
  async function organisation() {
    const created = (
      await staff('POST', '/staff/organisations', {
        name: 'Medway Care Home',
        contactName: 'Jo',
      })
    ).json().organisation as { id: string; joinCode: string };
    const user = (
      await staff('POST', `/staff/organisations/${created.id}/users`, {
        name: 'Jo',
        username: 'medwaycare',
        office: 'Head office',
      })
    ).json() as { password: string };
    return { created, headers: await signIn('medwaycare', user.password) };
  }

  async function placeOrder(shopper: SignedInShopper, milk: string) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/orders',
      headers: shopper.authHeader,
      payload: {
        lines: [{ catalogueItemId: milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Gillingham',
        paymentMethodId: shopper.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 100 + 799,
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
  }

  it('see only people who chose to link, what they spent, by office, with savings and budget', async () => {
    const { created, headers } = await organisation();
    expect(created.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    const items = await seedCatalogue(harness.repository);
    const linked = await signUpShopper(harness, { displayName: 'Mr Table' });
    const other = await signUpShopper(harness, { displayName: 'Stranger', phone: '+447700900333' });

    const noConsent = await harness.app.inject({
      method: 'POST',
      url: '/me/organisation',
      headers: linked.authHeader,
      payload: { code: created.joinCode },
    });
    expect(noConsent.statusCode).toBe(400);
    const joined = await harness.app.inject({
      method: 'POST',
      url: '/me/organisation',
      headers: linked.authHeader,
      payload: { code: created.joinCode.toLowerCase(), agreed: true },
    });
    expect(joined.json().message).toMatch(/now linked to Medway Care Home/);

    await placeOrder(linked, items.milk);
    await placeOrder(other, items.milk);

    const people = (
      await harness.app.inject({ method: 'GET', url: '/organisation/dashboard', headers })
    ).json().people;
    await harness.app.inject({
      method: 'POST',
      url: `/organisation/people/${people[0].id}/office`,
      headers,
      payload: { office: 'Ward B' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/organisation/settings',
      headers,
      payload: { monthlyBudgetPence: 50000, staffTripCostPence: 2500 },
    });

    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/organisation/dashboard', headers })
    ).json();
    expect(dashboard.people).toEqual([
      expect.objectContaining({ name: 'Mr Table', office: 'Ward B' }),
    ]);
    expect(dashboard.orders).toEqual([
      expect.objectContaining({ person: 'Mr Table', office: 'Ward B', paidPence: 1149 }),
    ]);
    expect(dashboard.totals).toEqual(
      expect.objectContaining({
        spentThisMonthPence: 1149,
        deliveriesThisMonth: 1,
        budgetLeftPence: 50000 - 1149,
        // Membership delivery for the people an organisation looks after (ruling 58).
        savedThisMonthPence: 2500 - 799,
      }),
    );
    expect(dashboard.byOffice).toEqual([{ office: 'Ward B', pence: 1149 }]);
    // £10 a client a month, every 51st client £5.
    expect(dashboard.plan).toMatchObject({ clients: 1, monthlyPence: 1000 });
    expect(JSON.stringify(dashboard)).not.toContain('Stranger');

    // The person can stop it whenever they like.
    await harness.app.inject({
      method: 'POST',
      url: '/me/organisation/leave',
      headers: linked.authHeader,
    });
    const after = (
      await harness.app.inject({ method: 'GET', url: '/organisation/dashboard', headers })
    ).json();
    expect(after.people).toEqual([]);
  });

  it('an organisation cannot reach a partner shop’s dashboard', async () => {
    const { headers } = await organisation();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/partner/dashboard',
      headers,
    });
    expect(response.statusCode).toBe(403);
  });

  it('only partnerships staff and the founder manage shops and organisations', async () => {
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
      url: '/staff/partners',
      headers: { 'x-staff-token': token },
    });
    expect(refused.statusCode).toBe(403);
  });
});
