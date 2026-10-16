/**
 * What a Runner has earned, by the day: for their own dashboard, and for the fair queue
 * (ruling 64), which offers the next job to the Runner who has earned least today.
 *
 * A Runner sees only their own figures. The dispatcher compares figures and tells nobody; only
 * the owner's account ever sees money across Runners (ruling 43).
 */

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { areaOf, orderReference } from '../routes/runner-account.js';

type EarningsContext = Pick<AppContext, 'repository'>;

/** The calendar day in the UK, as YYYY-MM-DD. */
export function ukDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(at);
}

/** The Monday that starts the UK week this moment falls in, as YYYY-MM-DD. */
export function ukWeekStart(at: Date): string {
  const day = new Date(`${ukDay(at)}T12:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7; // Monday is 0
  day.setUTCDate(day.getUTCDate() - weekday);
  return day.toISOString().slice(0, 10);
}

/** One job a Runner has delivered, with what it earned them. */
export interface DeliveredJob {
  orderId: string;
  reference: string;
  deliveredAt: Date;
  /** The postcode district, never the door. */
  area: string;
  earnedPence: number;
  /** Whether the pay has reached their own account. */
  paid: boolean;
  /** The UK day it was delivered, YYYY-MM-DD. */
  day: string;
}

const DELIVERED = new Set<Order['status']>(['delivered', 'completed']);

/**
 * Every job this Runner has delivered, newest first, with what each earned: the payout's figure
 * once paid, the order's pay until then.
 */
export async function deliveredJobsFor(
  ctx: EarningsContext,
  runnerId: string,
): Promise<DeliveredJob[]> {
  const orders = await ctx.repository.orders.listForRunner(runnerId);
  const payouts = await ctx.repository.payouts.listForRunner(runnerId);
  const payoutFor = new Map(payouts.map((payout) => [payout.orderId, payout]));
  return orders
    .filter((order) => DELIVERED.has(order.status))
    .map((order) => {
      const when = order.deliveredAt ?? order.completedAt ?? order.updatedAt;
      const payout = payoutFor.get(order.id);
      return {
        orderId: order.id,
        reference: orderReference(order.id),
        deliveredAt: when,
        area: areaOf(order.deliveryAddress),
        earnedPence: payout?.earnedPence ?? order.runnerPaymentPence,
        paid: payout !== undefined,
        day: ukDay(when),
      };
    })
    .sort((a, b) => b.deliveredAt.getTime() - a.deliveredAt.getTime());
}

/** What the jobs on a UK day (or from one onwards) earned, in pence. */
export function earnedOn(jobs: readonly DeliveredJob[], day: string): number {
  return jobs.filter((job) => job.day === day).reduce((sum, job) => sum + job.earnedPence, 0);
}

export function earnedFrom(jobs: readonly DeliveredJob[], day: string): number {
  return jobs.filter((job) => job.day >= day).reduce((sum, job) => sum + job.earnedPence, 0);
}

/** What this Runner has earned today, in pence (ruling 64). */
export async function earnedTodayPence(
  ctx: EarningsContext,
  runnerId: string,
  at: Date,
): Promise<number> {
  return earnedOn(await deliveredJobsFor(ctx, runnerId), ukDay(at));
}
