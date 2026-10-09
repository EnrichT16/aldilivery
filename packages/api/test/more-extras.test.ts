/**
 * Ozi Plus and the family plan, Ozi Finds It, gift cards and organisation enquiries
 * (7 October 2026). Every price agreed first; nothing renews by itself; the delivery fee never
 * changes (Rule Four).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normaliseGiftCode } from '../src/routes/extras.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpShopper,
  STAFF,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function post(url: string, payload: object, who: SignedInShopper = shopper) {
  return harness.app.inject({ method: 'POST', url, headers: who.authHeader, payload });
}

function charges() {
  return harness.payments.calls.filter((call) => call.kind === 'saved_card_charge');
}

function refunds() {
  return harness.payments.calls.filter((call) => call.kind === 'refund');
}

describe('Ozi Plus', () => {
  it('needs the price agreed, then gives thirty days, Recipes included, never renewing', async () => {
    const refused = await post('/extras/plus', { plan: 'single' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/agree to the price first: £7\.99/);
    expect(charges()).toEqual([]);

    const bought = await post('/extras/plus', { plan: 'single', priceAccepted: true });
    expect(bought.statusCode, bought.body).toBe(200);
    expect(bought.json().message).toMatch(
      /^Ozi Plus is on until Friday 6 November\. £7\.99 was taken from your card ending 4242\. It does not renew by itself\.$/,
    );
    expect(charges()).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 799 }) }),
    ]);
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    expect(me.json().shopper.recipePassUntil).toBe(me.json().shopper.plusUntil);
  });

  it('a family plan gives a code, and up to four people share it', async () => {
    const bought = await post('/extras/plus', { plan: 'family', priceAccepted: true });
    expect(bought.statusCode, bought.body).toBe(200);
    expect(charges()[0]?.input).toEqual(expect.objectContaining({ amountPence: 1199 }));
    const code = bought.json().familyCode as string;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(bought.json().message).toContain(`give them your family code: ${code}`);

    const others = [];
    for (const [index, name] of ['Tunde', 'Ngozi', 'Ada', 'Emeka'].entries()) {
      others.push(
        await signUpShopper(harness, { displayName: name, phone: `+44770090010${index}` }),
      );
    }
    for (const other of others.slice(0, 3)) {
      const joined = await post('/extras/family/join', { code: code.toLowerCase() }, other);
      expect(joined.statusCode, joined.body).toBe(200);
      expect(joined.json().message).toMatch(/^You've joined Margaret's family plan/);
    }
    const full = await post('/extras/family/join', { code }, others[3]!);
    expect(full.statusCode).toBe(409);
    expect(full.json().error.message).toMatch(/up to 4 people/);

    const state = await harness.app.inject({
      method: 'GET',
      url: '/extras/plus',
      headers: shopper.authHeader,
    });
    expect(state.json().members).toEqual(['Tunde', 'Ngozi', 'Ada']);

    // Buying again moves everybody's date on together.
    await post('/extras/plus', { plan: 'family', priceAccepted: true });
    const member = await harness.repository.shoppers.findById(others[0]!.shopperId);
    expect(member?.plusUntil?.toISOString().slice(0, 10)).toBe('2026-12-06');

    const left = await post('/extras/family/leave', {}, others[0]!);
    expect(left.json().active).toBe(false);
  });

  it('a wrong family code finds nothing', async () => {
    const response = await post('/extras/family/join', { code: 'ZZZZZZ' });
    expect(response.statusCode).toBe(404);
  });

  it('never changes the delivery fee (Rule Four)', async () => {
    const items = await seedCatalogue(harness.repository);
    await post('/extras/plus', { plan: 'single', priceAccepted: true });
    const price = await harness.app.inject({
      method: 'POST',
      url: '/basket/price',
      headers: shopper.authHeader,
      payload: { lines: [{ catalogueItemId: items.milk, quantity: 1 }] },
    });
    expect(price.json().feePence).toBe(harness.config.fees.standardDeliveryPence);
  });
});

describe('Ozi Finds It', () => {
  it('takes the agreed fee, and a person finds it: it goes in the catalogue to add to a basket', async () => {
    const refused = await post('/extras/find-it', { description: 'Welsh cakes' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/agree to the price first: £2\.00/);

    const asked = await post('/extras/find-it', {
      description: 'Welsh cakes',
      priceAccepted: true,
    });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json().message).toMatch(/in up to 3 shops/);
    expect(asked.json().message).toMatch(
      /£2\.00 was taken from your card ending 4242, and it comes back if it can't be found/,
    );

    const staffList = await harness.app.inject({
      method: 'GET',
      url: '/staff/find-it',
      headers: STAFF,
    });
    expect(staffList.json().requests).toHaveLength(1);
    expect(JSON.stringify(staffList.json())).not.toContain('+447700900001');

    const id = asked.json().request.id as string;
    const found = await harness.app.inject({
      method: 'POST',
      url: `/staff/find-it/${id}/decide`,
      headers: STAFF,
      payload: { found: true, name: 'Welsh cakes, 6 pack', shop: 'Market Bakery', pricePence: 250 },
    });
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().item).toEqual(
      expect.objectContaining({
        name: 'Welsh cakes, 6 pack (from Market Bakery)',
        estimatedPricePence: 250,
      }),
    );
    const mine = await harness.app.inject({
      method: 'GET',
      url: '/extras/find-it',
      headers: shopper.authHeader,
    });
    expect(mine.json().requests[0]).toEqual(
      expect.objectContaining({ status: 'found', foundShop: 'Market Bakery' }),
    );
  });

  it('gives the fee back when it cannot be found', async () => {
    const asked = await post('/extras/find-it', {
      description: 'A blue teapot',
      priceAccepted: true,
    });
    const id = asked.json().request.id as string;
    const decided = await harness.app.inject({
      method: 'POST',
      url: `/staff/find-it/${id}/decide`,
      headers: STAFF,
      payload: { found: false, note: 'None of the three shops had one.' },
    });
    expect(decided.json().request.status).toBe('not_found');
    expect(refunds()).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 200 }) }),
    ]);
  });

  it('is included in Ozi Plus, and never looks for things we never bring', async () => {
    await post('/extras/plus', { plan: 'single', priceAccepted: true });
    const covered = await post('/extras/find-it', { description: 'Welsh cakes' });
    expect(covered.statusCode).toBe(201);
    expect(covered.json().message).toMatch(/included in your Ozi Plus/);
    expect(charges()).toHaveLength(1);

    const never = await post('/extras/find-it', { description: 'a bottle of gin' });
    expect(never.statusCode).toBe(400);
    expect(never.json().error.message).toMatch(/never brings alcohol/);
  });

  it('is only for staff to decide', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/staff/find-it' });
    expect(response.statusCode).toBe(403);
  });
});

describe('gift cards', () => {
  it('reads codes however they are typed', () => {
    expect(normaliseGiftCode('abcd efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
  });

  it('buys one for an agreed amount, and it is used once, as credit given back after an order', async () => {
    const odd = await post('/extras/gift-cards', { amountPence: 1234, priceAccepted: true });
    expect(odd.statusCode).toBe(400);

    const bought = await post('/extras/gift-cards', {
      amountPence: 2000,
      recipientName: 'Mum',
      message: 'Happy birthday',
      priceAccepted: true,
    });
    expect(bought.statusCode, bought.body).toBe(201);
    const code = bought.json().giftCard.code as string;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(charges()[0]?.input).toEqual(expect.objectContaining({ amountPence: 2000 }));

    const mum = await signUpShopper(harness, { displayName: 'Mum', phone: '+447700900200' });
    const redeemed = await post('/extras/gift-cards/redeem', { code: code.toLowerCase() }, mum);
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect(redeemed.json().creditPence).toBe(2000);
    const twice = await post('/extras/gift-cards/redeem', { code }, mum);
    expect(twice.statusCode).toBe(409);

    // Her next order: the card pays as agreed, then the credit goes straight back to it.
    const items = await seedCatalogue(harness.repository);
    const order = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        paymentMethodId: mum.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 1350,
        },
      },
      mum,
    );
    expect(order.statusCode, order.body).toBe(201);
    expect(order.json().message).toMatch(
      /£16\.00\. £16\.00 of gift card money is going straight back to your card\./,
    );
    expect(refunds()).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 1600 }) }),
    ]);
    const after = await harness.repository.shoppers.findById(mum.shopperId);
    expect(after?.creditPence).toBe(400);
  });
});

describe('organisations', () => {
  it('can ask to work with us, and staff see it', async () => {
    const sent = await harness.app.inject({
      method: 'POST',
      url: '/organisations/enquiries',
      payload: {
        organisation: 'Medway Sight Support',
        contactName: 'Jo',
        telephone: '01634 000000',
        people: 'About 40',
      },
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().message).toMatch(/will ring you within two working days/);
    const list = await harness.app.inject({
      method: 'GET',
      url: '/staff/enquiries',
      headers: STAFF,
    });
    const [row] = list.json().enquiries;
    expect(row).toEqual(
      expect.objectContaining({ organisation: 'Medway Sight Support', handled: false }),
    );
    const handled = await harness.app.inject({
      method: 'POST',
      url: `/staff/enquiries/${row.id}/handled`,
      headers: STAFF,
    });
    expect(handled.json().enquiry.handled).toBe(true);
  });
});
