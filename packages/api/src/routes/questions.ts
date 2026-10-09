/**
 * A Runner asking a Shopper about something they cannot find, and the Shopper answering — and
 * the Shopper's view of their order while it is on its way, which is where the question appears.
 * The rules are in `services/questions.ts`.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Order } from '../domain.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { doorWordSentence, ensureDoorWord } from '../services/door-word.js';
import { estimateArrival } from '../services/eta.js';
import { notifyShopper } from '../services/notify.js';
import { questionsForOrder, settle } from '../services/questions.js';

const ANSWER_WORDS = {
  similar: 'bring something similar',
  leave_out: 'leave it out',
} as const;

export async function registerQuestionRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now } = app.ctx;

  async function orderFor(
    request: Parameters<typeof requireSession>[0],
    id: string,
  ): Promise<{ order: Order; role: 'shopper' | 'runner' }> {
    const session = requireSession(request);
    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    const mine =
      session.role === 'shopper'
        ? order.shopperId === session.accountId
        : order.runnerId === session.accountId;
    if (!mine) throw new ForbiddenError('That order is not yours.');
    return { order, role: session.role };
  }

  /** The Runner cannot find one thing on the list. Asks once per item; asking again returns it. */
  app.post('/orders/:id/questions', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { orderItemId } = z.object({ orderItemId: z.string().min(1) }).parse(request.body);
    const { order, role } = await orderFor(request, id);
    if (role !== 'runner') throw new ForbiddenError('Only the Runner shopping for it can ask.');
    if (order.status !== 'shopping') {
      throw new ConflictError('You can ask about something while you are shopping for it.');
    }
    if (!order.items.some((item) => item.id === orderItemId)) {
      throw new BadRequestError('That is not on this list.');
    }

    const existing = (await repository.itemQuestions.listForOrder(order.id)).find(
      (question) => question.orderItemId === orderItemId,
    );
    if (!existing) {
      const question = await repository.itemQuestions.create({
        orderId: order.id,
        orderItemId,
        askedAt: now(),
      });
      void reply.status(201);
      // Not waited for: the Runner should not stand at the shelf while a push service answers.
      const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
      const itemName = order.items.find((item) => item.id === orderItemId)?.name ?? 'something';
      void notifyShopper(
        { repository, sendPush: app.ctx.sendPush, log: request.log },
        order.shopperId,
        {
          title: 'A question from your Runner',
          body: `${runner ? runner.name.split(' ')[0] : 'Your Runner'} cannot find ${itemName}. Open this to choose what they do.`,
          url: '/my-order',
          tag: `question-${question.id}`,
        },
      );
    }
    const views = await questionsForOrder(repository, order.id, now());
    return { question: views.find((view) => view.orderItemId === orderItemId) };
  });

  app.get('/orders/:id/questions', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { order } = await orderFor(request, id);
    return {
      questions: await questionsForOrder(repository, order.id, now()),
    };
  });

  /** The Shopper's answer. Only theirs to give, and only while the question is still open. */
  app.post('/orders/:id/questions/:questionId/answer', async (request) => {
    const { id, questionId } = z
      .object({ id: z.string().min(1), questionId: z.string().min(1) })
      .parse(request.params);
    const { answer } = z.object({ answer: z.enum(['similar', 'leave_out']) }).parse(request.body);
    const { order, role } = await orderFor(request, id);
    if (role !== 'shopper') throw new ForbiddenError('Only the Shopper can answer.');

    const found = await repository.itemQuestions.findById(questionId);
    if (!found || found.orderId !== order.id) throw new NotFoundError('question');
    const question = await settle(repository, found, now());
    if (question.answer !== null) {
      throw new ConflictError(
        question.answeredBy === 'no_answer'
          ? 'We could not wait any longer, so your Runner has left it out. You will not be charged for it.'
          : `You have already answered: ${ANSWER_WORDS[question.answer]}.`,
      );
    }

    await repository.itemQuestions.update(question.id, {
      answer,
      answeredBy: 'shopper',
      answeredAt: now(),
    });
    return { answered: true, message: `Thank you. Your Runner will ${ANSWER_WORDS[answer]}.` };
  });

  /**
   * A Shopper's order while it is on its way: where it has got to, and any question waiting
   * for them. The most recent order that has been sent, or null.
   */
  app.get('/orders/current', async (request) => {
    const session = requireSession(request, 'shopper');
    const orders = (await repository.orders.listForShopper(session.accountId))
      .filter((order) => !['draft', 'confirmed', 'cancelled', 'refunded'].includes(order.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const order = orders[0];
    if (!order) return { order: null };

    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    // The two words the Runner says at the door (T6), once somebody has the order.
    const doorWord = runner ? await ensureDoorWord(repository, order) : null;
    // About when it arrives (Section G), worked out afresh each time the page asks.
    const eta = estimateArrival({
      status: order.status,
      now: now(),
      acceptedAt: order.acceptedAt,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      travelMode: runner?.vehicleType ?? null,
      runner: runner ? { latitude: runner.latitude, longitude: runner.longitude } : null,
      door: { latitude: order.latitude, longitude: order.longitude },
    });
    const delivered = order.status === 'delivered' || order.status === 'completed';
    return {
      order: {
        id: order.id,
        status: order.status,
        runnerName: runner ? runner.name.split(' ')[0] : null,
        doorWord,
        doorWordSentence: runner && doorWord ? doorWordSentence(runner.name, doorWord) : null,
        eta: eta ? { words: eta.words, byAt: eta.byAt.toISOString() } : null,
        // Feedback after delivery (Section O): whether it has been given, and what it earns.
        feedbackGiven: delivered
          ? (await repository.shopperFeedback.findByOrderId(order.id)) !== null
          : false,
        feedbackCreditPence: app.ctx.config.feedback.creditPence,
        items: order.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
        })),
        totalEstimatePence: order.totalEstimatePence,
        deliveredAt: order.deliveredAt,
      },
      questions: await questionsForOrder(repository, order.id, now()),
    };
  });
}
