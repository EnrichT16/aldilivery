/**
 * Top Ambassador of the month and the first-business bonus (Anthony, 2 November 2026, ruling
 * 91), each proved against the real services with the memory repository and the fake clock:
 *
 * 1. The month's decision: the most confirmed, ordering businesses wins; ties by who got there
 *    first; at least two; a business confirmed last month, or one with no order, does not count.
 * 2. The bar: paid only when Ozi's net income from Ambassador-brought businesses reaches £125;
 *    below it, the decision is kept, nobody is paid, and the dashboard says so plainly.
 * 3. The sweep on the hourly timer is idempotent, and the prize sits under the 30-day hold.
 * 4. The first-business bonus at the 4th paid order, postponed by a refund, once in a life.
 * 5. The dashboard words, with nobody else's count and no company figure.
 * 6. The terms version bump forces every Ambassador to agree again before withdrawing.
 * 7. The owner's view, and the owner alone.
 */

import { AMBASSADOR_TERMS_VERSION, TERMS_CHANGED_WORDS } from '@aldilivery/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import {
  ambassadorPrizesForVoice,
  decideMonth,
  firstBusinessState,
  monthTakings,
  prizePanel,
  sweepAmbassadorPrizes,
} from '../src/services/ambassador-prizes.js';
import { ambassadorSummary, creditAmbassadorShares } from '../src/services/ambassadors.js';
import { buildTestApp, signUpShopper, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

/** 2 November 2026, 10am UK. */
const START = new Date('2026-11-02T10:00:00.000Z');
/** The 1st of December, just after midnight UK: November is over. */
const DECEMBER = new Date('2026-12-01T01:00:00.000Z');
const DAY = 24 * 3_600_000;

async function build(at = START) {
  harness = await buildTestApp(at, {
    sendText: async () => {},
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

let people = 0;

/** An approved Ambassador, a Shopper, on the current terms unless an older version is given. */
async function ambassador(name: string, termsVersion = AMBASSADOR_TERMS_VERSION) {
  people += 1;
  const shopper = await signUpShopper(harness, {
    displayName: name,
    phone: `+447700${String(900_000 + people)}`,
  });
  const joined = await post(
    '/ambassador/join',
    { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
    shopper.authHeader,
  );
  expect(joined.statusCode, joined.body).toBe(200);
  const agreement = (await harness.repository.ambassadors.findAgreement(
    'shopper',
    shopper.shopperId,
  ))!;
  await harness.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'approved',
    approvedAt: harness.now(),
    termsVersion,
  });
  return { ...shopper, kind: 'shopper' as const, id: shopper.shopperId };
}

let shops = 0;

/**
 * An approved grocery shop partner, tied to this Ambassador and confirmed by the business at
 * `confirmedAt` (its own code, services/ambassador-protection.ts).
 */
async function confirmedShop(who: { id: string }, confirmedAt: Date) {
  shops += 1;
  const joined = await post('/partner/join', {
    name: `Corner Shop ${shops}`,
    kind: 'shop',
    address: '12 High Street, Gillingham',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    contactName: 'Bola',
    mobile: `07700 900 ${String(700 + shops)}`,
    email: `shop${shops}@example.com`,
    username: `cornershop${shops}`,
    password: 'a-long-enough-password',
    termsAgreed: true,
  });
  expect(joined.statusCode, joined.body).toBe(201);
  const shopId = (joined.json() as { shop: { id: string } }).shop.id;
  return harness.repository.partnerShops.update(shopId, {
    status: 'approved',
    approvedAt: confirmedAt,
    ambassadorKind: 'shopper',
    ambassadorId: who.id,
    ambassadorConfirmNeeded: true,
    ambassadorConfirmedAt: confirmedAt,
  });
}

/**
 * A paid, delivered order of one £60 thing from this shop at `at`, with the Ambassador's share
 * recorded as a delivery records it. Ozi's net on it (ruling 91): the fee less the Runner's
 * five pounds (£5.99), the item charges (£5.50), less the processor (£1.27 on £70.99) and the
 * Ambassador's share (6p): £10.16.
 */
const NET_PER_ORDER = 1099 - 500 + 550 - 127 - 6;

async function order(shopId: string, at: Date, pricePence = 6000): Promise<Order> {
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
  people += 1;
  const buyer = await harness.repository.shoppers.create({
    displayName: 'Buyer',
    phone: `+4477009${String(70_000 + people).slice(-5)}`,
    handle: `buyer-${people}`,
  });
  const made = await harness.repository.orders.create({
    shopperId: buyer.id,
    status: 'delivered',
    goodsEstimatePence: pricePence,
    feePence: 1099,
    totalEstimatePence: pricePence + 1099,
    deliveryAddress: `${people} Canterbury Street, Gillingham ME7 5UH`,
    items: [
      { catalogueItemId: item.id, name: item.name, quantity: 1, estimatedPricePence: pricePence },
    ],
  });
  const delivered = (await harness.repository.orders.update(made.id, { deliveredAt: at })) as Order;
  await creditAmbassadorShares(harness.app.ctx, delivered);
  return delivered;
}

const november = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));

/** Enough orders from this shop in November to take the month over the bar. */
async function overTheBar(shopId: string): Promise<void> {
  const needed = Math.ceil(harness.config.ambassador.monthlyPrizeBarPence / NET_PER_ORDER);
  for (let n = 0; n < needed; n += 1) await order(shopId, november(3 + (n % 20), 9 + (n % 8)));
}

describe('1. the month decision', () => {
  it('gives the prize to the most confirmed, ordering businesses, not counting last month or a business with no order', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const bola = await ambassador('Bola Adeyemi');
    // Ada: three businesses confirmed in November, each with an order; a fourth confirmed in
    // October with orders in November, which does not count; a fifth confirmed with no order.
    const first = await confirmedShop(ada, november(3));
    await overTheBar(first.id);
    for (const day of [9, 20])
      await order((await confirmedShop(ada, november(day))).id, november(day + 1));
    await order((await confirmedShop(ada, new Date('2026-10-20T10:00:00.000Z'))).id, november(5));
    await confirmedShop(ada, november(25));
    // Bola: two.
    for (const day of [1, 2])
      await order((await confirmedShop(bola, november(day))).id, november(day + 2));

    const takings = await monthTakings(harness.app.ctx, '2026-11');
    expect(takings.standings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ambassadorId: ada.id, confirmedAt: expect.any(Array) }),
        expect.objectContaining({ ambassadorId: bola.id }),
      ]),
    );
    expect(takings.standings.find((row) => row.ambassadorId === ada.id)?.confirmedAt).toHaveLength(
      3,
    );
    expect(takings.standings.find((row) => row.ambassadorId === bola.id)?.confirmedAt).toHaveLength(
      2,
    );
    expect(takings.netPence).toBeGreaterThanOrEqual(harness.config.ambassador.monthlyPrizeBarPence);

    harness.setNow(DECEMBER);
    const decided = await decideMonth(harness.app.ctx, '2026-11');
    expect(decided).toEqual(
      expect.objectContaining({
        month: '2026-11',
        winnerKind: 'shopper',
        winnerId: ada.id,
        qualifyingBusinesses: 3,
        barMet: true,
        decidedAt: DECEMBER,
      }),
    );
  });

  it('breaks a tie by who got there first, and needs at least two businesses', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const bola = await ambassador('Bola Adeyemi');
    const chidi = await ambassador('Chidi Eze');
    // Ada's second business confirmed on the 20th, Bola's on the 9th: Bola reached two first.
    const adaFirst = await confirmedShop(ada, november(1));
    await overTheBar(adaFirst.id);
    await order((await confirmedShop(ada, november(20))).id, november(21));
    for (const day of [2, 9])
      await order((await confirmedShop(bola, november(day))).id, november(day + 1));
    // Chidi: one business only, with many orders: never enough.
    const chidiShop = await confirmedShop(chidi, november(1));
    for (let n = 0; n < 5; n += 1) await order(chidiShop.id, november(2 + n));

    harness.setNow(DECEMBER);
    const decided = await decideMonth(harness.app.ctx, '2026-11');
    expect(decided?.winnerId).toBe(bola.id);
    expect(decided?.qualifyingBusinesses).toBe(2);
    expect(decided?.barMet).toBe(true);
  });

  it('records nobody when no Ambassador has two businesses, even over the bar, and pays nothing', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    await overTheBar((await confirmedShop(ada, november(1))).id);
    harness.setNow(DECEMBER);
    const decided = await decideMonth(harness.app.ctx, '2026-11');
    expect(decided).toEqual(
      expect.objectContaining({ winnerId: null, qualifyingBusinesses: 0, barMet: true }),
    );
    expect(await harness.repository.ambassadors.findByReference('prize:2026-11')).toBeNull();
    expect((await prizePanel(harness.app.ctx, 'shopper', ada.id)).lastMonthWords).toBe(
      'No prize last month, as nobody brought in enough businesses.',
    );
  });

  it('decides nothing for a month before the prize began, or after it ends', async () => {
    await build();
    expect(await decideMonth(harness.app.ctx, '2026-10')).toBeNull();
    expect(await decideMonth(harness.app.ctx, '2027-12')).toBeNull();
  });
});

describe('2. the bar: never paid before Ozi has been paid', () => {
  it('keeps the decision but pays no prize when the month is below the bar, and says so plainly', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const bola = await ambassador('Bola Adeyemi');
    for (const day of [3, 9])
      await order((await confirmedShop(ada, november(day))).id, november(day + 1));
    const takings = await monthTakings(harness.app.ctx, '2026-11');
    expect(takings.netPence).toBe(2 * NET_PER_ORDER);
    expect(takings.netPence).toBeLessThan(harness.config.ambassador.monthlyPrizeBarPence);

    harness.setNow(DECEMBER);
    const decided = await decideMonth(harness.app.ctx, '2026-11');
    expect(decided).toEqual(
      expect.objectContaining({
        winnerId: ada.id,
        qualifyingBusinesses: 2,
        barMet: false,
        netPence: 2 * NET_PER_ORDER,
      }),
    );
    expect(await harness.repository.ambassadors.findByReference('prize:2026-11')).toBeNull();
    const summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    expect(summary.pendingPence).toBe(2 * 6);
    // Both dashboards say why, and never a figure.
    for (const who of [ada, bola]) {
      const panel = await prizePanel(harness.app.ctx, 'shopper', who.id);
      expect(panel.lastMonthWords).toBe('No prize last month, as not enough orders came in.');
      expect(JSON.stringify(panel)).not.toMatch(/\d+\.\d\d|£1[0-9][0-9]/);
    }
  });

  it('works the net from the order as it finally stands: a refunded order counts for nothing', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const shop = await confirmedShop(ada, november(3));
    const kept = await order(shop.id, november(4));
    const refunded = await order(shop.id, november(5));
    await harness.repository.orders.update(refunded.id, { status: 'refunded' });
    const takings = await monthTakings(harness.app.ctx, '2026-11');
    // Ozi's share of the fee, the item charges, less the processor and the share, on one order.
    expect(takings.netPence).toBe(NET_PER_ORDER);
    expect(kept.status).toBe('delivered');
    // A part refund comes off the net.
    await harness.repository.orders.update(kept.id, { goodwillRefundedPence: 300 });
    expect((await monthTakings(harness.app.ctx, '2026-11')).netPence).toBe(NET_PER_ORDER - 300);
  });
});

describe('3. the sweep, and the hold', () => {
  it('decides each month once on the hourly timer, credits the prize under the 30-day hold, and does nothing again', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const first = await confirmedShop(ada, november(3));
    await overTheBar(first.id);
    await order((await confirmedShop(ada, november(9))).id, november(10));

    // Still November: nothing to decide.
    expect(await sweepAmbassadorPrizes(harness.app.ctx)).toEqual({ decided: 0, bonuses: 1 });
    expect(await harness.repository.ambassadorPrizes.list()).toEqual([]);

    harness.setNow(DECEMBER);
    expect((await sweepAmbassadorPrizes(harness.app.ctx)).decided).toBe(1);
    const prize = await harness.repository.ambassadors.findByReference('prize:2026-11');
    expect(prize).toEqual(
      expect.objectContaining({
        kind: 'prize',
        ambassadorId: ada.id,
        amountPence: 2500,
        at: DECEMBER,
        availableAt: new Date(DECEMBER.getTime() + 30 * DAY),
      }),
    );
    // Pending, not available, so it cannot be withdrawn yet.
    let summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    expect(summary.pendingPence).toBeGreaterThanOrEqual(2500);
    expect(summary.availablePence).toBe(0);

    // Running again, the same hour or a day later, changes nothing.
    expect(await sweepAmbassadorPrizes(harness.app.ctx)).toEqual({ decided: 0, bonuses: 0 });
    harness.setNow(new Date(DECEMBER.getTime() + DAY));
    expect(await sweepAmbassadorPrizes(harness.app.ctx)).toEqual({ decided: 0, bonuses: 0 });
    expect(await harness.repository.ambassadorPrizes.list()).toHaveLength(1);
    expect(
      (await harness.repository.ambassadors.listFor('shopper', ada.id)).filter(
        (entry) => entry.kind === 'prize',
      ),
    ).toHaveLength(1);

    // Thirty days on, it is available.
    harness.setNow(new Date(DECEMBER.getTime() + 31 * DAY));
    summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    expect(summary.availablePence).toBeGreaterThanOrEqual(2500);
  });

  it('on the 1st, every Ambassador sees the winner by first name only', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const bola = await ambassador('Bola Adeyemi');
    const first = await confirmedShop(ada, november(3));
    await overTheBar(first.id);
    await order((await confirmedShop(ada, november(9))).id, november(10));
    harness.setNow(DECEMBER);
    await sweepAmbassadorPrizes(harness.app.ctx);
    const seen = (await get('/referrals/me', bola.authHeader)).json().ambassador.prize;
    expect(seen).toEqual({
      runs: true,
      standingWords: 'You have 0 confirmed, ordering businesses this month.',
      barWords: 'Not enough orders yet this month for the prize.',
      lastMonthWords: "Last month's Top Ambassador: Ada, who won £25.",
      firstBusinessWords:
        'When your first confirmed business completes 4 orders, you earn a £10 one-off bonus.',
    });
    expect(JSON.stringify(seen)).not.toContain('Obi');
  });
});

describe('4. the first-business bonus', () => {
  it('is credited at the 4th paid order, held from that delivery, once in a life', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const shop = await confirmedShop(ada, november(3));
    for (const day of [4, 5, 6]) await order(shop.id, november(day));
    let words = (await get('/referrals/me', ada.authHeader)).json().ambassador.prize
      .firstBusinessWords;
    expect(words).toBe(
      'Your first business has completed 3 of 4 orders. At 4, you earn a £10 one-off bonus.',
    );
    expect(
      await harness.repository.ambassadors.findByReference(
        `first-business-bonus:shopper:${ada.id}`,
      ),
    ).toBeNull();

    await order(shop.id, november(7));
    const summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    const bonus = await harness.repository.ambassadors.findByReference(
      `first-business-bonus:shopper:${ada.id}`,
    );
    expect(bonus).toEqual(
      expect.objectContaining({
        kind: 'first-business-bonus',
        partnerShopId: shop.id,
        amountPence: 1000,
        at: november(7),
        availableAt: new Date(november(7).getTime() + 30 * DAY),
      }),
    );
    expect(summary.pendingPence).toBe(4 * 6 + 1000);
    words = (await get('/referrals/me', ada.authHeader)).json().ambassador.prize.firstBusinessWords;
    expect(words).toBe(
      'You earned your £10 one-off bonus when your first business completed 4 orders.',
    );

    // A second business, however many orders, earns no second bonus.
    const second = await confirmedShop(ada, november(10));
    for (const day of [11, 12, 13, 14, 15]) await order(second.id, november(day));
    await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    expect(
      (await harness.repository.ambassadors.listFor('shopper', ada.id)).filter(
        (entry) => entry.kind === 'first-business-bonus',
      ),
    ).toHaveLength(1);
  });

  it('is postponed by a refund that takes the count back below 4, and comes with the next order', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const shop = await confirmedShop(ada, november(3));
    const orders = [];
    for (const day of [4, 5, 6]) orders.push(await order(shop.id, november(day)));
    // The second order is refunded whole before the fourth is delivered.
    await harness.repository.orders.update(orders[1]!.id, { status: 'refunded' });
    await order(shop.id, november(7));
    let state = await firstBusinessState(harness.app.ctx, 'shopper', ada.id);
    expect(state.paidOrders).toBe(3);
    expect(await ambassadorSummary(harness.app.ctx, 'shopper', ada.id)).toEqual(
      expect.objectContaining({ pendingPence: 3 * 6 }),
    );
    expect(
      await harness.repository.ambassadors.findByReference(
        `first-business-bonus:shopper:${ada.id}`,
      ),
    ).toBeNull();

    await order(shop.id, november(8));
    await ambassadorSummary(harness.app.ctx, 'shopper', ada.id);
    state = await firstBusinessState(harness.app.ctx, 'shopper', ada.id);
    expect(state.paidOrders).toBe(4);
    expect(state.credited).toEqual(expect.objectContaining({ amountPence: 1000, at: november(8) }));
  });

  it('counts the first confirmed business, not the first tied, and nothing for somebody removed', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const later = await confirmedShop(ada, november(10));
    const first = await confirmedShop(ada, november(3));
    for (const day of [11, 12, 13, 14]) await order(later.id, november(day));
    const state = await firstBusinessState(harness.app.ctx, 'shopper', ada.id);
    expect(state.shop?.id).toBe(first.id);
    expect(state.paidOrders).toBe(0);
    expect(await ambassadorSummary(harness.app.ctx, 'shopper', ada.id)).toEqual(
      expect.objectContaining({ pendingPence: 4 * 6 }),
    );

    const agreement = (await harness.repository.ambassadors.findAgreement('shopper', ada.id))!;
    await harness.repository.ambassadors.updateAgreement(agreement.id, { status: 'removed' });
    for (const day of [4, 5, 6, 7]) await order(first.id, november(day));
    await sweepAmbassadorPrizes(harness.app.ctx);
    expect(
      await harness.repository.ambassadors.findByReference(
        `first-business-bonus:shopper:${ada.id}`,
      ),
    ).toBeNull();
  });
});

describe('5. the dashboard words this month', () => {
  it('say the live standing and whether the bar is met yet, with nobody else’s numbers', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const bola = await ambassador('Bola Adeyemi');
    const shop = await confirmedShop(ada, november(1));
    await order(shop.id, november(2));
    let panel = (await get('/referrals/me', ada.authHeader)).json().ambassador.prize;
    expect(panel).toEqual({
      runs: true,
      standingWords: 'You have 1 confirmed, ordering business this month.',
      barWords: 'Not enough orders yet this month for the prize.',
      lastMonthWords: 'The Top Ambassador prize began in November 2026.',
      firstBusinessWords:
        'Your first business has completed 1 of 4 orders. At 4, you earn a £10 one-off bonus.',
    });
    await overTheBar(shop.id);
    panel = (await get('/referrals/me', bola.authHeader)).json().ambassador.prize;
    expect(panel.standingWords).toBe('You have 0 confirmed, ordering businesses this month.');
    expect(panel.barWords).toBe('The £25 prize is on this month.');
    // Bola's dashboard carries no count of Ada's and no company figure.
    expect(JSON.stringify(panel)).not.toMatch(/£1\d\d|\b1 confirmed/);
  });

  it('says the prize runs from November 2026 in a month before it, and nothing before they apply', async () => {
    await build(new Date('2026-10-15T10:00:00.000Z'));
    const ada = await ambassador('Ada Obi');
    const panel = (await get('/referrals/me', ada.authHeader)).json().ambassador.prize;
    expect(panel.runs).toBe(false);
    expect(panel.standingWords).toBe(
      'The Top Ambassador prize runs from November 2026 to November 2027.',
    );
    const nobody = await signUpShopper(harness, { displayName: 'Nobody', phone: '+447700900999' });
    expect((await get('/referrals/me', nobody.authHeader)).json().ambassador.prize).toBeNull();
  });
});

describe('6. the terms version bump', () => {
  it('asks an Ambassador on the 31 October terms to agree again before withdrawing, and refuses the old version', async () => {
    await build();
    expect(AMBASSADOR_TERMS_VERSION).toBe('2026-11-02');
    const ada = await ambassador('Ada Obi', '2026-10-31a');
    const me = (await get('/referrals/me', ada.authHeader)).json().ambassador;
    expect(me.termsChanged).toBe(true);
    expect(me.termsChangedWords).toBe(TERMS_CHANGED_WORDS);
    expect(me.termsVersion).toBe('2026-11-02');
    expect(me.canWithdraw).toBe(false);
    const withdraw = await post('/ambassador/withdraw', {}, ada.authHeader);
    expect(withdraw.statusCode).toBe(409);
    expect(withdraw.json().error.message).toBe(TERMS_CHANGED_WORDS);
    // An old page cannot agree to the old version by accident.
    const stale = await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: '2026-10-31a' },
      ada.authHeader,
    );
    expect(stale.statusCode).toBe(400);
    // Agreeing to the new version clears it.
    const agreed = await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      ada.authHeader,
    );
    expect(agreed.statusCode, agreed.body).toBe(200);
    expect((await get('/referrals/me', ada.authHeader)).json().ambassador.termsChanged).toBe(false);
  });
});

describe('7. the owner', () => {
  async function ownerSignedIn(): Promise<Record<string, string>> {
    await post(
      '/staff/owner',
      { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
      STAFF,
    );
    const signedIn = await post(
      '/staff/sign-in',
      { username: 'anthony', password: 'a long password', passcode: '123456#', remember: true },
      { 'cf-ipcountry': 'GB' },
    );
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    return { 'x-staff-token': signedIn.json().token as string };
  }

  it('sees every decision and bonus; the staff key does not', async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const first = await confirmedShop(ada, november(3));
    await overTheBar(first.id);
    await order((await confirmedShop(ada, november(9))).id, november(10));
    harness.setNow(DECEMBER);
    await sweepAmbassadorPrizes(harness.app.ctx);

    expect((await get('/staff/ambassadors/prizes', STAFF)).statusCode).toBe(403);
    const owner = await ownerSignedIn();
    const seen = await get('/staff/ambassadors/prizes', owner);
    expect(seen.statusCode, seen.body).toBe(200);
    expect(seen.json()).toEqual(
      expect.objectContaining({
        prizePence: 2500,
        barPence: 12500,
        prizes: [
          expect.objectContaining({
            month: '2026-11',
            monthWords: 'November 2026',
            winnerName: 'Ada Obi',
            qualifyingBusinesses: 2,
            barMet: true,
            prizePence: 2500,
          }),
        ],
        firstBusinessBonuses: [
          expect.objectContaining({
            ambassadorName: 'Ada Obi',
            business: first.name,
            amountPence: 1000,
          }),
        ],
      }),
    );
    expect(seen.json().prizes[0].netPence).toBeGreaterThanOrEqual(12500);
  });

  it("answers Ozi's ambassador_prizes tool with the winner by name and the outcome", async () => {
    await build();
    const ada = await ambassador('Ada Obi');
    const first = await confirmedShop(ada, november(3));
    await overTheBar(first.id);
    await order((await confirmedShop(ada, november(9))).id, november(10));
    harness.setNow(DECEMBER);
    await sweepAmbassadorPrizes(harness.app.ctx);
    const answer = await ambassadorPrizesForVoice(harness.app.ctx);
    expect(answer.lastMonth).toBe('November 2026');
    expect(answer.prizes).toEqual([
      expect.objectContaining({
        month: 'November 2026',
        winner: 'Ada Obi',
        qualifyingBusinesses: 2,
        barMet: true,
        prizePaid: '£25',
        outcome: 'Ada Obi won £25.',
      }),
    ]);
    expect(answer.firstBusinessBonuses).toEqual([
      expect.objectContaining({ ambassador: 'Ada Obi', amount: '£10.00' }),
    ]);
    expect(answer.rules).toContain('at least £125');
  });
});
