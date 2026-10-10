/**
 * The Shopper's order page and after (STILL_TO_DO items 6, 7 and 10): an arrival time that is
 * honest and moves with the order, the door safe word both sides see, and feedback that earns
 * delivery credit whatever it says, with shops shown patterns only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FEEDBACK_PATTERN_MINIMUM } from '@aldilivery/core';

import { FIRST_WORDS, SECOND_WORDS, newDoorWord } from '../src/services/door-word.js';
import { estimateArrival, type EtaInput } from '../src/services/eta.js';
import { feedbackPatterns } from '../src/services/feedback.js';
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

const NOW = new Date('2026-10-09T10:00:00.000Z');

function eta(overrides: Partial<EtaInput>) {
  return estimateArrival({
    status: 'paid',
    now: NOW,
    acceptedAt: null,
    itemCount: 5,
    travelMode: 'bicycle',
    runner: null,
    door: { latitude: null, longitude: null },
    ...overrides,
  });
}

describe('the arrival time', () => {
  it('is always "about", a range, never a promise to the minute', () => {
    const paid = eta({ status: 'paid' });
    expect(paid?.words).toMatch(/^about \d+ to \d+ minutes$/);
    expect(paid!.toMinutes).toBeGreaterThan(paid!.fromMinutes);
  });

  it('comes closer as the order moves on', () => {
    const accepted = new Date(NOW.getTime() - 5 * 60_000);
    const stages = (
      ['paid', 'accepted', 'shopping', 'receipt_submitted', 'delivering'] as const
    ).map((status) => eta({ status, acceptedAt: accepted })!.toMinutes);
    for (let index = 1; index < stages.length; index += 1) {
      expect(stages[index]).toBeLessThanOrEqual(stages[index - 1]!);
    }
  });

  it('uses how far the Runner is from the door, once they are on the way', () => {
    const door = { latitude: 51.39, longitude: 0.55 };
    const near = eta({
      status: 'delivering',
      door,
      runner: { latitude: 51.391, longitude: 0.551 },
    });
    const far = eta({ status: 'delivering', door, runner: { latitude: 51.45, longitude: 0.65 } });
    expect(near!.toMinutes).toBeLessThan(far!.toMinutes);
    expect(near?.words).toBe('about 5 to 10 minutes');
  });

  it('is gone once it has arrived', () => {
    expect(eta({ status: 'delivered' })).toBeNull();
    expect(eta({ status: 'completed' })).toBeNull();
  });
});

describe('the door safe word', () => {
  it('is two everyday words, never a number', () => {
    for (let index = 0; index < 50; index += 1) {
      const [first, second, extra] = newDoorWord().split(' ');
      expect(FIRST_WORDS).toContain(first);
      expect(SECOND_WORDS).toContain(second);
      expect(extra).toBeUndefined();
    }
    expect([...FIRST_WORDS, ...SECOND_WORDS].join(' ')).not.toMatch(/\d/);
  });
});

describe('the order page and the Runner’s job', () => {
  let harness: TestHarness;
  let shopper: SignedInShopper;
  let runner: SignedInRunner;
  let orderId: string;

  function post(url: string, payload: object, headers: Record<string, string> = {}) {
    return harness.app.inject({ method: 'POST', url, payload, headers });
  }
  const current = async () =>
    (
      await harness.app.inject({
        method: 'GET',
        url: '/orders/current',
        headers: shopper.authHeader,
      })
    ).json().order;

  beforeEach(async () => {
    harness = await buildTestApp(NOW, { autoOffer: true });
    const { milk } = await seedCatalogue(harness.repository);
    shopper = await signUpShopper(harness);
    runner = await signUpRunner(harness, { name: 'Tomasz Nowak' });
    const placed = await post(
      '/orders',
      {
        lines: [{ catalogueItemId: milk, quantity: 2 }],
        deliveryAddress: '12 Example Street',
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
    orderId = placed.json().order.id;
  });

  afterEach(async () => {
    await harness.close();
  });

  async function accept() {
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    expect((await post(`/jobs/${offer.id}/accept`, {}, runner.authHeader)).statusCode).toBe(200);
  }

  it('shows an arrival time from the moment it is paid', async () => {
    const order = await current();
    expect(order.eta.words).toMatch(/^about \d+ to \d+ minutes$/);
    expect(order.doorWord).toBeNull();
  });

  it('gives the Shopper and the Runner the same two words once a Runner has it', async () => {
    await accept();
    const order = await current();
    expect(order.doorWord).toMatch(/^[a-z]+ [a-z]+$/);
    expect(order.doorWordSentence).toBe(
      `Your Runner is Tomasz. At your door they will say "${order.doorWord}". If they do not, you do not need to open the door.`,
    );
    const job = (
      await harness.app.inject({ method: 'GET', url: '/jobs/current', headers: runner.authHeader })
    ).json().job;
    expect(job.doorWord).toBe(order.doorWord);
    // The same words every time it is asked.
    expect((await current()).doorWord).toBe(order.doorWord);
  });

  it('never gives anybody a telephone number', async () => {
    await accept();
    const page = JSON.stringify(await current());
    expect(page).not.toContain('+447700900101');
    expect(page).not.toMatch(/07700/);
  });

  describe('feedback after delivery', () => {
    async function deliver() {
      await accept();
      for (const status of ['shopping'] as const) {
        await post(`/orders/${orderId}/status`, { status }, runner.authHeader);
      }
      await post(`/orders/${orderId}/receipt`, { receiptTotalPence: 250 }, runner.authHeader);
      await post(`/orders/${orderId}/status`, { status: 'delivering' }, runner.authHeader);
      await post(`/orders/${orderId}/status`, { status: 'delivered' }, runner.authHeader);
    }

    it('waits until the shopping has arrived', async () => {
      const early = await post(`/orders/${orderId}/feedback`, { rating: 5 }, shopper.authHeader);
      expect(early.statusCode).toBe(409);
    });

    it('earns the delivery credit for anything at all, even a complaint, once per order', async () => {
      await deliver();
      expect((await current()).feedbackGiven).toBe(false);
      const given = await post(
        `/orders/${orderId}/feedback`,
        { rating: 1, themes: ['late', 'missing', 'nonsense'], message: 'It was late.' },
        shopper.authHeader,
      );
      expect(given.statusCode, given.body).toBe(201);
      expect(given.json().creditPence).toBe(100);
      expect(given.json().message).toContain('£1.00 of delivery credit');
      expect((await harness.repository.shoppers.findById(shopper.shopperId))?.creditPence).toBe(
        100,
      );
      expect((await current()).feedbackGiven).toBe(true);

      const again = await post(`/orders/${orderId}/feedback`, { rating: 5 }, shopper.authHeader);
      expect(again.statusCode).toBe(409);
      expect((await harness.repository.shoppers.findById(shopper.shopperId))?.creditPence).toBe(
        100,
      );
      // Only the themes on the list are kept.
      expect((await harness.repository.shopperFeedback.findByOrderId(orderId))?.themes).toBe(
        'late,missing',
      );
    });

    it('needs something to have been said', async () => {
      await deliver();
      expect((await post(`/orders/${orderId}/feedback`, {}, shopper.authHeader)).statusCode).toBe(
        400,
      );
    });

    it('is only the Shopper’s own to give', async () => {
      await deliver();
      const other = await signUpShopper(harness, { phone: '+447700900002' });
      expect(
        (await post(`/orders/${orderId}/feedback`, { rating: 4 }, other.authHeader)).statusCode,
      ).toBe(403);
    });

    it('shows staff no names, and patterns only once there are enough', async () => {
      await deliver();
      await post(
        `/orders/${orderId}/feedback`,
        { message: 'Lovely, thank you.' },
        shopper.authHeader,
      );
      const staff = await harness.app.inject({
        method: 'GET',
        url: '/staff/shopper-feedback',
        headers: STAFF,
      });
      expect(staff.statusCode).toBe(200);
      expect(staff.json().recent[0].message).toBe('Lovely, thank you.');
      expect(JSON.stringify(staff.json())).not.toContain('Margaret');
      expect(staff.json().patterns).toMatchObject({ tooFew: true, themes: [] });
    });
  });
});

describe('patterns for shops', () => {
  const row = (themes: string, rating: number | null = 4) => ({
    id: 'f',
    orderId: 'o',
    rating,
    themes,
    message: 'Words a shop must never see.',
    creditPence: 100,
    createdAt: NOW,
  });

  it('shows nothing at all below the minimum, so nobody can be picked out', () => {
    const few = Array.from({ length: FEEDBACK_PATTERN_MINIMUM - 1 }, () => row('late'));
    expect(feedbackPatterns(few)).toEqual({
      count: FEEDBACK_PATTERN_MINIMUM - 1,
      averageRating: null,
      themes: [],
      tooFew: true,
    });
  });

  it('counts each theme, most raised first, with no words and nobody named', () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row('late,missing', 2)),
      ...Array.from({ length: 4 }, () => row('on_time', 5)),
    ];
    const patterns = feedbackPatterns(rows);
    expect(patterns.tooFew).toBe(false);
    expect(patterns.averageRating).toBe(3.2);
    expect(patterns.themes.map((theme) => [theme.theme, theme.count])).toEqual([
      ['late', 6],
      ['missing', 6],
      ['on_time', 4],
    ]);
    expect(JSON.stringify(patterns)).not.toContain('Words a shop must never see');
  });
});
