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

/** The two reply words a Shopper can text back (16 October 2026), and what each means. */
export const TEXT_REPLIES: Array<{ pattern: RegExp; answer: ItemAnswer }> = [
  { pattern: /^\s*similar\b/i, answer: 'similar' },
  { pattern: /^\s*leave(\s+it)?(\s+out)?\b/i, answer: 'leave_out' },
];

const ANSWER_WORDS: Record<ItemAnswer, string> = {
  similar: 'bring something similar',
  leave_out: 'leave it out',
};

/**
 * The text a Shopper gets when their Runner asks and no device of theirs shows notifications:
 * the question, the two reply words, and what happens if nobody answers in time.
 */
export function questionText(runnerFirstName: string, itemName: string): string {
  const minutes = Math.round(QUESTION_WAIT_SECONDS / 60);
  return `${runnerFirstName} can't find ${itemName}. Reply SIMILAR for something similar, or LEAVE to leave it out. If we don't hear from you in ${minutes} minutes, it will be left out and you won't be charged for it.`;
}

/**
 * A reply texted back from the Shopper's number: SIMILAR or LEAVE answers the oldest question
 * still waiting on their order. Null when the text is not one of those words, or the number is
 * not a Shopper's; otherwise the words to text back.
 */
export async function answerByText(
  deps: { repository: Repository; now: () => Date },
  phone: string,
  text: string,
): Promise<string | null> {
  const match = TEXT_REPLIES.find(({ pattern }) => pattern.test(text));
  if (!match) return null;
  const { repository, now } = deps;
  const shopper = await repository.shoppers.findByPhone(phone);
  if (!shopper) return null;
  const orders = (await repository.orders.listForShopper(shopper.id)).filter(
    (order) => !['draft', 'confirmed', 'cancelled', 'refunded'].includes(order.status),
  );
  const rows = (
    await Promise.all(
      orders.map(async (order) =>
        order.splitAt ? [order, ...(await repository.orders.listParts(order.id))] : [order],
      ),
    )
  ).flat();
  const waiting = (
    await Promise.all(rows.map((row) => questionsForOrder(repository, row.id, now())))
  )
    .flat()
    .filter((question) => question.answer === null)
    .sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
  const question = waiting[0];
  if (!question) {
    return 'There is no question waiting from your Runner just now.';
  }
  await repository.itemQuestions.update(question.id, {
    answer: match.answer,
    answeredBy: 'shopper',
    answeredAt: now(),
  });
  return `Thank you. Your Runner will ${ANSWER_WORDS[match.answer]} for the ${question.itemName}.`;
}
