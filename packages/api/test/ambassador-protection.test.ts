/**
 * Protections against Ambassadors misusing the Ozi name (Anthony, 31 October 2026), each proved:
 *
 * 1. The payment warning, word for word from config, and the welcome text when a business joins.
 * 2. The public "Check an Ambassador" page, the printed QR codes that go through it, the report
 *    button, and the limit on lookups.
 * 3. The business confirms with its own code; nothing is earned until then; the first confirmed
 *    claim wins; no bank details through an Ambassador.
 * 4. Shares held, and staff told, when the Shopper matches the Ambassador or the owner; the "Check
 *    this business" links.
 * 5. "Were you promised anything that isn't in your agreement?", once, about a week in.
 */

import { AMBASSADOR_TERMS_VERSION, freeJoiningWords } from '@aldilivery/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import { creditAmbassadorShares, ambassadorSummary } from '../src/services/ambassadors.js';
import { sweepAmbassadorFollowUps } from '../src/services/ambassador-protection.js';
import { buildTestApp, signUpShopper, STAFF, type TestHarness } from './helpers.js';

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;

afterEach(async () => {
  await harness?.close();
});

const START = new Date('2026-11-12T11:00:00.000Z');

async function build() {
  texts = [];
  harness = await buildTestApp(START, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function approvedAmbassador(name = 'Ada Obi', phone = '+447700900500') {
  const shopper = await signUpShopper(harness, { displayName: name, phone });
  const handle = (await harness.repository.shoppers.findById(shopper.shopperId))!.handle;
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
  });
  return { ...shopper, handle, via: `shopper:${handle}`, agreementId: agreement.id };
}

let count = 0;

async function joinShop(details: Record<string, unknown> = {}) {
  count += 1;
  const joined = await post('/partner/join', {
    name: `Corner Shop ${count}`,
    kind: 'shop',
    address: '12 High Street, Gillingham',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    contactName: 'Bola',
    mobile: `07700 900 ${String(700 + count)}`,
    email: `shop${count}@example.com`,
    username: `cornershop${count}`,
    password: 'a-long-enough-password',
    termsAgreed: true,
    ...details,
  });
  expect(joined.statusCode, joined.body).toBe(201);
  return joined.json() as { shop: { id: string }; message: string; token: string };
}

const business = {
  name: 'Mama Put Kitchen',
  kind: 'food',
  address: '3 Canterbury Street, Gillingham',
  postcode: 'ME7 5TP',
  hours: 'Every day 11am to 10pm',
  contactName: 'Chika Eze',
  mobile: '07700 900 888',
  email: 'chika@example.com',
  username: 'mamaput',
  password: 'a-long-enough-password',
  termsAgreed: true,
  ownerAgrees: true,
  ownerName: 'Chika Eze',
  agreedMarkupPercent: 30,
  agreedDiscountPercent: 20,
};

async function signIn(username: string) {
  const signed = await post('/business/sign-in', { username, password: 'a-long-enough-password' });
  expect(signed.statusCode, signed.body).toBe(200);
  return { 'x-business-token': signed.json().token as string };
}

/** A delivered order of one thing from this shop, by a new Shopper unless one is given. */
async function deliveredOrder(
  shopId: string,
  options: { shopperId?: string; deliveryAddress?: string; paymentMethodId?: string } = {},
): Promise<Order> {
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
  count += 1;
  const shopperId =
    options.shopperId ??
    (
      await harness.repository.shoppers.create({
        displayName: 'Buyer',
        phone: `+4477009${String(70_000 + count).slice(-5)}`,
        handle: `buyer-${count}`,
      })
    ).id;
  const order = await harness.repository.orders.create({
    shopperId,
    status: 'delivered',
    goodsEstimatePence: 1200,
    feePence: 1099,
    totalEstimatePence: 2299,
    deliveryAddress: options.deliveryAddress ?? '40 Canterbury Street, Gillingham ME7 5UH',
    items: [{ catalogueItemId: item.id, name: item.name, quantity: 1, estimatedPricePence: 1200 }],
  });
  return (await harness.repository.orders.update(order.id, {
    deliveredAt: harness.now(),
    ...(options.paymentMethodId ? { paymentMethodId: options.paymentMethodId } : {}),
  })) as Order;
}

describe('1. joining is free, and the welcome text', () => {
  it('gives the warning word for word, with the names from config', async () => {
    await build();
    expect(freeJoiningWords(harness.config)).toBe(
      'Joining Ozi is always free. We never charge you to join. Paid extras are optional: Spotlight and Partner Plus. You only pay if you choose them. Never pay an Ambassador. All payments are made only inside the app.',
    );
  });

  it('texts a business that joins, at its own number, with the warning, its terms in brief and how to report', async () => {
    await build();
    const { shop } = await joinShop({ mobile: '07700 900 321' });
    const welcome = texts.find((text) => text.body.includes('Welcome'));
    expect(welcome?.to).toBe('+447700900321');
    expect(welcome?.body).toContain(freeJoiningWords(harness.config));
    expect(welcome?.body).toContain('Never pay an Ambassador.');
    expect(welcome?.body).toContain('Your terms in brief: your basic listing is free');
    expect(welcome?.body).toContain('Report an Ambassador');
    expect(
      (await harness.repository.partnerShops.findById(shop.id))?.welcomeTextSentAt,
    ).not.toBeNull();
  });

  it('shows the warning and the three lines on the partner dashboard, the prices from config', async () => {
    await build();
    await joinShop();
    const headers = await signIn(`cornershop${count}`);
    const view = (await get('/partner/ambassador', headers)).json();
    expect(view.freeJoiningWords).toBe(freeJoiningWords(harness.config));
    expect(view.costLines.joining).toBe('Joining: free.');
    expect(view.costLines.preferred).toContain(
      `a discount of ${harness.config.restaurants.preferredDiscountPercent}% or more`,
    );
    expect(view.costLines.preferred).toContain('free Partner Plus and a free Spotlight week');
    expect(view.costLines.extras).toBe(
      'Spotlight and Partner Plus: paid and optional (Spotlight £19.99 a month and Partner Plus £14.99 a month). You only pay if you choose them.',
    );
  });

  it('lets a business report an Ambassador from its dashboard, as a matter on the desk', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { shop } = await joinShop({ ambassador: ada.via });
    const headers = await signIn(`cornershop${count}`);
    const empty = await post('/partner/ambassador/report', { note: '' }, headers);
    expect(empty.statusCode).toBe(400);
    const sent = await post(
      '/partner/ambassador/report',
      { note: 'They asked me for twenty pounds to join.' },
      headers,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    const matters = (await harness.repository.ownerDesk.listUnsettled()).filter(
      (matter) => matter.kind === 'ambassador_report',
    );
    expect(matters).toHaveLength(1);
    expect(matters[0]?.summary).toContain(`its Ambassador, Ada Obi`);
    expect(matters[0]?.summary).toContain('twenty pounds');
    expect(matters[0]?.subjectId).toContain(shop.id);
  });
});

describe('2. Check an Ambassador', () => {
  it('shows an active Ambassador by their first name only, and every printed QR code goes through it', async () => {
    await build();
    const ada = await approvedAmbassador();
    const toolkit = (await get('/ambassador/toolkit', ada.authHeader)).json();
    expect(toolkit.checkCode).toMatch(/^[A-Z2-9]{6}$/);
    for (const link of Object.values(toolkit.printLinks as Record<string, string>)) {
      expect(link).toMatch(new RegExp(`/ambassador/check/${toolkit.checkCode}\\?next=%2F`));
    }
    expect(decodeURIComponent(toolkit.printLinks.business)).toContain(
      `/business/join?ambassador=shopper-${ada.handle}`,
    );

    const check = await get(`/ambassador/check/${toolkit.checkCode.toLowerCase()}`);
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json()).toEqual(
      expect.objectContaining({ known: true, active: true, firstName: 'Ada', hasPhoto: false }),
    );
    expect(check.json().approvedWords).toBe('12 November 2026');
    // Never the surname, the phone number or the email.
    expect(check.body).not.toContain('Obi');
    expect(check.body).not.toContain('07700');
    expect(check.body).not.toContain('+44');
  });

  it('shows "Not active" at once after a suspension, with a report that reaches the desk', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { checkCode } = (await get('/ambassador/toolkit', ada.authHeader)).json();
    const suspended = await post(
      `/staff/ambassador-applications/${ada.agreementId}/suspend`,
      { by: 'Anthony', reason: 'Asked a business for money.' },
      STAFF,
    );
    expect(suspended.statusCode, suspended.body).toBe(200);
    const check = (await get(`/ambassador/check/${checkCode}`)).json();
    expect(check.active).toBe(false);
    expect(check.words).toBe(
      "Not active. Please do not deal with this person on Ozi's behalf. Report it.",
    );
    const report = await post(`/ambassador/check/${checkCode}/report`, { note: 'At my shop now.' });
    expect(report.statusCode, report.body).toBe(200);
    const matter = (await harness.repository.ownerDesk.listUnsettled()).find(
      (row) => row.kind === 'ambassador_report',
    );
    expect(matter?.summary).toContain('Ada Obi');
    expect(matter?.summary).toContain('not active');
  });

  it('says it does not know a code, and limits lookups from one address', async () => {
    await build();
    const unknown = (await get('/ambassador/check/ZZZZZZ')).json();
    expect(unknown).toEqual({ known: false, code: 'ZZZZZZ', words: "We don't know this code." });
    const most = harness.config.ambassadorProtection.checksPerTenMinutes;
    for (let i = 1; i < most; i += 1) await get('/ambassador/check/ZZZZZZ');
    expect((await get('/ambassador/check/ZZZZZZ')).statusCode).toBe(429);
  });

  it('shows the face photo only while the Ambassador is active', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { checkCode } = (await get('/ambassador/toolkit', ada.authHeader)).json();
    const document = await harness.repository.ambassadorDocuments.create({
      agreementId: ada.agreementId,
      accountKind: 'shopper',
      accountId: ada.shopperId,
      kind: 'face_photo',
      idType: null,
      addressType: null,
      image: new Uint8Array(Buffer.from('a face')),
      contentType: 'image/jpeg',
      shareCode: null,
      createdAt: harness.now(),
    });
    await harness.repository.ambassadorDocuments.update(document.id, { status: 'accepted' });
    expect((await get(`/ambassador/check/${checkCode}`)).json().hasPhoto).toBe(true);
    const photo = await get(`/ambassador/check/${checkCode}/photo`);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    await harness.repository.ambassadors.updateAgreement(ada.agreementId, { status: 'removed' });
    expect((await get(`/ambassador/check/${checkCode}/photo`)).statusCode).toBe(404);
  });

  it('puts the check first on a counter card and on the agreement sheet', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { shop } = await joinShop({ ambassador: ada.via });
    await post(`/staff/partners/${shop.id}`, { status: 'approved' }, STAFF);
    const card = (await get(`/ambassador/cards/${shop.id}`, ada.authHeader)).json();
    expect(card.printLink).toMatch(
      new RegExp(`/ambassador/check/${card.checkCode}\\?next=%2Fshops%2F${shop.id}$`),
    );

    const made = (await post('/ambassador/businesses', business, ada.authHeader)).json();
    const sheet = (await get(`/partner-agreements/${made.reference}`)).json();
    expect(sheet.ambassador).toEqual(
      expect.objectContaining({ known: true, active: true, firstName: 'Ada' }),
    );
  });
});

describe('3. the business confirms with its own code', () => {
  it('sends a code to the business’s own phone, and the Ambassador earns nothing until it is typed in on the business’s own sign-in', async () => {
    await build();
    const ada = await approvedAmbassador();
    // A grocery shop, whose share is of the item charges on every order.
    const made = await post(
      '/ambassador/businesses',
      { ...business, kind: 'shop', agreedMarkupPercent: 0, agreedDiscountPercent: 0 },
      ada.authHeader,
    );
    expect(made.statusCode, made.body).toBe(201);
    const body = made.json();
    expect(body.message).toMatch(/on their own phone or computer, not yours/);
    expect(JSON.stringify(body)).not.toMatch(/"code"/);
    const sentCode = harness.deliveredCodes.find((row) => row.phone === '+447700900888');
    expect(sentCode?.code).toMatch(/^\d{6}$/);
    expect(
      texts.some((text) => text.to === '+447700900888' && text.body.includes('Ada, an Ambassador')),
    ).toBe(true);

    let shop = (await harness.repository.partnerShops.findById(body.shop.id))!;
    expect(shop.ambassadorConfirmNeeded).toBe(true);
    expect(shop.ambassadorConfirmedAt).toBeNull();
    await post(
      `/staff/partners/${shop.id}`,
      { status: 'approved', agreementReference: body.reference },
      STAFF,
    );
    // Not yet confirmed: nothing is earned.
    expect(await creditAmbassadorShares(harness.app.ctx, await deliveredOrder(shop.id))).toEqual(
      [],
    );

    // The Ambassador's own sign-in cannot confirm it.
    expect(
      (await post('/partner/ambassador/confirm', { code: sentCode!.code }, ada.authHeader))
        .statusCode,
    ).toBe(403);

    const owner = await signIn('mamaput');
    const view = (await get('/partner/ambassador', owner)).json();
    expect(view.ambassador).toEqual(
      expect.objectContaining({ firstName: 'Ada', waiting: true, confirmed: false }),
    );
    const wrong = await post('/partner/ambassador/confirm', { code: '000000' }, owner);
    expect(wrong.statusCode).toBe(400);
    const right = await post('/partner/ambassador/confirm', { code: sentCode!.code }, owner);
    expect(right.statusCode, right.body).toBe(200);
    expect(right.json().message).toBe(
      'Thank you. You have confirmed that Ada introduced your business.',
    );
    shop = (await harness.repository.partnerShops.findById(shop.id))!;
    expect(shop.ambassadorConfirmedAt?.toISOString()).toBe(START.toISOString());
    const [entry] = await creditAmbassadorShares(harness.app.ctx, await deliveredOrder(shop.id));
    expect(entry?.ambassadorId).toBe(ada.shopperId);
  });

  it('lets the business say the Ambassador did not sign it up', async () => {
    await build();
    const ada = await approvedAmbassador();
    const { shop } = (await post('/ambassador/businesses', business, ada.authHeader)).json();
    const owner = await signIn('mamaput');
    const refused = await post('/partner/ambassador/refuse', {}, owner);
    expect(refused.statusCode, refused.body).toBe(200);
    expect((await harness.repository.partnerShops.findById(shop.id))?.ambassadorId).toBeNull();
    expect(
      (await harness.repository.ownerDesk.listUnsettled()).some(
        (matter) =>
          matter.kind === 'ambassador_report' && matter.summary.includes('did not sign it up'),
      ),
    ).toBe(true);
  });

  it('keeps the first confirmed claim, and refuses later ones politely', async () => {
    await build();
    const ada = await approvedAmbassador();
    const bea = await approvedAmbassador('Bea Ade', '+447700900501');
    const first = (await post('/ambassador/businesses', business, ada.authHeader)).json();
    // Bea signs up the same business, on its own number, before Ada's is confirmed.
    const second = await post(
      '/ambassador/businesses',
      { ...business, name: 'Mama Put Kitchen Two', username: 'mamaput2' },
      bea.authHeader,
    );
    expect(second.statusCode, second.body).toBe(201);
    const codes = harness.deliveredCodes.filter((row) => row.phone === '+447700900888');
    expect(codes).toHaveLength(2);
    const adaConfirmed = await post(
      '/partner/ambassador/confirm',
      { code: codes[0]!.code },
      await signIn('mamaput'),
    );
    expect(adaConfirmed.json().confirmed).toBe(true);
    const beaConfirmed = await post(
      '/partner/ambassador/confirm',
      { code: codes[1]!.code },
      await signIn('mamaput2'),
    );
    expect(beaConfirmed.statusCode, beaConfirmed.body).toBe(200);
    expect(beaConfirmed.json()).toEqual(
      expect.objectContaining({
        confirmed: false,
        message:
          'Thank you. Another Ambassador introduced this business to us first, so this introduction cannot be counted. Nothing changes for the business.',
      }),
    );
    expect(
      (await harness.repository.partnerShops.findById(second.json().shop.id))?.ambassadorId,
    ).toBeNull();
    expect((await harness.repository.partnerShops.findById(first.shop.id))?.ambassadorId).toBe(
      ada.shopperId,
    );

    // Now that Ada's is confirmed, signing the same business up again is refused at once.
    const third = await post(
      '/ambassador/businesses',
      { ...business, name: 'Mama Put Three', username: 'mamaput3' },
      bea.authHeader,
    );
    expect(third.statusCode).toBe(409);
    expect(third.json().error.message).toMatch(/Another Ambassador introduced this business/);
  });

  it('never takes bank or card details through an Ambassador', async () => {
    await build();
    const ada = await approvedAmbassador();
    for (const extra of [
      { sortCode: '12-34-56' },
      { accountNumber: '12345678' },
      { cardNumber: '4242' },
    ]) {
      const refused = await post(
        '/ambassador/businesses',
        { ...business, ...extra },
        ada.authHeader,
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.message).toMatch(/never takes bank or card details/);
    }
    expect(
      (await harness.repository.partnerShops.list()).some((shop) => shop.name === business.name),
    ).toBe(false);
  });
});

describe('4. fake businesses and fake orders', () => {
  async function tiedShop() {
    const ada = await approvedAmbassador();
    const joined = await joinShop({ ambassador: ada.via, mobile: '07700 900 444' });
    await post(`/staff/partners/${joined.shop.id}`, { status: 'approved' }, STAFF);
    return { ada, shopId: joined.shop.id, username: `cornershop${count}` };
  }

  it('counts an order from a real, distinct Shopper', async () => {
    await build();
    const { shopId } = await tiedShop();
    const [entry] = await creditAmbassadorShares(harness.app.ctx, await deliveredOrder(shopId));
    expect(entry?.heldAt).toBeNull();
  });

  it('holds the share and flags the Ambassador when the Shopper is the Ambassador, by phone', async () => {
    await build();
    const { ada, shopId } = await tiedShop();
    const order = await deliveredOrder(shopId, { shopperId: ada.shopperId });
    const [entry] = await creditAmbassadorShares(harness.app.ctx, order);
    expect(entry?.heldAt).not.toBeNull();
    expect(entry?.heldReason).toBe("The Shopper is the Ambassador's own account.");
    const agreement = await harness.repository.ambassadors.findAgreement('shopper', ada.shopperId);
    expect(agreement?.flaggedAt).not.toBeNull();
    const matter = (
      await harness.repository.ownerDesk.findMattersFor('ambassador_share_held', entry!.reference)
    )[0];
    expect(matter?.summary).toContain('Ada Obi');
    const summary = await ambassadorSummary(harness.app.ctx, 'shopper', ada.shopperId);
    expect(summary.earnedPence).toBe(0);
    expect(summary.heldPence).toBe(entry!.amountPence);

    // A person checks it and releases it: it counts.
    const held = (await get('/staff/ambassador-protection/held', STAFF)).json().held;
    expect(held).toEqual([expect.objectContaining({ id: entry!.id, ambassadorName: 'Ada Obi' })]);
    const released = await post(
      `/staff/ambassador-protection/held/${entry!.id}/release`,
      { by: 'Anthony' },
      STAFF,
    );
    expect(released.statusCode, released.body).toBe(200);
    expect((await ambassadorSummary(harness.app.ctx, 'shopper', ada.shopperId)).earnedPence).toBe(
      entry!.amountPence,
    );
  });

  it('holds a share when the phone, the delivery address, the device or the card is the owner’s or the Ambassador’s', async () => {
    await build();
    const { ada, shopId, username } = await tiedShop();
    // The owner's phone.
    const ownerShopper = await harness.repository.shoppers.create({
      displayName: 'Bola',
      phone: '+447700900444',
      handle: 'bola-owner',
    });
    let [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await deliveredOrder(shopId, { shopperId: ownerShopper.id }),
    );
    expect(entry?.heldReason).toBe("The Shopper's phone number is the business owner's.");

    // The shop's own address.
    [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await deliveredOrder(shopId, { deliveryAddress: '12 High Street, Gillingham ME7 1AA' }),
    );
    expect(entry?.heldReason).toBe("The delivery address is the business owner's.");

    // The Ambassador's device: the app's device id, seen with Ada and then with another Shopper.
    const device = { 'x-device-id': 'device-0123456789abcdef' };
    await get('/referrals/me', { ...ada.authHeader, ...device });
    const other = await signUpShopper(harness, { displayName: 'Dee', phone: '+447700900612' });
    await get('/referrals/me', { ...other.authHeader, ...device });
    [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await deliveredOrder(shopId, { shopperId: other.shopperId }),
    );
    expect(entry?.heldReason).toBe("The Shopper's device is the Ambassador's own.");

    // The owner's partner dashboard on the same phone as a Shopper's order.
    const ownerDevice = { 'x-device-id': 'device-owner-0123456789' };
    await get('/partner/ambassador', { ...(await signIn(username)), ...ownerDevice });
    const eve = await signUpShopper(harness, { displayName: 'Eve', phone: '+447700900613' });
    await get('/referrals/me', { ...eve.authHeader, ...ownerDevice });
    [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await deliveredOrder(shopId, { shopperId: eve.shopperId }),
    );
    expect(entry?.heldReason).toBe("The Shopper's device is the business owner's.");

    const buyer = await harness.repository.shoppers.create({
      displayName: 'Cee',
      phone: '+447700900611',
      handle: 'cee',
    });
    // The Ambassador's card, saved by another Shopper.
    const method = await harness.repository.paymentMethods.create({
      shopperId: buyer.id,
      stripePaymentMethodId: 'pm_cee',
      lastFour: '4242',
    });
    harness.payments.fingerprints.set('pm_cee', 'fp_pm_test_visa');
    [entry] = await creditAmbassadorShares(
      harness.app.ctx,
      await deliveredOrder(shopId, { shopperId: buyer.id, paymentMethodId: method.id }),
    );
    expect(entry?.heldReason).toBe("The Shopper's card is the Ambassador's own.");
  });

  it('gives staff links to check a business, filled in with its name and postcode, and who brought it in first', async () => {
    await build();
    const { shopId } = await tiedShop();
    const check = (await get(`/staff/partners/${shopId}/check`, STAFF)).json();
    expect(check.companiesHouse).toBe(
      `https://find-and-update.company-information.service.gov.uk/search/companies?q=Corner%20Shop%20${count}`,
    );
    expect(check.hygieneRating).toContain('location=ME7%201AA');
    expect(check.ambassadorConfirmedAt).not.toBeNull();
    expect(check.claims).toEqual([expect.objectContaining({ status: 'confirmed' })]);
    expect((await get(`/staff/partners/${shopId}/check`)).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('5. were you promised anything?', () => {
  it('asks once, about a week after a business joins through an Ambassador, in the dashboard and by text', async () => {
    await build();
    const ada = await approvedAmbassador();
    await joinShop({ ambassador: ada.via, mobile: '07700 900 555' });
    const username = `cornershop${count}`;
    let headers = await signIn(username);
    expect((await get('/partner/ambassador', headers)).json().promise).toBeNull();
    expect(await sweepAmbassadorFollowUps(harness.app.ctx)).toBe(0);

    harness.setNow(new Date(START.getTime() + 7 * 24 * 3_600_000));
    headers = await signIn(username);
    expect((await get('/partner/ambassador', headers)).json().promise).toEqual({
      question: "Were you promised anything that isn't in your agreement?",
    });
    expect(await sweepAmbassadorFollowUps(harness.app.ctx)).toBe(1);
    expect(await sweepAmbassadorFollowUps(harness.app.ctx)).toBe(0);
    expect(texts.at(-1)).toEqual({
      to: '+447700900555',
      body: expect.stringContaining("Were you promised anything that isn't in your agreement?"),
    });

    const yes = await post(
      '/partner/ambassador/promise',
      { answer: 'yes', note: 'Free Spotlight for a year.' },
      headers,
    );
    expect(yes.statusCode, yes.body).toBe(200);
    const matter = (await harness.repository.ownerDesk.listUnsettled()).find(
      (row) => row.kind === 'ambassador_promise',
    );
    expect(matter?.summary).toContain('Ada Obi');
    expect(matter?.summary).toContain('Free Spotlight for a year.');
    expect((await post('/partner/ambassador/promise', { answer: 'no' }, headers)).statusCode).toBe(
      409,
    );
    expect((await get('/partner/ambassador', headers)).json().promise).toBeNull();
  });

  it('is never asked of a business that joined without an Ambassador', async () => {
    await build();
    await joinShop();
    const username = `cornershop${count}`;
    harness.setNow(new Date(START.getTime() + 30 * 24 * 3_600_000));
    const headers = await signIn(username);
    expect((await get('/partner/ambassador', headers)).json().promise).toBeNull();
  });
});
