/**
 * "I cannot find this": the Runner asks, the Shopper answers on their own screen, and nobody's
 * phone number changes hands. If the Shopper does not answer in time, the item is left out and
 * not charged for — whatever they chose at sign-up (docs/BUILD_PROMPT.md, Section H).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { twilioSignature } from '../src/lib/twilio-voice.js';
import { QUESTION_WAIT_SECONDS } from '../src/services/questions.js';
import {
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
let milkLine: string;

beforeEach(async () => {
  harness = await buildTestApp(undefined, { autoOffer: true });
  const items = await seedCatalogue(harness.repository);
  shopper = await signUpShopper(harness);
  runner = await signUpRunner(harness);

  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 799,
      },
    },
  });
  expect(placed.statusCode, placed.body).toBe(201);
  orderId = (placed.json() as { order: { id: string } }).order.id;
  milkLine = (await harness.repository.orders.findById(orderId))!.items[0]!.id;
  const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
  await harness.app.inject({
    method: 'POST',
    url: `/jobs/${offer.id}/accept`,
    headers: runner.authHeader,
  });
});

function startShopping() {
  return harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/status`,
    headers: runner.authHeader,
    payload: { status: 'shopping' },
  });
}

function ask(headers = runner.authHeader) {
  return harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/questions`,
    headers,
    payload: { orderItemId: milkLine },
  });
}

function answer(questionId: string, value: 'similar' | 'leave_out', headers = shopper.authHeader) {
  return harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/questions/${questionId}/answer`,
    headers,
    payload: { answer: value },
  });
}

async function shopperView() {
  return (
    await harness.app.inject({ method: 'GET', url: '/orders/current', headers: shopper.authHeader })
  ).json();
}

describe('asking', () => {
  it('lets the Runner ask about one thing while shopping, and the Shopper sees it', async () => {
    await startShopping();
    const asked = await ask();
    expect(asked.statusCode).toBe(201);
    expect(asked.json().question).toMatchObject({
      itemName: expect.stringMatching(/milk/i),
      answer: null,
      secondsLeft: QUESTION_WAIT_SECONDS,
      // Nobody answering always means the item is left out.
      ifNoAnswer: 'leave_out',
    });

    const view = await shopperView();
    expect(view.order).toMatchObject({ id: orderId, status: 'shopping', runnerName: 'Tomasz' });
    expect(view.questions).toHaveLength(1);
  });

  it('asks once per item: asking again gives back the same question', async () => {
    await startShopping();
    const first = (await ask()).json().question.id;
    const again = await ask();
    expect(again.statusCode).toBe(200);
    expect(again.json().question.id).toBe(first);
  });

  it('is only for the Runner, and only while shopping', async () => {
    expect((await ask()).statusCode).toBe(409); // accepted, not shopping yet
    await startShopping();
    expect((await ask(shopper.authHeader)).statusCode).toBe(403);
    const other = await signUpRunner(harness, { phone: '+447700900202' });
    expect((await ask(other.authHeader)).statusCode).toBe(403);
  });
});

describe('answering', () => {
  it('takes the Shopper’s answer and shows it to the Runner', async () => {
    await startShopping();
    const id = (await ask()).json().question.id;

    const answered = await answer(id, 'similar');
    expect(answered.statusCode).toBe(200);
    expect(answered.json().message).toBe('Thank you. Your Runner will bring something similar.');

    const runnerSees = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
    });
    expect(runnerSees.json().questions[0]).toMatchObject({
      answer: 'similar',
      answeredBy: 'shopper',
      secondsLeft: 0,
    });
  });

  it('will not take an answer from the Runner, or a second answer', async () => {
    await startShopping();
    const id = (await ask()).json().question.id;
    expect((await answer(id, 'similar', runner.authHeader)).statusCode).toBe(403);
    await answer(id, 'leave_out');
    const second = await answer(id, 'similar');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.message).toBe('You have already answered: leave it out.');
  });

  it('leaves the item out when the Shopper cannot be reached in time', async () => {
    await startShopping();
    const id = (await ask()).json().question.id;
    harness.setNow(new Date(harness.now().getTime() + (QUESTION_WAIT_SECONDS + 1) * 1000));

    const view = await shopperView();
    expect(view.questions[0]).toMatchObject({ answer: 'leave_out', answeredBy: 'no_answer' });

    const late = await answer(id, 'similar');
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toBe(
      'We could not wait any longer, so your Runner has left it out. You will not be charged for it.',
    );
  });

  it('never substitutes silently, even for a Shopper who once chose "bring something similar"', async () => {
    await harness.repository.shoppers.update(shopper.shopperId, {
      substitutionDefault: 'similar_item',
    });
    await startShopping();
    await ask();
    harness.setNow(new Date(harness.now().getTime() + (QUESTION_WAIT_SECONDS + 1) * 1000));
    expect((await shopperView()).questions[0]).toMatchObject({
      answer: 'leave_out',
      answeredBy: 'no_answer',
      ifNoAnswer: 'leave_out',
    });
  });
});

describe('the Shopper’s own order', () => {
  it('is theirs alone', async () => {
    const other = await signUpShopper(harness, { phone: '+447700900999' });
    const theirs = await harness.app.inject({
      method: 'GET',
      url: '/orders/current',
      headers: other.authHeader,
    });
    expect(theirs.json()).toEqual({ order: null });
    const questions = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/questions`,
      headers: other.authHeader,
    });
    expect(questions.statusCode).toBe(403);
  });
});

/**
 * The question by text (16 October 2026): when no device of the Shopper's shows notifications,
 * the question is texted to their mobile with the two reply words, and SIMILAR or LEAVE texted
 * back answers it through Twilio's webhook. Nobody's number reaches the other.
 */
describe('a question by text', () => {
  const ORIGIN = 'https://shop.example.test';
  const TOKEN = 'twilio-auth-token-for-tests';
  let texts: Array<{ to: string; body: string }>;
  let pushes: number;

  async function withTexts(options: { push?: boolean } = {}) {
    texts = [];
    pushes = 0;
    const built = await buildTestApp(undefined, {
      autoOffer: true,
      env: { primaryOrigin: ORIGIN, twilioAuthToken: TOKEN },
      sendText: async (to, body) => {
        texts.push({ to, body });
      },
      ...(options.push
        ? {
            sendPush: async () => {
              pushes += 1;
              return 'sent' as const;
            },
          }
        : {}),
    });
    const items = await seedCatalogue(built.repository);
    const s = await signUpShopper(built);
    const r = await signUpRunner(built);
    const placed = await built.app.inject({
      method: 'POST',
      url: '/orders',
      headers: s.authHeader,
      payload: {
        lines: [{ catalogueItemId: items.milk, quantity: 2 }],
        deliveryAddress: '12 Example Street, Birmingham',
        paymentMethodId: s.paymentMethodId,
        confirmation: {
          confirmed: true,
          addressConfirmed: true,
          channel: 'button',
          statement: 'Send my order and pay.',
          agreedTotalPence: 250 + 100 + 799,
        },
      },
    });
    const id = (placed.json() as { order: { id: string } }).order.id;
    const line = (await built.repository.orders.findById(id))!.items[0]!.id;
    const offer = (await built.repository.offers.listForOrder(id))[0]!;
    await built.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: r.authHeader,
    });
    await built.app.inject({
      method: 'POST',
      url: `/orders/${id}/status`,
      headers: r.authHeader,
      payload: { status: 'shopping' },
    });
    return {
      built,
      s,
      r,
      id,
      ask: () =>
        built.app.inject({
          method: 'POST',
          url: `/orders/${id}/questions`,
          headers: r.authHeader,
          payload: { orderItemId: line },
        }),
      text: (from: string, body: string) => {
        const path = '/api/webhooks/twilio/sms';
        const params = { From: from, Body: body };
        return built.app.inject({
          method: 'POST',
          url: path,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-twilio-signature': twilioSignature(TOKEN, `${ORIGIN}${path}`, params),
          },
          payload: new URLSearchParams(params).toString(),
        });
      },
    };
  }

  it('texts the Shopper the question, the reply words and the five minutes, with no numbers in it', async () => {
    const { ask, built } = await withTexts();
    expect((await ask()).statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The order's own progress texts aside, one text: the question.
    const asked = texts.filter((text) => text.body.includes("can't find"));
    expect(asked).toHaveLength(1);
    expect(asked[0]!.to).toBe('+447700900001');
    // The product's name comes from config/store.json (Rule Nine), never written here.
    expect(asked[0]!.body.startsWith(`${harness.config.productName}: Tomasz can't find `)).toBe(
      true,
    );
    expect(asked[0]!.body).toMatch(
      /[Mm]ilk.*\. Reply SIMILAR for something similar, or LEAVE to leave it out\. If we don't hear from you in 5 minutes, it will be left out and you won't be charged for it\.$/,
    );
    expect(asked[0]!.body).not.toMatch(/\+44|07\d{3}/);
    await built.close();
  });

  it('does not text when the Shopper has a device that shows notifications', async () => {
    const { ask, built, s } = await withTexts({ push: true });
    await built.app.inject({
      method: 'POST',
      url: '/push-subscriptions',
      headers: s.authHeader,
      payload: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: { p256dh: 'BPublicKeyOfTheBrowser', auth: 'authsecret' },
      },
    });
    await ask();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pushes).toBeGreaterThan(0);
    expect(texts.filter((text) => text.body.includes("can't find"))).toHaveLength(0);
    await built.close();
  });

  it('takes SIMILAR texted back as the answer, and says so to the Runner', async () => {
    const { ask, built, text, id, r } = await withTexts();
    await ask();
    const replied = await text('+447700900001', 'similar');
    expect(replied.statusCode).toBe(200);
    expect(replied.body).toContain(
      `<Message>${harness.config.productName}: Thank you. Your Runner will bring something similar for the `,
    );
    expect(replied.body).toMatch(/<\/Message>/);
    const runnerSees = await built.app.inject({
      method: 'GET',
      url: `/orders/${id}/questions`,
      headers: r.authHeader,
    });
    expect(runnerSees.json().questions[0]).toMatchObject({
      answer: 'similar',
      answeredBy: 'shopper',
    });
    await built.close();
  });

  it('takes LEAVE as leave it out, and says when nothing is waiting', async () => {
    const { ask, built, text } = await withTexts();
    expect((await text('+447700900001', 'LEAVE')).body).toMatch(/no question waiting/);
    await ask();
    expect((await text('+447700900001', 'Leave it out')).body).toMatch(/will leave it out for the/);
    // A stranger's text, or any other words, are answered as before: texts are not read.
    expect((await text('+447700900555', 'similar')).body).toMatch(
      /texts to this number are not read/,
    );
    expect((await text('+447700900001', 'hello')).body).toMatch(
      /texts to this number are not read/,
    );
    await built.close();
  });
});
