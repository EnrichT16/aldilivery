/**
 * Keeping only what the privacy page says we keep, for as long as it says
 * (packages/web/src/pages/Privacy.tsx, "How long we keep it"; docs/LEGAL_REVIEW.md, the code that
 * must catch up). Run by the server every hour; each step is on its own, so one that fails does
 * not stop the rest, and running it twice changes nothing more.
 *
 * - A closed account, once its days to change its mind are over, is removed: name, number,
 *   addresses, doorstep words, PIN, cards, devices, saved addresses and regular orders go. The
 *   orders and money records stay, as tax law requires, without the address or doorstep words.
 *   An account with an order still on its way waits until that order is finished.
 * - Problem photos, voice notes and notes: two years after the problem was decided.
 * - Sign-in codes, the security record of signing in: one year.
 * - The figures about how the service is used: three years.
 * - Orders and money records: seven years, then made anonymous, with the receipt photo removed.
 *
 * Not here, because nothing is stored to remove: the telephone number of somebody who rang and
 * did not order lives only in the server's memory for the call (routes/telephone.ts), and Runner
 * document photos are removed as soon as a person has checked them (routes/runner-account.ts).
 * Runner check records "two years after they stop" need a record of a Runner stopping, which
 * does not exist yet.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';

const DAY_MS = 24 * 3600 * 1000;

/** How long each kind of record is kept, in days, as the privacy page says. */
export const KEEP_DAYS = {
  problemEvidence: 2 * 365,
  signInRecords: 365,
  analytics: 3 * 365,
  orders: 7 * 365 + 2,
} as const;

/** An order still on its way: its account is not removed until it is finished. */
const UNDER_WAY: readonly Order['status'][] = [
  'confirmed',
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

export interface RetentionReport {
  accountsRemoved: number;
  accountsWaiting: number;
  problemEvidenceRemoved: number;
  signInCodesRemoved: number;
  analyticsRemoved: number;
  ordersAnonymised: number;
  receiptPhotosRemoved: number;
}

function before(at: Date, days: number): Date {
  return new Date(at.getTime() - days * DAY_MS);
}

/** Remove the closed accounts whose time is up. */
export async function eraseClosedAccounts(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  log?: FastifyBaseLogger,
): Promise<{ removed: number; waiting: number }> {
  const at = ctx.now();
  let removed = 0;
  let waiting = 0;
  for (const shopper of await ctx.repository.shoppers.listDueForErasure(at)) {
    const orders = await ctx.repository.orders.listForShopper(shopper.id);
    if (orders.some((order) => UNDER_WAY.includes(order.status))) {
      waiting += 1;
      continue;
    }
    try {
      await ctx.repository.retention.eraseShopper(shopper.id, at);
      removed += 1;
    } catch (failure) {
      log?.error({ err: failure, shopperId: shopper.id }, 'A closed account could not be removed.');
    }
  }
  return { removed, waiting };
}

export async function sweepRetention(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  log?: FastifyBaseLogger,
): Promise<RetentionReport> {
  const at = ctx.now();
  const { retention } = ctx.repository;
  const step = async (name: string, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (failure) {
      log?.error({ err: failure }, `The retention step "${name}" failed.`);
      return 0;
    }
  };
  const accounts = await eraseClosedAccounts(ctx, log).catch((failure: unknown) => {
    log?.error({ err: failure }, 'Closed accounts could not be removed.');
    return { removed: 0, waiting: 0 };
  });
  const ordersBefore = before(at, KEEP_DAYS.orders);
  return {
    accountsRemoved: accounts.removed,
    accountsWaiting: accounts.waiting,
    problemEvidenceRemoved: await step('problem evidence', () =>
      retention.deleteProblemEvidenceDecidedBefore(before(at, KEEP_DAYS.problemEvidence)),
    ),
    signInCodesRemoved: await step('sign-in codes', () =>
      retention.deleteSignInCodesBefore(before(at, KEEP_DAYS.signInRecords)),
    ),
    analyticsRemoved: await step('analytics', () =>
      retention.deleteAnalyticsBefore(before(at, KEEP_DAYS.analytics)),
    ),
    receiptPhotosRemoved: await step('receipt photos', () =>
      retention.deleteReceiptPhotosBefore(ordersBefore),
    ),
    ordersAnonymised: await step('orders', () => retention.anonymiseOrdersBefore(ordersBefore, at)),
  };
}
