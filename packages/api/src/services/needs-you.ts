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
import type { Order, ProblemReport, RunnerDocument, RunnerSos } from '../domain.js';
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

/**
 * Everything waiting for a person, by card (ruling 74): the same lists the cards count, so Ozi's
 * desk can use this page as its checklist and ring the owner about each one. Typed by key, so a
 * new card cannot be added here without the desk being told what to say about it.
 */
export interface NeedsYouItems {
  sos: RunnerSos[];
  'waiting-orders': Order[];
  'bank-transfers': Order[];
  'pay-backs': Order[];
  problems: ProblemReport[];
  documents: RunnerDocument[];
}

export async function needsYouItems(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
): Promise<NeedsYouItems> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const limit = config.dispatch.splitAfterMinutes * 60_000;
  return {
    sos: (await repository.sos.listSince(new Date(at.getTime() - 24 * 3600 * 1000))).filter(
      (row) => row.endedAt === null,
    ),
    'waiting-orders': [
      ...(await repository.orders.listByStatus('paid')),
      ...(await repository.orders.listByStatus('offered')),
    ].filter(
      (order) =>
        order.runnerId === null &&
        order.splitAt === null &&
        !order.isDemo &&
        at.getTime() - waitingSince(order).getTime() > limit,
    ),
    'bank-transfers': (await repository.orders.listByStatus('confirmed')).filter(
      (order) => order.paidBy === 'bank' && (order.basketPart ?? 1) === 1,
    ),
    'pay-backs': await repository.orders.listByReimbursementStatus('waiting'),
    problems: await repository.problems.listOpen(),
    documents: await repository.runnerDocuments.listSubmitted(),
  };
}

/** The cards, in their fixed order, counting only what is there. */
export async function needsYou(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now'>,
  actor: Pick<StaffActor, 'areas'>,
): Promise<NeedsYouCard[]> {
  const { config } = ctx;
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

  const items = await needsYouItems(ctx);
  add('sos', items.sos.length, 'SOS', 'SOS', 'Runner SOS, on now', 'Open the SOS', 'problems');
  add(
    'waiting-orders',
    items['waiting-orders'].length,
    'order waiting for a Runner',
    'orders waiting for a Runner',
    `Orders waiting for a Runner for more than ${config.dispatch.splitAfterMinutes} minutes`,
    'Open the orders',
    'orders',
  );
  add(
    'bank-transfers',
    items['bank-transfers'].length,
    'bank transfer to check',
    'bank transfers to check',
    'Bank transfers to check',
    'Open the payments',
    'payments',
  );
  add(
    'pay-backs',
    items['pay-backs'].length,
    'Runner pay-back to approve',
    'Runner pay-backs to approve',
    'Runner pay-backs to approve',
    'Open the pay-backs',
    'payments',
  );

  add(
    'problems',
    items.problems.length,
    'problem to decide',
    'problems to decide',
    'Problems to decide',
    'Open the problems',
    'problems',
  );

  add(
    'documents',
    items.documents.length,
    'Runner document to review',
    'Runner documents to review',
    'Runner documents to review',
    'Open the documents',
    'documents',
  );

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
