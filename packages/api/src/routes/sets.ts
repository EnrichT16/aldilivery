/**
 * Sets: the recurring order.
 *
 * Rule Five is the whole shape of this file. A Set does not fire because the clock says so.
 * It fires because a notice went out thirty minutes earlier and the Shopper did not say the
 * one word that stops it. `mayFire` is the only door, and it refuses a Set whose notice was
 * missing or late.
 *
 * The server runs them itself, once a minute (services/set-runner.ts): the notice goes by
 * notification or text, and a Set the Shopper agreed should send itself is placed and paid for
 * with their saved card. `/sets/notices/run` and `/sets/run` do the same on demand, for the
 * server itself only.
 */

import type { FastifyInstance } from 'fastify';
import { SET_NOTICE_MINUTES_BEFORE } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession, requireStaff } from '../app.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { priceLines } from '../services/basket.js';
import { runDueSets, sendDueNotices } from '../services/set-runner.js';
import { firstFireAt, isSkipInstruction, noticeDueAt } from '../services/sets.js';

const createSetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  deliveryAddress: z.string().trim().min(1).max(300),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  paymentMethodId: z.string().min(1).optional(),
  frequency: z.enum(['weekly', 'fortnightly', 'monthly']),
  dayOfWeek: z.number().int().min(1).max(7),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, 'A time looks like 09:30.'),
  lines: z
    .array(
      z.object({
        catalogueItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
  /**
   * Send and pay for each one by itself after the notice, unless the Shopper says the skip
   * word (Rule One: this is their explicit agreement, in the words they were shown). Without
   * it, a Set is a reminder only and nothing is ever paid for.
   */
  autoSend: z
    .object({
      confirmed: z.literal(true),
      statement: z.string().trim().min(1).max(400),
    })
    .optional(),
});

export async function registerSetRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const skipWord = config.recurringOrders.skipWord;
  const noticeMinutes = config.recurringOrders.noticeMinutesBefore;

  app.post('/sets', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const input = createSetSchema.parse(request.body);

    const catalogueItems = await repository.catalogue.findManyByIds(
      input.lines.map((line) => line.catalogueItemId),
    );

    // Rule Six applies to a Set exactly as it applies to a one off order.
    const priced = priceLines(input.lines, catalogueItems, config.fees);

    // Sending and paying by itself needs a saved card of the Shopper's own.
    if (input.autoSend) {
      const card = input.paymentMethodId
        ? await repository.paymentMethods.findById(input.paymentMethodId)
        : null;
      if (!card || card.shopperId !== session.accountId) {
        throw new BadRequestError(
          'To have it sent and paid for by itself, please choose one of your saved cards.',
        );
      }
    }

    const recurringSet = await repository.sets.create({
      shopperId: session.accountId,
      name: input.name,
      deliveryAddress: input.deliveryAddress,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      frequency: input.frequency,
      dayOfWeek: input.dayOfWeek,
      timeOfDay: input.timeOfDay,
      nextFireAt: firstFireAt(now(), input.dayOfWeek, input.timeOfDay),
      ...(input.autoSend
        ? { autoSendAgreedAt: now(), autoSendStatement: input.autoSend.statement }
        : {}),
      items: priced.lines.map((line) => ({
        catalogueItemId: line.catalogueItemId,
        name: line.name,
        quantity: line.quantity,
        estimatedPricePence: line.unitPricePence,
      })),
    });

    void reply.status(201);
    return {
      set: recurringSet,
      estimate: {
        goodsPence: priced.goodsPence,
        feePence: priced.feePence,
        totalPence: priced.totalPence,
      },
      promise: input.autoSend
        ? `We will tell you ${noticeMinutes} minutes before every one of these, and you can stop it by saying "${skipWord}". If you do not, it is sent and paid for with your saved card.`
        : `We will tell you ${noticeMinutes} minutes before every one of these, and you can stop it by saying "${skipWord}".`,
    };
  });

  app.get('/sets', async (request) => {
    const session = requireSession(request, 'shopper');
    const sets = await repository.sets.listForShopper(session.accountId);
    return {
      sets: sets.map((set) => ({
        ...set,
        noticeDueAt: noticeDueAt(set.nextFireAt, noticeMinutes).toISOString(),
      })),
      noticeMinutesBefore: noticeMinutes,
      skipWord,
    };
  });

  app.post('/sets/:id/pause', async (request) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const set = await repository.sets.findById(id);
    if (!set) throw new NotFoundError('regular order');
    if (set.shopperId !== session.accountId) throw new ForbiddenError();

    const updated = await repository.sets.update(set.id, { active: false });
    return { set: updated, message: 'Paused. Nothing more will come until you start it again.' };
  });

  /**
   * The one word skip.
   *
   * Sent as a reply to the notice. It stops the next occurrence only; the Set itself stays,
   * so a Shopper who skips one week is not silently unsubscribed from the arrangement they
   * set up.
   */
  app.post('/sets/:id/skip', async (request) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ reply: z.string().trim().min(1).max(50).optional() })
      .parse(request.body ?? {});

    const set = await repository.sets.findById(id);
    if (!set) throw new NotFoundError('regular order');
    if (set.shopperId !== session.accountId) throw new ForbiddenError();

    // A reply is accepted either as the bare word or as an explicit call to this route.
    if (body.reply !== undefined && !isSkipInstruction(body.reply, skipWord)) {
      throw new BadRequestError(
        `To stop this one, just say "${skipWord}". Anything else and it will come as usual.`,
      );
    }

    const updated = await repository.sets.update(set.id, {
      skipRequestedForFireAt: set.nextFireAt,
    });

    return {
      set: updated,
      skipped: true,
      message: `That one is cancelled. Nothing has been charged. Your regular order carries on as normal after this.`,
    };
  });

  /**
   * The thirty minute notice, on demand. The server sends notices itself once a minute; this
   * does the same now, for the server itself only.
   */
  app.post('/sets/notices/run', async (request) => {
    requireStaff(request, app.ctx.env.staffKey);
    const outcomes = await sendDueNotices(app.ctx, request.log);
    return {
      sent: outcomes.length,
      notices: outcomes.map((outcome) => ({ setId: outcome.setId })),
      noticeMinutesBefore: SET_NOTICE_MINUTES_BEFORE,
    };
  });

  /**
   * Fire the Sets that are due, on demand, as the minute sweep does. Every Set goes through
   * `mayFire`, which refuses anything whose notice did not go out at least thirty minutes
   * beforehand. A refusal is returned with its reason rather than swallowed.
   */
  app.post('/sets/run', async (request) => {
    requireStaff(request, app.ctx.env.staffKey);
    const outcomes = await runDueSets(app.ctx, request.log);
    const fired = [];
    const refused = [];
    for (const outcome of outcomes) {
      if (outcome.kind === 'placed' || outcome.kind === 'draft') {
        fired.push({ setId: outcome.setId, orderId: outcome.orderId, kind: outcome.kind });
      } else if (outcome.kind === 'skipped') {
        refused.push({ setId: outcome.setId, because: 'skipped_by_shopper' });
      } else if (outcome.kind === 'missed' || outcome.kind === 'not-placed') {
        refused.push({ setId: outcome.setId, because: outcome.because });
      }
    }
    return { fired, refused };
  });
}
