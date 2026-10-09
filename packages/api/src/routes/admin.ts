/**
 * The admin panel's missing parts (Section Q, docs/STILL_TO_DO.md item 12).
 *
 * - Orders, live and past, searched and filtered, each with its timeline.
 * - Runners working now, and what each has earned.
 * - Signups by period, cancellations with their reasons, refunds with theirs, and how fresh
 *   the prices are.
 * - For the owner alone: opening a Shopper's account, exporting everything held about them
 *   (for a subject access request under the UK GDPR), and the audit log.
 *
 * Every screen here is checked by the server for the person's job, as every other tab is.
 * Money totals are the owner's alone (ruling 43): a refunds list shows each refund, but the
 * total only to him. Opening a Shopper's account and exporting their data are written in the
 * audit log, so the business can say who looked at whose record.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ORDER_STATUSES, type OrderStatus } from '@aldilivery/core';

import type { Order, ProblemReport, Runner, Shopper } from '../domain.js';
import { NotFoundError } from '../errors.js';
import { district } from '../lib/analytics.js';
import { auditWords, recordAudit } from '../lib/audit.js';
import { staffActor } from '../lib/staff.js';

const DAY = 24 * 60 * 60 * 1000;

/** Orders still on their way to the Shopper. */
export const LIVE_STATUSES: readonly OrderStatus[] = [
  'confirmed',
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

/** Orders that have finished, one way or another. */
export const PAST_STATUSES: readonly OrderStatus[] = [
  'delivered',
  'completed',
  'cancelled',
  'refunded',
];

/** Each status in plain words. */
export const STATUS_WORDS: Record<OrderStatus, string> = {
  draft: 'Being put together',
  confirmed: 'Waiting for payment',
  paid: 'Paid, finding a Runner',
  offered: 'Offered to a Runner',
  accepted: 'A Runner has it',
  shopping: 'Being shopped',
  receipt_submitted: 'Till total in',
  delivering: 'On its way',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const rangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** A from and to, defaulting to the last `days` days up to now. */
function range(query: unknown, now: Date, days: number): { from: Date; to: Date } {
  const parsed = rangeSchema.parse(query ?? {});
  // Up to and including this moment.
  const to = parsed.to ? new Date(parsed.to) : new Date(now.getTime() + 1000);
  const from = parsed.from ? new Date(parsed.from) : new Date(to.getTime() - days * DAY);
  return { from, to };
}

/** "Ada Lovelace" gives "Ada": enough to say who, without the whole name. */
function firstName(name: string | null | undefined): string | null {
  return name ? (name.trim().split(/\s+/)[0] ?? null) : null;
}

/** The short reference staff and Shoppers say aloud: the last six characters, in capitals. */
export function orderReference(order: Pick<Order, 'id' | 'bankReference'>): string {
  return order.bankReference ?? order.id.slice(-6).toUpperCase();
}

/** Why a refund went out, from what it was for. */
const REFUND_REASONS: Record<string, { reason: string; group: string }> = {
  problem: { reason: 'A complaint about an order, decided by a person.', group: 'complaints' },
  till: {
    reason: 'The shopping came to less than the estimate, so the difference went back.',
    group: 'the till coming to less than the estimate',
  },
  'find-it': {
    reason: 'Ozi Finds It could not find it, so the fee went back.',
    group: 'Finds It requests that were not found',
  },
  credit: {
    reason: 'Gift card credit used on an order went back to the card.',
    group: 'gift card credit',
  },
};

const DECISION_WORDS: Record<string, string> = {
  shopper_at_fault: 'the Shopper was responsible',
  runner_at_fault: 'the Runner was responsible',
  platform_at_fault: 'we were responsible',
  shop_at_fault: 'the shop was responsible',
  no_fault: 'nobody was at fault',
};

/** One CSV field, quoted, and never read as a formula by a spreadsheet. */
export function csvField(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now, config } = app.ctx;

  /** Looks Shoppers and Runners up once each, for a list of orders. */
  function people() {
    const shoppers = new Map<string, Promise<Shopper | null>>();
    const runners = new Map<string, Promise<Runner | null>>();
    return {
      shopper(id: string) {
        if (!shoppers.has(id)) shoppers.set(id, repository.shoppers.findById(id));
        return shoppers.get(id)!;
      },
      runner(id: string | null) {
        if (!id) return Promise.resolve(null);
        if (!runners.has(id)) runners.set(id, repository.runners.findById(id));
        return runners.get(id)!;
      },
    };
  }

  async function orderRow(order: Order, lookup: ReturnType<typeof people>) {
    const shopper = await lookup.shopper(order.shopperId);
    const runner = await lookup.runner(order.runnerId);
    return {
      id: order.id,
      reference: orderReference(order),
      status: order.status,
      statusWords: STATUS_WORDS[order.status],
      createdAt: order.createdAt,
      shopperName: shopper?.displayName ?? null,
      shopperHandle: shopper?.handle ?? null,
      runnerName: firstName(runner?.name),
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      totalEstimatePence: order.totalEstimatePence,
      finalTotalPence: order.finalTotalPence,
      paidBy: order.paidBy,
      area: district(order.deliveryAddress),
      cancelReason: order.cancelReason ?? null,
    };
  }

  /* ------------------------------------------------------------------ orders */

  app.get('/staff/orders', async (request) => {
    await staffActor(request, 'orders');
    const query = z
      .object({
        view: z.enum(['live', 'past', 'all']).default('live'),
        status: z.enum(ORDER_STATUSES).optional(),
        search: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      })
      .parse(request.query ?? {});
    const statuses: OrderStatus[] | undefined = query.status
      ? [query.status]
      : query.view === 'live'
        ? [...LIVE_STATUSES]
        : query.view === 'past'
          ? [...PAST_STATUSES]
          : undefined;
    const search = query.search?.toLowerCase() ?? '';
    const found = await repository.admin.listOrders({
      ...(statuses ? { statuses } : {}),
      ...(query.from ? { since: new Date(query.from) } : {}),
      ...(query.to ? { until: new Date(query.to) } : {}),
      // With a search, look through more before narrowing down.
      limit: search ? 2000 : query.limit,
    });
    const lookup = people();
    const rows = [];
    for (const order of found) {
      const row = await orderRow(order, lookup);
      if (
        search &&
        ![row.id, row.reference, row.shopperName, row.shopperHandle, row.runnerName, row.area]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase().includes(search))
      ) {
        continue;
      }
      rows.push(row);
      if (rows.length >= query.limit) break;
    }
    return {
      view: query.view,
      orders: rows,
      statuses: ORDER_STATUSES.map((status) => ({ status, words: STATUS_WORDS[status] })),
    };
  });

  /** One order, and everything that happened to it, in time order. */
  app.get('/staff/orders/:id', async (request) => {
    await staffActor(request, 'orders');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    const lookup = people();
    const runnerName = async (runnerId: string | null) =>
      firstName((await lookup.runner(runnerId))?.name) ?? 'a Runner';

    const events: Array<{ at: Date; what: string }> = [];
    const add = (at: Date | null | undefined, what: string): void => {
      if (at) events.push({ at, what });
    };
    add(order.createdAt, 'The order was started.');
    add(
      order.spokenConfirmationAt,
      `The Shopper said yes to send it and pay${order.confirmationChannel ? `, by ${order.confirmationChannel}` : ''}.`,
    );
    add(order.bankReceivedAt, 'The bank transfer was seen in the business account.');
    for (const offer of await repository.offers.listForOrder(order.id)) {
      const who = await runnerName(offer.runnerId);
      add(offer.offeredAt, `Offered to ${who}.`);
      if (offer.outcome !== 'pending') {
        add(
          offer.respondedAt ?? offer.expiresAt,
          {
            accepted: `${who} accepted it.`,
            declined: `${who} said no.`,
            expired: `The offer to ${who} ran out.`,
            superseded: `The offer to ${who} was withdrawn.`,
          }[offer.outcome],
        );
      }
    }
    for (const question of await repository.itemQuestions.listForOrder(order.id)) {
      const item = order.items.find((row) => row.id === question.orderItemId);
      add(question.askedAt, `The Runner could not find ${item?.name ?? 'something'}.`);
      add(
        question.answeredAt,
        question.answeredBy === 'no_answer'
          ? 'No answer came in time, so the Shopper’s usual choice was used.'
          : `The Shopper chose ${question.answer === 'similar' ? 'something similar' : 'to leave it out'}.`,
      );
    }
    if (order.receiptTotalPence !== null) {
      add(order.updatedAt, 'The till total was put in.');
    }
    add(order.deliveredAt, 'Delivered.');
    add(order.completedAt, 'Completed.');
    add(
      order.cancelledAt,
      `Cancelled.${order.cancelReason ? ` ${order.cancelReason}` : ' No reason was recorded.'}`,
    );
    add(order.reimbursedAt, 'The Runner was paid back for the shopping.');
    const payout = await repository.payouts.findByOrderId(order.id);
    if (payout) add(payout.createdAt, 'The Runner was paid for the delivery.');
    for (const report of await repository.problems.listForOrder(order.id)) {
      add(
        report.createdAt,
        `A problem was reported by the ${report.reportedBy === 'runner' ? 'Runner' : 'Shopper'}: ${report.summary}`,
      );
      add(
        report.decidedAt,
        `The problem was decided: ${DECISION_WORDS[report.decision ?? ''] ?? 'decided'}${report.decidedBy ? `, by ${report.decidedBy}` : ''}.`,
      );
    }
    for (const entry of await repository.audit.list({ search: order.id, limit: 100 })) {
      add(entry.at, `${entry.actorName}: ${auditWords(entry.action)}.`);
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      order: {
        ...(await orderRow(order, lookup)),
        goodsEstimatePence: order.goodsEstimatePence,
        feePence: order.feePence,
        receiptTotalPence: order.receiptTotalPence,
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          outcome: item.substitutionOutcome,
        })),
      },
      timeline: events,
    };
  });

  /* ------------------------------------------------------------------ Runners */

  app.get('/staff/runners/now', async (request) => {
    await staffActor(request, 'runners');
    const at = now();
    const startOfDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    const weekAgo = new Date(at.getTime() - 7 * DAY);
    const working = await repository.admin.listOrders({
      statuses: ['accepted', 'shopping', 'receipt_submitted', 'delivering'],
      limit: 1000,
    });
    const rows = [];
    for (const runner of await repository.runners.listAll()) {
      const job = working.find((order) => order.runnerId === runner.id) ?? null;
      const payouts = await repository.payouts.listForRunner(runner.id);
      const earned = (since: Date): number =>
        payouts
          .filter((row) => row.createdAt >= since)
          .reduce((sum, row) => sum + row.earnedPence, 0);
      rows.push({
        id: runner.id,
        name: runner.name,
        onShift: runner.available,
        activeNow: runner.available || job !== null,
        travel: runner.vehicleType,
        job: job ? { id: job.id, reference: orderReference(job), status: job.status } : null,
        jobsCompleted: runner.completedDeliveryCount,
        jobsToday: payouts.filter((row) => row.createdAt >= startOfDay).length,
        earnedTodayPence: earned(startOfDay),
        earnedWeekPence: earned(weekAgo),
        earnedAllTimePence: earned(new Date(0)),
      });
    }
    rows.sort((a, b) => Number(b.activeNow) - Number(a.activeNow) || a.name.localeCompare(b.name));
    return {
      activeNow: rows.filter((row) => row.activeNow).length,
      onShift: rows.filter((row) => row.onShift).length,
      onAJob: rows.filter((row) => row.job !== null).length,
      runners: rows,
    };
  });

  /* ------------------------------------------------------------------ reports */

  /**
   * Shoppers and Runners who signed up, in each of the last twelve days, weeks or months; and,
   * given a from (and a to), between those two moments, for "how many signups this month".
   */
  app.get('/staff/reports/signups', async (request) => {
    await staffActor(request, 'reports');
    const { period, from, to } = z
      .object({
        period: z.enum(['day', 'week', 'month']).default('month'),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      })
      .parse(request.query ?? {});
    const at = now();
    let between: { from: Date; to: Date; shoppers: number; runners: number } | null = null;
    if (from) {
      const since = new Date(from);
      const until = to ? new Date(to) : new Date(at.getTime() + 1000);
      between = {
        from: since,
        to: until,
        shoppers: (await repository.admin.listShoppersCreated({ since, until })).length,
        runners: (await repository.runners.listAll()).filter(
          (runner) => runner.createdAt >= since && runner.createdAt < until,
        ).length,
      };
    }
    const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const starts: Date[] = [];
    for (let back = 11; back >= 0; back -= 1) {
      if (period === 'day') starts.push(new Date(today - back * DAY));
      else if (period === 'week') {
        // Weeks start on a Monday.
        const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
        starts.push(new Date(monday - back * 7 * DAY));
      } else starts.push(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1)));
    }
    const ends = starts.map((start, index) =>
      index + 1 < starts.length
        ? starts[index + 1]!
        : period === 'day'
          ? new Date(start.getTime() + DAY)
          : period === 'week'
            ? new Date(start.getTime() + 7 * DAY)
            : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
    );
    const shoppers = await repository.admin.listShoppersCreated({ since: starts[0]! });
    const runners = (await repository.runners.listAll()).filter(
      (runner) => runner.createdAt >= starts[0]!,
    );
    const label = (start: Date): string =>
      period === 'month'
        ? start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : period === 'week'
          ? `Week of ${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
          : start.toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            });
    const within = (when: Date, index: number): boolean =>
      when >= starts[index]! && when < ends[index]!;
    return {
      period,
      between,
      buckets: starts.map((start, index) => ({
        label: label(start),
        from: start,
        to: ends[index]!,
        shoppers: shoppers.filter((row) => within(row.createdAt, index)).length,
        runners: runners.filter((row) => within(row.createdAt, index)).length,
      })),
    };
  });

  app.get('/staff/reports/cancellations', async (request) => {
    await staffActor(request, 'reports');
    const { from, to } = range(request.query, now(), 30);
    // An order is cancelled some time after it is made: look back further, then narrow down.
    const orders = await repository.admin.listOrders({
      statuses: ['cancelled'],
      since: new Date(from.getTime() - 30 * DAY),
      until: to,
      limit: 5000,
    });
    const rows = orders
      .filter((order) => order.cancelledAt && order.cancelledAt >= from && order.cancelledAt < to)
      .map((order) => ({
        id: order.id,
        reference: orderReference(order),
        at: order.cancelledAt!,
        reason: order.cancelReason ?? 'No reason was recorded.',
        paidBy: order.paidBy,
      }))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    return {
      from,
      to,
      count: rows.length,
      byReason: [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      cancellations: rows,
    };
  });

  app.get('/staff/reports/refunds', async (request) => {
    const actor = await staffActor(request, 'reports');
    const { from, to } = range(request.query, now(), 30);
    const ledger = (await repository.income.list({ since: from, until: to })).filter(
      (row) => row.amountPence < 0,
    );
    // Refunds for complaints carry the reference the gateway gave, which the complaint keeps.
    const decided = await repository.admin.listProblemsDecided({
      since: new Date(from.getTime() - DAY),
      until: new Date(to.getTime() + DAY),
    });
    const byReference = new Map<string, ProblemReport>();
    for (const report of decided) {
      if (report.refundReference) byReference.set(report.refundReference, report);
    }
    const rows = ledger
      .map((row) => {
        const kind = row.kind.replace(/^refund:\s*/, '');
        const known = REFUND_REASONS[kind] ?? { reason: 'A refund.', group: 'other refunds' };
        const report = kind === 'problem' ? byReference.get(row.reference) : undefined;
        return {
          at: row.at,
          amountPence: -row.amountPence,
          kind,
          group: known.group,
          reason: report
            ? `A complaint: "${report.summary}". Decided that ${DECISION_WORDS[report.decision ?? ''] ?? 'it was settled'}${report.decisionNote ? `: ${report.decisionNote}` : '.'}`
            : known.reason,
          orderId: report?.orderId ?? null,
          decidedBy: report?.decidedBy ?? null,
        };
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
    return {
      from,
      to,
      count: rows.length,
      // The total is money, and money is the owner's alone (ruling 43).
      totalPence: actor.isOwner ? rows.reduce((sum, row) => sum + row.amountPence, 0) : null,
      ownerOnlyAbovePence: config.admin.ownerOnlyRefundAbovePence,
      byReason: [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      refunds: rows,
    };
  });

  /** How recently each price was seen, and which shops have not updated theirs. */
  app.get('/staff/reports/prices', async (request) => {
    await staffActor(request, 'reports');
    const at = now();
    const age = (when: Date): number => (at.getTime() - when.getTime()) / DAY;
    const items = await repository.catalogue.search('', { limit: 100_000 });
    const shops = [];
    for (const shop of await repository.partnerShops.list()) {
      const products = (await repository.partnerProducts.listForShop(shop.id)).filter(
        (product) => product.status === 'approved',
      );
      const latest = products
        .map((product) => product.decidedAt ?? product.createdAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      shops.push({
        id: shop.id,
        name: shop.name,
        products: products.length,
        lastUpdatedAt: latest ?? null,
        stale: !latest || age(latest) > 30,
      });
    }
    return {
      catalogue: {
        total: items.length,
        // Seen in the last week; in the last month; longer ago than that.
        fresh: items.filter((item) => age(item.lastSeenAt) <= 7).length,
        ageing: items.filter((item) => age(item.lastSeenAt) > 7 && age(item.lastSeenAt) <= 30)
          .length,
        stale: items.filter((item) => age(item.lastSeenAt) > 30).length,
        oldest: [...items]
          .sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime())
          .slice(0, 20)
          .map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            pricePence: item.estimatedPricePence,
            lastSeenAt: item.lastSeenAt,
          })),
      },
      shops: shops.sort(
        (a, b) => Number(b.stale) - Number(a.stale) || a.name.localeCompare(b.name),
      ),
    };
  });

  /* ------------------------------------------------------------------ the owner's alone */

  async function shopperOr404(request: FastifyRequest): Promise<Shopper> {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const shopper = await repository.shoppers.findById(id);
    if (!shopper) throw new NotFoundError('Shopper');
    return shopper;
  }

  /** Everything held about one Shopper, in one place, for the account view and the export. */
  async function everything(shopper: Shopper) {
    const orders = await repository.orders.listForShopper(shopper.id);
    const problems: ProblemReport[] = [];
    for (const order of orders)
      problems.push(...(await repository.problems.listForOrder(order.id)));
    const organisation = shopper.organisationId
      ? await repository.organisations.findById(shopper.organisationId)
      : null;
    return {
      account: {
        id: shopper.id,
        displayName: shopper.displayName,
        handle: shopper.handle,
        phone: shopper.phone,
        deliveryAddress: shopper.deliveryAddress,
        preferredLanguage: shopper.preferredLanguage,
        doorstepProtocol: shopper.doorstepProtocol,
        substitutionDefault: shopper.substitutionDefault,
        budgetCapPence: shopper.budgetCapPence,
        hasPin: shopper.pinHash !== null,
        recipePassUntil: shopper.recipePassUntil,
        plusUntil: shopper.plusUntil,
        plusFamily: shopper.plusFamily,
        creditPence: shopper.creditPence,
        ageBand: shopper.ageBand,
        joinedVia: shopper.joinedVia,
        organisation: organisation?.name ?? null,
        organisationOffice: shopper.organisationOffice,
        deletionScheduledFor: shopper.deletionScheduledFor,
        createdAt: shopper.createdAt,
        updatedAt: shopper.updatedAt,
      },
      savedAddresses: (await repository.savedAddresses.listForShopper(shopper.id)).map((row) => ({
        label: row.label,
        address: row.address,
        createdAt: row.createdAt,
      })),
      cards: (await repository.paymentMethods.listForShopper(shopper.id)).map((row) => ({
        brand: row.brand,
        lastFour: row.lastFour,
        isDefault: row.isDefault,
        createdAt: row.createdAt,
      })),
      orders: orders.map((order) => ({
        id: order.id,
        reference: orderReference(order),
        status: order.status,
        createdAt: order.createdAt,
        deliveryAddress: order.deliveryAddress,
        totalEstimatePence: order.totalEstimatePence,
        finalTotalPence: order.finalTotalPence,
        paidBy: order.paidBy,
        confirmationStatement: order.confirmationStatement,
        cancelReason: order.cancelReason ?? null,
        items: order.items.map((item) => `${item.quantity} x ${item.name}`).join('; '),
      })),
      regularOrders: (await repository.sets.listForShopper(shopper.id)).map((set) => ({
        name: set.name,
        frequency: set.frequency,
        active: set.active,
        deliveryAddress: set.deliveryAddress,
        items: set.items.map((item) => `${item.quantity} x ${item.name}`).join('; '),
      })),
      problems: problems.map((report) => ({
        orderId: report.orderId,
        summary: report.summary,
        decision: report.decision,
        refundPence: report.refundPence,
        createdAt: report.createdAt,
      })),
      findIt: (await repository.findRequests.listForShopper(shopper.id)).map((row) => ({
        description: row.description,
        status: row.status,
        createdAt: row.createdAt,
      })),
      giftCardsBought: (await repository.giftCards.listBoughtBy(shopper.id)).map((row) => ({
        amountPence: row.amountPence,
        recipientName: row.recipientName,
        redeemed: row.redeemedAt !== null,
        createdAt: row.createdAt,
      })),
    };
  }

  app.get('/staff/shoppers', async (request) => {
    await staffActor(request, 'accounts');
    const { search } = z
      .object({ search: z.string().trim().min(2, 'Please type at least two letters.').max(80) })
      .parse(request.query ?? {});
    await recordAudit(request, { action: 'shopper.searched', detail: search });
    return {
      shoppers: (await repository.admin.searchShoppers(search, 20)).map((shopper) => ({
        id: shopper.id,
        displayName: shopper.displayName,
        handle: shopper.handle,
        createdAt: shopper.createdAt,
      })),
    };
  });

  app.get('/staff/shoppers/:id', async (request) => {
    await staffActor(request, 'accounts');
    const shopper = await shopperOr404(request);
    await recordAudit(request, { action: 'shopper.opened', target: `shopper=${shopper.id}` });
    return everything(shopper);
  });

  /**
   * Everything held about one Shopper, as a spreadsheet file (CSV), for a subject access
   * request. Four columns: what part of the record, which entry, what field, and its value.
   */
  app.get('/staff/shoppers/:id/export.csv', async (request, reply) => {
    await staffActor(request, 'accounts');
    const shopper = await shopperOr404(request);
    const data = await everything(shopper);
    const lines = [['section', 'entry', 'field', 'value'].map(csvField).join(',')];
    for (const [section, value] of Object.entries(data)) {
      const entries = Array.isArray(value) ? value : [value];
      entries.forEach((entry, index) => {
        for (const [field, fieldValue] of Object.entries(entry as Record<string, unknown>)) {
          lines.push([section, index + 1, field, fieldValue].map(csvField).join(','));
        }
      });
    }
    await recordAudit(request, { action: 'shopper.exported', target: `shopper=${shopper.id}` });
    const day = now().toISOString().slice(0, 10);
    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header(
      'content-disposition',
      `attachment; filename="shopper-${shopper.handle.replace(/[^a-z0-9-]/gi, '')}-${day}.csv"`,
    );
    void reply.header('cache-control', 'no-store');
    return reply.send(`${lines.join('\r\n')}\r\n`);
  });

  /** The audit log, newest first, searchable. The owner's alone, and only ever added to. */
  app.get('/staff/audit', async (request) => {
    await staffActor(request, 'audit');
    const query = z
      .object({
        search: z.string().trim().max(80).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      })
      .parse(request.query ?? {});
    const entries = await repository.audit.list({
      ...(query.search ? { search: query.search } : {}),
      ...(query.from ? { since: new Date(query.from) } : {}),
      ...(query.to ? { until: new Date(query.to) } : {}),
      limit: query.limit,
    });
    return {
      entries: entries.map((entry) => ({ ...entry, words: auditWords(entry.action) })),
    };
  });
}
