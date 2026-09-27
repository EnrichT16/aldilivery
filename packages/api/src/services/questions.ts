/**
 * "I cannot find this": a Runner's question to a Shopper, and the answer.
 *
 * Chosen by Anthony on 27 Sep 2026 over showing the Shopper's phone number to the Runner: many
 * Shoppers are exactly the people who should not have to hand a stranger their number. The
 * question appears on the Shopper's screen with two answers, and the answer on the Runner's.
 *
 * A Shopper may not be looking. So a question waits a few minutes and then the Shopper's own
 * standing preference decides — the one they chose when they signed up. Where that preference
 * was "ask me first", and they could not be asked, the item is left out: nothing is ever bought
 * that the Shopper did not agree to, and they are not charged for it.
 */

import type { ItemAnswer, ItemQuestion, SubstitutionPreference } from '../domain.js';
import type { Repository } from '../data/repository.js';

/** How long a question waits for the Shopper before their preference decides. */
export const QUESTION_WAIT_SECONDS = 5 * 60;

export function preferenceAnswer(preference: SubstitutionPreference): ItemAnswer {
  return preference === 'similar_item' ? 'similar' : 'leave_out';
}

export interface QuestionView {
  id: string;
  orderItemId: string;
  itemName: string;
  askedAt: Date;
  answer: ItemAnswer | null;
  answeredBy: 'shopper' | 'preference' | null;
  /** Until the preference decides. Zero once answered. */
  secondsLeft: number;
  /** What happens if nobody answers in time. */
  ifNoAnswer: ItemAnswer;
}

/**
 * Settle any question whose time has run out, then describe them all. Settling here, when
 * somebody looks, rather than on a timer, means there is nothing to fall behind: the answer is
 * right whenever it is read.
 */
export async function questionsForOrder(
  repository: Repository,
  orderId: string,
  preference: SubstitutionPreference,
  now: Date,
): Promise<QuestionView[]> {
  const order = await repository.orders.findById(orderId);
  const names = new Map(order?.items.map((item) => [item.id, item.name]) ?? []);
  const fallback = preferenceAnswer(preference);

  const views: QuestionView[] = [];
  for (let question of await repository.itemQuestions.listForOrder(orderId)) {
    question = await settle(repository, question, fallback, now);
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
      ifNoAnswer: fallback,
    });
  }
  return views;
}

export async function settle(
  repository: Repository,
  question: ItemQuestion,
  fallback: ItemAnswer,
  now: Date,
): Promise<ItemQuestion> {
  if (question.answer !== null) return question;
  const deadline = question.askedAt.getTime() + QUESTION_WAIT_SECONDS * 1000;
  if (now.getTime() < deadline) return question;
  return repository.itemQuestions.update(question.id, {
    answer: fallback,
    answeredBy: 'preference',
    answeredAt: new Date(deadline),
  });
}
