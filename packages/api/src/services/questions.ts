/**
 * "I cannot find this": a Runner's question to a Shopper, and the answer.
 *
 * Chosen by Anthony on 27 Sep 2026 over showing the Shopper's phone number to the Runner. The
 * question appears on the Shopper's screen with two answers, and the answer on the Runner's. It
 * sits alongside the in-app call (docs/BUILD_PROMPT.md, Section H) for anybody who would rather
 * answer on the screen.
 *
 * Section H is the rule: the Shopper decides. If they cannot be reached in time, the item is NOT
 * bought and they are not charged for it. Never a silent substitution, never a Runner guessing.
 * Until 30 Sep 2026 an unanswered question fell back to a preference chosen at sign-up, which
 * could mean "bring something similar" without anybody being asked. That is gone.
 *
 * The deadline is settled whenever somebody looks, rather than on a timer, so there is nothing
 * to fall behind: the answer is right whenever it is read.
 */

import type { ItemAnswer, ItemQuestion } from '../domain.js';
import type { Repository } from '../data/repository.js';

/** How long a question waits for the Shopper before the item is left out. */
export const QUESTION_WAIT_SECONDS = 5 * 60;

/** What happens when nobody answers: always, whoever the Shopper is. */
export const NO_ANSWER: ItemAnswer = 'leave_out';

export interface QuestionView {
  id: string;
  orderItemId: string;
  itemName: string;
  askedAt: Date;
  answer: ItemAnswer | null;
  answeredBy: 'shopper' | 'no_answer' | null;
  /** Until the item is left out. Zero once answered. */
  secondsLeft: number;
  /** What happens if nobody answers in time: always left out. */
  ifNoAnswer: ItemAnswer;
}

/** Settle any question whose time has run out, then describe them all. */
export async function questionsForOrder(
  repository: Repository,
  orderId: string,
  now: Date,
): Promise<QuestionView[]> {
  const order = await repository.orders.findById(orderId);
  const names = new Map(order?.items.map((item) => [item.id, item.name]) ?? []);

  const views: QuestionView[] = [];
  for (let question of await repository.itemQuestions.listForOrder(orderId)) {
    question = await settle(repository, question, now);
    const deadline = question.askedAt.getTime() + QUESTION_WAIT_SECONDS * 1000;
    views.push({
      id: question.id,
      orderItemId: question.orderItemId,
      itemName: names.get(question.orderItemId) ?? 'an item',
      askedAt: question.askedAt,
      answer: question.answer,
      answeredBy: question.answeredBy,
      secondsLeft:
        question.answer === null ? Math.max(0, Math.round((deadline - now.getTime()) / 1000)) : 0,
      ifNoAnswer: NO_ANSWER,
    });
  }
  return views;
}

export async function settle(
  repository: Repository,
  question: ItemQuestion,
  now: Date,
): Promise<ItemQuestion> {
  if (question.answer !== null) return question;
  const deadline = question.askedAt.getTime() + QUESTION_WAIT_SECONDS * 1000;
  if (now.getTime() < deadline) return question;
  return repository.itemQuestions.update(question.id, {
    answer: NO_ANSWER,
    answeredBy: 'no_answer',
    answeredAt: new Date(deadline),
  });
}
