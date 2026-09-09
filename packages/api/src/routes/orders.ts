/**
 * Orders.
 *
 * Read `POST /orders` slowly, because Rule One lives in the order of its statements. The
 * order is written, then the Shopper's confirmation is written onto it, then, and only
 * then, a payment intent is created. `assertConfirmedBeforePayment` sits between the two
 * and reads the confirmation back from the stored order rather than trusting the request
 * body, so there is no arrangement of inputs that gets to a charge without a confirmation
 * having been recorded first.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, type OrderStatus } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { priceLines } from '../services/basket.js';
import {
  assertConfirmedBeforePayment,
  assertNotAlreadyConfirmed,
  assertNotAlreadyPaid,
  assertTransitionAllowed,
  exceedsBudgetCap,
  repriceToReceipt,
} from '../services/orders.js';

const createOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        catalogueItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
  deliveryAddress: z.string().trim().min(1).max(300),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  paymentMethodId: z.string().min(1),
  /**
   * Rule One. A confirmation is an explicit act by the Shopper, not a default. The flag
   * must be present and true, and what they were told they were agreeing to is recorded
   * alongside it.
   */
  confirmation: z.object({
    confirmed: z.literal(true),
    /** How it was given: "button" today; a spoken channel in a later phase. */
    channel: z.string().trim().min(1).max(40).default('button'),
    /** The exact words the Shopper agreed to, kept for the record. */
    statement: z.string().trim().min(1).max(400),
    /** What the Shopper was shown as the total, in pence, at the moment they confirmed. */
    agreedTotalPence: z.number().int().min(0),
  }),
  overrideBudgetCap: z.boolean().optional(),
});

const statusSchema = z.object({
  status: z.enum([
    'draft',
    'confirmed',
    'paid',
    'offered',
    'accepted',
    'shopping',
    'receipt_submitted',
    'delivering',
    'delivered',
    'completed',
    'cancelled',
    'refunded',
  ]),
});

const receiptSchema = z.object({
  receiptTotalPence: z.number().int().min(0),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        outcome: z.enum(['supplied', 'substituted', 'unavailable']),
        actualPricePence: z.number().int().min(0).optional(),
        substitutedForName: z.string().trim().max(120).optional(),
      }),
    )
    .optional(),
});

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments, now } = app.ctx;
  const symbol = config.store.currencySymbol;

  app.post('/orders', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const input = createOrderSchema.parse(request.body);

    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');

    const paymentMethod = await repository.paymentMethods.findById(input.paymentMethodId);
    if (!paymentMethod || paymentMethod.shopperId !== shopper.id) {
      throw new NotFoundError('payment card');
    }
    if (
      paymentMethod.region &&
      !config.payments.supportedCardRegions.includes(paymentMethod.region)
    ) {
      throw new BadRequestError(
        `We can only take cards from ${config.payments.supportedCardRegions.join(' and ')} at the moment.`,
      );
    }

    const catalogueItems = await repository.catalogue.findManyByIds(
      input.lines.map((line) => line.catalogueItemId),
    );

    // Rule Six is applied again here, not only at basket time, because the catalogue can
    // change between pricing a basket and sending it.
    const priced = priceLines(input.lines, catalogueItems, {
      bands: config.fees.bands,
      maximumGoodsPence: config.fees.maximumGoodsPence,
    });

    if (!input.overrideBudgetCap && exceedsBudgetCap(priced.goodsPence, shopper.budgetCapPence)) {
      throw new BadRequestError(
        `This shop comes to ${formatPence(priced.goodsPence, symbol)}, which is over the limit you set of ${formatPence(shopper.budgetCapPence ?? 0, symbol)}. Say the word and we will send it anyway.`,
      );
    }

    // What the Shopper agreed to must be what we are about to charge. If the price moved
    // between the screen and the button, we stop and ask again rather than charging a
    // different amount from the one they confirmed.
    if (input.confirmation.agreedTotalPence !== priced.totalPence) {
      throw new BadRequestError(
        `The price changed while you were deciding. It is now ${formatPence(priced.totalPence, symbol)}. Nothing has been charged. Please check it and confirm again.`,
        { agreedTotalPence: input.confirmation.agreedTotalPence, totalPence: priced.totalPence },
      );
    }

    // Step one: write the order. Nothing has been charged.
    const order = await repository.orders.create({
      shopperId: shopper.id,
      status: 'draft',
      goodsEstimatePence: priced.goodsPence,
      feePence: priced.feePence,
      totalEstimatePence: priced.totalPence,
      deliveryAddress: input.deliveryAddress,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      paymentMethodId: paymentMethod.id,
      // The doorstep instructions as they stand right now, so a later profile edit cannot
      // change what the Runner was told.
      doorstepProtocolSnapshot: shopper.doorstepProtocol,
      items: priced.lines.map((line) => ({
        catalogueItemId: line.catalogueItemId,
        name: line.name,
        quantity: line.quantity,
        estimatedPricePence: line.unitPricePence,
      })),
    });

    assertNotAlreadyConfirmed(order);
    assertNotAlreadyPaid(order);

    // Step two: record the single explicit confirmation.
    const confirmedAt = now();
    const confirmed = await repository.orders.update(order.id, {
      status: 'confirmed',
      spokenConfirmationAt: confirmedAt,
      confirmationChannel: input.confirmation.channel,
      confirmationStatement: input.confirmation.statement,
    });

    // Step three: refuse to go further unless the confirmation is on the stored order.
    // Rule One.
    assertConfirmedBeforePayment(confirmed);

    // Step four, and not before: take payment.
    const intent = await payments.createPaymentIntent({
      amountPence: confirmed.totalEstimatePence,
      currency: config.fees.currency,
      paymentMethodId: paymentMethod.stripePaymentMethodId,
      orderId: confirmed.id,
      description: `${config.productName} order ${confirmed.id}`,
      confirmationRecordedAt: confirmedAt.toISOString(),
    });

    const paid = await repository.orders.update(confirmed.id, {
      status: 'paid',
      stripePaymentIntentId: intent.id,
    });

    void reply.status(201);
    return {
      order: paid,
      payment: { id: intent.id, status: intent.status, clientSecret: intent.clientSecret },
      message: `Thank you. Your order is on its way to a Runner. We have taken ${formatPence(paid.totalEstimatePence, symbol)}.`,
    };
  });

  app.get('/orders', async (request) => {
    const session = requireSession(request, 'shopper');
    const orders = await repository.orders.listForShopper(session.accountId);
    return { orders };
  });

  app.get('/orders/:id', async (request) => {
    const session = requireSession(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);

    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');

    const mine =
      session.role === 'shopper'
        ? order.shopperId === session.accountId
        : order.runnerId === session.accountId;
    if (!mine) throw new ForbiddenError('That order is not yours.');

    return { order };
  });

  app.post('/orders/:id/status', async (request) => {
    const session = requireSession(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { status } = statusSchema.parse(request.body);

    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');

    const mine =
      session.role === 'shopper'
        ? order.shopperId === session.accountId
        : order.runnerId === session.accountId;
    if (!mine) throw new ForbiddenError('That order is not yours.');

    assertTransitionAllowed(order.status, status as OrderStatus);

    const patch: Record<string, unknown> = { status };
    if (status === 'delivered') patch['deliveredAt'] = now();
    if (status === 'completed') patch['completedAt'] = now();
    if (status === 'cancelled') patch['cancelledAt'] = now();

    const updated = await repository.orders.update(order.id, patch);
    return { order: updated };
  });

  /**
   * The Runner submits what the till actually said, and the order is repriced to it.
   *
   * The Shopper pays the shelf price. The fee is recalculated against the receipt rather
   * than carried over from the estimate, so Rule Three holds for the amount really charged.
   */
  app.post('/orders/:id/receipt', async (request) => {
    const session = requireSession(request, 'runner');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = receiptSchema.parse(request.body);

    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (order.runnerId !== session.accountId) {
      throw new ForbiddenError('That order is not yours.');
    }

    const repricing = repriceToReceipt(
      input.receiptTotalPence,
      order.goodsEstimatePence,
      config.fees.bands,
    );

    for (const line of input.items ?? []) {
      await repository.orders.updateItem(line.orderItemId, {
        substitutionOutcome: line.outcome,
        actualPricePence: line.actualPricePence ?? null,
        substitutedForName: line.substitutedForName ?? null,
      });
    }

    assertTransitionAllowed(order.status, 'receipt_submitted');

    const updated = await repository.orders.update(order.id, {
      status: 'receipt_submitted',
      receiptTotalPence: repricing.receiptTotalPence,
      receiptFeePence: repricing.receiptFeePence,
      finalTotalPence: repricing.finalTotalPence,
    });

    return {
      order: updated,
      repricing,
      message:
        repricing.differenceFromEstimatePence > 0
          ? `The shopping came to ${formatPence(repricing.receiptTotalPence, symbol)}, which is ${formatPence(repricing.differenceFromEstimatePence, symbol)} less than we thought.`
          : `The shopping came to ${formatPence(repricing.receiptTotalPence, symbol)}.`,
    };
  });
}
