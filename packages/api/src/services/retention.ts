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
 * - The figures about how the service is used: three years; checkouts viewed and not completed,
 *   and the answers to "what stopped you", 12 months (Anthony, 30 October 2026).
 * - Orders and money records: seven years, then made anonymous, with the receipt photo removed.
 *
 * Not here, because nothing is stored to remove: the telephone number of somebody who rang and
 * did not order lives only in the server's memory for the call (routes/telephone.ts), and Runner
 * document photos are removed as soon as a person has checked them (routes/runner-account.ts).
 *
 * Staff call recordings (ruling 77): deleted from storage after `companyContact.callRecordingDays`
 * (90); the call stays in the log, saying the recording was deleted. Messages between the company
 * and an account are kept as long as the account, and go with it when it is removed.
 *
 * Runners (ruling 60): a Runner who closed their account in the app, or was removed, has their
 * name, number, where they last were and any document photos removed after the same days to
 * change their mind as a Shopper, once nothing is still owed either way (a job in hand, a
 * delivery not yet paid, a pay-back or deposit not yet sent). Their pay records stay, as money
 * records, and the record of their checks stays two years after they stopped, then goes.
 *
 * Ozi Ambassadors (Anthony, 30 October 2026): the photo ID, proof of address, face photo and any
 * share code sent with an application are kept while the person is an Ambassador and for
 * `ambassador.documentsKeptMonths` (12) after they stop (suspended) or are declined, then removed;
 * that a document was sent and how it was decided stays. They go at once with the account.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { removeOldAmbassadorDocuments } from './ambassador-applications.js';
import { deleteOldRecordings } from './company-contact.js';
import { depositHeld } from './runner-leaving.js';

const DAY_MS = 24 * 3600 * 1000;

/** How long each kind of record is kept, in days, as the privacy page says. */
export const KEEP_DAYS = {
  problemEvidence: 2 * 365,
  signInRecords: 365,
  analytics: 3 * 365,
  /**
   * Checkouts viewed and not completed, and why (Anthony, 30 October 2026): 12 months, to
   * improve our prices, as the privacy page says. Never a card detail.
   */
  checkoutInsights: 365,
  orders: 7 * 365 + 2,
  runnerChecksAfterLeaving: 2 * 365,
  /** Ozi's memory (ruling 68): exchanges nobody judged go after six months, judged ones after three years. */
  exchangesUnrated: 180,
  exchangesRated: 3 * 365,
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
  runnersRemoved: number;
  runnersWaiting: number;
  runnerChecksRemoved: number;
  problemEvidenceRemoved: number;
  signInCodesRemoved: number;
  analyticsRemoved: number;
  /** Checkout insight rows older than `KEEP_DAYS.checkoutInsights` (12 months). */
  checkoutEventsRemoved: number;
  exchangesRemoved: number;
  ordersAnonymised: number;
  receiptPhotosRemoved: number;
  /** Staff call recordings older than `companyContact.callRecordingDays` (90), deleted (ruling 77). */
  callRecordingsRemoved: number;
  /** Ambassador application documents, 12 months after the person stopped (30 October 2026). */
  ambassadorDocumentsRemoved: number;
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

/**
 * Remove the Runners who left whose days to change their mind are over (ruling 60), the same
 * days as a Shopper's closed account. One with anything still owed, to them or by them on a job,
 * waits until it is settled.
 */
export async function eraseLeftRunners(
  ctx: Pick<AppContext, 'repository' | 'now' | 'config'>,
  log?: FastifyBaseLogger,
): Promise<{ removed: number; waiting: number }> {
  const at = ctx.now();
  const days = ctx.config.accountDeletion.recycleBinDays;
  let removed = 0;
  let waiting = 0;
  for (const runner of await ctx.repository.runners.listAll()) {
    if (!runner.leftAt || runner.erasedAt) continue;
    if (runner.leftAt.getTime() > before(at, days).getTime()) continue;
    const orders = await ctx.repository.orders.listForRunner(runner.id);
    const unsettled =
      depositHeld(runner) > 0 ||
      orders.some(
        (order) =>
          RUNNER_UNDER_WAY.includes(order.status) ||
          order.status === 'delivered' ||
          order.reimbursementStatus === 'owed' ||
          order.reimbursementStatus === 'waiting',
      );
    if (unsettled) {
      waiting += 1;
      continue;
    }
    try {
      await ctx.repository.retention.eraseRunner(runner.id, at);
      removed += 1;
    } catch (failure) {
      log?.error(
        { err: failure, runnerId: runner.id },
        'A closed Runner account could not be removed.',
      );
    }
  }
  return { removed, waiting };
}

/** A Runner's job still under way: their account waits until it is finished. */
const RUNNER_UNDER_WAY: readonly Order['status'][] = [
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

export async function sweepRetention(
  ctx: Pick<AppContext, 'repository' | 'now'> & Partial<Pick<AppContext, 'config' | 'recorder'>>,
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
  const config = ctx.config;
  const runners = config
    ? await eraseLeftRunners({ ...ctx, config }, log).catch((failure: unknown) => {
        log?.error({ err: failure }, 'Closed Runner accounts could not be removed.');
        return { removed: 0, waiting: 0 };
      })
    : { removed: 0, waiting: 0 };
  const ordersBefore = before(at, KEEP_DAYS.orders);
  return {
    accountsRemoved: accounts.removed,
    accountsWaiting: accounts.waiting,
    runnersRemoved: runners.removed,
    runnersWaiting: runners.waiting,
    runnerChecksRemoved: await step('Runner checks', () =>
      retention.deleteRunnerChecksLeftBefore(before(at, KEEP_DAYS.runnerChecksAfterLeaving)),
    ),
    problemEvidenceRemoved: await step('problem evidence', () =>
      retention.deleteProblemEvidenceDecidedBefore(before(at, KEEP_DAYS.problemEvidence)),
    ),
    signInCodesRemoved: await step('sign-in codes', () =>
      retention.deleteSignInCodesBefore(before(at, KEEP_DAYS.signInRecords)),
    ),
    analyticsRemoved: await step('analytics', () =>
      retention.deleteAnalyticsBefore(before(at, KEEP_DAYS.analytics)),
    ),
    checkoutEventsRemoved: await step('checkout insights', () =>
      retention.deleteCheckoutEventsBefore(before(at, KEEP_DAYS.checkoutInsights)),
    ),
    exchangesRemoved: await step("Ozi's memory", async () => {
      const unrated = await retention.deleteExchangesBefore(
        before(at, KEEP_DAYS.exchangesUnrated),
        'unrated',
      );
      const rated = await retention.deleteExchangesBefore(
        before(at, KEEP_DAYS.exchangesRated),
        'all',
      );
      return unrated + rated;
    }),
    receiptPhotosRemoved: await step('receipt photos', () =>
      retention.deleteReceiptPhotosBefore(ordersBefore),
    ),
    ordersAnonymised: await step('orders', () => retention.anonymiseOrdersBefore(ordersBefore, at)),
    callRecordingsRemoved: await step('call recordings', () => deleteOldRecordings(ctx, log)),
    ambassadorDocumentsRemoved: await step('Ambassador documents', () =>
      removeOldAmbassadorDocuments(ctx),
    ),
  };
}
