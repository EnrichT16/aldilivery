/**
 * Ozi's desk (ruling 74, 22 October 2026): Ozi phones the owner about anything that needs him,
 * and he decides with the keypad. Acted out with a fake clock, a stand-in for placing calls, and
 * requests signed the way Twilio signs them.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type {
  DocumentCheckInput,
  DocumentReading,
  OziBrain,
  ProductCheckInput,
  ProductReading,
} from '../src/lib/language-model.js';
import { twilioSignature, type PlaceCallOptions } from '../src/lib/twilio-voice.js';
import { checkPartnerProduct, checkWaiting } from '../src/services/auto-check.js';
import {
  askOwner,
  inQuietHours,
  nextDayAt,
  spokenSafe,
  sweepOwnerDesk,
} from '../src/services/owner-desk.js';
import {
  STAFF,
  buildTestApp,
  signUpRunner,
  signUpShopper,
  type TestHarness,
  type TestAppOptions,
} from './helpers.js';

const ORIGIN = 'https://desk.example.test';
const TOKEN = 'twilio-auth-token-for-desk-tests';
const OWNER_PHONE = '+447700900999';
/** Thursday 22 October 2026, 11:00 in the UK (British Summer Time, an hour ahead of UTC). */
const START = new Date('2026-10-22T10:00:00.000Z');

interface Rang {
  to: string;
  url: string;
  statusCallback: string;
  options: PlaceCallOptions | undefined;
}

let harness: TestHarness;
let rang: Rang[];
let texts: Array<{ to: string; body: string }>;

async function build(at = START, options: TestAppOptions = {}): Promise<TestHarness> {
  rang = [];
  texts = [];
  harness = await buildTestApp(at, {
    env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN, ownerAlertPhone: OWNER_PHONE },
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
    placeCall: async (to, url, statusCallback, callOptions) => {
      rang.push({ to, url, statusCallback, options: callOptions });
    },
    ...options,
  });
  return harness;
}

afterEach(async () => {
  await harness.close();
});

function twilio(path: string, params: Record<string, string>, sign = true) {
  const signature = twilioSignature(TOKEN, `${ORIGIN}${path}`, params);
  return harness.app.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(sign ? { 'x-twilio-signature': signature } : {}),
    },
    payload: new URLSearchParams(params).toString(),
  });
}

function pathOf(url: string): string {
  return url.replace(/&amp;/g, '&').replace(ORIGIN, '');
}

function nextStep(twiml: string): string {
  return pathOf(/action="([^"]+)"/.exec(twiml)?.[1] ?? '');
}

function spoken(twiml: string): string {
  return [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)]
    .map((m) => m[1])
    .join(' ')
    .replace(/&apos;|&#39;/g, "'");
}

function minutes(count: number): number {
  return count * 60_000;
}

function later(ms: number): Date {
  const at = new Date(harness.now().getTime() + ms);
  harness.setNow(at);
  return at;
}

async function sweep() {
  return sweepOwnerDesk(harness.app.ctx);
}

/** Twilio telling us how the last call went. */
async function status(callStatus: string, call = rang[rang.length - 1]!) {
  const response = await twilio(pathOf(call.statusCallback), {
    CallSid: 'CA-owner',
    CallStatus: callStatus,
  });
  expect(response.statusCode).toBe(204);
}

/** He (or a machine) picks up the last call. */
async function answer(answeredBy = 'human', call = rang[rang.length - 1]!) {
  return twilio(pathOf(call.url), { CallSid: 'CA-owner', AnsweredBy: answeredBy });
}

function press(twiml: string, digits: string) {
  return twilio(nextStep(twiml), { CallSid: 'CA-owner', Digits: digits });
}

async function aMatter(
  summary = 'A Shopper wrote about order OZ-AAAAAA: lovely Runner.',
  urgent = false,
) {
  const matter = await askOwner(harness.app.ctx, {
    kind: 'shopper_feedback',
    subjectId: `feedback-${Math.random()}`,
    summary,
    options: 'acknowledge',
    urgent,
  });
  return matter!;
}

const PHOTO = Buffer.from('a pretend photo of a document').toString('base64');

async function runnerSigningUp(name = 'Chidi Okafor', phone = '+447700900301') {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/runners',
    payload: { name, phone, travelModes: ['on_foot'], adult: true, homePostcode: 'ME7 1AA' },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json() as { runner: { id: string }; token: string };
  return { id: body.runner.id, headers: { authorization: `Bearer ${body.token}` } };
}

function sendDocument(headers: Record<string, string>, payload: object) {
  return harness.app.inject({ method: 'POST', url: '/runners/me/documents', headers, payload });
}

/* ================================================================== the matters */

describe('what becomes a matter for the owner', () => {
  it('a Runner document, with no automatic check switched on, is a matter to decide', async () => {
    await build();
    const runner = await runnerSigningUp();
    const sent = await sendDocument(runner.headers, {
      kind: 'dbs',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter).toEqual(
      expect.objectContaining({ kind: 'runner_document', options: 'decide', status: 'open' }),
    );
    expect(matter!.summary).toMatch(/Runner Chidi Okafor's DBS certificate needs you/);
    expect(matter!.summary).toMatch(/automatic check is not switched on/);
    // Nothing is decided by itself: it waits for a person.
    const document = await harness.repository.runnerDocuments.findById(sent.json().document.id);
    expect(document?.status).toBe('submitted');
  });

  it('a share code always goes to the owner, to check on GOV.UK', async () => {
    await build(START, { brain: standInBrain() });
    const runner = await runnerSigningUp();
    await sendDocument(runner.headers, { kind: 'right_to_work', shareCode: 'W12 345 678' });
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter?.summary).toMatch(/share code.*cannot verify.*GOV\.UK/);
  });

  it('a new shop joining, and its product with no automatic check switched on', async () => {
    await build(START, { codeDelivery: 'sms' });
    // A shop joining by itself, waiting for approval.
    const mobile = '07700 900 222';
    await harness.app.inject({
      method: 'POST',
      url: '/auth/request-code',
      payload: { phone: mobile, role: 'partner', purpose: 'sign-up' },
    });
    const code = harness.deliveredCodes[harness.deliveredCodes.length - 1]!.code;
    const proof = await harness.app.inject({
      method: 'POST',
      url: '/auth/verify-code',
      payload: { phone: mobile, role: 'partner', code },
    });
    const joined = await harness.app.inject({
      method: 'POST',
      url: '/partner/join',
      payload: {
        name: 'Corner Bakery',
        kind: 'shop',
        address: '12 High Street, Gillingham',
        postcode: 'ME7 1AA',
        hours: 'Monday to Saturday 7am to 5pm',
        contactName: 'Bola',
        mobile,
        email: 'bola@example.com',
        about: 'Fresh bread every morning.',
        username: 'cornerbakery',
        password: 'a-long-enough-password',
        phoneProof: proof.json().phoneProof,
        termsAgreed: true,
      },
    });
    expect(joined.statusCode, joined.body).toBe(201);
    const shopHeaders = { 'x-business-token': joined.json().token as string };
    const added = await harness.app.inject({
      method: 'POST',
      url: '/partner/products',
      headers: shopHeaders,
      payload: { name: 'Sourdough loaf', pricePence: 350 },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().product.status).toBe('pending');

    const matters = await harness.repository.ownerDesk.listUnsettled();
    const byKind = Object.fromEntries(matters.map((matter) => [matter.kind, matter]));
    expect(Object.keys(byKind).sort()).toEqual(['partner_product', 'partner_shop']);
    expect(byKind['partner_shop']!.summary).toMatch(/Corner Bakery, in ME7, has joined/);
    expect(byKind['partner_shop']!.options).toBe('decide');
    expect(byKind['partner_product']!.summary).toMatch(
      /Corner Bakery added Sourdough loaf, £3\.50/,
    );
    for (const matter of matters) expect(matter.summary).not.toMatch(/0\s?7700|\+44/);
  });

  it('an organisation, a complaint, feedback, an SOS and a Finds It', async () => {
    await build();
    // An organisation asking to work with us. Their number is never in what Ozi says.
    await harness.app.inject({
      method: 'POST',
      url: '/organisations/enquiries',
      payload: {
        organisation: 'Medway Care',
        contactName: 'Ada',
        telephone: '01634 123 4567',
        people: '40',
        termsAgreed: true,
      },
    });

    // A complaint, and feedback with one star and a few words.
    const shopper = await signUpShopper(harness, { displayName: 'Margaret' });
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      status: 'delivered',
      goodsEstimatePence: 500,
      feePence: 1099,
      totalEstimatePence: 1749,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [],
    });
    const complained = await harness.app.inject({
      method: 'POST',
      url: `/orders/${order.id}/problems`,
      headers: shopper.authHeader,
      payload: { summary: 'The eggs were broken. Ring me on 07700 900 123.' },
    });
    expect(complained.statusCode, complained.body).toBe(201);
    const fed = await harness.app.inject({
      method: 'POST',
      url: `/orders/${order.id}/feedback`,
      headers: shopper.authHeader,
      payload: { rating: 1, message: 'Bread was squashed' },
    });
    expect(fed.statusCode, fed.body).toBe(201);

    // A Finds It request.
    await harness.app.inject({
      method: 'POST',
      url: '/extras/find-it',
      headers: shopper.authHeader,
      payload: { description: 'Welsh cakes', priceAccepted: true },
    });

    // A Runner's SOS: urgent.
    const runner = await signUpRunner(harness);
    const pressed = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/sos',
      headers: runner.authHeader,
      payload: {},
    });
    expect(pressed.statusCode, pressed.body).toBe(201);

    const matters = await harness.repository.ownerDesk.listUnsettled();
    const byKind = Object.fromEntries(matters.map((matter) => [matter.kind, matter]));
    expect(Object.keys(byKind).sort()).toEqual(
      ['find_it', 'organisation_enquiry', 'problem', 'shopper_feedback', 'sos'].sort(),
    );
    expect(byKind['organisation_enquiry']!.summary).toMatch(
      /Medway Care.*number is on the Enquiries page/,
    );
    expect(byKind['problem']!.summary).toMatch(/Margaret reported a problem.*eggs were broken/);
    expect(byKind['shopper_feedback']!.summary).toMatch(/gave 1 star.*Bread was squashed/);
    expect(byKind['find_it']!.summary).toMatch(/Welsh cakes/);
    expect(byKind['sos']).toEqual(
      expect.objectContaining({ urgent: true, options: 'acknowledge' }),
    );
    // Never a customer's telephone number in anything said aloud.
    for (const matter of matters) {
      expect(matter.summary).not.toMatch(/0\s?7700|01634|\+44/);
    }
  });

  it('feedback with five stars and nothing written is not for the owner', async () => {
    await build();
    const shopper = await signUpShopper(harness);
    const order = await harness.repository.orders.create({
      shopperId: shopper.shopperId,
      status: 'delivered',
      goodsEstimatePence: 500,
      feePence: 1099,
      totalEstimatePence: 1749,
      deliveryAddress: '1 High Street, Gillingham ME7 1AA',
      items: [],
    });
    await harness.app.inject({
      method: 'POST',
      url: `/orders/${order.id}/feedback`,
      headers: shopper.authHeader,
      payload: { rating: 5 },
    });
    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(0);
  });

  it('uses the "Needs you now" page as its checklist: waiting orders, bank transfers and pay-backs', async () => {
    await build(START, { env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN } });
    const shopper = await signUpShopper(harness);
    const make = async (patch: object) => {
      const order = await harness.repository.orders.create({
        shopperId: shopper.shopperId,
        status: 'paid',
        goodsEstimatePence: 500,
        feePence: 1099,
        totalEstimatePence: 1749,
        deliveryAddress: '1 High Street, Gillingham ME7 1AA',
        items: [],
      });
      return harness.repository.orders.update(order.id, patch);
    };
    const waiting = await make({ spokenConfirmationAt: new Date(START.getTime() - minutes(30)) });
    const bank = await make({ status: 'confirmed', paidBy: 'bank', bankReference: 'OZI-ABCD' });
    const payBack = await make({
      status: 'delivered',
      reimbursementStatus: 'waiting',
      reimbursementPence: 1230,
      reimbursementReason: 'no receipt photo',
    });
    // No alert phone: nobody is rung, but everything is on the desk.
    expect(await sweep()).toEqual({ called: false, reason: 'not-set-up' });
    const matters = await harness.repository.ownerDesk.listUnsettled();
    expect(matters.map((matter) => [matter.kind, matter.subjectId]).sort()).toEqual(
      [
        ['bank_transfer', bank.id],
        ['pay_back', payBack.id],
        ['waiting_order', waiting.id],
      ].sort(),
    );
    expect(matters.find((m) => m.kind === 'pay_back')!.summary).toMatch(/£12\.30/);
    // Once a person deals with it in its own tab, it settles by itself.
    await harness.repository.orders.update(bank.id, { status: 'paid' });
    await sweep();
    const left = await harness.repository.ownerDesk.listUnsettled();
    expect(left.map((m) => m.kind)).not.toContain('bank_transfer');
  });

  it('never says a telephone or card number', () => {
    expect(spokenSafe('Ring 07700 900123 or 4242 4242 4242 4242, or a@b.co')).toBe(
      'Ring a number or a number, or an email address',
    );
  });
});

/* ================================================================== the call */

describe('the call', () => {
  it('refuses anything Twilio did not sign', async () => {
    await build();
    await aMatter();
    await sweep();
    const response = await twilio(pathOf(rang[0]!.url), { CallSid: 'CA1' }, false);
    expect(response.statusCode).toBe(403);
  });

  it('greets Mr. Anthony, reads each matter with its keys, and the keypad does what the panel would', async () => {
    await build(START, { codeDelivery: 'sms' });
    // A Runner document to decide.
    const runner = await runnerSigningUp();
    const sent = await sendDocument(runner.headers, {
      kind: 'dbs',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    const documentId = sent.json().document.id as string;
    // A shop product to decide, and feedback only to hear.
    const shop = await harness.repository.partnerShops.create({
      name: 'Corner Bakery',
      address: '12 High Street',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'shop',
      status: 'approved',
      source: 'staff',
    });
    const product = await harness.repository.partnerProducts.create({
      partnerShopId: shop.id,
      name: 'Sourdough loaf',
      pricePence: 350,
      tags: '',
      expiresOn: null,
      photo: null,
      photoType: null,
    });
    await askOwner(harness.app.ctx, {
      kind: 'partner_product',
      subjectId: product.id,
      summary: 'Corner Bakery added Sourdough loaf, £3.50.',
      options: 'decide',
    });
    later(1000);
    await aMatter('A Shopper gave 1 star for order OZ-AAAAAA.');

    const result = await sweep();
    expect(result.called).toBe(true);
    expect(rang).toHaveLength(1);
    expect(rang[0]!.to).toBe(OWNER_PHONE);
    // Twilio's answering machine detection, so a voicemail is not him picking up.
    expect(rang[0]!.options).toEqual({ machineDetection: true });
    // A text alongside the first call, as a backup: how many, never what.
    expect(texts).toEqual([
      expect.objectContaining({
        to: OWNER_PHONE,
        body: expect.stringMatching(/about three things/),
      }),
    ]);

    const hello = await answer();
    expect(hello.statusCode).toBe(200);
    expect(hello.body).toContain('<Gather input="dtmf" numDigits="1"');
    expect(spoken(hello.body)).toMatch(
      /^Hello, Mr\. Anthony\. This is Ozi\. Three things need you\. The first\. Runner Chidi Okafor's DBS certificate needs you\..*Press 1 to approve, 2 to decline, 3 to decide later\.$/,
    );

    // 1: approve the document, exactly as the Documents tab would.
    const second = await press(hello.body, '1');
    expect(spoken(second.body)).toMatch(
      /^Approved\. The second\. Corner Bakery added Sourdough loaf/,
    );
    const document = await harness.repository.runnerDocuments.findById(documentId);
    expect(document).toEqual(
      expect.objectContaining({ status: 'accepted', reviewedBy: 'Mr. Anthony, by phone' }),
    );
    const checks = await harness.repository.runnerChecks.listForRunner(runner.id);
    expect(checks).toEqual([
      expect.objectContaining({ kind: 'criminal_record', outcome: 'verified' }),
    ]);

    // Silence: said once more, then 2: decline the product.
    const again = await press(second.body, '');
    expect(spoken(again.body)).toMatch(/^I'll say that again\. The second\. Corner Bakery/);
    const third = await press(again.body, '2');
    expect(spoken(third.body)).toMatch(
      /^Declined\. The third, and last\. A Shopper gave 1 star.*Press 1 if you have heard it, 3 to hear it later\.$/,
    );
    expect((await harness.repository.partnerProducts.findById(product.id))?.status).toBe(
      'rejected',
    );

    // 1 on something only to hear: heard. Then goodbye.
    const end = await press(third.body, '1');
    expect(spoken(end.body)).toBe("Thank you. That's everything. Goodbye, Mr. Anthony.");
    expect(end.body).toContain('<Hangup/>');

    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(0);
    const audit = await harness.repository.audit.list({ search: 'owner-desk.decided' });
    expect(audit).toHaveLength(3);
    expect(audit.every((entry) => entry.actorName === 'Mr. Anthony')).toBe(true);
    expect(audit.map((entry) => entry.detail).join(' ')).toMatch(/by phone/);
  });

  it('silence twice moves on and keeps it for the next call; 3 puts it off for an hour', async () => {
    await build();
    await aMatter('First thing.');
    later(1000);
    await aMatter('Second thing.');
    await sweep();
    const hello = await answer();
    const repeated = await press(hello.body, '');
    const moved = await press(repeated.body, '');
    expect(spoken(moved.body)).toMatch(
      /^I'll keep that one for next time\. The second, and last\. Second thing\./,
    );
    const done = await press(moved.body, '3');
    expect(spoken(done.body)).toBe(
      "Left for later. I will ask you again in an hour. That's everything. Goodbye, Mr. Anthony.",
    );
    const matters = await harness.repository.ownerDesk.listUnsettled();
    const second = matters.find((m) => m.summary === 'Second thing.')!;
    expect(second.status).toBe('later');
    // An hour later (Anthony, 22 October 2026).
    expect(second.laterUntil?.getTime()).toBe(harness.now().getTime() + 60 * 60_000);
    expect(matters.find((m) => m.summary === 'First thing.')!.status).toBe('open');
  });

  it('a voicemail is not him picking up: Ozi puts the phone down and rings again', async () => {
    await build();
    await aMatter();
    await sweep();
    const machine = await answer('machine_start');
    expect(machine.body).toBe('<Response><Hangup/></Response>');
    await status('completed');
    const [call] = await harness.repository.ownerDesk.latestCalls(1);
    expect(call?.status).toBe('voicemail');
    later(minutes(2));
    const next = await sweep();
    expect(next).toEqual(
      expect.objectContaining({ called: true, call: expect.objectContaining({ attempt: 2 }) }),
    );
  });
});

/* ================================================================== escalation */

describe('ringing until he answers, exactly as Anthony asked', () => {
  it('three calls about two minutes apart, an hour, three more; new matters join; stops once answered', async () => {
    await build();
    await aMatter();

    // The first call of the first run, with a text.
    expect((await sweep()).called).toBe(true);
    expect(texts).toHaveLength(1);
    // Ringing: no second call on top of it.
    later(minutes(1) / 2);
    expect(await sweep()).toEqual({ called: false, reason: 'ringing' });
    await status('no-answer');

    // Two minutes after that one ended, the second; then the third.
    later(minutes(1));
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    later(minutes(1));
    expect(await sweep()).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ cascade: 1, attempt: 2 }),
      }),
    );
    await status('busy');
    // A new matter while the run is going joins it rather than starting another.
    await aMatter('Something new.');
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    later(minutes(2));
    expect(await sweep()).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ cascade: 1, attempt: 3, matterCount: 2 }),
      }),
    );
    await status('no-answer');
    // Only one text for the whole run.
    expect(texts).toHaveLength(1);

    // After the third unanswered call: an hour.
    later(minutes(2));
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    later(minutes(57));
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    later(minutes(1));
    expect(await sweep()).toEqual(
      expect.objectContaining({
        called: true,
        call: expect.objectContaining({ cascade: 2, attempt: 1 }),
      }),
    );
    // A text again with the first call of the new run.
    expect(texts).toHaveLength(2);

    // He answers and hears both; one he puts to later, one he has heard.
    const hello = await answer();
    const second = await press(hello.body, '1');
    await press(second.body, '3');
    await status('completed');
    later(minutes(5));
    expect(await sweep()).toEqual({ called: false, reason: 'nothing-open' });
    expect(rang).toHaveLength(4);

    // An hour after he put it to later, it is rung about again (Anthony, 22 October 2026).
    later(minutes(54));
    expect(await sweep()).toEqual({ called: false, reason: 'nothing-open' });
    later(minutes(1));
    expect(await sweep()).toEqual(
      expect.objectContaining({ called: true, call: expect.objectContaining({ attempt: 1 }) }),
    );
  });

  it('a matter decided in the admin panel first is not rung about', async () => {
    await build();
    const matter = await aMatter();
    const decided = await harness.app.inject({
      method: 'POST',
      url: `/staff/desk/${matter.id}`,
      headers: STAFF,
      payload: { choice: 'acknowledge' },
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect(await sweep()).toEqual({ called: false, reason: 'nothing-open' });
    expect(rang).toHaveLength(0);
  });

  it('after he picks up and leaves something unanswered, waits an hour; a new thing is rung about soon', async () => {
    await build();
    await aMatter('Heard but not answered.');
    await sweep();
    const hello = await answer();
    const repeated = await press(hello.body, '');
    await press(repeated.body, '');
    await status('completed');
    later(minutes(10));
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    await aMatter('Brand new.');
    later(minutes(2));
    expect((await sweep()).called).toBe(true);
  });

  it('no calls in quiet hours (22:50 to 06:00 UK time, Anthony 22 October 2026) unless urgent', async () => {
    // 23:30 in the UK.
    await build(new Date('2026-10-22T22:30:00.000Z'));
    await aMatter();
    expect(await sweep()).toEqual({ called: false, reason: 'quiet-hours' });
    expect(rang).toHaveLength(0);
    await aMatter('Urgent. Runner Tomasz pressed SOS.', true);
    const urgent = await sweep();
    expect(urgent.called).toBe(true);
    // The urgent one is read first.
    const hello = await answer();
    expect(spoken(hello.body)).toMatch(/Two things need you\. The first\. Urgent\. Runner Tomasz/);
  });

  it('an urgent matter does not wait for the hour between runs', async () => {
    await build();
    await aMatter();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sweep();
      await status('no-answer');
      later(minutes(2));
    }
    expect(await sweep()).toEqual({ called: false, reason: 'waiting' });
    await aMatter('Urgent. SOS.', true);
    expect((await sweep()).called).toBe(true);
  });

  it('knows the UK clock: quiet hours across midnight, and nine the next morning in winter too', () => {
    expect(inQuietHours(new Date('2026-10-22T19:59:00Z'), '21:00', '08:00')).toBe(false);
    expect(inQuietHours(new Date('2026-10-22T20:00:00Z'), '21:00', '08:00')).toBe(true);
    expect(inQuietHours(new Date('2026-10-23T06:59:00Z'), '21:00', '08:00')).toBe(true);
    expect(inQuietHours(new Date('2026-10-23T07:00:00Z'), '21:00', '08:00')).toBe(false);
    // After the clocks go back on 25 October, 9:00 UK time is 9:00 UTC.
    expect(nextDayAt(new Date('2026-10-26T15:00:00Z'), '09:00').toISOString()).toBe(
      '2026-10-27T09:00:00.000Z',
    );
  });
});

/* ================================================================== the admin panel */

describe('the desk on the "Needs you now" page', () => {
  it('lists the open matters, and Approve does what the panel always did', async () => {
    await build();
    const shop = await harness.repository.partnerShops.create({
      name: 'Corner Bakery',
      address: '12 High Street',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'shop',
      status: 'pending',
      source: 'self',
    });
    const matter = (await askOwner(harness.app.ctx, {
      kind: 'partner_shop',
      subjectId: shop.id,
      summary: 'A new shop, Corner Bakery, in ME7, has joined and is waiting for approval.',
      options: 'decide',
    }))!;
    const listed = await harness.app.inject({ method: 'GET', url: '/staff/desk', headers: STAFF });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().matters).toEqual([
      expect.objectContaining({ id: matter.id, options: 'decide', status: 'open' }),
    ]);
    const approved = await harness.app.inject({
      method: 'POST',
      url: `/staff/desk/${matter.id}`,
      headers: STAFF,
      payload: { choice: 'approve' },
    });
    expect(approved.json().message).toBe('Approved.');
    expect((await harness.repository.partnerShops.findById(shop.id))?.status).toBe('approved');
    const audit = await harness.repository.audit.list({ search: 'owner-desk.decided' });
    expect(audit[0]?.detail).toMatch(/Approved in the admin panel/);
  });
});

/* ================================================================== the automatic check */

function clearReading(input: DocumentCheckInput): DocumentReading {
  const named = ['right_to_work', 'dbs', 'driving_licence_front', 'insurance'].includes(input.kind);
  return {
    kindMatches: true,
    readable: true,
    nameOnDocument: named ? 'OKAFOR, CHIDI EMEKA' : null,
    expiresOn: input.kind === 'right_to_work' ? '2031-05-01' : null,
    dbsRecordsSomething: input.kind === 'dbs' ? false : null,
    clearRealFace: input.kind === 'face_photo' ? true : null,
    samePerson: input.idPhoto ? true : null,
    concern: null,
    confidence: 0.97,
  };
}

function standInBrain(
  document: (input: DocumentCheckInput) => DocumentReading | null = clearReading,
  product: (input: ProductCheckInput) => ProductReading | null = () => ({
    verdict: 'allowed',
    offensive: false,
    photoMatches: null,
    priceSensible: true,
    concern: null,
    confidence: 0.95,
  }),
): OziBrain & { asked: DocumentCheckInput[] } {
  const asked: DocumentCheckInput[] = [];
  return {
    name: 'model',
    model: 'stand-in',
    asked,
    understand: async () => null,
    checkDocument: async (input) => {
      asked.push(input);
      return document(input);
    },
    checkProduct: async (input) => product(input),
  };
}

async function fullApplication(headers: Record<string, string>) {
  for (const kind of ['face_photo', 'right_to_work', 'dbs']) {
    const sent = await sendDocument(headers, { kind, image: PHOTO, contentType: 'image/jpeg' });
    expect(sent.statusCode, sent.body).toBe(201);
  }
}

describe('the automatic check of Runner documents', () => {
  it('approves a whole application automatically when every check is clearly fine, with consent', async () => {
    const brain = standInBrain();
    await build(START, { brain });
    const runner = await runnerSigningUp();
    const consent = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/face-match-consent',
      headers: runner.headers,
      payload: { agree: true },
    });
    expect(consent.json().faceMatchConsent).toBe(true);
    await sendDocument(runner.headers, {
      kind: 'face_photo',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    // Read and passed, but waiting for the rest of the application.
    let documents = await harness.repository.runnerDocuments.listForRunner(runner.id);
    expect(documents[0]).toEqual(
      expect.objectContaining({ status: 'submitted', checkPassed: true }),
    );
    await sendDocument(runner.headers, {
      kind: 'right_to_work',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    await sendDocument(runner.headers, { kind: 'dbs', image: PHOTO, contentType: 'image/jpeg' });
    documents = await harness.repository.runnerDocuments.listForRunner(runner.id);
    expect(documents.map((d) => d.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(documents.every((d) => d.reviewedBy === 'The automatic check')).toBe(true);
    // The face photo was compared with the passport photo, because they agreed.
    expect(brain.asked.some((input) => input.kind === 'face_photo' && input.idPhoto)).toBe(true);
    const stored = await harness.repository.runners.findById(runner.id);
    expect(stored).toEqual(
      expect.objectContaining({ rightToWorkVerified: true, criminalRecordCheckVerified: true }),
    );
    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(0);
    const audit = await harness.repository.audit.list({ search: 'automatic-check' });
    expect(audit.some((entry) => /Approved: DBS certificate/.test(entry.detail))).toBe(true);
    expect(audit.every((entry) => entry.actorName === 'The automatic check')).toBe(true);
  });

  it('never compares faces without consent: the owner is asked instead', async () => {
    const brain = standInBrain();
    await build(START, { brain });
    const runner = await runnerSigningUp();
    await fullApplication(runner.headers);
    expect(brain.asked.some((input) => input.idPhoto)).toBe(false);
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter).toEqual(
      expect.objectContaining({ kind: 'runner_application', subjectId: runner.id }),
    );
    expect(matter!.summary).toMatch(/did not agree to the automatic face comparison/);
    const documents = await harness.repository.runnerDocuments.listForRunner(runner.id);
    expect(documents.every((d) => d.status === 'submitted')).toBe(true);
  });

  it('something recorded on the DBS goes to the owner, never refused by itself', async () => {
    await build(START, {
      brain: standInBrain((input) => ({
        ...clearReading(input),
        dbsRecordsSomething: input.kind === 'dbs' ? true : null,
      })),
    });
    const runner = await runnerSigningUp();
    await sendDocument(runner.headers, { kind: 'dbs', image: PHOTO, contentType: 'image/jpeg' });
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter?.summary).toMatch(/DBS certificate needs you\. Something is recorded on it\./);
    const [document] = await harness.repository.runnerDocuments.listForRunner(runner.id);
    expect(document?.status).toBe('submitted');
  });

  it('a name that does not match, an expired document or a low confidence goes to the owner', async () => {
    await build(START, {
      brain: standInBrain((input) => ({
        ...clearReading(input),
        nameOnDocument: 'JOHN SMITH',
        expiresOn: '2025-01-01',
      })),
    });
    const runner = await runnerSigningUp();
    await sendDocument(runner.headers, {
      kind: 'right_to_work',
      image: PHOTO,
      contentType: 'image/jpeg',
    });
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter?.summary).toMatch(
      /It has expired and the name on it does not match the name on the account\./,
    );
  });

  it('checks what was already waiting when the server starts, once', async () => {
    await build(START, { brain: standInBrain() });
    const runner = await runnerSigningUp();
    const document = await harness.repository.runnerDocuments.create({
      runnerId: runner.id,
      kind: 'dbs',
      image: Buffer.from('old photo'),
      contentType: 'image/jpeg',
      shareCode: null,
      expiresOn: null,
      status: 'submitted',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(START.getTime() - 86_400_000),
    });
    const report = await checkWaiting(harness.app.ctx);
    expect(report.documents).toBe(1);
    expect((await harness.repository.runnerDocuments.findById(document.id))?.checkPassed).toBe(
      true,
    );
    expect((await checkWaiting(harness.app.ctx)).documents).toBe(0);
  });
});

describe('the automatic check of shop products', () => {
  async function shopWith(kind: 'shop' | 'service' = 'shop') {
    return harness.repository.partnerShops.create({
      name: 'Corner Bakery',
      address: '12 High Street',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind,
      status: 'approved',
      source: 'staff',
    });
  }
  async function pending(name: string, pricePence = 350) {
    const shop = await shopWith();
    return harness.repository.partnerProducts.create({
      partnerShopId: shop.id,
      name,
      pricePence,
      tags: '',
      expiresOn: null,
      photo: null,
      photoType: null,
    });
  }

  it('approves a clear one automatically, into the catalogue', async () => {
    await build(START, { brain: standInBrain() });
    const product = await pending('Sourdough loaf');
    await checkPartnerProduct(harness.app.ctx, product.id);
    const checked = await harness.repository.partnerProducts.findById(product.id);
    expect(checked?.status).toBe('approved');
    expect(checked?.catalogueItemId).not.toBeNull();
    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(0);
  });

  it('refuses by itself only by the rule lists: never brought, or over the most one product may cost', async () => {
    await build(START, { brain: standInBrain() });
    const lager = await pending('Lager, 4 pack');
    await checkPartnerProduct(harness.app.ctx, lager.id);
    expect(await harness.repository.partnerProducts.findById(lager.id)).toEqual(
      expect.objectContaining({
        status: 'rejected',
        note: expect.stringMatching(/never brings alcohol/),
      }),
    );
    const dear = await pending('Hamper', 7000);
    await checkPartnerProduct(harness.app.ctx, dear.id);
    expect((await harness.repository.partnerProducts.findById(dear.id))?.status).toBe('rejected');
  });

  it('a price that is only an estimate (ruling 75) goes to the owner, and approving it approves the estimate', async () => {
    await build(START, { brain: standInBrain() });
    const shop = await shopWith();
    const product = await harness.repository.partnerProducts.create({
      partnerShopId: shop.id,
      name: 'Braeburn apples, 6 pack',
      pricePence: 240,
      tags: '',
      expiresOn: null,
      photo: null,
      photoType: null,
      priceEstimated: true,
    });
    await checkPartnerProduct(harness.app.ctx, product.id);
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter?.summary).toMatch(/Its price is an estimate.*Approve the estimate\?/);
    const approved = await harness.app.inject({
      method: 'POST',
      url: `/staff/desk/${matter!.id}`,
      headers: STAFF,
      payload: { choice: 'approve' },
    });
    expect(approved.json().message).toBe('Approved.');
    expect(await harness.repository.partnerProducts.findById(product.id)).toEqual(
      expect.objectContaining({ status: 'approved', priceEstimated: false }),
    );
  });

  it('a doubtful one, judged by the automatic check, goes to the owner and stays waiting', async () => {
    await build(START, {
      brain: standInBrain(clearReading, () => ({
        verdict: 'restricted',
        offensive: false,
        photoMatches: null,
        priceSensible: true,
        concern: 'It may be an energy drink sold only to adults.',
        confidence: 0.6,
      })),
    });
    const product = await pending('Rocket Fuel can');
    await checkPartnerProduct(harness.app.ctx, product.id);
    expect((await harness.repository.partnerProducts.findById(product.id))?.status).toBe('pending');
    const [matter] = await harness.repository.ownerDesk.listUnsettled();
    expect(matter?.summary).toMatch(
      /Corner Bakery added Rocket Fuel can, £3\.50\. The automatic check was not sure: it may be something we do not sell\./,
    );
  });
});
