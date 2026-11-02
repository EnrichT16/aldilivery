/**
 * "I can't find this", one tap (ruling 90, 2 November 2026, Anthony).
 *
 * The Runner's tap puts the question on the Shopper's screen and sends the text, as before
 * (`routes/questions.ts`), and now also rings the Shopper in the app: a Runner-started in-app
 * call, free to the Shopper (`services/calls.ts`), which rings, and if nobody answers in about
 * `questions.callRetrySeconds` rings again, up to `questions.callAttempts` times, all inside the
 * question's five minutes (`QUESTION_WAIT_SECONDS`). The Shopper may answer by voice on the call,
 * on their screen, or by text; the first answer wins. At five minutes with no answer the item is
 * left out and not charged, exactly as today.
 *
 * The ringing is driven by `tickCantFind`: run on a timer from index.ts (the sweep pattern) and
 * again whenever the Runner's page reads the questions, so it needs no clock of its own and is
 * right whenever it is looked at. Every step is idempotent. If LiveKit is off, the question goes
 * by screen and text only, and the Runner is told calls are off.
 *
 * The call itself is made and rung through a `Ringer`, so the sequence can be proved with a
 * stand-in and a fake clock. The real one (`appRinger`) uses the Call rows, LiveKit and Web Push.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { StoreConfig } from '@aldilivery/core';
import type { AppContext } from '../app.js';
import type { Repository } from '../data/repository.js';
import type { Call, ItemAnswer, ItemQuestion, Order } from '../domain.js';
import { finishCall, runnerCall, runnerCallingMessage } from './calls.js';
import { notifyShopper } from './notify.js';
import { QUESTION_WAIT_SECONDS, settle } from './questions.js';

export interface Ringer {
  /** Starts the Runner's call to the Shopper about the order, or null when calls are off. */
  start(order: Order, at: Date): Promise<Call | null>;
  /** Rings the Shopper again on the same, still ringing, call. */
  ringAgain(call: Call, attempt: number): Promise<void>;
  /** Stops a call that is still ringing. */
  stop(call: Call, at: Date): Promise<void>;
}

export interface CantFindDeps {
  repository: Repository;
  config: Pick<StoreConfig, 'questions'>;
  now: () => Date;
  ringer: Ringer;
}

/** The real thing: Call rows, LiveKit's room, and a notification on the Shopper's devices. */
export function appRinger(ctx: AppContext, log: FastifyBaseLogger): Ringer {
  const { repository } = ctx;
  return {
    async start(order, at) {
      if (!ctx.calls || !order.runnerId) return null;
      const open = await repository.calls.findOpenForOrder(order.id);
      if (open) return open;
      const call = await repository.calls.create(runnerCall(order, ctx.config, at));
      void notifyShopper(
        { repository, sendPush: ctx.sendPush, log },
        order.shopperId,
        runnerCallingMessage(call, 1),
      );
      return call;
    },
    async ringAgain(call, attempt) {
      void notifyShopper(
        { repository, sendPush: ctx.sendPush, log },
        call.shopperId,
        runnerCallingMessage(call, attempt),
      );
    },
    async stop(call, at) {
      if (ctx.calls) {
        await ctx.calls.endRoom(call.roomName).catch((failure: unknown) => {
          log.warn({ err: failure, callId: call.id }, 'LiveKit could not close the room.');
        });
      }
      await finishCall(ctx, call, at, log);
    },
  };
}

export function cantFindDeps(ctx: AppContext, log: FastifyBaseLogger): CantFindDeps {
  return {
    repository: ctx.repository,
    config: ctx.config,
    now: ctx.now,
    ringer: appRinger(ctx, log),
  };
}

/**
 * The tap: ring the Shopper about a question just asked. Asking again about the same item does
 * nothing more. When calls are off, the question is marked so the Runner is told.
 */
export async function startCantFindCall(
  deps: CantFindDeps,
  question: ItemQuestion,
  order: Order,
): Promise<ItemQuestion> {
  if (question.callState !== null || question.answer !== null) return question;
  const at = deps.now();
  const call = await deps.ringer.start(order, at);
  if (!call) {
    return deps.repository.itemQuestions.update(question.id, { callState: 'off' });
  }
  // A call already open on this order (another question, or the Runner's own call) is used, so
  // one order never has two calls ringing.
  const attached = (await deps.repository.itemQuestions.listForOrder(order.id)).find(
    (other) => other.callId === call.id && other.callState === 'calling',
  );
  return deps.repository.itemQuestions.update(question.id, {
    callId: call.id,
    callAttempts: attached ? attached.callAttempts : 1,
    lastRangAt: attached ? attached.lastRangAt : at,
    callState: 'calling',
  });
}

/**
 * Move every question on an order along: ring again when it is time, stop the ringing once the
 * question is answered another way, and stop it with "unanswered" when the five minutes are up.
 * Safe to run as often as anybody likes.
 */
export async function tickCantFind(deps: CantFindDeps, orderId: string): Promise<void> {
  const { repository, config, ringer } = deps;
  const now = deps.now();
  for (let question of await repository.itemQuestions.listForOrder(orderId)) {
    question = await settle(repository, question, now);
    if (question.callState !== 'calling' || !question.callId) continue;
    const call = await repository.calls.findById(question.callId);
    if (!call) continue;
    if (call.status === 'ended') {
      // Somebody ended it: answered and over, or hung up. The question stands as it is.
      await repository.itemQuestions.update(question.id, {
        callState:
          question.answer === null && !(await wasAnswered(repository, call))
            ? 'unanswered'
            : 'stopped',
      });
      continue;
    }
    if (call.status === 'live') continue; // They are talking. Nothing to ring.
    if (question.answer !== null) {
      // Answered on the screen or by text while it rang: stop ringing.
      await ringer.stop(call, now);
      await repository.itemQuestions.update(question.id, {
        callState: question.answeredBy === 'no_answer' ? 'unanswered' : 'stopped',
      });
      continue;
    }
    const deadline = question.askedAt.getTime() + QUESTION_WAIT_SECONDS * 1000;
    if (now.getTime() >= deadline) {
      await ringer.stop(call, now);
      await repository.itemQuestions.update(question.id, { callState: 'unanswered' });
      continue;
    }
    const retryAt =
      (question.lastRangAt ?? question.askedAt).getTime() +
      config.questions.callRetrySeconds * 1000;
    if (question.callAttempts < config.questions.callAttempts && now.getTime() >= retryAt) {
      const attempt = question.callAttempts + 1;
      await ringer.ringAgain(call, attempt);
      await repository.itemQuestions.update(question.id, {
        callAttempts: attempt,
        lastRangAt: now,
      });
    }
  }
}

/** Whether the Shopper was ever on the call: by the app, or by their own telephone (ruling 46). */
async function wasAnswered(repository: Repository, call: Call): Promise<boolean> {
  const legs = await repository.callLegs.listForCall(call.id);
  return legs.some(
    (leg) =>
      (leg.role === 'shopper' || leg.role === 'phone') &&
      (leg.connectedSince !== null || leg.secondsConnected > 0),
  );
}

/**
 * The Shopper answered by voice on the call, and the Runner writes down which of the two answers
 * they gave. Only once the Shopper has actually been on the call, so this can never be a guess;
 * and never over an answer already given another way (the first answer wins).
 */
export async function recordHeardAnswer(
  deps: CantFindDeps,
  question: ItemQuestion,
  answer: ItemAnswer,
): Promise<{ question: ItemQuestion; refused: string | null }> {
  const { repository } = deps;
  const now = deps.now();
  const settled = await settle(repository, question, now);
  if (settled.answer !== null) {
    return {
      question: settled,
      refused:
        settled.answeredBy === 'no_answer'
          ? 'The time ran out, so it is left out and they are not charged for it.'
          : 'They have already answered on their screen or by text. That answer stands.',
    };
  }
  const call = settled.callId ? await repository.calls.findById(settled.callId) : null;
  if (!call || !(await wasAnswered(repository, call))) {
    return {
      question: settled,
      refused:
        'They have not answered the call yet, so there is nothing to write down. Wait for their answer on the call, their screen or by text.',
    };
  }
  const updated = await repository.itemQuestions.update(settled.id, {
    answer,
    answeredBy: 'shopper',
    answeredAt: now,
    answeredVia: 'call',
  });
  return { question: updated, refused: null };
}

/** The live state the Runner's page shows and says aloud (ruling 90). */
export interface QuestionCallView {
  state: 'off' | 'ringing' | 'live' | 'stopped' | 'unanswered';
  attempt: number;
  of: number;
  words: string;
}

export async function questionCallView(
  deps: Pick<CantFindDeps, 'repository' | 'config'>,
  question: ItemQuestion,
): Promise<QuestionCallView | null> {
  const of = deps.config.questions.callAttempts;
  const attempt = question.callAttempts;
  switch (question.callState) {
    case null:
      return null;
    case 'off':
      return {
        state: 'off',
        attempt: 0,
        of,
        words: 'Calls are off, so the question went to their screen and by text.',
      };
    case 'stopped':
      return { state: 'stopped', attempt, of, words: 'The call has stopped.' };
    case 'unanswered':
      return {
        state: 'unanswered',
        attempt,
        of,
        words: `No answer to ${attempt} ${attempt === 1 ? 'call' : 'calls'}.`,
      };
    case 'calling': {
      const call = question.callId ? await deps.repository.calls.findById(question.callId) : null;
      if (call?.status === 'live') {
        return { state: 'live', attempt, of, words: 'They have answered the call. Ask them.' };
      }
      return {
        state: 'ringing',
        attempt,
        of,
        words: `Ringing (attempt ${attempt} of ${of}). Question sent by text too.`,
      };
    }
  }
}

/** Every order with a question still ringing, for the timer in index.ts. */
export async function sweepCantFind(ctx: AppContext, log: FastifyBaseLogger): Promise<number> {
  const deps = cantFindDeps(ctx, log);
  const ringing = await ctx.repository.itemQuestions.listRinging();
  const orders = [...new Set(ringing.map((question) => question.orderId))];
  for (const orderId of orders) {
    await tickCantFind(deps, orderId);
  }
  return orders.length;
}
