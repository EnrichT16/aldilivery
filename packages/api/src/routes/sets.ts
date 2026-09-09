/**
 * Sets: the recurring order.
 *
 * Rule Five is the whole shape of this file. A Set does not fire because the clock says so.
 * It fires because a notice went out thirty minutes earlier and the Shopper did not say the
 * one word that stops it. `mayFire` is the only door, and it refuses a Set whose notice was
 * missing or late.
 *
 * There is no telephony in this phase, so `/sets/notices/run` hands back the notices that
 * are due and marks them sent. A later phase will hand the same list to a voice or a text
 * message. The rule does not change when the delivery method does.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, SET_NOTICE_MINUTES_BEFORE } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { priceLines } from '../services/basket.js';
import {
  advanceAfterFiring,
  firstFireAt,
  isSkipInstruction,
  mayFire,
  noticeDueAt,
  noticeIsDue,
} from '../services/sets.js';

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
});

export async function registerSetRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const symbol = config.store.currencySymbol;
  const skipWord = config.recurringOrders.skipWord;
  const noticeMinutes = config.recurringOrders.noticeMinutesBefore;

  app.post('/sets', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const input = createSetSchema.parse(request.body);

    const catalogueItems = await repository.catalogue.findManyByIds(
      input.lines.map((line) => line.catalogueItemId),
    );

    // Rule Six applies to a Set exactly as it applies to a one off order.
    const priced = priceLines(input.lines, catalogueItems, {
      bands: config.fees.bands,
      maximumGoodsPence: config.fees.maximumGoodsPence,
    });

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
      promise: `We will tell you ${noticeMinutes} minutes before every one of these, and you can stop it by saying "${skipWord}".`,
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
    const body = z.object({ reply: z.string().trim().min(1).max(50).optional() }).parse(
      request.body ?? {},
    );

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
   * The thirty minute notice hook.
   *
   * A scheduler calls this. It returns every notice that is due and marks it sent. Sending
   * it by voice or by text is a later phase; the rule that it must go out first is not.
   */
  app.post('/sets/notices/run', async () => {
    const at = now();
    const active = await repository.sets.listActive();

    const due = active.filter((set) => noticeIsDue(set, at, noticeMinutes));

    const notices = [];
    for (const set of due) {
      const items = await repository.catalogue.findManyByIds(
        set.items.map((item) => item.catalogueItemId ?? '').filter(Boolean),
      );
      const goodsPence = set.items.reduce(
        (sum, item) => sum + item.estimatedPricePence * item.quantity,
        0,
      );

      await repository.sets.update(set.id, { noticeSentAt: at });

      notices.push({
        setId: set.id,
        shopperId: set.shopperId,
        fireAt: set.nextFireAt.toISOString(),
        itemCount: set.items.length,
        knownItems: items.length,
        goodsEstimatePence: goodsPence,
        message:
          `Your regular order "${set.name}" goes in ${noticeMinutes} minutes. ` +
          `About ${formatPence(goodsPence, symbol)} of shopping. ` +
          `To stop it, say "${skipWord}".`,
        skipWord,
      });
    }

    return { sent: notices.length, notices, noticeMinutesBefore: SET_NOTICE_MINUTES_BEFORE };
  });

  /**
   * Fire the Sets that are due.
   *
   * Every Set goes through `mayFire`, which refuses anything whose notice did not go out at
   * least thirty minutes beforehand. A refusal is returned with its reason rather than
   * swallowed, because a Set that keeps failing to fire is something we need to see.
   */
  app.post('/sets/run', async () => {
    const at = now();
    const active = await repository.sets.listActive();

    const fired: Array<{ setId: string; goodsEstimatePence: number }> = [];
    const refused: Array<{ setId: string; because: string }> = [];

    for (const set of active) {
      const decision = mayFire(set, at, noticeMinutes);

      if (!decision.mayFire) {
        if (decision.refusedBecause !== 'not_yet_due') {
          refused.push({ setId: set.id, because: decision.refusedBecause ?? 'unknown' });
        }
        // A skipped occurrence still moves on to the next one.
        if (decision.refusedBecause === 'skipped_by_shopper') {
          await repository.sets.update(set.id, advanceAfterFiring(set, set.frequency));
        }
        continue;
      }

      const goodsPence = set.items.reduce(
        (sum, item) => sum + item.estimatedPricePence * item.quantity,
        0,
      );

      // The Set produces a draft order. It still has to pass through the ordinary order
      // route, and therefore through Rule One, before any money moves.
      await repository.orders.create({
        shopperId: set.shopperId,
        setId: set.id,
        status: 'draft',
        goodsEstimatePence: goodsPence,
        feePence: 0,
        totalEstimatePence: goodsPence,
        deliveryAddress: set.deliveryAddress,
        latitude: set.latitude,
        longitude: set.longitude,
        paymentMethodId: set.paymentMethodId,
        items: set.items.map((item) => ({
          catalogueItemId: item.catalogueItemId,
          name: item.name,
          quantity: item.quantity,
          estimatedPricePence: item.estimatedPricePence,
        })),
      });

      await repository.sets.update(set.id, {
        ...advanceAfterFiring(set, set.frequency),
        lastFiredAt: at,
      });

      fired.push({ setId: set.id, goodsEstimatePence: goodsPence });
    }

    return { fired, refused };
  });
}
