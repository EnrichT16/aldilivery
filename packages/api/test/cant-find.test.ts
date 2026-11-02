/**
 * "I can't find this", one tap (ruling 90, 2 November 2026): the question goes to the Shopper's
 * screen and by text as before, and a free Runner-started call rings them, rings again up to
 * three times forty seconds apart, stops the moment they answer another way (the first answer
 * wins), and at five minutes with no answer the item is left out and not charged. With LiveKit
 * off, screen and text only, and the Runner is told.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { Call, Order } from '../src/domain.js';
import type { CallProvider, CallWebhookEvent } from '../src/lib/livekit.js';
import {
  recordHeardAnswer,
  startCantFindCall,
  tickCantFind,
  type CantFindDeps,
  type Ringer,
} from '../src/services/cant-find.js';
import { runnerCall } from '../src/services/calls.js';
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

const START = new Date('2026-11-02T10:00:00.000Z');

let harness: TestHarness;
let shopper: SignedInShopper;
let runner: SignedInRunner;
let orderId: string;
let milkLine: string;

function fakeLiveKit(): CallProvider & { ended: string[] } {
  const fake = {
    url: 'wss://ozi-test.livekit.cloud',
    ended: [] as string[],
    async issueToken(input: { identity: string }) {
      return `token-for-${input.identity}`;
    },
    async verifyWebhook(body: string, authorization: string | undefined) {
      if (authorization !== 'signed') throw new Error('bad signature');
      const parsed = JSON.parse(body) as Omit<CallWebhookEvent, 'at'> & { at: string };
      return { ...parsed, at: new Date(parsed.at) };
    },
    async endRoom(roomName: string) {
      fake.ended.push(roomName);
    },
  };
  return fake;
}

async function placeAndShop(
  options: { calls?: CallProvider; sendText?: (to: string, body: string) => Promise<void> } = {},
) {
  harness = await buildTestApp(START, { autoOffer: true, ...options });
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
        agreedTotalPence: 250 + 100 + 1099,
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
  await harness.app.inject({
    method: 'POST',
    url: `/orders/${orderId}/status`,
    headers: runner.authHeader,
    payload: { status: 'shopping' },
  });
}

function at(secondsIn: number): Date {
  return new Date(START.getTime() + secondsIn * 1000);
}

/* ------------------------------------------------------------------------------------------
 * The sequence itself, with a stand-in ringer and the fake clock.
 * ---------------------------------------------------------------------------------------- */

interface FakeRinger extends Ringer {
  rang: Array<{ attempt: number; at: Date }>;
  stopped: Date[];
  off: boolean;
}

function fakeRinger(): FakeRinger {
  const fake: FakeRinger = {
    rang: [],
    stopped: [],
    off: false,
    async start(order: Order, when: Date) {
      if (fake.off) return null;
      const call = await harness.repository.calls.create(runnerCall(order, harness.config, when));
      fake.rang.push({ attempt: 1, at: when });
      return call;
    },
    async ringAgain(_call: Call, attempt: number) {
      fake.rang.push({ attempt, at: harness.now() });
    },
    async stop(call: Call, when: Date) {
      fake.stopped.push(when);
      await harness.repository.calls.update(call.id, { status: 'ended', endedAt: when });
    },
  };
  return fake;
}

describe('the one tap, step by step', () => {
  let ringer: FakeRinger;
  let deps: CantFindDeps;

  beforeEach(async () => {
    await placeAndShop();
    ringer = fakeRinger();
    deps = { repository: harness.repository, config: harness.config, now: harness.now, ringer };
  });

  async function ask() {
    const order = (await harness.repository.orders.findById(orderId))!;
    const question = await harness.repository.itemQuestions.create({
      orderId,
      orderItemId: milkLine,
      askedAt: harness.now(),
    });
    return startCantFindCall(deps, question, order);
  }

  async function tickAt(secondsIn: number) {
    harness.setNow(at(secondsIn));
    await tickCantFind(deps, orderId);
    return (await harness.repository.itemQuestions.listForOrder(orderId))[0]!;
  }

  it('rings three times, forty seconds apart, then leaves the item out at five minutes', async () => {
    const started = await ask();
    expect(started).toMatchObject({ callState: 'calling', callAttempts: 1 });
    expect(started.callId).not.toBeNull();
    expect(harness.config.questions).toEqual({ callAttempts: 3, callRetrySeconds: 40 });

    // Not yet time to ring again.
    expect(await tickAt(39)).toMatchObject({ callAttempts: 1 });
    expect(await tickAt(40)).toMatchObject({ callAttempts: 2 });
    // Running it again changes nothing.
    expect(await tickAt(41)).toMatchObject({ callAttempts: 2 });
    expect(await tickAt(80)).toMatchObject({ callAttempts: 3 });
    // Never a fourth.
    expect(await tickAt(200)).toMatchObject({ callAttempts: 3, callState: 'calling' });
    expect(ringer.rang.map((ring) => ring.attempt)).toEqual([1, 2, 3]);
    expect(ringer.rang.map((ring) => ring.at)).toEqual([at(0), at(40), at(80)]);

    // Five minutes: left out, not charged, the call stopped.
    const settled = await tickAt(QUESTION_WAIT_SECONDS);
    expect(settled).toMatchObject({
      answer: 'leave_out',
      answeredBy: 'no_answer',
      callState: 'unanswered',
    });
    expect(ringer.stopped).toEqual([at(QUESTION_WAIT_SECONDS)]);
    expect((await harness.repository.calls.findById(settled.callId!))?.status).toBe('ended');
  });

  it('stops ringing the moment the Shopper answers on their screen: the first answer wins', async () => {
    const started = await ask();
    await tickAt(40);
    await harness.repository.itemQuestions.update(started.id, {
      answer: 'similar',
      answeredBy: 'shopper',
      answeredAt: at(50),
      answeredVia: 'screen',
    });
    const after = await tickAt(50);
    expect(after).toMatchObject({ answer: 'similar', callState: 'stopped', callAttempts: 2 });
    expect(ringer.stopped).toEqual([at(50)]);
    // No more rings, and a voice answer written down afterwards is refused.
    expect(await tickAt(80)).toMatchObject({ callAttempts: 2 });
    const heard = await recordHeardAnswer(deps, after, 'leave_out');
    expect(heard.refused).toMatch(/already answered/);
    expect(heard.question.answer).toBe('similar');
  });

  it('takes the answer given by voice once the Shopper is on the call, and not before', async () => {
    const started = await ask();
    const early = await recordHeardAnswer(deps, started, 'similar');
    expect(early.refused).toMatch(/not answered the call yet/);
    expect(early.question.answer).toBeNull();

    // The Shopper picks up: their leg connects and the call is live.
    await harness.repository.callLegs.create({
      callId: started.callId!,
      role: 'shopper',
      identity: `shopper-${shopper.shopperId}`,
      name: 'Margaret',
      connectedSince: at(30),
      secondsConnected: 0,
      inviteCodeHash: null,
      priceStatement: null,
      createdAt: at(30),
    });
    await harness.repository.calls.update(started.callId!, { status: 'live' });
    harness.setNow(at(45));
    const heard = await recordHeardAnswer(deps, started, 'similar');
    expect(heard.refused).toBeNull();
    expect(heard.question).toMatchObject({
      answer: 'similar',
      answeredBy: 'shopper',
      answeredVia: 'call',
    });
    // Nobody is rung again while they are talking, and the call is left to them to end.
    expect(await tickAt(90)).toMatchObject({ callAttempts: 1, callState: 'calling' });
    expect(ringer.stopped).toEqual([]);
  });

  it('with calls off, goes by screen and text only and says so', async () => {
    ringer.off = true;
    const started = await ask();
    expect(started).toMatchObject({ callState: 'off', callId: null, callAttempts: 0 });
    expect(await tickAt(100)).toMatchObject({ callState: 'off', answer: null });
    expect(await tickAt(QUESTION_WAIT_SECONDS)).toMatchObject({
      answer: 'leave_out',
      answeredBy: 'no_answer',
      callState: 'off',
    });
    expect(ringer.rang).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------
 * Through the API, with the stand-in LiveKit.
 * ---------------------------------------------------------------------------------------- */

describe('the one tap through the API', () => {
  it('creates the question, sends the text, and rings a free call the Shopper answers without a yes', async () => {
    const texts: Array<{ to: string; body: string }> = [];
    const livekit = fakeLiveKit();
    await placeAndShop({
      calls: livekit,
      sendText: async (to, body) => {
        texts.push({ to, body });
      },
    });
    const asked = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
      payload: { orderItemId: milkLine },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json()).toMatchObject({
      callsOff: false,
      question: { call: { state: 'ringing', attempt: 1, of: 3 } },
    });
    expect(asked.json().question.call.words).toBe(
      'Ringing (attempt 1 of 3). Question sent by text too.',
    );
    const questionTexts = texts.filter((text) => /Reply SIMILAR/.test(text.body));
    expect(questionTexts).toHaveLength(1);
    expect(questionTexts[0]?.body).toMatch(
      /Reply SIMILAR for something similar, or LEAVE to leave it out/,
    );

    // The Shopper sees a free call from their Runner, and answers it with no price agreed.
    const current = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/calls/current`,
      headers: shopper.authHeader,
    });
    expect(current.json().call).toMatchObject({
      startedBy: 'runner',
      free: true,
      status: 'ringing',
    });
    const answered = await harness.app.inject({
      method: 'POST',
      url: `/calls/${current.json().call.id}/join`,
      headers: shopper.authHeader,
      payload: {},
    });
    expect(answered.statusCode, answered.body).toBe(200);

    // The Runner's own tap to join finds the same call, not a second one.
    const joined = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/calls`,
      headers: runner.authHeader,
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().call.id).toBe(current.json().call.id);

    // Forty seconds on with nobody connected, the Runner's page sees the second ring.
    harness.setNow(at(40));
    const looked = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
    });
    expect(looked.json().questions[0].call).toMatchObject({ state: 'ringing', attempt: 2, of: 3 });

    // The Shopper answers on the screen; the ringing stops.
    const questionId = looked.json().questions[0].id as string;
    const screen = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/questions/${questionId}/answer`,
      headers: shopper.authHeader,
      payload: { answer: 'leave_out' },
    });
    expect(screen.statusCode).toBe(200);
    expect(livekit.ended).toHaveLength(1);
    const after = await harness.app.inject({
      method: 'GET',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
    });
    expect(after.json().questions[0]).toMatchObject({
      answer: 'leave_out',
      answeredVia: 'screen',
      call: { state: 'stopped' },
    });
    // A second tap about the same item does nothing more.
    const again = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
      payload: { orderItemId: milkLine },
    });
    expect(again.statusCode).toBe(200);
  });

  it('with LiveKit off, the question still goes, and the Runner is told calls are off', async () => {
    await placeAndShop();
    const asked = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/questions`,
      headers: runner.authHeader,
      payload: { orderItemId: milkLine },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(asked.json()).toMatchObject({
      callsOff: true,
      question: {
        answer: null,
        call: {
          state: 'off',
          words: 'Calls are off, so the question went to their screen and by text.',
        },
      },
    });
    expect(await harness.repository.calls.findOpenForOrder(orderId)).toBeNull();
    // The Shopper still sees the question on their order.
    const mine = await harness.app.inject({
      method: 'GET',
      url: '/orders/current',
      headers: shopper.authHeader,
    });
    expect(mine.json().questions).toHaveLength(1);
  });
});
