/**
 * "Needs you now" (16 October 2026 review): what in the admin panel is waiting for a person,
 * most urgent first, so the owner hears it in one breath when he signs in, and the first screen
 * of the panel shows it as cards with a count and a button to the right tab.
 *
 * The order is fixed, and it is the order of harm: a Runner's SOS; an order nobody has taken
 * for longer than the dispatcher waits before splitting it (`dispatch.splitAfterMinutes`); bank
 * transfers to check against the business account; Runners waiting to be paid back for the
 * shopping; problems to decide; Runner documents to review. Each card is given only to someone
 * whose job includes the tab it points to, since that is where the button goes.
 */

import type { AppContext } from '../app.js';
import type { StaffActor, StaffArea } from '../lib/staff.js';
import { waitingSince } from './dispatch.js';

export type NeedsYouKey =
  'sos' | 'waiting-orders' | 'bank-transfers' | 'pay-backs' | 'problems' | 'documents';

export interface NeedsYouCard {
  key: NeedsYouKey;
  /** How many of them. */
  count: number;
  /** "one SOS", "two bank transfers to check": the count in words, for the ear. */
  words: string;
  /** What the card is called on the screen. */
  title: string;
  /** What pressing the button does, as the button's own words. */
  action: string;
  /** Which tab the button opens. */
  tab: StaffArea;
}

/** One, two, three, up to twelve, then figures. */
export function countWords(count: number): string {
  const words = [
    'no',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ];
  return words[count] ?? String(count);
}

function plural(count: number, one: string, many: string): string {
  return `${countWords(count)} ${count === 1 ? one : many}`;
}

/** The cards, in their fixed order, counting only what is there. */
export async function needsYou(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  actor: Pick<StaffActor, 'areas'>,
): Promise<NeedsYouCard[]> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const cards: NeedsYouCard[] = [];
  const add = (
    key: NeedsYouKey,
    count: number,
    one: string,
    many: string,
    title: string,
    action: string,
    tab: StaffArea,
  ): void => {
    if (count === 0 || !actor.areas.includes(tab)) return;
    cards.push({ key, count, words: plural(count, one, many), title, action, tab });
  };

  if (actor.areas.includes('problems')) {
    const sos = (await repository.sos.listSince(new Date(at.getTime() - 24 * 3600 * 1000))).filter(
      (row) => row.endedAt === null,
    );
    add('sos', sos.length, 'SOS', 'SOS', 'Runner SOS, on now', 'Open the SOS', 'problems');
  }

  if (actor.areas.includes('orders')) {
    const limit = config.dispatch.splitAfterMinutes * 60_000;
    const waiting = [
      ...(await repository.orders.listByStatus('paid')),
      ...(await repository.orders.listByStatus('offered')),
    ].filter(
      (order) =>
        order.runnerId === null &&
        order.splitAt === null &&
        !order.isDemo &&
        at.getTime() - waitingSince(order).getTime() > limit,
    );
    add(
      'waiting-orders',
      waiting.length,
      'order waiting for a Runner',
      'orders waiting for a Runner',
      `Orders waiting for a Runner for more than ${config.dispatch.splitAfterMinutes} minutes`,
      'Open the orders',
      'orders',
    );
  }

  if (actor.areas.includes('payments')) {
    const transfers = (await repository.orders.listByStatus('confirmed')).filter(
      (order) => order.paidBy === 'bank' && (order.basketPart ?? 1) === 1,
    );
    add(
      'bank-transfers',
      transfers.length,
      'bank transfer to check',
      'bank transfers to check',
      'Bank transfers to check',
      'Open the payments',
      'payments',
    );
    const payBacks = await repository.orders.listByReimbursementStatus('waiting');
    add(
      'pay-backs',
      payBacks.length,
      'Runner pay-back to approve',
      'Runner pay-backs to approve',
      'Runner pay-backs to approve',
      'Open the pay-backs',
      'payments',
    );
  }

  if (actor.areas.includes('problems')) {
    const problems = await repository.problems.listOpen();
    add(
      'problems',
      problems.length,
      'problem to decide',
      'problems to decide',
      'Problems to decide',
      'Open the problems',
      'problems',
    );
  }

  if (actor.areas.includes('documents')) {
    const documents = await repository.runnerDocuments.listSubmitted();
    add(
      'documents',
      documents.length,
      'Runner document to review',
      'Runner documents to review',
      'Runner documents to review',
      'Open the documents',
      'documents',
    );
  }

  return cards;
}

/**
 * The cards in one sentence, in the same order: "Two things need you: one SOS, one bank
 * transfer to check." or "Nothing needs you right now."
 */
export function needsYouWords(cards: readonly NeedsYouCard[]): string {
  if (cards.length === 0) return 'Nothing needs you right now.';
  const total = cards.reduce((sum, card) => sum + card.count, 0);
  // A plain list, with commas: "one SOS, one bank transfer to check", as the review wrote it.
  const list = cards.map((card) => card.words).join(', ');
  const opening =
    total === 1
      ? 'One thing needs you'
      : `${countWords(total)[0]!.toUpperCase()}${countWords(total).slice(1)} things need you`;
  return `${opening}: ${list}.`;
}
