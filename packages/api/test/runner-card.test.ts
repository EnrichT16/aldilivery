/**
 * The Runner spending card (Anthony, 9 October 2026): Runners pay at the till with a card from
 * Stripe Issuing, loaded for each order, or with their own card and are paid back (ruling 55).
 *
 * Proved here with the rehearsal gateway, so no Stripe account is needed: the card is made
 * frozen, loaded for an order with the estimate plus the margin and never over £60, every till
 * payment is approved only for the order in hand, the till total is what the card paid, the
 * card is frozen again afterwards, nothing is paid back for a card order, and the Runner's £5 is
 * untouched. With the switch off, nothing changes from ruling 55.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { splitName, STRIPE_API_VERSION } from '../src/lib/payments.js';
import {
  cardLimitFor,
  cardTill,
  decideAuthorization,
  sweepCards,
} from '../src/services/runner-card.js';
import {
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  STAFF,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let started = false;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let texts: Array<{ to: string; body: string }>;
let milk: string;

async function start(issuing: boolean): Promise<void> {
  texts = [];
  harness = await buildTestApp(new Date('2026-10-09T10:00:00.000Z'), {
    autoOffer: true,
    autoPayout: true,
    env: { ownerAlertPhone: '+447700900999', stripeIssuingEnabled: issuing },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  started = true;
  milk = (await seedCatalogue(harness.repository)).milk;
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
}

afterEach(async () => {
  if (started) await harness.close();
  started = false;
});

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

const ADDRESS = { line1: '3 Runner Row', city: 'Gillingham', postcode: 'me7 2bb' };

async function setUpCard() {
  const made = await post(
    '/runners/me/card',
    { acceptTerms: true, address: ADDRESS },
    { ...runner.authHeader, 'user-agent': 'TestPhone/1.0' },
  );
  expect(made.statusCode, made.body).toBe(200);
  return made.json();
}

/** Two pints of milk, £2.50 of shopping, accepted. Returns the order and what accepting said. */
interface Accepted {
  till: { payMethodUsed: 'card' | 'own'; cardLimitPence: number | null; message: string };
}

async function orderAccepted(): Promise<{ orderId: string; accepted: Accepted }> {
  const placed = await post(
    '/orders',
    {
      lines: [{ catalogueItemId: milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Gillingham ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 799,
      },
    },
    shopper.authHeader,
  );
  expect(placed.statusCode, placed.body).toBe(201);
  const orderId = placed.json().order.id as string;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  const accepted = await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader);
  expect(accepted.statusCode, accepted.body).toBe(200);
  return { orderId, accepted: accepted.json<Accepted>() };
}

async function shopping(orderId: string) {
  await post(`/orders/${orderId}/status`, { status: 'shopping' }, runner.authHeader);
}

function webhook(type: string, object: object) {
  return harness.app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'rehearsal' },
    payload: JSON.stringify({ id: `evt_${type}_${Math.random()}`, type, data: { object } }),
  });
}

async function cardId(): Promise<string> {
  return (await harness.repository.runners.findById(runner.runnerId))!.issuingCardId!;
}

async function askAtTill(
  stripeId: string,
  amount: number,
  category = 'grocery_stores_supermarkets',
  card?: string,
) {
  return webhook('issuing_authorization.request', {
    id: stripeId,
    amount: 0,
    currency: 'gbp',
    card: { id: card ?? (await cardId()) },
    merchant_data: { name: 'The Corner Supermarket', category },
    pending_request: { amount, currency: 'gbp' },
  });
}

/** The tap at the till, approved, and the money captured, as Stripe would tell us. */
async function payAtTill(amount: number) {
  const asked = await askAtTill('iauth_1', amount);
  expect(asked.json()).toEqual({ approved: true });
  const card = await cardId();
  await webhook('issuing_authorization.created', {
    id: 'iauth_1',
    amount,
    currency: 'gbp',
    approved: true,
    status: 'pending',
    card: { id: card },
    merchant_data: { name: 'The Corner Supermarket', category: 'grocery_stores_supermarkets' },
  });
  await webhook('issuing_transaction.created', {
    id: 'ipi_1',
    amount: -amount,
    type: 'capture',
    card,
    authorization: 'iauth_1',
    merchant_data: { name: 'The Corner Supermarket' },
  });
}

const payBacks = () =>
  harness.payments.calls.filter(
    (call) =>
      call.kind === 'transfer' &&
      String((call.input as { idempotencyKey?: string }).idempotencyKey ?? '').startsWith(
        'reimburse:',
      ),
  );

describe('the rules, without a server', () => {
  it('loads the estimate plus the larger of £5 or a fifth, never more than £60', () => {
    expect(cardLimitFor(250, 6000)).toBe(750);
    expect(cardLimitFor(4000, 6000)).toBe(4800);
    expect(cardLimitFor(5800, 6000)).toBe(6000);
  });

  it('approves only an order being shopped, in pounds, at a grocery shop, within the load', () => {
    const base = {
      enabled: true,
      runner: { id: 'r1', leftAt: null },
      order: {
        runnerId: 'r1',
        status: 'shopping' as const,
        payMethodUsed: 'card' as const,
        cardLimitPence: 750,
      },
      amountPence: 500,
      currency: 'gbp',
      category: 'grocery_stores_supermarkets',
      approvedSoFarPence: 0,
    };
    expect(decideAuthorization(base)).toEqual({
      approved: true,
      reason: 'Within what is loaded for this order.',
    });
    expect(decideAuthorization({ ...base, enabled: false }).approved).toBe(false);
    expect(decideAuthorization({ ...base, runner: null }).approved).toBe(false);
    expect(decideAuthorization({ ...base, order: null }).reason).toBe(
      'No order being shopped is loaded on this card.',
    );
    expect(
      decideAuthorization({ ...base, order: { ...base.order, status: 'receipt_submitted' } })
        .approved,
    ).toBe(false);
    expect(
      decideAuthorization({ ...base, order: { ...base.order, runnerId: 'someone-else' } }).approved,
    ).toBe(false);
    expect(decideAuthorization({ ...base, currency: 'eur' }).approved).toBe(false);
    expect(decideAuthorization({ ...base, category: 'betting_casino_gambling' }).reason).toBe(
      'Not a grocery shop (betting_casino_gambling).',
    );
    expect(decideAuthorization({ ...base, amountPence: 751 }).reason).toBe(
      'Over what is loaded for this order.',
    );
    // What the card already spent on this order counts.
    expect(
      decideAuthorization({ ...base, approvedSoFarPence: 300, amountPence: 451 }).approved,
    ).toBe(false);
    expect(
      decideAuthorization({ ...base, approvedSoFarPence: 300, amountPence: 450 }).approved,
    ).toBe(true);
  });

  it('takes the till total from the card, when the receipt matches within a few pence', () => {
    expect(cardTill({ cardSpentPence: 240 }, 243, '£')).toEqual({ tillPence: 240, mismatch: null });
    expect(cardTill({ cardSpentPence: 240 }, 300, '£')).toEqual({
      tillPence: 240,
      mismatch: 'the receipt says £3.00 but the card paid £2.40',
    });
    expect(cardTill({ cardSpentPence: null }, 300, '£').mismatch).toBe(
      'no card payment was found for this order yet',
    );
  });

  it('gives Stripe a first and last name without numbers', () => {
    expect(splitName('Mary Jane Okafor')).toEqual({ first: 'Mary Jane', last: 'Okafor' });
    expect(splitName('Tomasz')).toEqual({ first: 'Tomasz', last: 'Tomasz' });
    expect(splitName('R2 D2')).toEqual({ first: 'R', last: 'D' });
  });
});

describe('with the card switched off', () => {
  beforeEach(async () => {
    await start(false);
  });

  it('offers the Runner their own card only, and says the card is coming soon', async () => {
    const view = (await get('/runners/me/card', runner.authHeader)).json();
    expect(view).toMatchObject({ enabled: false, payMethod: 'own', card: null });
    const made = await post(
      '/runners/me/card',
      { acceptTerms: true, address: ADDRESS },
      runner.authHeader,
    );
    expect(made.statusCode).toBe(409);
    expect(made.json().error.message).toContain('coming soon');
    expect(
      (await post('/runners/me/pay-method', { method: 'card' }, runner.authHeader)).statusCode,
    ).toBe(409);
    expect(harness.payments.calls.some((call) => call.kind === 'cardholder')).toBe(false);
  });

  it('leaves paying back exactly as ruling 55 has it', async () => {
    const { orderId, accepted } = await orderAccepted();
    expect(accepted.till.payMethodUsed).toBe('own');
    await shopping(orderId);
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 240 },
      runner.authHeader,
    );
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 240 });
    expect(payBacks()).toHaveLength(1);
  });

  it('declines any till payment', async () => {
    const asked = await askAtTill('iauth_x', 100, 'grocery_stores_supermarkets', 'ic_unknown');
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({ approved: false });
  });
});

describe('with the card switched on', () => {
  beforeEach(async () => {
    await start(true);
  });

  it('makes a frozen card after the cardholder terms, recording when and from where', async () => {
    const made = await setUpCard();
    expect(made).toMatchObject({
      enabled: true,
      payMethod: 'card',
      termsAccepted: true,
      card: { status: 'inactive', last4: expect.stringMatching(/^\d{4}$/) },
    });
    const cardholder = harness.payments.calls.find((call) => call.kind === 'cardholder')!;
    expect(cardholder.input).toMatchObject({
      runnerId: runner.runnerId,
      name: 'Tomasz',
      phone: '+447700900101',
      billing: { line1: '3 Runner Row', city: 'Gillingham', postalCode: 'ME7 2BB', country: 'GB' },
      termsAcceptedAt: harness.now(),
      termsAcceptedIp: expect.any(String),
      userAgent: 'TestPhone/1.0',
    });
    const saved = (await harness.repository.runners.findById(runner.runnerId))!;
    expect(saved.issuingTermsAcceptedAt).toEqual(harness.now());
    expect(saved.issuingTermsAcceptedIp).toBeTruthy();
    // The address went to Stripe only: nothing on the Runner record can hold it.
    expect(Object.keys(saved)).not.toContain('billingAddress');
    // A second time gives the same card, not another.
    await setUpCard();
    expect(harness.payments.calls.filter((call) => call.kind === 'issuing_card')).toHaveLength(1);
  });

  it('refuses without the terms accepted', async () => {
    const made = await post('/runners/me/card', { address: ADDRESS }, runner.authHeader);
    expect(made.statusCode).toBe(400);
  });

  it('gives a short-lived key for Stripe to show the card, never the number', async () => {
    await setUpCard();
    const key = await post('/runners/me/card/key', { nonce: 'nonce_abc' }, runner.authHeader);
    expect(key.statusCode, key.body).toBe(200);
    expect(key.json()).toEqual({
      cardId: await cardId(),
      secret: `ek_rehearsal_${await cardId()}`,
    });
    expect(JSON.stringify(key.json())).not.toMatch(/\d{12,}/);
  });

  it('loads the card for the order when a job is taken, and switches it on', async () => {
    await setUpCard();
    const { orderId, accepted } = await orderAccepted();
    expect(accepted.till).toEqual({
      payMethodUsed: 'card',
      cardLimitPence: 750,
      message:
        'Your Ozi card is loaded with up to £7.50 for this order. Tap your phone at the till.',
    });
    expect(harness.payments.issuingCards.get(await cardId())).toEqual({
      status: 'active',
      limitPence: 750,
    });
    const current = (await get('/jobs/current', runner.authHeader)).json().job;
    expect(current).toMatchObject({ orderId, payMethodUsed: 'card', cardLimitPence: 750 });
  });

  it('approves the till for the order in hand only, and answers as Stripe asks', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);

    const yes = await askAtTill('iauth_ok', 600);
    expect(yes.statusCode).toBe(200);
    expect(yes.headers['stripe-version']).toBe(STRIPE_API_VERSION);
    expect(yes.json()).toEqual({ approved: true });

    // The 600 already approved counts: 200 more would be over the 750 loaded.
    expect((await askAtTill('iauth_more', 200)).json()).toEqual({ approved: false });
    expect((await askAtTill('iauth_pub', 100, 'bars_taverns_nightclubs')).json()).toEqual({
      approved: false,
    });
    expect(
      (await askAtTill('iauth_other', 100, 'grocery_stores_supermarkets', 'ic_nobody')).json(),
    ).toEqual({
      approved: false,
    });

    const rows = await harness.repository.cardAuthorizations.listForOrder(orderId);
    expect(rows.map((row) => [row.stripeId, row.approved, row.reason])).toEqual([
      ['iauth_ok', true, 'Within what is loaded for this order.'],
      ['iauth_more', false, 'Over what is loaded for this order.'],
      ['iauth_pub', false, 'Not a grocery shop (bars_taverns_nightclubs).'],
    ]);
  });

  it('takes the till total from the card, pays nothing back, freezes the card, and still pays £5', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    await payAtTill(240);
    expect(await harness.repository.orders.findById(orderId)).toMatchObject({
      cardSpentPence: 240,
      cardMerchant: 'The Corner Supermarket',
    });

    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 241 },
      runner.authHeader,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().reimbursement).toBeNull();
    expect(sent.json().message).toContain('nothing to pay back');
    expect(sent.json().message).toContain('£5.00 for the delivery follows');
    // The Shopper is settled on what the card actually paid: 10p back of the £2.50 estimate.
    expect(sent.json().settled).toEqual({ kind: 'refunded', pence: 10 });
    expect(sent.json().order.receiptTotalPence).toBe(240);
    expect(payBacks()).toHaveLength(0);

    expect(harness.payments.issuingCards.get(await cardId())).toEqual({
      status: 'inactive',
      limitPence: 0,
    });
    expect((await harness.repository.runners.findById(runner.runnerId))?.cardStatus).toBe(
      'inactive',
    );
    // Frozen: a tap now is declined.
    expect((await askAtTill('iauth_late', 100)).json()).toEqual({ approved: false });

    await post(`/orders/${orderId}/status`, { status: 'delivering' }, runner.authHeader);
    const delivered = await post(
      `/orders/${orderId}/status`,
      { status: 'delivered' },
      runner.authHeader,
    );
    expect(delivered.json().payout.earnedPence).toBe(500);
    expect(delivered.json().notes[0]).toBe('You earned £5.00 for this delivery.');
  });

  it('sends a receipt that does not match the card to a person, and settles nothing', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    await payAtTill(240);
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 300 },
      runner.authHeader,
    );
    expect(sent.json().settled).toMatchObject({ kind: 'needs-person' });
    expect(sent.json().message).toContain('a person will check it');
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.tillStatus).toBe('needs_person');
    expect(order.tillReason).toBe('card: the receipt says £3.00 but the card paid £2.40');
    expect(harness.payments.calls.some((call) => call.kind === 'refund')).toBe(false);
    expect(texts.some((text) => text.to === '+447700900999' && text.body.includes(orderId))).toBe(
      true,
    );
    expect(payBacks()).toHaveLength(0);
  });

  it('falls back to the Runner’s own card, paid back, when the card cannot be loaded', async () => {
    await setUpCard();
    harness.payments.refuseNextCardLoad = true;
    const { orderId, accepted } = await orderAccepted();
    expect(accepted.till.payMethodUsed).toBe('own');
    expect(accepted.till.message).toContain('please pay with your own card');
    await shopping(orderId);
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 240 },
      runner.authHeader,
    );
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 240 });
  });

  it('pays back a Runner whose card was declined and who paid with their own', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    expect((await askAtTill('iauth_big', 5000)).json()).toEqual({ approved: false });
    const sent = await post(
      `/orders/${orderId}/receipt`,
      { receiptTotalPence: 240 },
      runner.authHeader,
    );
    expect(sent.json().reimbursement).toMatchObject({ kind: 'paid', pence: 240 });
    expect((await harness.repository.orders.findById(orderId))?.payMethodUsed).toBe('own');
    expect(harness.payments.issuingCards.get(await cardId())?.status).toBe('inactive');
  });

  it('counts an approved tap on the order straight away, before Stripe confirms it', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    await askAtTill('iauth_fast', 240);
    expect((await harness.repository.orders.findById(orderId))?.cardSpentPence).toBe(240);
  });

  it('pays with their own card, paid back, when they choose it', async () => {
    await setUpCard();
    const chose = await post('/runners/me/pay-method', { method: 'own' }, runner.authHeader);
    expect(chose.json()).toMatchObject({ payMethod: 'own', chosen: 'own' });
    const { accepted } = await orderAccepted();
    expect(accepted.till.payMethodUsed).toBe('own');
    expect(harness.payments.calls.some((call) => call.kind === 'card_load')).toBe(false);
  });

  it('freezes a card left switched on with no order in hand', async () => {
    await setUpCard();
    const id = await cardId();
    harness.payments.issuingCards.set(id, { status: 'active', limitPence: 750 });
    await harness.repository.runners.update(runner.runnerId, { cardStatus: 'active' });
    expect(await sweepCards(harness.app.ctx)).toBe(1);
    expect(harness.payments.issuingCards.get(id)?.status).toBe('inactive');
  });

  it('flags a till already in when the card later turns out to have paid something else', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    await askAtTill('iauth_1', 240);
    await webhook('issuing_authorization.created', {
      id: 'iauth_1',
      amount: 240,
      approved: true,
      status: 'pending',
      card: { id: await cardId() },
      merchant_data: { name: 'Shop', category: 'grocery_stores_supermarkets' },
    });
    await post(`/orders/${orderId}/receipt`, { receiptTotalPence: 240 }, runner.authHeader);
    expect((await harness.repository.orders.findById(orderId))?.tillStatus).not.toBe(
      'needs_person',
    );
    await webhook('issuing_transaction.created', {
      id: 'ipi_1',
      amount: -275,
      type: 'capture',
      card: await cardId(),
      authorization: 'iauth_1',
      merchant_data: { name: 'Shop' },
    });
    const order = (await harness.repository.orders.findById(orderId))!;
    expect(order.cardSpentPence).toBe(275);
    expect(order.tillStatus).toBe('needs_person');
  });

  it('records a decline Stripe made itself, with its reason', async () => {
    await setUpCard();
    await webhook('issuing_authorization.created', {
      id: 'iauth_frozen',
      amount: 900,
      approved: false,
      status: 'closed',
      card: { id: await cardId() },
      merchant_data: { name: 'Shop', category: 'grocery_stores_supermarkets' },
      request_history: [{ approved: false, reason: 'card_inactive' }],
    });
    expect(
      await harness.repository.cardAuthorizations.findByStripeId('iauth_frozen'),
    ).toMatchObject({ approved: false, reason: 'The card was frozen.', runnerId: runner.runnerId });
  });

  it('shows the owner each card, what each order spent, and the declines', async () => {
    await setUpCard();
    const { orderId } = await orderAccepted();
    await shopping(orderId);
    await payAtTill(240);
    await askAtTill('iauth_pub', 100, 'bars_taverns_nightclubs');
    await post(
      '/staff/owner',
      { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
      STAFF,
    );
    const token = (
      await post('/staff/sign-in', {
        username: 'anthony',
        password: 'a long password',
        passcode: '123456#',
      })
    ).json().token as string;
    const money = (await get('/staff/money', { 'x-staff-token': token })).json();
    expect(money.runnerCards.enabled).toBe(true);
    expect(money.runnerCards.cards).toEqual([
      expect.objectContaining({ name: 'Tomasz', status: 'active', last4: expect.any(String) }),
    ]);
    expect(money.runnerCards.orders).toEqual([
      expect.objectContaining({ orderId, loadedPence: 750, spentPence: 240 }),
    ]);
    expect(money.runnerCards.declines).toEqual([
      expect.objectContaining({ reason: 'Not a grocery shop (bars_taverns_nightclubs).' }),
    ]);
  });
});
