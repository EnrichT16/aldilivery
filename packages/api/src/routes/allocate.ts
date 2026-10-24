/**
 * "Allocate jobs" in the admin panel's Orders tab (ruling 80, Anthony, 24 October 2026;
 * docs/changes/allocate-jobs.md): the owner, and staff he lets allocate, send any order straight
 * to a chosen Runner, outside the queue, as many as they like to as many Runners as they like.
 *
 * - `GET /staff/allocate`: the orders waiting or offered (paid, offered, taken but not yet being
 *   shopped, and orders booked for today), numbered for saying aloud; the approved Runners, on
 *   shift first, with how many jobs each holds and their way of travelling; and what was sent
 *   lately and what became of it.
 * - `POST /staff/orders/allocate`: `{ assignments: [{ orderId, runnerId, backupRunnerId?,
 *   allowEarly? }] }`, no maximum, each taken on its own and answered on its own.
 *
 * Both need the Orders tab and the permission to allocate (services/allocate.ts). Every order
 * sent is written in the audit log, with who sent it, which order, which Runner and when.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Order, Runner } from '../domain.js';
import { district } from '../lib/analytics.js';
import { recordAudit } from '../lib/audit.js';
import { staffActor } from '../lib/staff.js';
import {
  allocateOrders,
  allocationMessage,
  allocationStateWords,
  firstName,
  LIVE_ALLOCATION,
  requireAllocator,
} from '../services/allocate.js';
import { isOfferExpired } from '../services/allocation.js';
import { isLargeOrder, vehiclesFor, waitingSince } from '../services/dispatch.js';
import { mayBeAssigned } from '../services/order-rescue.js';
import { ukDate } from '../services/owner-desk.js';
import { activeOrdersByRunner } from '../services/runner-pool.js';
import { bookedWords } from '../services/scheduled.js';
import { splitView } from '../services/split.js';
import { orderReference, STATUS_WORDS } from './admin.js';

/** A way of travelling, in words. */
const TRAVEL_WORDS: Record<Runner['vehicleType'], string> = {
  on_foot: 'on foot',
  bicycle: 'by bicycle',
  motorbike: 'by motorbike',
  car: 'by car',
  van: 'by van',
};

const assignmentSchema = z.object({
  orderId: z.string().trim().min(1, 'Please choose an order.'),
  runnerId: z.string().trim().min(1, 'Please choose a Runner.'),
  backupRunnerId: z.string().trim().min(1).optional(),
  allowEarly: z.boolean().optional(),
});

export async function registerAllocateRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now, config } = app.ctx;

  app.get('/staff/allocate', async (request) => {
    const actor = await staffActor(request, 'orders');
    await requireAllocator(app.ctx, actor);
    const at = now();
    const today = ukDate(at);

    const names = new Map<string, string>();
    const nameOf = async (id: string | null): Promise<string | null> => {
      if (!id) return null;
      if (!names.has(id)) {
        names.set(id, firstName((await repository.runners.findById(id))?.name));
      }
      return names.get(id) ?? null;
    };

    const pending = (await repository.offers.listByOutcome('pending')).filter(
      (offer) => !isOfferExpired(offer, at),
    );
    const live = await repository.allocations.listByStatus(LIVE_ALLOCATION);
    const candidates: Order[] = [];
    for (const status of ['paid', 'offered', 'accepted'] as const) {
      candidates.push(...(await repository.orders.listByStatus(status)));
    }
    const waiting = candidates
      .filter((order) => !order.isDemo && order.splitAt === null)
      // Booked for a later day (ruling 78): not listed; one booked for today is.
      .filter(
        (order) =>
          order.offerAt === null ||
          order.offerAt.getTime() <= at.getTime() ||
          order.deliveryDay === today,
      )
      .sort((a, b) => waitingSince(a).getTime() - waitingSince(b).getTime());

    const orders = [];
    for (const [index, order] of waiting.entries()) {
      const offer = pending.find((row) => row.orderId === order.id);
      const sent = live.find((row) => row.orderId === order.id);
      const holder = order.runnerId ? await nameOf(order.runnerId) : null;
      const bookedLater = order.offerAt !== null && order.offerAt.getTime() > at.getTime();
      orders.push({
        number: index + 1,
        id: order.id,
        reference: orderReference(order),
        status: order.status,
        statusWords:
          order.status === 'accepted' && holder
            ? `${holder} has it, not yet shopping`
            : offer && !sent
              ? `Offered to ${await nameOf(offer.runnerId)}`
              : STATUS_WORDS[order.status],
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        goodsEstimatePence: order.goodsEstimatePence,
        area: district(order.deliveryAddress),
        waitingSince: waitingSince(order),
        booked: order.deliveryDay ? bookedWords(app.ctx, order) : null,
        /** Booked for later today: held until its offer time unless sent early. */
        bookedLater,
        offerAt: order.offerAt,
        largeWords:
          !order.splitMode && isLargeOrder(config, order)
            ? `Large order: only for a Runner with ${vehiclesFor(config, order.goodsEstimatePence)}.`
            : null,
        split: splitView(config, order)?.label ?? null,
        sentTo: sent
          ? {
              runnerId: sent.runnerId,
              runnerName: await nameOf(sent.runnerId),
              status: sent.status,
              by: sent.allocatedByName,
            }
          : null,
      });
    }

    const active = await activeOrdersByRunner(app.ctx);
    const runners = (await repository.runners.listAll())
      .filter((runner) => mayBeAssigned(runner))
      .map((runner) => {
        const inHand = (active.get(runner.id) ?? []).length;
        const offered = pending.filter((offer) => offer.runnerId === runner.id).length;
        const queued = live.filter(
          (row) => row.runnerId === runner.id && row.status === 'queued',
        ).length;
        return {
          id: runner.id,
          name: runner.name,
          firstName: firstName(runner.name),
          onShift: runner.available,
          travel: runner.vehicleType,
          travelWords: TRAVEL_WORDS[runner.vehicleType],
          jobsInHand: inHand,
          offersOpen: offered,
          queued,
          holds: inHand + offered + queued,
        };
      })
      .sort((a, b) => Number(b.onShift) - Number(a.onShift) || a.name.localeCompare(b.name));

    const recent = [];
    for (const row of await repository.allocations.listRecent(40)) {
      const order = await repository.orders.findById(row.orderId);
      const runnerName = (await nameOf(row.runnerId)) ?? 'the Runner';
      const backupName = await nameOf(row.backupRunnerId);
      recent.push({
        id: row.id,
        orderId: row.orderId,
        reference: order ? orderReference(order) : null,
        runnerName,
        backupName,
        by: row.allocatedByName,
        at: row.allocatedAt,
        status: row.status,
        words: allocationStateWords(row, runnerName, backupName),
      });
    }

    return {
      holdMinutes: config.allocation.allocatedHoldMinutes,
      orders,
      runners,
      recent,
    };
  });

  app.post('/staff/orders/allocate', async (request) => {
    const actor = await staffActor(request, 'orders');
    await requireAllocator(app.ctx, actor);
    const body = z
      .object({
        // No maximum: as many as the office wants to send, each answered on its own.
        assignments: z.array(assignmentSchema).min(1, 'Please choose at least one order.'),
      })
      .parse(request.body ?? {});
    const by = { id: actor.id, name: actor.name };
    const results = await allocateOrders(app.ctx, body.assignments, by, request.log);

    // The audit log: who sent which order to which Runner, and when, one entry each.
    for (const row of results) {
      if (row.result !== 'allocated') continue;
      const assignment = body.assignments.find(
        (one) => one.orderId === row.orderId && one.runnerId === row.runnerId,
      );
      await recordAudit(request, {
        action: 'order.allocated',
        target: `orderId=${row.orderId} runnerId=${row.runnerId}`,
        detail: JSON.stringify({
          order: row.reference,
          runner: row.runnerName,
          offered: row.state === 'offered',
          ...(row.place ? { place: row.place } : {}),
          ...(assignment?.backupRunnerId ? { backupRunnerId: assignment.backupRunnerId } : {}),
          ...(assignment?.allowEarly ? { early: true } : {}),
        }),
      });
    }

    const allocated = results.filter((row) => row.result === 'allocated').length;
    return {
      allocated,
      refused: results.length - allocated,
      results,
      message: allocationMessage(results),
    };
  });
}
