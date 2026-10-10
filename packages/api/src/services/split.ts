/**
 * Split jobs (ruling 60, with the cascade by vehicle of ruling 61, Anthony, 10 October 2026).
 *
 * An order over what walking and cycling carry (£60 of shopping at shop prices) goes to a Runner
 * with a motorbike, car or van who can carry it (services/dispatch.ts). If none of them takes it
 * within `dispatch.splitAfterMinutes` (10) of the Shopper's yes, it is split by item for the
 * fewest Runners possible, motorbike riders first, then Runners on foot or bicycle, counting who
 * is on shift and free right now (`planSplit` in core): each motorbike part up to
 * `dispatch.splitPartMaxPenceByMode.motorbike` (£75), each foot or bicycle part up to `.foot`
 * (£60). So £150 is two motorbike parts with two motorbike riders, motorbike £75 + foot £60 +
 * foot £15 with one, and three foot parts with none. Each part is offered only to Runners of its
 * kind (a car or van Runner may also take a motorbike part). If a part's kind of Runner is no
 * longer on shift and it has waited another `splitAfterMinutes`, the parts nobody has taken are
 * planned again with whoever is on shift then (`replanStrandedParts`).
 *
 * How it is kept, the simplest correct way: each part is its own order row, pointing at the whole
 * order (`splitParentId`, `splitPart` of `splitOf`), carrying only its own items. So everything a
 * Runner does goes through the code that already does it for any order, once per part: the offer,
 * the Ozi card load (per Runner card) or the own-card pay-back, the receipt photo, the till total,
 * the delivery, and the Runner's pay, `dispatch.splitRunnerPayPence` (£5, Anthony's figure) for
 * each part, so a three-way split pays £15 against a £13.50 delivery fee, the difference covered
 * by the item charges. The whole order keeps the Shopper's payment, item charges and delivery fee, which do
 * not change. The Shopper's card is settled once, on the whole order, when every part has its
 * till total: the till totals are added up and settled as one (services/till.ts), so the Shopper
 * sees one refund or one extra charge, never one per part.
 *
 * Nobody's name or number is passed between the Runners, or to them about each other: each is
 * told only that another Runner is delivering the rest.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  formatPence,
  planSplit,
  splitPartLimitPence,
  type OrderStatus,
  type PlannedPart,
  type SplitLine,
  type SplitPartMode,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { orderReference } from '../routes/runner-account.js';
import { tellShopperWords } from './order-updates.js';
import { repriceToReceipt } from './orders.js';
import { freeRunnersByPartMode } from './runner-pool.js';
import { settleTill, type TillOutcome } from './till.js';

type SplitContext = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'env' | 'sendText' | 'sendPush'>>;

/** A logger for the sweep, which has no request to log against. */
const QUIET = {
  warn: () => undefined,
  error: () => undefined,
  info: () => undefined,
} as unknown as FastifyBaseLogger;

/** What a Runner is shown about a split part, before and after taking it. */
export interface SplitView {
  part: number;
  of: number;
  /** "Split job — part 1 of 2". */
  label: string;
  /** "Split job — you earn £5.00". */
  earnWords: string;
  /** That another Runner is delivering the rest. Never who. */
  rest: string;
}

export function splitView(
  config: AppContext['config'],
  order: Pick<Order, 'splitPart' | 'splitOf' | 'runnerPaymentPence'>,
): SplitView | null {
  if (order.splitPart === null || order.splitOf === null) return null;
  const others = order.splitOf - 1;
  return {
    part: order.splitPart,
    of: order.splitOf,
    label: `Split job — part ${order.splitPart} of ${order.splitOf}`,
    earnWords: `Split job — you earn ${formatPence(order.runnerPaymentPence, config.store.currencySymbol)}`,
    rest:
      others === 1
        ? 'Another Runner is delivering the rest of this order. Bring only the items on your list.'
        : `${others} other Runners are delivering the rest of this order. Bring only the items on your list.`,
  };
}

/** How many parts, in words, for the Shopper. */
function partsWords(n: number): string {
  return ['', 'one part', 'two parts', 'three parts', 'four parts', 'five parts'][n] ?? `${n} parts`;
}

/**
 * Whether this order should be split now: over what walking and cycling carry, nobody has it,
 * not split already, and it has waited `dispatch.splitAfterMinutes` since the Shopper's yes (or
 * since a bank transfer arrived).
 */
export function shouldSplit(ctx: Pick<AppContext, 'config'>, order: Order, at: Date): boolean {
  const limits = ctx.config.dispatch.maxGoodsPenceByMode;
  if (order.isDemo || order.splitAt || order.splitParentId || order.runnerId) return false;
  if (order.status !== 'paid' && order.status !== 'offered') return false;
  if (order.goodsEstimatePence <= splitPartLimitPence(limits)) return false;
  const since = order.bankReceivedAt ?? order.spokenConfirmationAt ?? order.createdAt;
  return at.getTime() - since.getTime() >= ctx.config.dispatch.splitAfterMinutes * 60_000;
}

/** An order's items as lines to split, keyed by the item. */
function linesOf(orders: readonly Order[]): SplitLine[] {
  return orders.flatMap((row) =>
    row.items.map((item) => ({
      key: item.id,
      unitPricePence: item.estimatedPricePence,
      quantity: item.quantity,
    })),
  );
}

const PART_WORDS: Record<SplitPartMode, string> = {
  motorbike: 'motorbike',
  foot: 'on foot or bicycle',
};

/** "motorbike £75.00, on foot or bicycle £60.00 and on foot or bicycle £15.00", for the owner. */
function planWords(config: AppContext['config'], plan: readonly PlannedPart[]): string {
  const words = plan.map(
    (part) => `${PART_WORDS[part.mode]} ${formatPence(part.goodsPence, config.store.currencySymbol)}`,
  );
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** Make each planned part its own job, numbered from `firstNumber`, of `of` parts in all. */
async function createParts(
  ctx: SplitContext,
  whole: Order,
  plan: readonly PlannedPart[],
  items: Order['items'],
  firstNumber: number,
  of: number,
  at: Date,
): Promise<Order[]> {
  const { repository, config } = ctx;
  const byId = new Map(items.map((item) => [item.id, item]));
  const parts: Order[] = [];
  for (const [index, part] of plan.entries()) {
    parts.push(
      await repository.orders.create({
        shopperId: whole.shopperId,
        status: 'paid',
        // Only the shop prices travel with a part: the item charges and delivery stay on the
        // whole order, which the Shopper paid, and do not change.
        goodsEstimatePence: part.goodsPence,
        itemChargesPence: 0,
        feePence: 0,
        totalEstimatePence: part.goodsPence,
        deliveryPlan: whole.deliveryPlan,
        deliveryAddress: whole.deliveryAddress,
        latitude: whole.latitude,
        longitude: whole.longitude,
        doorstepProtocolSnapshot: whole.doorstepProtocolSnapshot,
        // The Shopper's one yes, on the whole order, is the yes for every part (Rule One).
        spokenConfirmationAt: whole.spokenConfirmationAt,
        confirmationChannel: whole.confirmationChannel,
        confirmationStatement: whole.confirmationStatement,
        paidBy: whole.paidBy,
        ...(whole.payerShopperId ? { payerShopperId: whole.payerShopperId } : {}),
        runnerPaymentPence: config.dispatch.splitRunnerPayPence,
        splitParentId: whole.id,
        splitPart: firstNumber + index,
        splitOf: of,
        // Offered only to Runners of this kind (ruling 61).
        splitMode: part.mode,
        splitPlannedAt: at,
        items: part.lines.map((line) => {
          const item = byId.get(line.key);
          return {
            catalogueItemId: item?.catalogueItemId ?? null,
            name: item?.name ?? 'item',
            quantity: line.quantity,
            estimatedPricePence: line.unitPricePence,
            ...(item?.note ? { note: item.note } : {}),
          };
        }),
      }),
    );
  }
  return parts;
}

/**
 * The plan for splitting a whole order now (ruling 61): the fewest Runners, motorbike riders
 * first, counting the motorbike riders on shift and free. A plan of one motorbike part (an order
 * of £75 or less) would be no split at all, only the whole order for one motorbike rider, beyond
 * the £70 a motorbike carries whole (`dispatch.maxGoodsPenceByMode`), so then it is planned for
 * foot and bicycle instead: always at least two parts.
 */
export async function planWholeSplit(
  ctx: Pick<AppContext, 'repository' | 'config'>,
  order: Order,
  at: Date,
): Promise<PlannedPart[]> {
  const partMax = ctx.config.dispatch.splitPartMaxPenceByMode;
  const riders = (await freeRunnersByPartMode(ctx, at)).motorbike;
  const lines = linesOf([order]);
  const plan = planSplit(lines, riders, partMax);
  return plan.length === 1 ? planSplit(lines, 0, partMax) : plan;
}

/**
 * Split the order into parts and make each its own job. Returns the parts, or nothing when the
 * order was taken or split in the meantime. The Shopper is told, and the owner too.
 */
export async function splitOrder(ctx: SplitContext, order: Order, at: Date): Promise<Order[]> {
  const { repository, config } = ctx;
  const fresh = await repository.orders.findById(order.id);
  if (!fresh || !shouldSplit(ctx, fresh, at)) return [];

  const plan = await planWholeSplit(ctx, fresh, at);
  if (plan.length < 2) return [];

  // The whole order is marked first, so nobody can take it whole any more, and anything still
  // offered for it is withdrawn.
  await repository.orders.update(fresh.id, {
    splitAt: at,
    ...(fresh.status === 'paid' ? { status: 'offered' as const } : {}),
  });
  for (const offer of await repository.offers.listForOrder(fresh.id)) {
    if (offer.outcome === 'pending') {
      await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
    }
  }

  const parts = await createParts(ctx, fresh, plan, fresh.items, 1, plan.length, at);

  const telling = ctx as AppContext;
  await tellShopperWords(
    telling,
    fresh,
    `No Runner who could carry your whole order was free, so it is coming in ${partsWords(parts.length)}, each brought by a different Runner. You pay the same. Your order page shows when each part should arrive.`,
    QUIET,
  );

  const money = (pence: number) => formatPence(pence, config.store.currencySymbol);
  const phone = ctx.env?.ownerAlertPhone;
  if (!fresh.waitingAlertSentAt) {
    await repository.orders.update(fresh.id, { waitingAlertSentAt: at });
  }
  if (phone && ctx.sendText) {
    await ctx
      .sendText(
        phone,
        `${config.productName}: order ${orderReference(fresh.id)}, ${money(fresh.goodsEstimatePence)} of shopping, was not taken by a Runner who could carry it, so it has been split into ${parts.length} parts: ${planWords(config, plan)}, each paying its Runner ${money(config.dispatch.splitRunnerPayPence)}.`,
      )
      .catch(() => undefined);
  }
  return parts;
}

/** A part nobody has taken yet. */
const UNTAKEN = new Set<OrderStatus>(['paid', 'offered']);

/**
 * A part whose kind of Runner has gone (ruling 61): once it has waited another
 * `dispatch.splitAfterMinutes` with no Runner of its kind on shift and free, every part of the
 * order nobody has taken yet is planned again, with whoever is on shift now, the same way
 * (motorbike riders first). The untaken parts are replaced (cancelled, no longer parts) by the
 * new ones; parts already taken keep going. Nothing changes when the new plan has the same kinds
 * of part as before, so an order is not churned while it simply waits. Returns the new parts, or
 * null when nothing was planned again.
 */
export async function replanStrandedParts(
  ctx: SplitContext,
  stale: Order,
  at: Date,
): Promise<Order[] | null> {
  const { repository, config } = ctx;
  const part = await repository.orders.findById(stale.id);
  if (!part?.splitParentId || !part.splitMode || part.runnerId || !UNTAKEN.has(part.status)) {
    return null;
  }
  const plannedAt = part.splitPlannedAt ?? part.createdAt;
  if (at.getTime() - plannedAt.getTime() < config.dispatch.splitAfterMinutes * 60_000) {
    return null;
  }
  const free = await freeRunnersByPartMode(ctx, at);
  if (free[part.splitMode] > 0) return null;
  const whole = await repository.orders.findById(part.splitParentId);
  if (!whole?.splitAt || ['cancelled', 'refunded'].includes(whole.status)) return null;

  const siblings = await repository.orders.listParts(whole.id);
  const untaken = siblings.filter((row) => !row.runnerId && UNTAKEN.has(row.status));
  const kept = siblings.filter((row) => !untaken.includes(row));
  const plan = planSplit(linesOf(untaken), free.motorbike, config.dispatch.splitPartMaxPenceByMode);
  const shape = (modes: Array<SplitPartMode | null>) => [...modes].sort().join(',');
  if (shape(plan.map((row) => row.mode)) === shape(untaken.map((row) => row.splitMode))) return null;
  // Always at least two parts in all, as at the split.
  if (kept.length + plan.length < 2) return null;

  // The untaken parts are replaced: cancelled, no longer numbered, anything offered withdrawn.
  for (const old of untaken) {
    await repository.orders.update(old.id, {
      status: 'cancelled',
      cancelledAt: at,
      cancelReason: 'Planned again: no Runner of its kind was on shift (ruling 61).',
      splitPart: null,
    });
    for (const offer of await repository.offers.listForOrder(old.id)) {
      if (offer.outcome === 'pending') {
        await repository.offers.update(offer.id, { outcome: 'superseded', respondedAt: at });
      }
    }
  }
  // The parts already taken come first, in their order, then the new ones.
  const of = kept.length + plan.length;
  for (const [index, row] of kept.entries()) {
    await repository.orders.update(row.id, { splitPart: index + 1, splitOf: of });
  }
  const parts = await createParts(
    ctx,
    whole,
    plan,
    untaken.flatMap((row) => row.items),
    kept.length + 1,
    of,
    at,
  );
  // The owner's one alert for a part still waiting stays one for the whole order.
  const alertedAt = siblings.find((row) => row.waitingAlertSentAt)?.waitingAlertSentAt;
  if (alertedAt) {
    for (const row of parts) await repository.orders.update(row.id, { waitingAlertSentAt: alertedAt });
  }

  const phone = ctx.env?.ownerAlertPhone;
  if (phone && ctx.sendText) {
    await ctx
      .sendText(
        phone,
        `${config.productName}: order ${orderReference(whole.id)}: no Runner of the kind a part was planned for is on shift, so what nobody has taken yet has been planned again: ${planWords(config, plan)}.`,
      )
      .catch(() => undefined);
  }
  return parts;
}

/**
 * A part nobody has taken either (ruling 60): once it has waited `dispatch.waitingAlertMinutes`
 * since the split, the owner is texted once for the whole order, whichever part it is.
 */
export async function alertIfSplitPartWaiting(
  ctx: SplitContext,
  stale: Order,
  at: Date,
): Promise<boolean> {
  const { repository, config } = ctx;
  if (!stale.splitParentId) return false;
  // Read again: another part may have just sent the one alert for the whole order.
  const part = await repository.orders.findById(stale.id);
  if (!part?.splitParentId || part.runnerId || part.waitingAlertSentAt) return false;
  const parent = await repository.orders.findById(part.splitParentId);
  if (!parent?.splitAt) return false;
  const waitedMinutes = Math.floor((at.getTime() - parent.splitAt.getTime()) / 60_000);
  if (waitedMinutes < config.dispatch.waitingAlertMinutes) return false;

  // Once for the whole order: every part is marked, so no other part sends it again.
  for (const sibling of await repository.orders.listParts(part.splitParentId)) {
    if (!sibling.waitingAlertSentAt) {
      await repository.orders.update(sibling.id, { waitingAlertSentAt: at });
    }
  }
  const phone = ctx.env?.ownerAlertPhone;
  if (!phone || !ctx.sendText) return false;
  try {
    await ctx.sendText(
      phone,
      `${config.productName}: part ${part.splitPart} of ${part.splitOf} of order ${orderReference(part.splitParentId)} has still not been taken by any Runner, ${waitedMinutes} minutes after it was split. Please find a Runner, or ring the Shopper.`,
    );
  } catch {
    return false;
  }
  return true;
}

/** How far an order has got, for following the parts on the whole order. */
const LADDER: readonly OrderStatus[] = [
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
];

function rank(status: OrderStatus): number {
  const at = LADDER.indexOf(status);
  return at < 0 ? 0 : at;
}

/**
 * The whole order follows its parts: it stands where the part furthest behind stands, so it is
 * delivered only when every part is, and completed when every part is.
 */
export async function syncSplitParent(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  const parent = await ctx.repository.orders.findById(parentId);
  if (!parent?.splitAt) return;
  if (['cancelled', 'refunded'].includes(parent.status)) return;
  const parts = await ctx.repository.orders.listParts(parentId);
  if (parts.length === 0) return;
  const behind = LADDER[Math.min(...parts.map((part) => rank(part.status)))] ?? 'offered';
  if (behind === parent.status) return;
  const at = ctx.now();
  await ctx.repository.orders.update(parent.id, {
    status: behind,
    ...(rank(behind) >= rank('accepted') && !parent.acceptedAt ? { acceptedAt: at } : {}),
    ...(rank(behind) >= rank('delivered') && !parent.deliveredAt ? { deliveredAt: at } : {}),
    ...(behind === 'completed' && !parent.completedAt ? { completedAt: at } : {}),
  });
}

/**
 * A part's till total is in. The Shopper's card is settled on the whole order once every part
 * has one, with the till totals added together (services/till.ts); before then there is nothing
 * to settle. What comes back is what the part's own pay-back should wait on.
 */
export async function settleSplitTill(
  ctx: AppContext,
  part: Order,
  log: FastifyBaseLogger,
): Promise<TillOutcome> {
  const { repository } = ctx;
  if (!part.splitParentId) return { kind: 'even' };
  const parent = await repository.orders.findById(part.splitParentId);
  if (!parent) return { kind: 'even' };
  // A bank transfer order is settled by a person, so each part's pay-back waits for one too, as
  // it would on a whole order.
  const bank: TillOutcome | null =
    parent.paidBy === 'bank' ? { kind: 'needs-person', pence: 0, reason: 'bank transfer' } : null;

  const parts = await repository.orders.listParts(parent.id);
  if (parts.some((row) => row.receiptTotalPence === null) || parent.receiptTotalPence !== null) {
    return bank ?? { kind: 'even' };
  }

  const sum = parts.reduce((total, row) => total + (row.receiptTotalPence ?? 0), 0);
  const repricing = repriceToReceipt(sum, parent);
  const flagged = parts.find((row) => row.tillStatus === 'needs_person');
  const updated = await repository.orders.update(parent.id, {
    receiptTotalPence: repricing.receiptTotalPence,
    receiptFeePence: repricing.receiptFeePence,
    finalTotalPence: repricing.finalTotalPence,
    ...(flagged
      ? { tillStatus: 'needs_person' as const, tillReason: `split part ${flagged.splitPart}: ${flagged.tillReason ?? 'needs a person'}` }
      : {}),
  });
  if (flagged) {
    return { kind: 'needs-person', pence: 0, reason: 'a split part needs a person' };
  }
  return settleTill(ctx, updated, log);
}
