/**
 * When something goes wrong (rulings of 2 October 2026): reports with voice notes, photos and
 * notes from either side, small refunds given straight away, a person's written decision within
 * two working days, and a Runner found at fault repaying 10% of each job until it is repaid.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { addWorkingDays } from '../src/routes/problems.js';
import { payOutOrder } from '../src/services/pay-runner.js';
import {
  STAFF,
  buildTestApp,
  seedCatalogue,
  signUpRunner,
  signUpShopper,
  type SignedInRunner,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let orderId: string;

// A Friday, so the two working days run over a weekend.
const FRIDAY = new Date('2026-10-02T10:00:00.000Z');

beforeEach(async () => {
  harness = await buildTestApp(FRIDAY, { autoOffer: true });
  const items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Gillingham, ME7 1AA',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order.',
        agreedTotalPence: 1600,
      },
    },
  });
  orderId = placed.json().order.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  await harness.app.inject({
    method: 'POST',
    url: `/jobs/${offer.id}/accept`,
    headers: runner.authHeader,
  });
  await harness.repository.orders.update(orderId, { status: 'delivered', deliveredAt: FRIDAY });
});

function report(who: { authHeader: Record<string, string> }, payload: object) {
  return harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/problems`,
    headers: who.authHeader,
    payload,
  });
}

function refunds() {
  return harness.payments.calls.filter((call) => call.kind === 'refund').map((call) => call.input);
}

describe('reporting', () => {
  it('is open to the Runner of the job, with a decision due two working days later', async () => {
    const response = await report(runner, {
      summary: 'The eggs broke when the bag split on the stairs.',
    });
    expect(response.statusCode, response.body).toBe(201);
    const { report: made } = response.json();
    expect(made).toMatchObject({ reportedBy: 'runner', status: 'open' });
    // Friday, then Monday and Tuesday: due Tuesday.
    expect(new Date(made.decideBy).toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(response.json().message).toMatch(/decide by Tuesday 6 October/);
  });

  it('is closed to anybody not on the order', async () => {
    const stranger = await signUpShopper(harness, { phone: '+447700900222' });
    expect((await report(stranger, { summary: 'Not mine' })).statusCode).toBe(404);
  });

  it('takes voice notes, photos and notes from either side, and keeps the files for staff only', async () => {
    const made = (await report(runner, { summary: 'Split bag.' })).json().report;
    const voice = await harness.app.inject({
      method: 'POST',
      url: `/problems/${made.id}/evidence`,
      headers: runner.authHeader,
      payload: {
        kind: 'voice_note',
        data: Buffer.from('pretend audio').toString('base64'),
        contentType: 'audio/webm;codecs=opus',
      },
    });
    expect(voice.statusCode, voice.body).toBe(201);
    expect(voice.json().message).toBe('Your voice note is sent.');
    await harness.app.inject({
      method: 'POST',
      url: `/problems/${made.id}/evidence`,
      headers: shopper.authHeader,
      payload: { kind: 'note', text: 'Two eggs were cracked, the rest were fine.' },
    });
    const listed = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/problems`,
      headers: shopper.authHeader,
    });
    const evidence = listed.json().reports[0].evidence;
    expect(
      evidence.map((e: { kind: string; addedBy: string }) => `${e.addedBy}:${e.kind}`),
    ).toEqual(['runner:voice_note', 'shopper:note']);
    expect(listed.body).not.toContain('pretend audio');

    const file = await harness.app.inject({
      method: 'GET',
      url: `/staff/evidence/${evidence[0].id}`,
      headers: STAFF,
    });
    expect(file.rawPayload.toString()).toBe('pretend audio');
    expect(
      (await harness.app.inject({ method: 'GET', url: `/staff/evidence/${evidence[0].id}` }))
        .statusCode,
    ).toBe(403);
  });
});

describe('refunds', () => {
  it('gives £5 or less back straight away, never counted against anyone', async () => {
    const response = await report(shopper, {
      summary: 'The milk was out of date.',
      refundRequestedPence: 250,
    });
    expect(response.json().report).toMatchObject({
      status: 'decided',
      decision: 'no_fault',
      refundPence: 250,
    });
    expect(response.json().message).toBe(
      '£2.50 is on its way back to your card. Your bank may take a few days to show it.',
    );
    expect(refunds()).toEqual([expect.objectContaining({ amountPence: 250 })]);
    expect(await harness.repository.recoveries.listOutstanding(runner.runnerId)).toEqual([]);
  });

  it('sends anything more to a person, who sees it with the soonest due first', async () => {
    await report(shopper, { summary: 'Half the shopping was missing.', refundRequestedPence: 800 });
    expect(refunds()).toEqual([]);
    const open = await harness.app.inject({
      method: 'GET',
      url: '/staff/problems',
      headers: STAFF,
    });
    expect(open.json().reports[0]).toMatchObject({ refundRequestedPence: 800, overdue: false });
    harness.setNow(new Date('2026-10-07T09:00:00.000Z'));
    const later = await harness.app.inject({
      method: 'GET',
      url: '/staff/problems',
      headers: STAFF,
    });
    expect(later.json().reports[0].overdue).toBe(true);
  });

  it('refuses more than the order cost', async () => {
    const response = await report(shopper, { summary: 'Everything.', refundRequestedPence: 99999 });
    expect(response.statusCode).toBe(400);
  });
});

describe('a person deciding', () => {
  async function decide(payload: object) {
    const made = (
      await report(shopper, {
        summary: 'The bag split and the jar broke.',
        refundRequestedPence: 800,
      })
    ).json().report;
    return harness.app.inject({
      method: 'POST',
      url: `/staff/problems/${made.id}/decide`,
      headers: STAFF,
      payload,
    });
  }

  it('must write the decision down, and gives no refund when the Shopper was responsible', async () => {
    expect((await decide({ decision: 'no_fault', refundPence: 0, by: 'Anthony' })).statusCode).toBe(
      400,
    );
    const response = await decide({
      decision: 'shopper_at_fault',
      refundPence: 800,
      note: 'The jar was dropped after it was handed over.',
      by: 'Anthony',
    });
    expect(response.statusCode).toBe(400);
  });

  it('refunds the Shopper and, with the Runner at fault, takes back 10% of each job until repaid', async () => {
    const response = await decide({
      decision: 'runner_at_fault',
      refundPence: 120,
      note: 'The bag was overfilled; heavy jars should go in a separate bag.',
      by: 'Anthony',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().report).toMatchObject({
      decision: 'runner_at_fault',
      decisionWords: 'The Runner was responsible.',
      refundPence: 120,
    });
    expect(refunds()).toEqual([expect.objectContaining({ amountPence: 120 })]);

    // First job after: 50p of £5 (10%), whatever else is held; the earning stays £5.
    const first = await payOutOrder(harness.app.ctx, orderId);
    expect(first.payout).toMatchObject({ earnedPence: 500, recoveryWithheldPence: 50 });
    expect(first.payout.transferredPence).toBe(500 - first.payout.coolBagWithheldPence - 50);
    expect(first.notes.join(' ')).toMatch(/£0\.50 went towards the refund/);

    const dashboard = await harness.app.inject({
      method: 'GET',
      url: '/runners/me/dashboard',
      headers: runner.authHeader,
    });
    expect(dashboard.json().owing).toEqual([
      expect.objectContaining({ amountPence: 120, recoveredPence: 50, remainingPence: 70 }),
    ]);
    expect(dashboard.json().owing[0].reason).toMatch(/overfilled/);
  });

  it('is decided once only', async () => {
    const made = (await report(runner, { summary: 'Something.' })).json().report;
    const decide1 = () =>
      harness.app.inject({
        method: 'POST',
        url: `/staff/problems/${made.id}/decide`,
        headers: STAFF,
        payload: {
          decision: 'no_fault',
          refundPence: 0,
          note: 'Nothing to put right.',
          by: 'Anthony',
        },
      });
    expect((await decide1()).statusCode).toBe(200);
    expect((await decide1()).statusCode).toBe(409);
  });
});

describe('working days', () => {
  it('skip Saturdays and Sundays', () => {
    expect(addWorkingDays(new Date('2026-10-05T10:00:00Z'), 2).toISOString().slice(0, 10)).toBe(
      '2026-10-07',
    );
    expect(addWorkingDays(new Date('2026-10-03T10:00:00Z'), 2).toISOString().slice(0, 10)).toBe(
      '2026-10-06',
    );
  });
});
