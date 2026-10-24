/**
 * Sending jobs straight to a chosen Runner, outside the queue (ruling 80, Anthony, 24 October
 * 2026; docs/changes/allocate-jobs.md).
 *
 * The founder, and staff he lets allocate (`canAllocate` on the staff account, given only by him
 * in Team), can send any number of orders to any number of Runners at once. Each assignment is
 * taken on its own and answered on its own: sent, or refused with a plain reason (bought already,
 * cannot carry it, not approved, booked for a later day unless sent early on purpose).
 *
 * Runners are self-employed, so a job sent by the office is still theirs to accept or decline.
 * It reaches them at once as a priority offer held only for them, for
 * `allocation.allocatedHoldMinutes` (10), announced by notification and by text, with no
 * customer's telephone number, and by Ozi on the Runner page. A Runner has one pair of hands, so
 * a Runner sent several jobs has an allocated queue, in the order the jobs were sent: the next is
 * offered when the one in hand is delivered (or said no to). Declined or run out, the order goes
 * to the backup Runner the office chose, or back to the ordinary queue, and the office is told,
 * with a matter on Ozi's desk to hear.
 *
 * The pay is unchanged (Rule Two): the offer carries the order's own Runner payment.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { JobAllocation, JobOffer, Order, Runner } from '../domain.js';
import { ForbiddenError } from '../errors.js';
import { isViewerRole, type StaffActor } from '../lib/staff.js';
import { orderReference } from '../routes/admin.js';
import { distanceMiles, isOfferExpired, offerExpiryAt } from './allocation.js';
import { canCarry, largeOrderWords, offerOrder } from './dispatch.js';
import { mayBeAssigned, releaseRunner, withdrawOffers } from './order-rescue.js';
import { askOwner, ukDate } from './owner-desk.js';
import { tellShopperWords } from './order-updates.js';
import { activeOrdersByRunner } from './runner-pool.js';
import { bookedWords } from './scheduled.js';

type Ctx = AppContext;

/**
 * Whether this person may send jobs straight to Runners (ruling 80): the owner always; the staff
 * key, which is the founder without an account; and a staff member the owner lets allocate.
 * Never a family or investor account, which only looks.
 */
export async function mayAllocate(
  ctx: Pick<Ctx, 'repository'>,
  actor: StaffActor,
): Promise<boolean> {
  if (actor.isOwner) return true;
  if (actor.viewOnly) return false;
  if (actor.id === null) return true;
  const member = await ctx.repository.staffMembers.findById(actor.id);
  return Boolean(member?.active && member.canAllocate && !isViewerRole(member.role));
}

/** Refuses anybody the owner has not let allocate. */
export async function requireAllocator(
  ctx: Pick<Ctx, 'repository'>,
  actor: StaffActor,
): Promise<void> {
  if (!(await mayAllocate(ctx, actor))) {
    throw new ForbiddenError(
      'Sending jobs straight to a Runner is for the owner, and the staff he lets allocate in Team.',
    );
  }
}

/** An allocation still waiting for its Runner, or offered to them. */
export const LIVE_ALLOCATION: readonly JobAllocation['status'][] = ['queued', 'offered'];

/** Orders the office may send to a Runner: paid, offered, or taken but not yet being shopped. */
const SENDABLE = new Set<Order['status']>(['paid', 'offered', 'accepted']);

/** One line of a request: this order to this Runner, perhaps with a backup, perhaps early. */
export interface Assignment {
  orderId: string;
  runnerId: string;
  backupRunnerId?: string | undefined;
  /** A booked order (ruling 78) may go before its offer time only when this is true. */
  allowEarly?: boolean | undefined;
}

/** What became of one line. */
export interface AssignmentResult {
  orderId: string;
  reference: string | null;
  runnerId: string;
  runnerName: string | null;
  result: 'allocated' | 'refused';
  /** Allocated: offered to the Runner now, or waiting its turn behind what they hold. */
  state?: 'offered' | 'queued';
  /** Allocated and waiting: its place in the Runner's allocated queue, 1 being next. */
  place?: number;
  /** Refused: why, in plain words, such as "it has been bought already". */
  reason?: string;
  allocationId?: string;
}

/** Who sent it, as the audit log and the order's history say it. */
export interface Allocator {
  id: string | null;
  name: string;
}

/** "Ada Lovelace" gives "Ada". */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? 'the Runner';
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** A booked order whose offer time has not come yet (ruling 78). */
function bookedAhead(order: Pick<Order, 'offerAt'>, at: Date): boolean {
  return order.offerAt !== null && order.offerAt.getTime() > at.getTime();
}

/** Why this order cannot be sent to anybody now, or null when it can. */
export function orderRefusal(order: Order): string | null {
  if (order.isDemo) return 'it is a demo order, so no Runner is sent';
  if (order.splitAt) return 'it has been split into parts; send each part on its own';
  switch (order.status) {
    case 'draft':
    case 'confirmed':
      return 'it has not been paid for yet';
    case 'cancelled':
    case 'refunded':
      return 'it has been cancelled';
    case 'shopping':
      return 'it is being shopped already';
    case 'receipt_submitted':
    case 'delivering':
      return 'it has been bought already';
    case 'delivered':
    case 'completed':
      return 'it has been delivered already';
    default:
      return SENDABLE.has(order.status) ? null : 'it cannot be sent to a Runner now';
  }
}

/** Why this Runner cannot be sent this order, or null when they can. */
export function runnerRefusal(ctx: Pick<Ctx, 'config'>, runner: Runner, order: Order, at: Date) {
  const name = firstName(runner.name);
  if (!mayBeAssigned(runner)) return `${name} is not approved to take jobs`;
  if (!canCarry(ctx.config, runner, order, at)) {
    return `${name} cannot carry it: ${lowerFirst(largeOrderWords(ctx.config, order, runner).replace(/\.$/, ''))}`;
  }
  return null;
}

/** The order's office allocation still live, queued or offered, if there is one. */
export async function liveAllocationFor(
  ctx: Pick<Ctx, 'repository'>,
  orderId: string,
): Promise<JobAllocation | null> {
  const rows = await ctx.repository.allocations.listForOrder(orderId);
  return rows.find((row) => LIVE_ALLOCATION.includes(row.status)) ?? null;
}

/** The ids of every order the office has sent to a Runner that is still queued or offered. */
export async function allocatedOrderIds(ctx: Pick<Ctx, 'repository'>): Promise<Set<string>> {
  return new Set(
    (await ctx.repository.allocations.listByStatus(LIVE_ALLOCATION)).map((row) => row.orderId),
  );
}

/** Held for its offer time: a booked order not sent early on purpose. */
function heldForItsTime(order: Order, allocation: JobAllocation, at: Date): boolean {
  return bookedAhead(order, at) && !allocation.allowEarly;
}

/**
 * Runners with a job from the office waiting for them and ready to go: the ordinary queue does
 * not offer them anything else meanwhile (services/dispatch.ts).
 */
export async function runnersAwaitingOfficeJobs(
  ctx: Pick<Ctx, 'repository'>,
  at: Date,
): Promise<Set<string>> {
  const waiting = new Set<string>();
  for (const row of await ctx.repository.allocations.listByStatus(['queued'])) {
    if (waiting.has(row.runnerId)) continue;
    const order = await ctx.repository.orders.findById(row.orderId);
    if (order && !heldForItsTime(order, row, at)) waiting.add(row.runnerId);
  }
  return waiting;
}

/** A Runner whose hands are full: a job in hand, or an offer open for them now. */
async function handsFull(ctx: Ctx, runnerId: string, at: Date): Promise<boolean> {
  if (((await activeOrdersByRunner(ctx)).get(runnerId) ?? []).length > 0) return true;
  return (await ctx.repository.offers.listByOutcome('pending')).some(
    (offer) => offer.runnerId === runnerId && !isOfferExpired(offer, at),
  );
}

/** The job, as the Runner is told it: never the customer's name, address or number. */
export function officeJobWords(ctx: Pick<Ctx, 'config'>, order: Order): string {
  const money = (pence: number) => formatPence(pence, ctx.config.store.currencySymbol);
  const things = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const minutes = ctx.config.allocation.allocatedHoldMinutes;
  return `The office has sent you job ${orderReference(order)}: ${things} ${things === 1 ? 'thing' : 'things'}, about ${money(order.goodsEstimatePence)} of shopping, from ${ctx.config.store.displayName}. You get ${money(order.runnerPaymentPence)}. It is held for you alone for ${minutes} minutes. Take it or say no on your Runner page.`;
}

/** Notification and text to the Runner. Never stops the offer: the Runner page shows it too. */
async function tellRunnerOfJob(
  ctx: Ctx,
  runner: Runner,
  order: Order,
  offer: JobOffer,
  log?: FastifyBaseLogger,
): Promise<void> {
  const words = officeJobWords(ctx, order);
  if (ctx.sendPush) {
    try {
      for (const device of await ctx.repository.pushSubscriptions.listForRunner(runner.id)) {
        try {
          const sent = await ctx.sendPush(device, {
            title: ctx.config.productName,
            body: words,
            url: '/runner',
            tag: `office-job-${offer.id}`,
          });
          if (sent === 'gone')
            await ctx.repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
        } catch (failure) {
          log?.warn({ err: failure }, 'A notification about a job from the office did not go.');
        }
      }
    } catch (failure) {
      log?.warn({ err: failure }, 'Notifications about a job from the office could not be sent.');
    }
  }
  if (ctx.sendText && runner.phone) {
    await ctx
      .sendText(runner.phone, `${ctx.config.productName}: ${words}`)
      .catch((failure: unknown) =>
        log?.warn({ err: failure }, 'The text about a job from the office did not go.'),
      );
  }
}

/** Makes the priority offer: held for this Runner alone, longer than a queue offer. */
async function offerAllocation(
  ctx: Ctx,
  allocation: JobAllocation,
  order: Order,
  runner: Runner,
  log?: FastifyBaseLogger,
): Promise<JobAllocation> {
  const at = ctx.now();
  const offer = await ctx.repository.offers.create({
    orderId: order.id,
    runnerId: runner.id,
    expiresAt: offerExpiryAt(at, ctx.config.allocation.allocatedHoldMinutes * 60),
    queuePosition: 0,
    distanceMiles: distanceMiles(order, runner),
    allocated: true,
  });
  if (order.status === 'paid') await ctx.repository.orders.update(order.id, { status: 'offered' });
  const updated = await ctx.repository.allocations.update(allocation.id, {
    status: 'offered',
    offerId: offer.id,
    offeredAt: at,
  });
  await tellRunnerOfJob(ctx, runner, order, offer, log);
  return updated;
}

/**
 * The next job in this Runner's allocated queue, offered if their hands are free: the oldest
 * sent first. One that can no longer go (bought, cancelled, or the Runner can no longer carry it)
 * is withdrawn and left to the ordinary queue; a booked order waits for its offer time unless it
 * was sent early. Null when nothing was offered.
 */
export async function offerNextFor(
  ctx: Ctx,
  runnerId: string,
  log?: FastifyBaseLogger,
): Promise<JobAllocation | null> {
  const at = ctx.now();
  const queued = (await ctx.repository.allocations.listByStatus(['queued'])).filter(
    (row) => row.runnerId === runnerId,
  );
  if (queued.length === 0 || (await handsFull(ctx, runnerId, at))) return null;
  const runner = await ctx.repository.runners.findById(runnerId);
  for (const allocation of queued) {
    const order = await ctx.repository.orders.findById(allocation.orderId);
    const refusal = !order
      ? 'gone'
      : (orderRefusal(order) ??
        (order.status === 'accepted' || order.runnerId ? 'taken' : null) ??
        (runner ? runnerRefusal(ctx, runner, order, at) : 'gone'));
    if (!order || !runner || refusal) {
      await ctx.repository.allocations.update(allocation.id, {
        status: 'withdrawn',
        settledAt: at,
        returnedTo: order && !orderRefusal(order) && !order.runnerId ? 'queue' : null,
      });
      continue;
    }
    if (heldForItsTime(order, allocation, at)) continue;
    return offerAllocation(ctx, allocation, order, runner, log);
  }
  return null;
}

/** Its place in the Runner's allocated queue, 1 being next. */
async function placeInQueue(ctx: Ctx, allocation: JobAllocation): Promise<number> {
  const queued = (await ctx.repository.allocations.listByStatus(['queued'])).filter(
    (row) => row.runnerId === allocation.runnerId,
  );
  return Math.max(1, queued.findIndex((row) => row.id === allocation.id) + 1);
}

/** One assignment, on its own: allocated, or refused with a reason. Never throws. */
async function allocateOne(
  ctx: Ctx,
  assignment: Assignment,
  by: Allocator,
  log: FastifyBaseLogger,
): Promise<AssignmentResult> {
  const { repository } = ctx;
  const base = {
    orderId: assignment.orderId,
    runnerId: assignment.runnerId,
    reference: null as string | null,
    runnerName: null as string | null,
  };
  const refuse = (reason: string): AssignmentResult => ({ ...base, result: 'refused', reason });
  try {
    const order = await repository.orders.findById(assignment.orderId);
    if (!order) return refuse('that order was not found');
    base.reference = orderReference(order);
    const runner = await repository.runners.findById(assignment.runnerId);
    if (!runner) return refuse('that Runner was not found');
    base.runnerName = firstName(runner.name);
    const at = ctx.now();

    const notNow = orderRefusal(order);
    if (notNow) return refuse(notNow);
    if (order.runnerId === runner.id) return refuse(`${base.runnerName} has it already`);
    // Booked for a later day (ruling 78): sent before then only on purpose. One booked for later
    // today is sent, and held for the Runner until its offer time unless sent early.
    if (bookedAhead(order, at) && !assignment.allowEarly && order.deliveryDay !== ukDate(at)) {
      return refuse(
        `it is booked for a later day, ${bookedWords(ctx, order)}; choose to send it early to send it now`,
      );
    }
    const cannot = runnerRefusal(ctx, runner, order, at);
    if (cannot) return refuse(cannot);
    let backup: Runner | null = null;
    if (assignment.backupRunnerId) {
      if (assignment.backupRunnerId === runner.id) {
        return refuse('the backup is the same Runner; choose somebody else, or no backup');
      }
      backup = await repository.runners.findById(assignment.backupRunnerId);
      if (!backup) return refuse('the backup Runner was not found');
      const backupCannot = runnerRefusal(ctx, backup, order, at);
      if (backupCannot) return refuse(`the backup cannot have it: ${backupCannot}`);
    }
    const live = await liveAllocationFor(ctx, order.id);
    if (live?.runnerId === runner.id) {
      return refuse(`it has been sent to ${base.runnerName} already`);
    }

    // Taken back from whoever has it: a Runner who accepted it is released and told to stop
    // (services/order-rescue.ts); open offers, and any earlier sending, are withdrawn.
    if (order.runnerId) {
      const freed = await releaseRunner(ctx, order, log);
      await tellShopperWords(
        ctx,
        freed.order,
        `Your order ${orderReference(order)} is being passed to another Runner. We will tell you when one has it.`,
        log,
      );
      if (freed.runner) await offerNextFor(ctx, freed.runner.id, log);
    } else {
      await withdrawOffers(ctx, order.id);
      if (live) await offerNextFor(ctx, live.runnerId, log);
    }

    const allocation = await repository.allocations.create({
      orderId: order.id,
      runnerId: runner.id,
      backupRunnerId: backup?.id ?? null,
      allowEarly: assignment.allowEarly === true,
      allocatedById: by.id,
      allocatedByName: by.name,
      allocatedAt: at,
    });
    await offerNextFor(ctx, runner.id, log);
    const now = (await repository.allocations.findById(allocation.id)) ?? allocation;
    if (now.status === 'offered') {
      return { ...base, result: 'allocated', state: 'offered', allocationId: now.id };
    }
    return {
      ...base,
      result: 'allocated',
      state: 'queued',
      place: await placeInQueue(ctx, now),
      allocationId: now.id,
    };
  } catch (failure) {
    log.warn({ err: failure, orderId: assignment.orderId }, 'An order could not be allocated.');
    return refuse(
      failure instanceof Error && failure.message
        ? lowerFirst(failure.message.replace(/\.$/, ''))
        : 'it could not be sent just now',
    );
  }
}

/**
 * Every assignment, in the order given, each on its own: one that is refused never stops the
 * rest. No limit on how many, or on how many go to one Runner.
 */
export async function allocateOrders(
  ctx: Ctx,
  assignments: readonly Assignment[],
  by: Allocator,
  log: FastifyBaseLogger,
): Promise<AssignmentResult[]> {
  const results: AssignmentResult[] = [];
  for (const assignment of assignments) results.push(await allocateOne(ctx, assignment, by, log));
  return results;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The results read back in one breath: "4 orders sent to Tomasz; 1 could not be: order 7KQ2PX,
 * it has been bought already."
 */
export function allocationMessage(results: readonly AssignmentResult[]): string {
  const sent = results.filter((row) => row.result === 'allocated');
  const refused = results.filter((row) => row.result === 'refused');
  const byRunner = new Map<string, { name: string; count: number; waiting: number }>();
  for (const row of sent) {
    const entry = byRunner.get(row.runnerId) ?? {
      name: row.runnerName ?? 'the Runner',
      count: 0,
      waiting: 0,
    };
    entry.count += 1;
    if (row.state === 'queued') entry.waiting += 1;
    byRunner.set(row.runnerId, entry);
  }
  const parts = [...byRunner.values()].map(
    (entry, index) =>
      `${index === 0 ? count(entry.count, 'order', 'orders') : entry.count} sent to ${entry.name}`,
  );
  let text = parts.length > 0 ? parts.join(', ') : 'Nothing was sent';
  if (refused.length > 0) {
    const why = refused
      .map((row) => (row.reference ? `order ${row.reference}, ${row.reason}` : row.reason))
      .join('; ');
    text += sent.length > 0 ? `; ${refused.length} could not be: ${why}.` : `: ${why}.`;
  } else {
    text += '.';
  }
  for (const entry of byRunner.values()) {
    if (entry.waiting === 0) continue;
    text += ` ${entry.waiting === entry.count ? (entry.waiting === 1 ? 'It waits' : 'They wait') : `${entry.waiting} wait`} their turn with ${entry.name}, in the order sent.`;
  }
  return text;
}

/**
 * An office offer ended without a yes: said no to, or run out. The order goes to the backup
 * Runner if the office chose one who can still have it, otherwise back to the ordinary queue; the
 * office is told on Ozi's desk; and the Runner, free again, is offered their next office job.
 */
export async function settleAllocatedOffer(
  ctx: Ctx,
  offer: JobOffer,
  outcome: 'accepted' | 'declined' | 'expired',
  log?: FastifyBaseLogger,
): Promise<JobAllocation | null> {
  const { repository } = ctx;
  const allocation = (await repository.allocations.listForOrder(offer.orderId)).find(
    (row) => row.offerId === offer.id && row.status === 'offered',
  );
  if (!allocation) return null;
  const at = ctx.now();
  if (outcome === 'accepted') {
    return repository.allocations.update(allocation.id, { status: 'accepted', settledAt: at });
  }
  await repository.allocations.update(allocation.id, { status: outcome, settledAt: at });

  const order = await repository.orders.findById(offer.orderId);
  let returnedTo: 'backup' | 'queue' | null = null;
  let backupName: string | null = null;
  if (order && !orderRefusal(order) && !order.runnerId) {
    const backup = allocation.backupRunnerId
      ? await repository.runners.findById(allocation.backupRunnerId)
      : null;
    if (backup && !runnerRefusal(ctx, backup, order, at)) {
      await repository.allocations.create({
        orderId: order.id,
        runnerId: backup.id,
        allowEarly: allocation.allowEarly,
        allocatedById: allocation.allocatedById,
        allocatedByName: allocation.allocatedByName,
        allocatedAt: at,
        backupOfId: allocation.id,
      });
      returnedTo = 'backup';
      backupName = firstName(backup.name);
      await offerNextFor(ctx, backup.id, log);
    } else {
      returnedTo = 'queue';
      await offerOrder(ctx, order.id).catch((failure: unknown) =>
        log?.warn({ err: failure, orderId: order.id }, 'Could not offer a returned order.'),
      );
    }
  }
  const settled = await repository.allocations.update(allocation.id, { returnedTo });

  const runner = await repository.runners.findById(allocation.runnerId);
  const reference = order
    ? orderReference(order)
    : orderReference({ id: offer.orderId, bankReference: null });
  await askOwner(
    ctx,
    {
      kind: 'allocation_returned',
      subjectId: allocation.id,
      options: 'acknowledge',
      summary: `${firstName(runner?.name)} ${outcome === 'declined' ? 'said no to' : 'did not answer in time for'} order ${reference}, which ${allocation.allocatedByName} sent them. ${returnedTo === 'backup' ? `It has gone to ${backupName}, the backup.` : returnedTo === 'queue' ? 'It is back in the queue for any Runner.' : 'The order is no longer waiting.'}`,
    },
    log,
  );
  await tellAllocator(ctx, settled, reference, log);
  await offerNextFor(ctx, allocation.runnerId, log);
  return settled;
}

/** The staff member who sent it, on their own devices if they allowed notifications. */
async function tellAllocator(
  ctx: Ctx,
  allocation: JobAllocation,
  reference: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  if (!ctx.sendPush || !allocation.allocatedById) return;
  try {
    for (const device of await ctx.repository.pushSubscriptions.listForStaff(
      allocation.allocatedById,
    )) {
      await ctx
        .sendPush(device, {
          title: ctx.config.productName,
          body: `Order ${reference}, which you sent to a Runner, has come back: ${allocation.returnedTo === 'backup' ? 'it has gone to the backup' : 'it is back in the queue'}.`,
          url: '/staff',
          tag: `allocation-${allocation.id}`,
        })
        .catch(() => undefined);
    }
  } catch (failure) {
    log?.warn({ err: failure }, 'The office could not be told on their device.');
  }
}

/**
 * The minute-by-minute work, with the offer sweep (src/index.ts): office offers that ran out are
 * settled, ones taken or withdrawn elsewhere are recorded, and every Runner with jobs waiting in
 * their allocated queue is offered the next when their hands are free.
 */
export async function sweepAllocations(
  ctx: Ctx,
  onError: (allocationId: string, failure: unknown) => void = () => undefined,
): Promise<number> {
  const { repository } = ctx;
  const at = ctx.now();
  for (const allocation of await repository.allocations.listByStatus(['offered'])) {
    try {
      const offer = allocation.offerId
        ? await repository.offers.findById(allocation.offerId)
        : null;
      if (!offer || offer.outcome === 'superseded') {
        await repository.allocations.update(allocation.id, { status: 'withdrawn', settledAt: at });
        continue;
      }
      if (offer.outcome === 'accepted') {
        await settleAllocatedOffer(ctx, offer, 'accepted');
        continue;
      }
      if (offer.outcome === 'pending' && isOfferExpired(offer, at)) {
        const lapsed = await repository.offers.update(offer.id, {
          outcome: 'expired',
          respondedAt: at,
        });
        await settleAllocatedOffer(ctx, lapsed, 'expired');
        continue;
      }
      if (offer.outcome === 'expired' || offer.outcome === 'declined') {
        await settleAllocatedOffer(ctx, offer, offer.outcome);
      }
    } catch (failure) {
      onError(allocation.id, failure);
    }
  }
  let offered = 0;
  const runners = new Set(
    (await repository.allocations.listByStatus(['queued'])).map((row) => row.runnerId),
  );
  for (const runnerId of runners) {
    try {
      if (await offerNextFor(ctx, runnerId)) offered += 1;
    } catch (failure) {
      onError(runnerId, failure);
    }
  }
  return offered;
}

/** Where an allocation has got to, in words for the office. */
export function allocationStateWords(
  allocation: JobAllocation,
  runnerName: string,
  backupName: string | null,
): string {
  switch (allocation.status) {
    case 'queued':
      return `Waiting for ${runnerName} to finish the job in hand, or for its booked time.`;
    case 'offered':
      return `Offered to ${runnerName}, held for them alone.`;
    case 'accepted':
      return `${runnerName} took it.`;
    case 'declined':
    case 'expired':
      return `${runnerName} ${allocation.status === 'declined' ? 'said no' : 'did not answer in time'}; ${allocation.returnedTo === 'backup' ? `it went to ${backupName ?? 'the backup'}, the backup` : allocation.returnedTo === 'queue' ? 'it went back to the queue' : 'the order is no longer waiting'}.`;
    case 'withdrawn':
      return `Withdrawn from ${runnerName}${allocation.returnedTo === 'queue' ? '; it went back to the queue' : ''}.`;
  }
}
