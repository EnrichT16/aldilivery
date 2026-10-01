/**
 * "I cannot find this": the Runner asks, the Shopper answers on their own screen, and nobody's
 * phone number changes hands. If the Shopper does not answer in time, the item is left out and
 * not charged for — whatever they chose at sign-up (docs/BUILD_PROMPT.md, Section H).
 */

import { beforeEach, describe, expect, it } from 'vitest';

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
        statement: 'Send my order.',
        agreedTotalPence: 1600,
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
