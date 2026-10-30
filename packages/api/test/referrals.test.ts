/**
 * Referral links for everybody, the referral log and reward levels, and Ozi Ambassadors (Anthony,
 * 30 October 2026): links recorded for every kind of account, what "active" means, the 70% rule,
 * levels and the owner told once, the staff page and who may open it, and the Ambassador share
 * (2% of item charges or commission, a quarter on another branch, 12 months, 5% of the first
 * Partner Plus payment once, the review over £500 once a month, opt-in and no introducing
 * yourself), and the money made tamper-proof: pending for 30 days, following refunds and
 * chargebacks, deductions, only what is available paid, and withdrawals to the bank.
 */

import { AMBASSADOR_TERMS_VERSION } from '@aldilivery/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Order, ReferralKind } from '../src/domain.js';
import {
  ambassadorChargeback,
  ambassadorSummary,
  creditAmbassadorShares,
  settlePlusBonuses,
} from '../src/services/ambassadors.js';
import { activeStatus } from '../src/services/referrals.js';
import { buildTestApp, signUpRunner, signUpShopper, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-11-10T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

let joinedCount = 0;

/** A business joining through /business/join, with whatever link it came by. */
async function joinShop(details: Record<string, unknown> = {}) {
  joinedCount += 1;
  const joined = await post('/partner/join', {
    name: `Corner Shop ${joinedCount}`,
    kind: 'shop',
    address: '12 High Street, Gillingham',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    contactName: 'Bola',
    mobile: `07700 900 ${String(300 + joinedCount)}`,
    email: `shop${joinedCount}@example.com`,
    about: 'Groceries.',
    username: `cornershop${joinedCount}`,
    password: 'a-long-enough-password',
    termsAgreed: true,
    ...details,
  });
  expect(joined.statusCode, joined.body).toBe(201);
  const body = joined.json();
  return {
    id: body.shop.id as string,
    headers: { 'x-business-token': body.token as string },
    message: body.message as string,
  };
}

async function handleOf(shopperId: string): Promise<string> {
  return (await harness.repository.shoppers.findById(shopperId))!.handle;
}

async function staffToken(role: string, username: string): Promise<Record<string, string>> {
  const made = (await post('/staff/team', { name: username, username, role }, STAFF)).json() as {
    password: string;
  };
  const token = (await post('/staff/sign-in', { username, password: made.password })).json()
    .token as string;
  return { 'x-staff-token': token };
}

let personCount = 0;

/** A referred Shopper, made directly, with or without an order delivered. */
async function referredShopper(referrer: { kind: ReferralKind; id: string }, delivered: boolean) {
  personCount += 1;
  const shopper = await harness.repository.shoppers.create({
    displayName: `Person ${personCount}`,
    handle: `person-${personCount}`,
    phone: `+4477009${String(20_000 + personCount).slice(-5)}`,
  });
  await harness.repository.referrals.record({
    referrerKind: referrer.kind,
    referrerId: referrer.id,
    joinedKind: 'shopper',
    joinedId: shopper.id,
    via: 'test',
    createdAt: harness.now(),
  });
  if (delivered) {
    await harness.repository.orders.create({
      shopperId: shopper.id,
      status: 'delivered',
      goodsEstimatePence: 1000,
      feePence: 1099,
      totalEstimatePence: 2099,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [],
    });
  }
  return shopper;
}

describe('referral links for every kind of account', () => {
  it('gives everybody a link, and records who referred each new account, whatever its kind', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada', phone: '+447700900500' });
    const mine = (await get('/referrals/me', ada.authHeader)).json();
    const handle = await handleOf(ada.shopperId);
    // The format Shoppers' links have had since ruling 44, kept for links already shared.
    expect(mine.referrals.link).toMatch(new RegExp(`/join\\?via=shopper-${handle}$`));
    const via = `shopper:${handle}`;

    // A Shopper brings a Shopper, and a driver to sign up as a Runner.
    const friend = await post('/shoppers', {
      displayName: 'Bea',
      phone: '+447700900501',
      joinedVia: via,
    });
    expect(friend.statusCode, friend.body).toBe(201);
    const driver = await post('/runners', {
      name: 'Dan',
      phone: '+447700900502',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      joinedVia: via,
    });
    expect(driver.statusCode, driver.body).toBe(201);

    // A Runner's own link brings a shop.
    const code = driver.json().runner.referralCode as string;
    const shop = await joinShop({ joinedVia: `runner:${code}` });

    // A shop's link brings an organisation, through its enquiry, once staff set it up.
    const enquiry = await post('/organisations/enquiries', {
      organisation: 'Sunrise Care Home',
      contactName: 'Grace',
      telephone: '01634 000000',
      termsAgreed: true,
      joinedVia: `partner:${shop.id}`,
    });
    expect(enquiry.statusCode, enquiry.body).toBe(201);
    const made = await post(
      '/staff/organisations',
      { name: 'Sunrise Care Home', contactName: 'Grace' },
      STAFF,
    );
    expect(made.statusCode, made.body).toBe(201);
    const organisationId = made.json().organisation.id as string;

    // A Runner's old link, by their Runner ID, still works.
    const second = await post('/runners', {
      name: 'Eve',
      phone: '+447700900503',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      referredBy: code.toLowerCase(),
    });
    expect(second.statusCode, second.body).toBe(201);

    const rows = await harness.repository.referrals.list();
    expect(rows.map((row) => [row.referrerKind, row.joinedKind])).toEqual([
      ['shopper', 'shopper'],
      ['shopper', 'runner'],
      ['runner', 'partner'],
      ['partner', 'organisation'],
      ['runner', 'runner'],
    ]);
    expect(rows[0]!.referrerId).toBe(ada.shopperId);
    expect(rows[3]!.joinedId).toBe(organisationId);
    expect(rows[2]!.joinedId).toBe(shop.id);

    // Each kind sees its own link on its own dashboard.
    expect((await get('/referrals/me', shop.headers)).json().referrals.link).toMatch(
      new RegExp(`/join\\?via=partner-${shop.id}$`),
    );
  });

  it('never records somebody referring themselves', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada', phone: '+447700900500' });
    const via = `shopper:${await handleOf(ada.shopperId)}`;
    // The same phone number, as a Runner.
    const self = await post('/runners', {
      name: 'Ada',
      phone: '+447700900500',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      joinedVia: via,
    });
    expect(self.statusCode, self.body).toBe(201);
    expect(await harness.repository.referrals.list()).toEqual([]);
  });

  it('shows the referrer only their own counts, never who joined', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada', phone: '+447700900500' });
    await referredShopper({ kind: 'shopper', id: ada.shopperId }, true);
    await referredShopper({ kind: 'shopper', id: ada.shopperId }, false);
    const response = await get('/referrals/me', ada.authHeader);
    const body = response.json();
    expect(body.referrals).toEqual(
      expect.objectContaining({
        joined: 2,
        active: 1,
        progress: '1 of 20 active referrals for your £10 voucher.',
      }),
    );
    expect(response.body).not.toContain('Person ');
  });
});

describe("a Shopper's no-Runner link for a driver", () => {
  it('counts the driver as the Shopper\'s referral, from the Runner sign-up link', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada', phone: '+447700900500' });
    const handle = await handleOf(ada.shopperId);
    // The link the checkout's "Send my referral link" shares: /runner/sign-up?via=shopper-<handle>.
    const driver = await post('/runners', {
      name: 'Dan',
      phone: '+447700900502',
      vehicleType: 'car',
      adult: true,
      homePostcode: 'ME7 1AA',
      referredBy: `shopper-${handle}`,
    });
    expect(driver.statusCode, driver.body).toBe(201);
    const row = await harness.repository.referrals.findFor('runner', driver.json().runner.id);
    expect(row).toMatchObject({ referrerKind: 'shopper', referrerId: ada.shopperId });
  });
});

describe('what active means', () => {
  it('a Shopper with an order delivered', () => {
    expect(activeStatus({ kind: 'shopper', closed: false, ordersDelivered: 1 })).toEqual({
      active: true,
      reason: 'Has had an order delivered.',
    });
    expect(activeStatus({ kind: 'shopper', closed: false, ordersDelivered: 0 }).active).toBe(false);
  });

  it('a Runner approved, with a delivery completed', () => {
    expect(
      activeStatus({ kind: 'runner', closed: false, approved: true, deliveriesCompleted: 1 })
        .active,
    ).toBe(true);
    expect(
      activeStatus({ kind: 'runner', closed: false, approved: false, deliveriesCompleted: 3 }),
    ).toEqual({ active: false, reason: 'Not approved yet.' });
    expect(
      activeStatus({ kind: 'runner', closed: false, approved: true, deliveriesCompleted: 0 })
        .reason,
    ).toBe('Approved, but no delivery completed yet.');
  });

  it('a shop partner approved, with an order', () => {
    expect(activeStatus({ kind: 'partner', closed: false, approved: true, orders: 1 }).active).toBe(
      true,
    );
    expect(
      activeStatus({ kind: 'partner', closed: false, approved: false, orders: 5 }).active,
    ).toBe(false);
    expect(activeStatus({ kind: 'partner', closed: false, approved: true, orders: 0 }).active).toBe(
      false,
    );
  });

  it('an organisation with somebody linked', () => {
    expect(activeStatus({ kind: 'organisation', closed: false, peopleLinked: 1 }).active).toBe(
      true,
    );
    expect(activeStatus({ kind: 'organisation', closed: false, peopleLinked: 0 }).active).toBe(
      false,
    );
  });

  it('never a closed or missing account', () => {
    expect(activeStatus({ kind: 'shopper', closed: true, ordersDelivered: 4 }).active).toBe(false);
    expect(activeStatus({ kind: 'runner', missing: true }).active).toBe(false);
  });

  it('is worked out from the data: a Runner referred becomes active once approved and delivering', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada', phone: '+447700900500' });
    const runner = await signUpRunner(harness, { phone: '+447700900601' });
    await harness.repository.referrals.record({
      referrerKind: 'shopper',
      referrerId: ada.shopperId,
      joinedKind: 'runner',
      joinedId: runner.runnerId,
      via: 'test',
      createdAt: harness.now(),
    });
    const detail = async () =>
      (await get(`/staff/referrals/shopper/${ada.shopperId}`, STAFF)).json().people[0];
    expect(await detail()).toEqual(
      expect.objectContaining({
        kind: 'runner',
        active: false,
        reason: 'Approved, but no delivery completed yet.',
      }),
    );
    const order = await harness.repository.orders.create({
      shopperId: ada.shopperId,
      status: 'delivered',
      goodsEstimatePence: 1000,
      feePence: 1099,
      totalEstimatePence: 2099,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [],
    });
    await harness.repository.orders.update(order.id, { runnerId: runner.runnerId });
    expect(await detail()).toEqual(expect.objectContaining({ active: true }));
  });
});

describe('reward levels', () => {
  it('needs 70% of everyone who joined active: 20 of 29 is not enough, 21 of 30 is', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada Obi', phone: '+447700900500' });
    const referrer = { kind: 'shopper' as const, id: ada.shopperId };
    for (let n = 0; n < 20; n += 1) await referredShopper(referrer, true);
    for (let n = 0; n < 9; n += 1) await referredShopper(referrer, false);

    const before = (await get('/referrals/me', ada.authHeader)).json().referrals;
    expect(before.levels.every((level: { reached: boolean }) => !level.reached)).toBe(true);
    expect(before.progress).toBe(
      '20 of 20 active referrals for your £10 voucher. At least 70% of the people who joined need to be active, and 20 of 29 is 68%.',
    );
    expect(await harness.repository.ownerDesk.listUnsettled()).toEqual([]);

    // One more active: 21 of 30 is exactly 70%, which counts.
    await referredShopper(referrer, true);
    const after = (await get('/referrals/me', ada.authHeader)).json().referrals;
    expect(after.active).toBe(21);
    expect(after.joined).toBe(30);
    expect(after.levels[0]).toEqual(
      expect.objectContaining({ label: '£10 voucher', reached: true }),
    );
    expect(after.earned[0].words).toBe("You've earned a £10 shopping voucher. We'll be in touch.");
    expect(after.progress).toBe('21 of 30 active referrals for your £15 voucher.');
  });

  it('tells the owner once, and the person once through Ozi', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada Obi', phone: '+447700900500' });
    const referrer = { kind: 'shopper' as const, id: ada.shopperId };
    for (let n = 0; n < 20; n += 1) await referredShopper(referrer, true);
    for (let n = 0; n < 8; n += 1) await referredShopper(referrer, false);

    const first = (await get('/referrals/me', ada.authHeader)).json().referrals;
    expect(first.news).toBe("You've earned a £10 shopping voucher. We'll be in touch.");
    await get('/staff/referrals', STAFF);
    await get('/referrals/me', ada.authHeader);
    const matters = (await harness.repository.ownerDesk.listUnsettled()).filter(
      (matter) => matter.kind === 'referral_level',
    );
    expect(matters.map((matter) => matter.summary)).toEqual([
      'Ada Obi has reached the £10 voucher level with 20 active referrals.',
    ]);

    expect((await post('/referrals/me/heard', {}, ada.authHeader)).json()).toEqual({ told: 1 });
    expect((await get('/referrals/me', ada.authHeader)).json().referrals.news).toBe('');
  });
});

describe('the staff Referrals page', () => {
  it('is for the founder and the operations manager, not other staff, and never for the public', async () => {
    expect((await get('/staff/referrals', STAFF)).statusCode).toBe(200);
    expect(
      (await get('/staff/referrals', await staffToken('operations_manager', 'ngozi'))).statusCode,
    ).toBe(200);
    expect(
      (await get('/staff/referrals', await staffToken('customer_care', 'kemi'))).statusCode,
    ).toBe(403);
    expect(
      (await get('/staff/referrals', await staffToken('partnerships', 'tunde'))).statusCode,
    ).toBe(403);
    expect((await get('/staff/referrals')).statusCode).toBe(403);
  });

  it('lists everybody who referred anybody, the most first, searchable, and marks a reward given', async () => {
    const ada = await signUpShopper(harness, { displayName: 'Ada Obi', phone: '+447700900500' });
    const runner = await signUpRunner(harness, { name: 'Tomasz', phone: '+447700900601' });
    for (let n = 0; n < 20; n += 1)
      await referredShopper({ kind: 'shopper', id: ada.shopperId }, true);
    await referredShopper({ kind: 'runner', id: runner.runnerId }, false);

    const page = (await get('/staff/referrals', STAFF)).json();
    expect(page.referrers.map((row: { name: string }) => row.name)).toEqual(['Ada Obi', 'Tomasz']);
    expect(page.referrers[0]).toEqual(
      expect.objectContaining({
        kindWords: 'Shopper',
        joined: 20,
        active: 20,
        percent: '100%',
        level: expect.objectContaining({ label: '£10 voucher', given: false }),
      }),
    );
    expect(page.referrers[1]).toEqual(
      expect.objectContaining({
        kindWords: 'Runner',
        area: 'Medway',
        joined: 1,
        active: 0,
        percent: '0%',
        level: null,
      }),
    );
    expect(
      (await get('/staff/referrals?search=tom', STAFF))
        .json()
        .referrers.map((row: { name: string }) => row.name),
    ).toEqual(['Tomasz']);

    const detail = (await get(`/staff/referrals/runner/${runner.runnerId}`, STAFF)).json();
    expect(detail.people[0]).toEqual(
      expect.objectContaining({
        kindWords: 'Shopper',
        active: false,
        reason: 'No order delivered yet.',
      }),
    );

    const levelId = page.referrers[0].level.id as string;
    const given = await post(`/staff/referrals/levels/${levelId}/given`, { by: 'Anthony' }, STAFF);
    expect(given.statusCode, given.body).toBe(200);
    expect(given.json().message).toBe('The £10 voucher for Ada Obi is marked given, by Anthony.');
    const level = await harness.repository.referrals.findLevel(levelId);
    expect(level).toEqual(expect.objectContaining({ givenBy: 'Anthony', givenAt: harness.now() }));
    expect(
      (await post(`/staff/referrals/levels/${levelId}/given`, { by: 'Anthony' }, STAFF)).statusCode,
    ).toBe(409);
  });
});

describe('Ozi Ambassadors', () => {
  async function ambassador() {
    const ada = await signUpShopper(harness, { displayName: 'Ada Obi', phone: '+447700900500' });
    const via = `shopper:${await handleOf(ada.shopperId)}`;
    return { ...ada, via };
  }

  async function optIn(headers: Record<string, string>) {
    const joined = await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      headers,
    );
    expect(joined.statusCode, joined.body).toBe(200);
    return joined.json();
  }

  async function approve(shopId: string) {
    const approved = await post(`/staff/partners/${shopId}`, { status: 'approved' }, STAFF);
    expect(approved.statusCode, approved.body).toBe(200);
  }

  /** A delivered order of `quantity` of one product from the shop, at the price given. */
  async function orderFrom(shopId: string, pricePence: number, quantity: number, at?: Date) {
    const product = await harness.repository.partnerProducts.create({
      partnerShopId: shopId,
      name: 'Thing',
      pricePence,
      tags: '',
      expiresOn: null,
      photo: null,
      photoType: null,
    });
    const item = await harness.repository.catalogue.create({
      name: 'Thing',
      category: 'From the shop',
      estimatedPricePence: pricePence,
      source: 'partner_feed',
      externalRef: `partner:${product.id}`,
    });
    personCount += 1;
    const shopper = await harness.repository.shoppers.create({
      displayName: 'Buyer',
      phone: `+4477009${String(40_000 + personCount).slice(-5)}`,
      handle: `buyer-${personCount}`,
    });
    const order = await harness.repository.orders.create({
      shopperId: shopper.id,
      status: 'delivered',
      goodsEstimatePence: pricePence * quantity,
      feePence: 1099,
      totalEstimatePence: pricePence * quantity + 1099,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [
        { catalogueItemId: item.id, name: item.name, quantity, estimatedPricePence: pricePence },
      ],
    });
    return (await harness.repository.orders.update(order.id, {
      deliveredAt: at ?? harness.now(),
    })) as Order;
  }

  it('must be chosen first, agreeing to the terms; only then is there a link that ties a shop', async () => {
    const ada = await ambassador();
    const before = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(before).toEqual(
      expect.objectContaining({
        joined: false,
        link: null,
        profitShareWords: '2%',
        branchShareWords: '0.5%',
        planShareWords: '5%',
        months: 12,
      }),
    );
    // A link used before they opted in ties nothing.
    const early = await joinShop({ ambassador: ada.via });
    expect((await harness.repository.partnerShops.findById(early.id))?.ambassadorId).toBeNull();

    expect(
      (await post('/ambassador/join', { termsAgreed: true, termsVersion: 'old' }, ada.authHeader))
        .statusCode,
    ).toBe(400);
    const joined = await optIn(ada.authHeader);
    expect(joined.link).toMatch(/\/business\/join\?ambassador=shopper-/);
    const agreement = await harness.repository.ambassadors.findAgreement('shopper', ada.shopperId);
    expect(agreement).toEqual(
      expect.objectContaining({ termsVersion: AMBASSADOR_TERMS_VERSION, agreedAt: harness.now() }),
    );

    const shop = await joinShop({ ambassador: ada.via });
    expect(shop.message).toMatch(/introduced by Ada Obi, an Ozi Ambassador/);
    const tied = await harness.repository.partnerShops.findById(shop.id);
    expect(tied).toEqual(
      expect.objectContaining({ ambassadorKind: 'shopper', ambassadorId: ada.shopperId }),
    );
    // An Ambassador's link is a referral too.
    expect((await harness.repository.referrals.findFor('partner', shop.id))?.referrerId).toBe(
      ada.shopperId,
    );

    const mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine.businesses).toEqual([{ name: tied!.name, approved: false }]);
  });

  it('cannot introduce their own business: the same phone or email', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const own = await joinShop({ ambassador: ada.via, mobile: '07700 900500' });
    expect(own.message).toMatch(/cannot be the Ambassador of their own business/);
    expect((await harness.repository.partnerShops.findById(own.id))?.ambassadorId).toBeNull();

    // A shop partner as Ambassador, and a second listing with the same email.
    const first = await joinShop({ email: 'owner@example.com' });
    await optIn(first.headers);
    const second = await joinShop({
      ambassador: `partner:${first.id}`,
      email: 'OWNER@example.com',
    });
    expect((await harness.repository.partnerShops.findById(second.id))?.ambassadorId).toBeNull();
  });

  it('earns 2% of the item charges on a shop’s orders, once, for 12 months from approval', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const shop = await joinShop({ ambassador: ada.via });

    // Not yet approved: nothing earned.
    const early = await orderFrom(shop.id, 1200, 10);
    expect(await creditAmbassadorShares(harness.app.ctx, early)).toEqual([]);

    await approve(shop.id);
    // £12 each: an item charge of £1.50, ten of them £15; 2% of that is 30p. Not the delivery fee.
    const order = await orderFrom(shop.id, 1200, 10);
    const [entry] = await creditAmbassadorShares(harness.app.ctx, order);
    expect(entry).toEqual(
      expect.objectContaining({ kind: 'share', profitPence: 1500, amountPence: 30 }),
    );
    expect(await creditAmbassadorShares(harness.app.ctx, order)).toEqual([]);

    // Twelve months on, nothing more.
    const late = await orderFrom(shop.id, 1200, 10, new Date('2027-11-10T10:00:00.000Z'));
    expect(await creditAmbassadorShares(harness.app.ctx, late)).toEqual([]);
    const nearly = await orderFrom(shop.id, 1200, 10, new Date('2027-11-10T09:00:00.000Z'));
    expect(await creditAmbassadorShares(harness.app.ctx, nearly)).toHaveLength(1);

    const summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.shopperId);
    expect(summary.earnedPence).toBe(60);
  });

  it('earns 2% of a café’s 10% commission', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const cafe = await joinShop({ ambassador: ada.via, kind: 'food', about: 'Breakfasts.' });
    await approve(cafe.id);
    // £50 of food: £5 commission, 2% of it 10p.
    const [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await orderFrom(cafe.id, 500, 10),
    );
    expect(entry).toEqual(expect.objectContaining({ profitPence: 500, amountPence: 10 }));
  });

  it('earns a quarter on another branch through the same link, and nothing on a branch without it', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const main = await joinShop({ ambassador: ada.via });
    const branch = await joinShop({ ambassador: ada.via });
    const elsewhere = await joinShop({});
    for (const shop of [main, branch, elsewhere]) await approve(shop.id);
    for (const shop of [branch, elsewhere]) {
      const marked = await post(`/staff/partners/${shop.id}`, { branchOfShopId: main.id }, STAFF);
      expect(marked.statusCode, marked.body).toBe(200);
    }
    expect(
      (await post(`/staff/partners/${main.id}`, { branchOfShopId: main.id }, STAFF)).statusCode,
    ).toBe(400);

    const [full] = await creditAmbassadorShares(
      harness.app.ctx,
      await orderFrom(main.id, 1200, 10),
    );
    const [quarter] = await creditAmbassadorShares(
      harness.app.ctx,
      await orderFrom(branch.id, 1200, 10),
    );
    expect(full?.amountPence).toBe(30);
    // A quarter of 2% is 0.5%: of £15 of item charges, 7.5p, to the nearest penny 8p.
    expect(quarter?.amountPence).toBe(8);
    expect(
      await creditAmbassadorShares(harness.app.ctx, await orderFrom(elsewhere.id, 1200, 10)),
    ).toEqual([]);
  });

  it('earns 5% of the first Partner Plus payment, once; the free month is not a payment', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const shop = await joinShop({ ambassador: ada.via });
    const pay = (amountPence: number, at: string) =>
      harness.repository.partnerPayments.create({
        partnerShopId: shop.id,
        kind: 'plan',
        amountPence,
        months: 1,
        coversUntil: new Date(at),
        recordedBy: 'test',
        paidAt: new Date(at),
      });
    await pay(0, '2026-11-10T10:00:00.000Z');
    const tied = (await harness.repository.partnerShops.findById(shop.id))!;
    await settlePlusBonuses(harness.app.ctx, [tied]);
    expect(await harness.repository.ambassadors.list()).toEqual([]);

    await pay(1499, '2026-12-10T10:00:00.000Z');
    await pay(1499, '2027-01-10T10:00:00.000Z');
    await settlePlusBonuses(harness.app.ctx, [tied]);
    await settlePlusBonuses(harness.app.ctx, [tied]);
    const entries = await harness.repository.ambassadors.list();
    expect(entries).toEqual([
      expect.objectContaining({ kind: 'bonus', profitPence: 1499, amountPence: 75 }),
    ]);
  });

  it('asks the owner to check a month over £500 once that month, with no limit on businesses', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const shop = await joinShop({ ambassador: ada.via });
    await approve(shop.id);
    await harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId: ada.shopperId,
      kind: 'share',
      partnerShopId: shop.id,
      orderId: 'earlier',
      profitPence: 0,
      amountPence: 49_990,
      reference: 'share:earlier',
      recordedBy: null,
      at: harness.now(),
    });
    const reviews = async () =>
      (await harness.repository.ownerDesk.listUnsettled()).filter(
        (matter) => matter.kind === 'ambassador_review',
      );
    await creditAmbassadorShares(harness.app.ctx, await orderFrom(shop.id, 1200, 10));
    await creditAmbassadorShares(harness.app.ctx, await orderFrom(shop.id, 1200, 10));
    expect((await reviews()).map((matter) => matter.summary)).toEqual([
      "Ada Obi's Ambassador earnings are over £500 this month. Please check before paying.",
    ]);
  });

  it('is marked paid by staff for what is available only, and shows on the staff page', async () => {
    const ada = await ambassador();
    await optIn(ada.authHeader);
    const shop = await joinShop({ ambassador: ada.via });
    await approve(shop.id);
    await creditAmbassadorShares(harness.app.ctx, await orderFrom(shop.id, 1200, 10));
    // 30p, pending: nothing can be paid.
    expect(
      (await post(`/staff/ambassadors/shopper/${ada.shopperId}/paid`, { by: 'Anthony' }, STAFF))
        .statusCode,
    ).toBe(409);
    // An earlier share, past its 30 days.
    await harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId: ada.shopperId,
      kind: 'share',
      partnerShopId: shop.id,
      orderId: null,
      profitPence: 50_000,
      amountPence: 1000,
      availableAt: new Date('2026-11-01T10:00:00.000Z'),
      reference: 'share:big',
      recordedBy: null,
      at: harness.now(),
    });
    const page = (await get('/staff/referrals', STAFF)).json();
    expect(page.ambassadors[0]).toEqual(
      expect.objectContaining({
        name: 'Ada Obi',
        earnedThisMonthPence: 1030,
        pendingPence: 30,
        availablePence: 1000,
        paidPence: 0,
        deductionsPence: 0,
        payable: true,
      }),
    );
    const paid = await post(
      `/staff/ambassadors/shopper/${ada.shopperId}/paid`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().message).toBe('Ada Obi is marked paid £10.00, by Anthony.');
    const mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine).toEqual(
      expect.objectContaining({
        earnedPence: 1030,
        pendingPence: 30,
        availablePence: 0,
        paidPence: 1000,
      }),
    );
  });
});

describe('Ambassador money is tamper-proof (ruled 30 October 2026)', () => {
  async function tiedShop(kind: 'shop' | 'food' = 'shop') {
    const ada = await signUpShopper(harness, { displayName: 'Ada Obi', phone: '+447700900500' });
    const via = `shopper:${await handleOf(ada.shopperId)}`;
    await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      ada.authHeader,
    );
    const shop = await joinShop({ ambassador: via, kind, about: 'Things.' });
    await post(`/staff/partners/${shop.id}`, { status: 'approved' }, STAFF);
    return { ada, shop };
  }

  /** A delivered order of `quantity` things at £12 each from the shop. */
  async function delivered(shopId: string, quantity: number, patch: Partial<Order> = {}) {
    const product = await harness.repository.partnerProducts.create({
      partnerShopId: shopId,
      name: 'Thing',
      pricePence: 1200,
      tags: '',
      expiresOn: null,
      photo: null,
      photoType: null,
    });
    const item = await harness.repository.catalogue.create({
      name: 'Thing',
      category: 'From the shop',
      estimatedPricePence: 1200,
      source: 'partner_feed',
      externalRef: `partner:${product.id}`,
    });
    personCount += 1;
    const shopper = await harness.repository.shoppers.create({
      displayName: 'Buyer',
      phone: `+4477009${String(60_000 + personCount).slice(-5)}`,
      handle: `buyer-${personCount}`,
    });
    const order = await harness.repository.orders.create({
      shopperId: shopper.id,
      status: 'delivered',
      goodsEstimatePence: 1200 * quantity,
      feePence: 1099,
      totalEstimatePence: 1200 * quantity + 1099,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [{ catalogueItemId: item.id, name: item.name, quantity, estimatedPricePence: 1200 }],
    });
    return (await harness.repository.orders.update(order.id, {
      deliveredAt: harness.now(),
      ...patch,
    })) as Order;
  }

  const summary = (id: string) => ambassadorSummary(harness.app.ctx, 'shopper', id);

  it('comes only from a real, delivered order, read again from the records', async () => {
    const { shop } = await tiedShop();
    expect(await creditAmbassadorShares(harness.app.ctx, { id: 'made-up' })).toEqual([]);
    const shopping = await delivered(shop.id, 10, { status: 'shopping', deliveredAt: null });
    expect(await creditAmbassadorShares(harness.app.ctx, shopping)).toEqual([]);
    // What the caller hands in is not believed: the order as recorded is.
    const order = await delivered(shop.id, 10);
    const [entry] = await creditAmbassadorShares(harness.app.ctx, {
      ...order,
      items: order.items.map((item) => ({ ...item, quantity: 1000 })),
    } as Order);
    expect(entry?.amountPence).toBe(30);
  });

  it('stays pending for 30 days, following a cancel or part refund, then is available', async () => {
    const { ada, shop } = await tiedShop();
    const whole = await delivered(shop.id, 10);
    const part = await delivered(shop.id, 10);
    await creditAmbassadorShares(harness.app.ctx, whole);
    await creditAmbassadorShares(harness.app.ctx, part);
    expect(await summary(ada.shopperId)).toEqual(
      expect.objectContaining({ pendingPence: 60, availablePence: 0 }),
    );

    // One refunded whole; half of the other given back as goodwill.
    await harness.repository.orders.update(whole.id, { status: 'refunded' });
    await harness.repository.orders.update(part.id, {
      goodwillRefundedPence: Math.floor(part.totalEstimatePence / 2),
    });
    expect(await summary(ada.shopperId)).toEqual(
      expect.objectContaining({ pendingPence: 15, availablePence: 0, deductionsPence: 0 }),
    );

    harness.setNow(new Date('2026-12-10T10:00:01.000Z'));
    expect(await summary(ada.shopperId)).toEqual(
      expect.objectContaining({ pendingPence: 0, availablePence: 15 }),
    );
  });

  it('takes a later refund off what is available next, never below zero, as a line', async () => {
    const { ada, shop } = await tiedShop();
    const order = await delivered(shop.id, 10);
    await creditAmbassadorShares(harness.app.ctx, order);
    harness.setNow(new Date('2026-12-11T10:00:00.000Z'));
    expect((await summary(ada.shopperId)).availablePence).toBe(30);

    // A late complaint refunds the whole order.
    await harness.repository.orders.update(order.id, {
      goodwillRefundedPence: order.totalEstimatePence,
    });
    const after = await summary(ada.shopperId);
    expect(after).toEqual(
      expect.objectContaining({ availablePence: 0, deductionsPence: 30, shortfallPence: 0 }),
    );
    expect(after.deductions[0]?.words).toMatch(
      /^A refund on an order from Corner Shop \d+ came after your share was available: £0\.30 taken off\.$/,
    );
    // Worked out again, the same deduction is not made twice.
    expect((await summary(ada.shopperId)).deductionsPence).toBe(30);

    // Another share, available and paid; then a chargeback on it: nothing goes below zero.
    const second = await delivered(shop.id, 10, { stripePaymentIntentId: 'pi_disputed' });
    await creditAmbassadorShares(harness.app.ctx, second);
    harness.setNow(new Date('2027-01-11T10:00:00.000Z'));
    expect((await summary(ada.shopperId)).availablePence).toBe(30);
    await harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId: ada.shopperId,
      kind: 'payment',
      partnerShopId: null,
      orderId: null,
      profitPence: 0,
      amountPence: 30,
      reference: 'payment:test',
      recordedBy: 'Anthony',
      at: harness.now(),
    });
    expect(await ambassadorChargeback(harness.app.ctx, 'pi_disputed')).toBe(1);
    expect(await summary(ada.shopperId)).toEqual(
      expect.objectContaining({ availablePence: 0, deductionsPence: 60, shortfallPence: 30 }),
    );
  });

  it('hears of a chargeback from Stripe', async () => {
    const { ada, shop } = await tiedShop();
    const order = await delivered(shop.id, 10, { stripePaymentIntentId: 'pi_chargeback' });
    await creditAmbassadorShares(harness.app.ctx, order);
    expect((await summary(ada.shopperId)).pendingPence).toBe(30);
    const hook = await harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'rehearsal' },
      payload: JSON.stringify({
        id: 'evt_dispute',
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_1', payment_intent: 'pi_chargeback' } },
      }),
    });
    expect(hook.statusCode, hook.body).toBe(200);
    expect((await summary(ada.shopperId)).pendingPence).toBe(0);
  });

  /** Earnings past their 30 days, as if from orders long delivered. */
  function earn(ambassadorId: string, shopId: string, amountPence: number) {
    return harness.repository.ambassadors.add({
      ambassadorKind: 'shopper',
      ambassadorId,
      kind: 'share',
      partnerShopId: shopId,
      orderId: null,
      profitPence: 0,
      amountPence,
      availableAt: new Date('2026-11-01T10:00:00.000Z'),
      reference: `share:${amountPence}:${Math.random()}`,
      recordedBy: null,
      at: harness.now(),
    });
  }

  it('lets an Ambassador withdraw what is available to their bank, through Stripe’s own form', async () => {
    const { ada, shop } = await tiedShop();
    // Under £10 available: no withdrawal.
    expect((await post('/ambassador/withdraw', {}, ada.authHeader)).statusCode).toBe(409);
    await earn(ada.shopperId, shop.id, 1200);
    // No bank details yet.
    const early = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(early.statusCode).toBe(409);
    expect(early.body).toMatch(/bank details/);

    const setup = await post(
      '/ambassador/bank',
      {},
      { ...ada.authHeader, origin: 'http://localhost:5173' },
    );
    expect(setup.statusCode, setup.body).toBe(200);
    expect(setup.json().url).toMatch(/\/settings\?bank=back$/);
    expect(harness.payments.calls.some((call) => call.kind === 'connected_account')).toBe(true);

    const sent = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual(expect.objectContaining({ status: 'sent', amountPence: 1200 }));
    const transfer = harness.payments.calls.filter((call) => call.kind === 'transfer').at(-1);
    expect(transfer?.input).toEqual(expect.objectContaining({ amountPence: 1200 }));
    expect(await summary(ada.shopperId)).toEqual(
      expect.objectContaining({ availablePence: 0, paidPence: 1200 }),
    );
    // Nothing left to withdraw twice.
    expect((await post('/ambassador/withdraw', {}, ada.authHeader)).statusCode).toBe(409);
    const mine = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(mine.withdrawals[0].words).toBe('£12.00: sent to your bank.');
  });

  it('holds a withdrawal over £500 in a month, or from somebody flagged, for staff to approve', async () => {
    const { ada, shop } = await tiedShop();
    await post('/ambassador/bank', {}, { ...ada.authHeader, origin: 'http://localhost:5173' });
    await earn(ada.shopperId, shop.id, 60_000);
    const asked = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(asked.json()).toEqual(expect.objectContaining({ status: 'waiting_approval' }));
    expect(asked.json().message).toMatch(/over £500 in a month are checked by a person/);
    // Held back while it waits: nothing more to ask for, and nothing sent.
    expect((await summary(ada.shopperId)).availablePence).toBe(0);
    expect(harness.payments.calls.filter((call) => call.kind === 'transfer')).toEqual([]);

    const page = (await get('/staff/referrals', STAFF)).json();
    const waiting = page.ambassadors[0].waitingWithdrawals[0];
    expect(waiting).toEqual(expect.objectContaining({ amountPence: 60_000 }));
    // Only staff with the Referrals page may approve.
    expect(
      (
        await post(
          `/staff/ambassadors/withdrawals/${waiting.id}/approve`,
          { by: 'Kemi' },
          await staffToken('customer_care', 'kemi'),
        )
      ).statusCode,
    ).toBe(403);
    const approved = await post(
      `/staff/ambassadors/withdrawals/${waiting.id}/approve`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().message).toMatch(
      /^The withdrawal of £600\.00 is approved and sent, by /,
    );
    expect((await summary(ada.shopperId)).paidPence).toBe(60_000);

    // Flagged: even a small one waits, and refusing it leaves the money available.
    const flag = await post(
      `/staff/ambassadors/shopper/${ada.shopperId}/flag`,
      { flagged: true, reason: 'Checking' },
      STAFF,
    );
    expect(flag.statusCode, flag.body).toBe(200);
    await earn(ada.shopperId, shop.id, 1500);
    const small = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(small.json().status).toBe('waiting_approval');
    const second = (await get('/staff/referrals', STAFF)).json().ambassadors[0];
    expect(second.flagged).toBe(true);
    const refused = await post(
      `/staff/ambassadors/withdrawals/${second.waitingWithdrawals[0].id}/refuse`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(refused.statusCode, refused.body).toBe(200);
    expect((await summary(ada.shopperId)).availablePence).toBe(1500);
  });
});
