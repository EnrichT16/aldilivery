/**
 * The Shopper's side of an order once it is on its way and after: feedback with delivery credit
 * (Section O), and who sees what of it. The arrival time and the door safe word are on the
 * Shopper's order page (`GET /orders/current`) and the Runner's job (`GET /jobs/current`).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { FEEDBACK_THEMES, formatPence, isFeedbackTheme } from '@aldilivery/core';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { staffActor } from '../lib/staff.js';
import { feedbackPatterns } from '../services/feedback.js';

const DAY_MS = 24 * 3600 * 1000;
/** Patterns are made from the last three months of feedback. */
const PATTERN_DAYS = 90;

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  themes: z.array(z.string().max(40)).max(Object.keys(FEEDBACK_THEMES).length).default([]),
  message: z.string().trim().max(2000).default(''),
});

export async function registerOrderExtraRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);

  /**
   * Feedback on a delivered order. Anything at all counts: a score, a theme, a few words. It
   * earns the delivery credit once per order, whatever it says.
   */
  app.post('/orders/:id/feedback', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = feedbackSchema.parse(request.body ?? {});
    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (order.shopperId !== session.accountId) throw new ForbiddenError('That order is not yours.');
    if (order.status !== 'delivered' && order.status !== 'completed') {
      throw new ConflictError('You can tell us how it went once your shopping has arrived.');
    }
    const themes = [...new Set(input.themes)].filter(isFeedbackTheme);
    if (input.rating === undefined && themes.length === 0 && input.message === '') {
      throw new BadRequestError('Please choose a score, tick something, or say a few words.');
    }
    if (await repository.shopperFeedback.findByOrderId(order.id)) {
      throw new ConflictError('Thank you, you have already told us about this order.');
    }

    const creditPence = config.feedback.creditPence;
    await repository.shopperFeedback.create({
      orderId: order.id,
      rating: input.rating ?? null,
      themes: themes.join(','),
      message: input.message,
      creditPence,
      createdAt: now(),
    });
    if (creditPence > 0) {
      const shopper = await repository.shoppers.findById(session.accountId);
      if (shopper) {
        await repository.shoppers.update(shopper.id, {
          creditPence: shopper.creditPence + creditPence,
        });
      }
    }
    void reply.status(201);
    return {
      creditPence,
      message:
        creditPence > 0
          ? `Thank you for telling us. ${money(creditPence)} of delivery credit is on your account, and comes off your next order.`
          : 'Thank you for telling us.',
    };
  });

  /** For customer care: what Shoppers said, with no names, and the patterns. */
  app.get('/staff/shopper-feedback', async (request) => {
    await staffActor(request, 'feedback');
    const rows = await repository.shopperFeedback.listSince(
      new Date(now().getTime() - PATTERN_DAYS * DAY_MS),
    );
    return {
      patterns: feedbackPatterns(rows),
      recent: rows
        .slice(-50)
        .reverse()
        .map((row) => ({
          rating: row.rating,
          themes: row.themes
            .split(',')
            .filter(isFeedbackTheme)
            .map((theme) => FEEDBACK_THEMES[theme]),
          message: row.message,
          createdAt: row.createdAt,
        })),
    };
  });

  /** For a Shop Partner: patterns only, never who said what, and nothing at all when too few. */
  app.get('/business/feedback-patterns', async (request) => {
    await businessActor(request, 'partner');
    const rows = await repository.shopperFeedback.listSince(
      new Date(now().getTime() - PATTERN_DAYS * DAY_MS),
    );
    return { patterns: feedbackPatterns(rows), days: PATTERN_DAYS };
  });
}
