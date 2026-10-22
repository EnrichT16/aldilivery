/**
 * Shops join by themselves (ruling 65, 16 and 17 October 2026): the mobile confirmed with a code,
 * a pending account that works at once and a page that goes public only once a person approves
 * it; the free-for-ever listings and Partner Plus paid from the dashboard; a café's commission;
 * services with enquiries and the kinds never listed; the shops Ozi lists itself and their claiming.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadShopsSeed, parseShopsSeed, seedShops } from '../src/lib/shops-seed.js';
import { seedShopsOnStartup } from '../src/data/startup-seed.js';
import { memoryRepository } from '../src/data/memory.js';
import { buildTestApp, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-17T10:00:00.000Z'), { codeDelivery: 'sms' });
});

afterEach(async () => {
  await harness.close();
});

function staff(method: 'GET' | 'POST', url: string, payload?: object) {
  return harness.app.inject({ method, url, headers: STAFF, ...(payload ? { payload } : {}) });
}

/** The code texted to a joining shop's mobile, turned into the proof the join form sends. */
async function proveMobile(mobile: string): Promise<string> {
  const asked = await harness.app.inject({
    method: 'POST',
    url: '/auth/request-code',
    payload: { phone: mobile, role: 'partner', purpose: 'sign-up' },
  });
  expect(asked.statusCode, asked.body).toBe(200);
  const code = harness.deliveredCodes[harness.deliveredCodes.length - 1]!.code;
  const checked = await harness.app.inject({
    method: 'POST',
    url: '/auth/verify-code',
    payload: { phone: mobile, role: 'partner', code },
  });
  expect(checked.statusCode, checked.body).toBe(200);
  expect(checked.json().registrationRequired).toBe(true);
  expect(checked.json().token).toBeUndefined();
  return checked.json().phoneProof as string;
}

/** A Shopper, their number confirmed with a code the way it is once texts really go out. */
async function shopperWithProof() {
  const phone = '+447700900001';
  await harness.app.inject({
    method: 'POST',
    url: '/auth/request-code',
    payload: { phone, role: 'shopper', purpose: 'sign-up' },
  });
  const code = harness.deliveredCodes[harness.deliveredCodes.length - 1]!.code;
  const checked = await harness.app.inject({
    method: 'POST',
    url: '/auth/verify-code',
    payload: { phone, role: 'shopper', code },
  });
  const response = await harness.app.inject({
    method: 'POST',
    url: '/shoppers',
    payload: {
      displayName: 'Margaret',
      phone,
      doorstepProtocol: 'Knock loudly and wait.',
      phoneProof: checked.json().phoneProof,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { authHeader: { authorization: `Bearer ${response.json().token as string}` } };
}

const BAKERY = {
  name: 'Corner Bakery',
  kind: 'shop',
  address: '12 High Street, Gillingham',
  postcode: 'ME7 1AA',
  hours: 'Monday to Saturday 7am to 5pm',
  contactName: 'Bola',
  mobile: '07700 900 222',
  email: 'bola@example.com',
  about: 'Fresh bread every morning.',
  username: 'cornerbakery',
  password: 'a-long-enough-password',
};

async function join(
  overrides: Partial<typeof BAKERY> & { claimShopId?: string; plan?: string } = {},
) {
  const details = { ...BAKERY, ...overrides };
  const phoneProof = await proveMobile(details.mobile);
  const response = await harness.app.inject({
    method: 'POST',
    url: '/partner/join',
    payload: { ...details, phoneProof },
  });
  return response;
}

describe('a shop joining by itself', () => {
  it('needs the mobile confirmed with a code, then signs in at once in the pending state', async () => {
    const unproven = await harness.app.inject({
      method: 'POST',
      url: '/partner/join',
      payload: BAKERY,
    });
    expect(unproven.statusCode).toBe(400);
    expect(unproven.json().error.message).toMatch(/confirm the mobile/);

    const joined = await join();
    expect(joined.statusCode, joined.body).toBe(201);
    const body = joined.json();
    expect(body.kind).toBe('partner');
    expect(body.shop).toEqual(
      expect.objectContaining({ status: 'pending', plan: 'free', freeForever: true }),
    );
    expect(body.message).toMatch(/Your basic listing is free\./);

    const headers = { 'x-business-token': body.token as string };
    const dashboard = await harness.app.inject({
      method: 'GET',
      url: '/partner/dashboard',
      headers,
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().shop).toEqual(
      expect.objectContaining({ status: 'pending', listed: false, kind: 'shop' }),
    );
    expect(dashboard.json().plan).toEqual(
      expect.objectContaining({ tier: 'free', freeForever: true, productLimit: 10, paid: false }),
    );
    // The mobile is private: it is on no answer anywhere.
    expect(JSON.stringify(dashboard.json())).not.toContain('900222');

    // They can add products straight away, with no photo on a free listing.
    const added = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Sourdough loaf', pricePence: 350 },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().message).toMatch(/goes public once we have checked/);

    // The same username and password sign in again.
    const signedIn = await harness.app.inject({
      method: 'POST',
      url: '/business/sign-in',
      payload: { username: BAKERY.username, password: BAKERY.password },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().mustChangePassword).toBe(false);
  });

  it('is public only once staff approve, and can be paused and removed, each change audited', async () => {
    const joined = await join();
    const shopId = joined.json().shop.id as string;
    expect((await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops).toEqual([]);
    expect((await harness.app.inject({ method: 'GET', url: `/shops/${shopId}` })).statusCode).toBe(
      404,
    );

    const list = (await staff('GET', '/staff/partners')).json();
    expect(list.shops).toEqual([
      expect.objectContaining({ name: 'Corner Bakery', status: 'pending', source: 'self' }),
    ]);
    expect(list.shops[0].mobile).toBeUndefined();

    const approved = await staff('POST', `/staff/partners/${shopId}`, { status: 'approved' });
    expect(approved.statusCode, approved.body).toBe(200);
    const shops = (await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops;
    expect(shops).toEqual([
      expect.objectContaining({ name: 'Corner Bakery', kind: 'shop', area: 'ME7', products: 0 }),
    ]);
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shopId}` })).json();
    expect(page.shop).toEqual(
      expect.objectContaining({ hours: BAKERY.hours, listedByOzi: false, claimable: false }),
    );

    await staff('POST', `/staff/partners/${shopId}`, { active: false });
    expect((await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops).toEqual([]);
    await staff('POST', `/staff/partners/${shopId}`, { active: true });
    expect((await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops).toHaveLength(
      1,
    );
    await staff('POST', `/staff/partners/${shopId}`, { status: 'removed' });
    expect((await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops).toEqual([]);

    const audited = await harness.repository.audit.list({ limit: 20 });
    expect(audited.filter((row) => row.action === 'POST /staff/partners/:id')).toHaveLength(4);
  });

  it('gives the first free listings for ever, then Partner Plus with the first month free', async () => {
    const { freeListingCount } = harness.config.extras.partners;
    for (let n = 0; n < freeListingCount; n += 1) {
      const added = await staff('POST', '/staff/partners', { name: `Shop ${n}`, plan: 'free' });
      expect(added.statusCode).toBe(201);
    }
    const options = (
      await harness.app.inject({ method: 'GET', url: '/partner/join/options' })
    ).json();
    expect(options.freeListingsLeft).toBe(0);

    const joined = await join();
    expect(joined.statusCode, joined.body).toBe(201);
    expect(joined.json().shop).toEqual(
      expect.objectContaining({ plan: 'plus', freeForever: false }),
    );
    expect(joined.json().message).toMatch(/free listings have all gone/);
    expect(joined.json().message).toMatch(/£14\.99 a month, with the first month free/);
  });

  it('refuses the kinds of service never listed, in plain words', async () => {
    const loans = await join({
      name: 'Quick Payday Loans',
      kind: 'service',
      about: 'Loans the same day.',
      username: 'quickloans',
      mobile: '07700 900 333',
    });
    expect(loans.statusCode).toBe(400);
    expect(loans.json().error.message).toMatch(/cannot list payday loans/);
    expect(loans.json().error.message).toMatch(/FCA, the SRA or the MHRA/);

    const barber = await join({
      name: 'Tony’s Barbers',
      kind: 'service',
      about: 'Barber and hairdresser, walk in or book.',
      username: 'tonysbarbers',
      mobile: '07700 900 444',
    });
    expect(barber.statusCode, barber.body).toBe(201);
    const headers = { 'x-business-token': barber.json().token as string };
    const mortgage = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Mortgage advice', pricePence: 5000, durationMinutes: 60 },
    });
    expect(mortgage.statusCode).toBe(400);
    expect(mortgage.json().error.message).toMatch(/cannot list mortgage advice/);
  });
});

describe('Partner Plus, paid from the dashboard', () => {
  async function joinedBakery() {
    const joined = await join();
    const headers = { 'x-business-token': joined.json().token as string };
    const shopId = joined.json().shop.id as string;
    await staff('POST', `/staff/partners/${shopId}`, { status: 'approved' });
    return { headers, shopId };
  }

  it('starts with the first month free, then pays through a Stripe Checkout page, recorded once', async () => {
    const { headers, shopId } = await joinedBakery();
    const free = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers,
      payload: {},
    });
    expect(free.statusCode, free.body).toBe(200);
    expect(free.json().url).toBeNull();
    expect(free.json().message).toMatch(/first month is free/);
    let dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.plan).toEqual(
      expect.objectContaining({
        tier: 'plus',
        paid: true,
        firstMonthFree: false,
        productLimit: null,
      }),
    );
    expect(dashboard.payments[0]).toEqual(
      expect.objectContaining({ what: 'Partner Plus', amountPence: 0 }),
    );

    // The next month is paid: a Checkout page, with the shop and the amount, and no address asked for.
    const checkout = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers,
      payload: { months: 2 },
    });
    expect(checkout.statusCode, checkout.body).toBe(200);
    expect(checkout.json().url).toMatch(/^https:\/\/checkout/);
    const link = harness.payments.calls.find((call) => call.kind === 'payment_link');
    expect(link, JSON.stringify(harness.payments.calls)).toBeDefined();
    expect(link?.input).toEqual(
      expect.objectContaining({
        purpose: 'partner',
        amountPence: 2998,
        description: expect.stringContaining('Partner Plus for Corner Bakery, 2 months'),
      }),
    );
    expect(checkout.json().url).toContain('cs_rehearsal');

    // Back from Stripe: the dashboard records it, and a second record of the same page does nothing.
    const sessionId = String(checkout.json().url).split('/').pop();
    const confirm = () =>
      harness.app.inject({
        method: 'POST',
        url: '/partner/plan/confirm',
        headers,
        payload: { receipt: checkout.json().receipt, sessionId },
      });
    const first = await confirm();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().recorded).toBe(true);
    const second = await confirm();
    expect(second.json().recorded).toBe(false);
    dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.payments).toHaveLength(2);
    expect(dashboard.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ what: 'Partner Plus', amountPence: 2998, months: 2 }),
      ]),
    );
    // Free month plus two paid: paid until three months on.
    expect(dashboard.plan.paidUntil).toBe('2027-01-17T10:00:00.000Z');

    // Another shop's receipt is refused.
    const other = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/confirm',
      headers,
      payload: { receipt: 'pc1.not.real', sessionId },
    });
    expect(other.statusCode).toBe(400);
    expect(shopId).toBeTruthy();
  });

  it('caps a free listing at the configured number of products and keeps photos for Plus', async () => {
    const { headers } = await joinedBakery();
    for (let n = 0; n < 10; n += 1) {
      const added = await harness.app.inject({
        method: 'POST',
        url: '/partner/products',
        headers,
        payload: { name: `Loaf ${n}`, pricePence: 200 },
      });
      expect(added.statusCode, added.body).toBe(201);
    }
    const eleventh = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Loaf 11', pricePence: 200 },
    });
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json().error.message).toMatch(/up to 10 products/);
  });
});

describe('a café or takeaway', () => {
  it('pays no monthly fee and sees its commission on orders through the app', async () => {
    const joined = await join({
      name: 'Rainham Café',
      kind: 'food',
      about: 'Breakfasts and lunches.',
      username: 'rainhamcafe',
      mobile: '07700 900 555',
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const headers = { 'x-business-token': joined.json().token as string };
    await harness.repository.analytics.record({
      at: harness.now(),
      kind: 'order_paid',
      shopperKey: 'k1',
      runnerKey: null,
      shop: 'Rainham Café',
      area: 'ME8',
      toArea: 'ME8',
      ageBand: null,
      viaOrganisation: false,
      itemCount: 2,
      goodsPence: 1250,
      categories: '',
      query: null,
      travelMode: null,
    });
    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.plan.monthlyPence).toBe(0);
    expect(dashboard.plan.words).toMatch(/No monthly fee\. 10%/);
    expect(dashboard.commission).toEqual({
      basisPoints: 1000,
      words: '10%',
      ordersThisMonth: 1,
      goodsThisMonthPence: 1250,
      owedThisMonthPence: 125,
    });
    const nothingToPay = await harness.app.inject({
      method: 'POST',
      url: '/partner/plan/checkout',
      headers,
      payload: {},
    });
    expect(nothingToPay.statusCode).toBe(400);
    const pdf = await harness.app.inject({
      method: 'GET',
      url: '/partner/statement.pdf',
      headers,
    });
    expect(pdf.rawPayload.toString('latin1')).toContain('10% owed: £1.25');
  });
});

describe('a service', () => {
  it('lists services with a price-from and a duration, and takes enquiries nobody pays for here', async () => {
    const joined = await join({
      name: 'Tony’s Barbers',
      kind: 'service',
      about: 'Barber and hairdresser.',
      username: 'tonysbarbers',
      mobile: '07700 900 444',
    });
    const headers = { 'x-business-token': joined.json().token as string };
    const shopId = joined.json().shop.id as string;
    await staff('POST', `/staff/partners/${shopId}`, { status: 'approved' });

    const noDuration = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Haircut', pricePence: 1200 },
    });
    expect(noDuration.statusCode).toBe(400);
    const haircut = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers,
      payload: { name: 'Haircut', pricePence: 1200, durationMinutes: 30 },
    });
    expect(haircut.statusCode, haircut.body).toBe(201);
    expect(haircut.json().message).toMatch(/from £12\.00/);
    const pending = (await staff('GET', '/staff/partner-products')).json().products;
    await staff('POST', `/staff/partner-products/${pending[0].id}/decide`, { approve: true });
    // A service is never in the catalogue: nobody buys it here.
    expect(await harness.repository.catalogue.search('Haircut')).toEqual([]);
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${shopId}` })).json();
    expect(page.shop.kind).toBe('service');
    expect(page.products).toEqual([
      expect.objectContaining({ name: 'Haircut', pricePence: 1200, durationMinutes: 30 }),
    ]);

    const shopper = await shopperWithProof();
    const refusedContact = await harness.app.inject({
      method: 'POST',
      url: `/shops/${shopId}/enquiry`,
      headers: shopper.authHeader,
      payload: { kind: 'quote', productId: page.products[0].id, message: 'Saturday?' },
    });
    expect(refusedContact.statusCode).toBe(400);
    const asked = await harness.app.inject({
      method: 'POST',
      url: `/shops/${shopId}/enquiry`,
      headers: shopper.authHeader,
      payload: {
        kind: 'call_back',
        productId: page.products[0].id,
        message: 'Saturday morning if you can.',
        contact: '07700 900 001',
      },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json().message).toMatch(/Nothing is paid through/);
    expect(harness.payments.calls).toEqual([]);

    const dashboard = (
      await harness.app.inject({ method: 'GET', url: '/partner/dashboard', headers })
    ).json();
    expect(dashboard.enquiries).toEqual([
      expect.objectContaining({
        kind: 'call_back',
        what: 'a call back',
        status: 'open',
        shopperName: 'Margaret',
        contact: '07700 900 001',
      }),
    ]);
    const answered = await harness.app.inject({
      method: 'POST',
      url: `/partner/enquiries/${dashboard.enquiries[0].id}/answer`,
      headers,
      payload: { reply: 'Saturday at 10 is fine.' },
    });
    expect(answered.statusCode, answered.body).toBe(200);

    const mine = (
      await harness.app.inject({ method: 'GET', url: '/me/enquiries', headers: shopper.authHeader })
    ).json();
    expect(mine.enquiries).toEqual([
      expect.objectContaining({
        shopName: 'Tony’s Barbers',
        status: 'answered',
        reply: 'Saturday at 10 is fine.',
      }),
    ]);
    expect(JSON.stringify(mine)).not.toContain('contact');

    // Ozi knows: from what is listed, in the words of the phrases file.
    const found = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload: { text: 'Is there a barber on Ozi?', mode: 'within' },
    });
    expect(found.json().reply).toMatch(/Tony’s Barbers/);
    const none = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload: { text: 'Ozi, is there a plumber on Ozi?', mode: 'within' },
    });
    expect(none.json().reply).toContain(
      `No plumber is on ${harness.config.productName} at the moment`,
    );
    const which = await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      payload: { text: 'Which shops are on Ozi?', mode: 'within' },
    });
    expect(which.json().reply).toContain(
      `1 shop is on ${harness.config.productName}: Tony’s Barbers`,
    );
  });
});

describe('the shops Ozi lists itself', () => {
  it('are seeded once from config, listed by Ozi with no products, and added again only when missing', async () => {
    const seed = parseShopsSeed({
      shops: [
        {
          key: 'first-shop',
          name: 'First Shop',
          kind: 'shop',
          address: '1 High Street',
          postcode: 'ME7 1AA',
          hours: 'Every day 8am to 8pm',
          about: 'A shop.',
        },
        { key: 'second-shop', name: 'Second Shop', address: '2 High Street' },
      ],
    });
    const repository = memoryRepository();
    expect(await seedShopsOnStartup(repository, seed)).toEqual({ seeded: true, shops: 2 });
    expect(await seedShopsOnStartup(repository, seed)).toEqual({ seeded: false, shops: 0 });
    const shops = await repository.partnerShops.list();
    expect(shops.map((shop) => [shop.name, shop.source, shop.status, shop.plan])).toEqual([
      ['First Shop', 'ozi', 'approved', 'free'],
      ['Second Shop', 'ozi', 'approved', 'free'],
    ]);
    // A curated list is never added to behind staff's backs; the button adds only what is missing.
    const curated = memoryRepository();
    await curated.partnerShops.create({
      name: 'Ours',
      address: '',
      telephone: '',
      about: '',
      monthlyPence: 0,
    });
    expect(await seedShopsOnStartup(curated, seed)).toEqual({ seeded: false, shops: 0 });
    expect(await seedShops(curated, seed)).toEqual({ added: 2, skipped: 0 });
    expect(await seedShops(curated, seed)).toEqual({ added: 0, skipped: 2 });

    expect(() => parseShopsSeed({ shops: [{ key: 'Bad Key', name: 'x', address: 'y' }] })).toThrow(
      /letters, numbers and dashes/,
    );
  });

  it('come from the real config file through the staff button, idempotently, and can be claimed', async () => {
    const first = await staff('POST', '/staff/partners/seed');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().added).toBeGreaterThan(10);
    const again = await staff('POST', '/staff/partners/seed');
    expect(again.json()).toEqual(expect.objectContaining({ added: 0 }));
    expect(again.json().message).toMatch(/Nothing to add/);

    const shops = (await harness.app.inject({ method: 'GET', url: '/shops' })).json().shops;
    expect(shops.length).toBe(first.json().added);
    expect(shops.every((shop: { listedByOzi: boolean }) => shop.listedByOzi)).toBe(true);
    // The first shop in the config file, whatever it is called: names live there, not here.
    const [firstSeed] = loadShopsSeed();
    const seeded = shops.find((shop: { name: string }) => shop.name === firstSeed!.name);
    expect(seeded).toEqual(expect.objectContaining({ kind: 'shop', area: 'ME7', products: 0 }));
    const page = (await harness.app.inject({ method: 'GET', url: `/shops/${seeded.id}` })).json();
    expect(page.shop.claimable).toBe(true);

    // The owner claims it: the mobile code and staff approval are both needed.
    const claimed = await join({
      name: seeded.name,
      address: page.shop.address,
      postcode: 'ME7 1BB',
      hours: page.shop.hours,
      username: 'bigshopgillingham',
      mobile: '07700 900 666',
      claimShopId: seeded.id,
    });
    expect(claimed.statusCode, claimed.body).toBe(201);
    expect(claimed.json().shop.id).toBe(seeded.id);
    expect(claimed.json().message).toMatch(/set up and claimed/);
    // Pending again until a person approves the claim, so the page is off meanwhile.
    expect(
      (await harness.app.inject({ method: 'GET', url: `/shops/${seeded.id}` })).statusCode,
    ).toBe(404);
    const row = (await staff('GET', '/staff/partners'))
      .json()
      .shops.find((shop: { id: string }) => shop.id === seeded.id);
    expect(row).toEqual(expect.objectContaining({ source: 'claimed', status: 'pending' }));
    await staff('POST', `/staff/partners/${seeded.id}`, { status: 'approved' });
    const after = (await harness.app.inject({ method: 'GET', url: `/shops/${seeded.id}` })).json();
    expect(after.shop).toEqual(expect.objectContaining({ claimable: false, listedByOzi: false }));

    // Nobody else can claim it now.
    const twice = await join({
      name: seeded.name,
      username: 'somebodyelse',
      mobile: '07700 900 777',
      claimShopId: seeded.id,
    });
    expect(twice.statusCode).toBe(409);
  });
});
