/**
 * An Ambassador's link in the owner's and staff's hands, and an individual rate (Anthony, 3
 * November 2026, ruling 94): the links endpoint for an approved and a pending Ambassador, who may
 * open it, texting the link to a business (audited as the staff member's action, limited each day,
 * the number kept nowhere else), the rate (the owner alone, the cap, applied to new shares only
 * on the founder's worked example, old shares untouched, the dashboard's words), and the owner's
 * voice tools, read back and done only on his yes.
 */

import { AMBASSADOR_TERMS_VERSION } from '@aldilivery/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { Order } from '../src/domain.js';
import type { OwnerActionRequest, OwnerTalkInput, OziBrain } from '../src/lib/language-model.js';
import { creditAmbassadorShares, reconcileOrder } from '../src/services/ambassadors.js';
import {
  buildTestApp,
  signUpRunner,
  signUpShopper,
  STAFF,
  type TestAppOptions,
  type TestHarness,
} from './helpers.js';

/** Tuesday 3 November 2026, 10:00 in the UK. */
const START = new Date('2026-11-03T10:00:00.000Z');
const ORIGIN = 'https://desk.example.test';

let harness: TestHarness;
let texts: Array<{ to: string; body: string }>;

afterEach(async () => {
  await harness?.close();
});

async function build(options: TestAppOptions = {}) {
  texts = [];
  passwords.clear();
  harness = await buildTestApp(START, {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: 'token' },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    ...options,
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

/** Elise, a Runner, applied to be an Ambassador: approved unless a test says otherwise. */
async function elise(status: 'approved' | 'documents_checked' | 'declined' = 'approved') {
  const runner = await signUpRunner(harness, { name: 'Elise Marchant', phone: '+447700900601' });
  const joined = await post(
    '/ambassador/join',
    { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
    runner.authHeader,
  );
  expect(joined.statusCode, joined.body).toBe(200);
  const agreement = (await harness.repository.ambassadors.findAgreement(
    'runner',
    runner.runnerId,
  ))!;
  await harness.repository.ambassadors.updateAgreement(agreement.id, {
    status,
    ...(status === 'approved' ? { approvedAt: harness.now() } : {}),
  });
  return { ...runner, agreementId: agreement.id };
}

const passwords = new Map<string, string>();

async function staffToken(role: string, username: string): Promise<Record<string, string>> {
  if (!passwords.has(username)) {
    const made = (await post('/staff/team', { name: username, username, role }, STAFF)).json() as {
      password: string;
    };
    passwords.set(username, made.password);
  }
  const token = (
    await post('/staff/sign-in', { username, password: passwords.get(username)! })
  ).json().token as string;
  return { 'x-staff-token': token };
}

/** The owner's account, signed in with his passcode. */
async function ownerSignedIn(): Promise<{ headers: Record<string, string>; id: string }> {
  const made = await post(
    '/staff/owner',
    { name: 'Anthony', username: 'anthony', password: 'a long password', passcode: '123456#' },
    STAFF,
  );
  expect(made.statusCode, made.body).toBe(201);
  const signedIn = await post('/staff/sign-in', {
    username: 'anthony',
    password: 'a long password',
    passcode: '123456#',
    remember: true,
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  const owner = await harness.repository.staffMembers.findByUsername('anthony');
  return { headers: { 'x-staff-token': signedIn.json().token as string }, id: owner!.id };
}

let shopCount = 0;

/** A café joining through Elise's link, approved by staff. */
async function cafeThrough(via: string) {
  shopCount += 1;
  const joined = await post('/partner/join', {
    name: `Mama Put Kitchen ${shopCount}`,
    kind: 'food',
    address: '12 High Street, Gillingham',
    postcode: 'ME7 1AA',
    hours: 'Monday to Saturday 7am to 5pm',
    contactName: 'Bola',
    mobile: `07700 900 ${String(700 + shopCount)}`,
    email: `cafe${shopCount}@example.com`,
    about: 'Breakfasts.',
    username: `cafe${shopCount}`,
    password: 'a-long-enough-password',
    termsAgreed: true,
    ambassador: via,
  });
  expect(joined.statusCode, joined.body).toBe(201);
  const id = joined.json().shop.id as string;
  const approved = await post(`/staff/partners/${id}`, { status: 'approved' }, STAFF);
  expect(approved.statusCode, approved.body).toBe(200);
  return id;
}

let buyerCount = 0;

/**
 * The founder's worked example (30 October 2026): a £10 dish at 50% mark-up and 20% discount.
 * The Shopper pays £15, the Runner £8: Ozi keeps £5 of mark-up and £2 of discount.
 */
async function dishOrder(shopId: string): Promise<Order> {
  const product = await harness.repository.partnerProducts.create({
    partnerShopId: shopId,
    name: 'Jollof',
    pricePence: 1000,
    tags: '',
    expiresOn: null,
    photo: null,
    photoType: null,
  });
  const item = await harness.repository.catalogue.create({
    name: 'Jollof',
    category: 'From the shop',
    estimatedPricePence: 1500,
    source: 'partner_feed',
    externalRef: `partner:${product.id}`,
  });
  buyerCount += 1;
  const shopper = await harness.repository.shoppers.create({
    displayName: 'Buyer',
    phone: `+4477009${String(50_000 + buyerCount).slice(-5)}`,
    handle: `buyer-${buyerCount}`,
  });
  const order = await harness.repository.orders.create({
    shopperId: shopper.id,
    status: 'delivered',
    goodsEstimatePence: 1500,
    feePence: 1200,
    totalEstimatePence: 1500 + 150 + 1200,
    deliveryAddress: '1 High Street, Gillingham ME7 1AA',
    restaurantShopId: shopId,
    restaurantDiscountPercent: 20,
    items: [
      {
        catalogueItemId: item.id,
        name: 'Jollof',
        quantity: 1,
        estimatedPricePence: 1500,
        shopPricePence: 1000,
        counterPricePence: 800,
      },
    ],
  });
  return (await harness.repository.orders.update(order.id, {
    deliveredAt: harness.now(),
  })) as Order;
}

/* ================================================================== 1. the links */

describe("an Ambassador's links for the owner and staff", () => {
  it('gives an approved Ambassador’s name, check code, sign-up link, check link and rate; never a document', async () => {
    await build();
    const her = await elise();
    const found = await get(`/staff/ambassadors/${her.agreementId}/links`, STAFF);
    expect(found.statusCode, found.body).toBe(200);
    const body = found.json();
    expect(body).toEqual(
      expect.objectContaining({
        name: 'Elise Marchant',
        firstName: 'Elise',
        surname: 'Marchant',
        statusWords: 'Approved',
        approved: true,
        linkWorks: true,
        checkCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
        rate: expect.objectContaining({ percent: 2, standardPercent: 2, individual: false }),
      }),
    );
    expect(body.link).toMatch(new RegExp(`^${ORIGIN}/business/join\\?ambassador=runner-`));
    expect(body.checkLink).toBe(`${ORIGIN}/ambassador/check/${body.checkCode}`);
    expect(body.printLink).toMatch(/\/ambassador\/check\/[A-Z0-9]{6}\?next=%2Fbusiness%2Fjoin/);
    // The link said slowly: every slash and sign named, the code spelt out.
    expect(body.linkAloud).toMatch(
      /^desk, dot, example, dot, test, slash, business, slash, join, question mark, ambassador, equals, runner, dash, /,
    );
    expect(JSON.stringify(body)).not.toMatch(/image|document|passport/i);
  });

  it('shows a pending or declined Ambassador’s status and no link, and says why', async () => {
    await build();
    const pending = await elise('documents_checked');
    const found = (await get(`/staff/ambassadors/${pending.agreementId}/links`, STAFF)).json();
    expect(found).toEqual(
      expect.objectContaining({
        statusWords: 'Documents checked',
        approved: false,
        linkWorks: false,
        link: null,
        checkCode: null,
        words:
          "Elise's application is still waiting (Documents checked), so their link does not work yet. It works once they are approved.",
      }),
    );
    await harness.repository.ambassadors.updateAgreement(pending.agreementId, {
      status: 'declined',
    });
    const declined = (await get(`/staff/ambassadors/${pending.agreementId}/links`, STAFF)).json();
    expect(declined.link).toBeNull();
    expect(declined.words).toBe(
      "Elise's application was not approved, so there is no link to send.",
    );
    expect((await get('/staff/ambassadors/nobody/links', STAFF)).statusCode).toBe(404);
  });

  it('opens for the owner and staff whose area covers Ambassadors, nobody else', async () => {
    await build();
    const her = await elise();
    const url = `/staff/ambassadors/${her.agreementId}/links`;
    const owner = await ownerSignedIn();
    expect((await get(url, owner.headers)).statusCode).toBe(200);
    expect((await get(url, STAFF)).statusCode).toBe(200);
    expect((await get(url, await staffToken('operations_manager', 'ngozi'))).statusCode).toBe(200);
    expect((await get(url, await staffToken('customer_care', 'kemi'))).statusCode).toBe(403);
    expect((await get(url, await staffToken('finance', 'bisi'))).statusCode).toBe(403);
    expect((await get(url)).statusCode).toBe(403);
  });
});

/* ================================================================== 2. texting the link */

describe('texting the link to a business', () => {
  it('sends one text in fixed words, as the staff member’s own action in the audit log, and keeps the number nowhere else', async () => {
    await build();
    const her = await elise();
    const ngozi = await staffToken('operations_manager', 'ngozi');
    const sent = await post(
      `/staff/ambassadors/${her.agreementId}/links/text`,
      { phone: '07700 900 123' },
      ngozi,
    );
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toEqual({
      message:
        "Elise's link is texted to +447700900123. The business joins through it, and the reward goes to Elise.",
    });
    const link = (await get(`/staff/ambassadors/${her.agreementId}/links`, STAFF)).json()
      .link as string;
    expect(texts).toEqual([
      {
        to: '+447700900123',
        body: `Hello from ${harness.app.ctx.config.productName}. Elise invited you to join as a Shop Partner. Sign up here: ${link}. Joining ${harness.app.ctx.config.assistantName} is always free; never pay an Ambassador.`,
      },
    ]);
    // Written down once, by the service, as Ngozi's: the hook writes nothing more.
    const entries = await harness.repository.audit.list({ search: 'ambassadors.link-texted' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorName: 'ngozi',
      actorRole: 'operations_manager',
      target: `ambassador-application=${her.agreementId}`,
      detail: "Texted Elise Marchant's business sign-up link to +447700900123.",
    });
    expect(await harness.repository.audit.list({ search: 'links/text' })).toEqual([]);
    // The number lives in that entry alone: not on the Ambassador, and not in any other record.
    const agreement = await harness.repository.ambassadors.findAgreementById(her.agreementId);
    expect(JSON.stringify(agreement)).not.toContain('900123');
    expect(JSON.stringify(await harness.repository.partnerShops.list())).not.toContain('900123');
    expect(JSON.stringify(await harness.repository.runners.findById(her.runnerId))).not.toContain(
      '900123',
    );
  });

  it('refuses a pending Ambassador’s, a landline, a foreign number and the public', async () => {
    await build();
    const pending = await elise('documents_checked');
    const refused = await post(
      `/staff/ambassadors/${pending.agreementId}/links/text`,
      { phone: '07700 900 123' },
      STAFF,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/does not work yet/);
    await harness.repository.ambassadors.updateAgreement(pending.agreementId, {
      status: 'approved',
      approvedAt: harness.now(),
    });
    const url = `/staff/ambassadors/${pending.agreementId}/links/text`;
    expect((await post(url, { phone: '01634 000000' }, STAFF)).statusCode).toBe(400);
    expect((await post(url, { phone: '+1 555 0100' }, STAFF)).statusCode).toBe(400);
    expect((await post(url, { phone: '07700 900 123' })).statusCode).toBe(403);
    expect(
      (await post(url, { phone: '07700 900 123' }, await staffToken('customer_care', 'kemi')))
        .statusCode,
    ).toBe(403);
    expect(texts).toEqual([]);
  });

  it('is limited for each person each day, from the configured most', async () => {
    await build();
    const her = await elise();
    const url = `/staff/ambassadors/${her.agreementId}/links/text`;
    const ngozi = await staffToken('operations_manager', 'ngozi');
    const most = harness.app.ctx.config.ambassador.linkTextsPerDay;
    expect(most).toBe(20);
    for (let n = 0; n < most; n += 1) {
      const sent = await post(url, { phone: `07700 900 ${String(100 + n)}` }, ngozi);
      expect(sent.statusCode, sent.body).toBe(200);
    }
    const tooMany = await post(url, { phone: '07700 900 999' }, ngozi);
    expect(tooMany.statusCode).toBe(429);
    expect(tooMany.json().error.message).toMatch(/sent 20 link texts today/);
    expect(texts).toHaveLength(most);
    // Another person has their own share; and tomorrow Ngozi's starts again.
    expect((await post(url, { phone: '07700 900 998' }, STAFF)).statusCode).toBe(200);
    harness.setNow(new Date(START.getTime() + 24 * 60 * 60 * 1000));
    const tomorrow = await staffToken('operations_manager', 'ngozi');
    expect((await post(url, { phone: '07700 900 997' }, tomorrow)).statusCode).toBe(200);
  });
});

/* ================================================================== 3. the rate */

describe('an individual rate', () => {
  it('is set by the owner alone: the staff key and other staff are refused', async () => {
    await build();
    const her = await elise();
    const url = `/staff/ambassadors/${her.agreementId}/rate`;
    expect((await post(url, { percent: 3 }, STAFF)).statusCode).toBe(403);
    expect(
      (await post(url, { percent: 3 }, await staffToken('operations_manager', 'ngozi'))).statusCode,
    ).toBe(403);
    expect((await post(url, { percent: 3 })).statusCode).toBe(403);
    const owner = await ownerSignedIn();
    const set = await post(url, { percent: 3 }, owner.headers);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({
      message:
        'Elise Marchant now earns 3% where others earn 2%, on every share from now. Nothing already earned changes.',
      rate: expect.objectContaining({
        percent: 3,
        standardPercent: 2,
        individual: true,
        multiplier: 1.5,
        words: '3%, where the standard rate is 2%',
        setBy: 'Anthony',
      }),
    });
    // Audited with before, after and who; the hook writes nothing more.
    const entries = await harness.repository.audit.list({ search: 'ambassadors.rate-set' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: owner.id,
      actorName: 'Anthony',
      actorRole: 'owner',
    });
    expect(entries[0]!.detail).toBe(
      "Elise Marchant's individual Ambassador rate: 2% before, 3% after, set by Anthony. New shares only, from now.",
    );
    expect(await harness.repository.audit.list({ search: '/rate' })).toEqual([]);
    // And back to the standard rate.
    const back = await post(url, { percent: 2 }, owner.headers);
    expect(back.json().message).toBe(
      'Elise Marchant is back on the standard rate of 2%, for new shares from now.',
    );
  });

  it('is capped at the configured most, never below the standard rate, and only for an approved Ambassador', async () => {
    await build();
    const owner = await ownerSignedIn();
    const her = await elise();
    const url = `/staff/ambassadors/${her.agreementId}/rate`;
    expect(harness.app.ctx.config.ambassador.maxIndividualRatePercent).toBe(5);
    const tooHigh = await post(url, { percent: 5.5 }, owner.headers);
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json().error.message).toBe('An individual rate can be at most 5%.');
    const tooLow = await post(url, { percent: 1 }, owner.headers);
    expect(tooLow.statusCode).toBe(400);
    expect(tooLow.json().error.message).toBe(
      'An individual rate is never below the standard rate of 2%.',
    );
    expect((await post(url, { percent: 0 }, owner.headers)).statusCode).toBe(400);
    expect((await post(url, { percent: 'three' }, owner.headers)).statusCode).toBe(400);
    expect((await post(url, { percent: 5 }, owner.headers)).statusCode).toBe(200);
    const pending = await harness.repository.ambassadors.updateAgreement(her.agreementId, {
      status: 'documents_checked',
    });
    expect(pending.shareMultiplier).toBe(2.5);
    expect((await post(url, { percent: 3 }, owner.headers)).statusCode).toBe(409);
  });

  it('applies to new shares from the moment it is set, on the founder’s worked example, and never to a share already made', async () => {
    await build();
    const owner = await ownerSignedIn();
    const her = await elise();
    const link = (await get(`/staff/ambassadors/${her.agreementId}/links`, STAFF)).json()
      .link as string;
    const via = new URL(link).searchParams.get('ambassador')!.replace('-', ':');
    const cafe = await cafeThrough(via);
    // Before the rate: 2% of £5 and 2% of £2, 14p.
    const earlier = await dishOrder(cafe);
    const [before] = await creditAmbassadorShares(harness.app.ctx, earlier);
    expect(before).toEqual(
      expect.objectContaining({ profitPence: 700, amountPence: 14, shareMultiplier: 1 }),
    );

    const set = await post(
      `/staff/ambassadors/${her.agreementId}/rate`,
      { percent: 3 },
      owner.headers,
    );
    expect(set.statusCode, set.body).toBe(200);

    // After: 3% of £5 and 3% of £2, 21p, with the rate kept on the share.
    const later = await dishOrder(cafe);
    const [after] = await creditAmbassadorShares(harness.app.ctx, later);
    expect(after).toEqual(
      expect.objectContaining({ profitPence: 700, amountPence: 21, shareMultiplier: 1.5 }),
    );

    // The earlier share is untouched, even when its order is brought up to date again.
    await reconcileOrder(harness.app.ctx, earlier.id);
    await reconcileOrder(harness.app.ctx, later.id);
    const shares = (await harness.repository.ambassadors.listFor('runner', her.runnerId)).filter(
      (entry) => entry.kind === 'share',
    );
    expect(shares.map((entry) => entry.amountPence)).toEqual([14, 21]);

    // Back on the standard rate: the 21p share keeps its own rate too.
    await post(`/staff/ambassadors/${her.agreementId}/rate`, { percent: 2 }, owner.headers);
    await reconcileOrder(harness.app.ctx, later.id);
    expect(
      (await harness.repository.ambassadors.listFor('runner', her.runnerId))
        .filter((entry) => entry.kind === 'share')
        .map((entry) => entry.amountPence),
    ).toEqual([14, 21]);
    expect(await harness.repository.ambassadors.listForOrder(later.id)).toHaveLength(1);
  });

  it('shows on her dashboard as "Your rate: 3%"; the standard rate before', async () => {
    await build();
    const owner = await ownerSignedIn();
    const her = await elise();
    let mine = (await get('/referrals/me', her.authHeader)).json().ambassador;
    expect(mine.rateWords).toBe('Your rate: 2%');
    expect(mine.rate).toEqual(
      expect.objectContaining({ percent: 2, individual: false, words: 'the standard rate of 2%' }),
    );
    await post(`/staff/ambassadors/${her.agreementId}/rate`, { percent: 3 }, owner.headers);
    mine = (await get('/referrals/me', her.authHeader)).json().ambassador;
    expect(mine.rateWords).toBe('Your rate: 3%');
    expect(mine.rate).toEqual(
      expect.objectContaining({ percent: 3, standardPercent: 2, individual: true }),
    );
    // The terms are not changed by a rate in her favour: nothing to agree again.
    expect(mine.termsChanged).toBe(false);
  });
});

/* ================================================================== 4. by voice */

/** A stand-in for the owner's model: a few plain sentences, calling his tools as the real one would. */
function ownerBrain() {
  const results: unknown[] = [];
  const propose = async (input: OwnerTalkInput, request: OwnerActionRequest) => {
    const checked = await input.tools.proposeAction(request);
    if (!checked.ok) return { reply: checked.why, proposal: null };
    return {
      reply: checked.readBack,
      proposal: { action: checked.action, readBack: checked.readBack },
    };
  };
  const brain: OziBrain = {
    name: 'model',
    model: 'stand-in-everyday',
    ownerModel: 'stand-in-owner',
    understand: async () => null,
    async talkWithOwner(input) {
      const text = input.text;
      let match: RegExpExecArray | null;
      if ((match = /^link for (.+)$/i.exec(text))) {
        results.push(await input.tools.ambassadorLink(match[1]!));
        return { reply: 'Here is the link.', proposal: null };
      }
      if ((match = /^text (.+?)'s link to (.+)$/i.exec(text))) {
        return propose(input, { kind: 'text_ambassador_link', who: match[1]!, phone: match[2]! });
      }
      if ((match = /^set (.+?)'s rate to (\S+)$/i.exec(text))) {
        return propose(input, {
          kind: 'set_ambassador_rate',
          who: match[1]!,
          percent: Number(match[2]),
        });
      }
      return { reply: 'Yes?', proposal: null };
    },
  };
  return { brain, results };
}

function ask(text: string, headers: Record<string, string>) {
  return harness.app.inject({
    method: 'POST',
    url: '/ozi/reply',
    headers,
    payload: { text, mode: 'within', turn: 0, conversation: 'visit:owner' },
  });
}

describe('the owner by voice', () => {
  it('ambassador_link finds her by first name, surname or code, gives the link, the code and the offer to text it; never a document', async () => {
    const { brain, results } = ownerBrain();
    await build({ brain });
    const owner = await ownerSignedIn();
    const her = await elise();
    const other = await signUpShopper(harness, {
      displayName: 'Elise Dubois',
      phone: '+447700900602',
    });
    await post(
      '/ambassador/join',
      { termsAgreed: true, termsVersion: AMBASSADOR_TERMS_VERSION },
      other.authHeader,
    );
    await ask('link for Marchant', owner.headers);
    const found = results[0] as { checkCode: string; link: string };
    expect(found).toEqual(
      expect.objectContaining({
        found: true,
        name: 'Elise Marchant',
        firstName: 'Elise',
        status: 'Approved',
        checkCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
        rate: 'the standard rate of 2%',
        offer: "Shall I text Elise's link to a number you give me?",
      }),
    );
    expect(found.link).toMatch(/\/business\/join\?ambassador=runner-/);
    expect(JSON.stringify(found)).not.toMatch(/image|document/i);
    // By her check code, too; and a first name two people share asks for the full name.
    await ask(`link for ${found.checkCode.toLowerCase()}`, owner.headers);
    expect(results[1]).toEqual(expect.objectContaining({ found: true, name: 'Elise Marchant' }));
    await ask('link for Elise', owner.headers);
    expect(results[2]).toEqual({
      found: false,
      why: 'There is more than one Ambassador called Elise: Elise Marchant, Elise Dubois. Please say the full name.',
    });
    // Somebody not approved: the status and no link.
    await harness.repository.ambassadors.updateAgreement(her.agreementId, {
      status: 'documents_checked',
    });
    await ask('link for Marchant', owner.headers);
    expect(results[3]).toEqual(
      expect.objectContaining({
        found: true,
        link: null,
        status: 'Documents checked',
        offer: null,
      }),
    );
  });

  it('text_ambassador_link reads the number back in twos, sends only on his yes, and is audited as his, by voice', async () => {
    const { brain } = ownerBrain();
    await build({ brain });
    const owner = await ownerSignedIn();
    const her = await elise();
    const asked = await ask("text Elise's link to 07700 900 123", owner.headers);
    expect(asked.json()).toEqual({
      reply:
        "To be sure, Mr. Anthony: I will text Elise Marchant's business sign-up link to zero seven, seven zero, zero nine, zero zero, one two, three. Again, that is zero seven, seven zero, zero nine, zero zero, one two, three. Shall I go ahead? Say yes, or no.",
      awaitingYes: true,
    });
    expect(texts).toEqual([]);
    expect((await ask('no', owner.headers)).json().reply).toBe("All right, I haven't done it.");
    expect(texts).toEqual([]);

    await ask("text Elise's link to 07700 900 123", owner.headers);
    const yes = await ask('yes', owner.headers);
    expect(yes.json().reply).toBe(
      "Elise's link is texted to +447700900123. The business joins through it, and the reward goes to Elise.",
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]!.to).toBe('+447700900123');
    expect(texts[0]!.body).toMatch(
      /^Hello from .*\. Elise invited you to join as a Shop Partner\./,
    );
    const [entry] = await harness.repository.audit.list({ search: 'ambassadors.link-texted' });
    expect(entry).toMatchObject({
      actorId: owner.id,
      actorRole: 'owner',
      target: `ambassador-application=${her.agreementId}`,
    });
    expect(entry!.detail).toMatch(/by voice, talking to Ozi, after reading it back/);

    // A number that is not a UK mobile is asked for again; nothing waits for a yes.
    const bad = await ask("text Elise's link to 01634 000000", owner.headers);
    expect(bad.json()).toEqual({
      reply:
        'That does not sound like a UK mobile number. Please say it again, starting zero seven.',
    });
  });

  it('set_ambassador_rate reads the rate back, sets it only on his yes, and refuses the cap', async () => {
    const { brain } = ownerBrain();
    await build({ brain });
    const owner = await ownerSignedIn();
    const her = await elise();
    const asked = await ask("set Elise's rate to 3", owner.headers);
    expect(asked.json()).toEqual({
      reply:
        "To be sure, Mr. Anthony: I will set Elise Marchant's individual Ambassador rate to 3%, where the standard rate is 2%, for new earnings from now. Nothing already earned changes. Shall I go ahead? Say yes, or no.",
      awaitingYes: true,
    });
    expect(
      (await harness.repository.ambassadors.findAgreementById(her.agreementId))?.shareMultiplier,
    ).toBe(1);
    const yes = await ask('yes please', owner.headers);
    expect(yes.json().reply).toBe(
      'Elise Marchant now earns 3% where others earn 2%, on every share from now. Nothing already earned changes.',
    );
    expect(
      (await harness.repository.ambassadors.findAgreementById(her.agreementId))?.shareMultiplier,
    ).toBe(1.5);
    const [entry] = await harness.repository.audit.list({ search: 'ambassadors.rate-set' });
    expect(entry).toMatchObject({ actorId: owner.id, actorRole: 'owner' });
    expect(entry!.detail).toMatch(/2% before, 3% after, set by Anthony by voice/);

    expect((await ask("set Elise's rate to 6", owner.headers)).json()).toEqual({
      reply: 'An individual rate can be at most 5%.',
    });
    expect((await ask("set Nobody's rate to 3", owner.headers)).json()).toEqual({
      reply: 'I cannot find an Ambassador called Nobody.',
    });
  });

  it('a member of staff talking to Ozi has none of these tools', async () => {
    const { brain, results } = ownerBrain();
    await build({ brain });
    await ownerSignedIn();
    await elise();
    const ngozi = await staffToken('operations_manager', 'ngozi');
    await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      headers: ngozi,
      payload: { text: "set Elise's rate to 3", mode: 'within', turn: 0, conversation: 'visit:n' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/ozi/reply',
      headers: ngozi,
      payload: { text: 'yes', mode: 'within', turn: 0, conversation: 'visit:n' },
    });
    expect(results).toEqual([]);
    expect(
      (await harness.repository.ambassadors.listAgreements()).map((row) => row.shareMultiplier),
    ).toEqual([1]);
  });
});
