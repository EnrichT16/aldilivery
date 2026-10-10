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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatPence, overOneRunnerWords, type OrderStatus, runnerPaymentFor } from '@aldilivery/core';
import { z } from 'zod';

import { requireSession } from '../app.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentFailedError,
} from '../errors.js';
import type { Order, PaymentMethod, Shopper } from '../domain.js';
import { cardAccepted } from '../lib/card-region.js';
import { priceLinesInParts, type PricedBasketInParts } from '../services/basket.js';
import {
  alertTinyExtras,
  basketGroup,
  chargedNowPence,
  releaseExtraDelivery,
} from '../services/basket-orders.js';
import { applyCredit } from '../services/credit.js';
import { recordOrder } from '../lib/analytics.js';
import { recordOrderIncome } from '../lib/ledger.js';
import { offerOrder } from '../services/dispatch.js';
import { alertPayments, bankReference, bankSettings } from '../lib/bank.js';
import { tellShopper } from '../services/order-updates.js';
import { settleTill, type TillOutcome } from '../services/till.js';
import { settleSplitTill, syncSplitParent } from '../services/split.js';
import { cardTill, flagCardTill, releaseCard } from '../services/runner-card.js';
import { payOutOrder } from '../services/pay-runner.js';
import { keepReceiptPhoto, receiptPhotoSchema } from '../services/receipt-photo.js';
import { startReimbursement } from '../services/reimburse.js';
import { DEMO_BANNER, DEMO_REFUSED } from '../services/demo.js';
import { activePlan, deliveryPlanFor } from '../services/plans.js';
import { tellShopperById } from '../services/order-updates.js';
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
  /** The saved card. Not needed when paying by bank transfer. */
  paymentMethodId: z.string().min(1).optional(),
  /**
   * A saved card through Stripe, a bank transfer to the business account (ruling 50), or, for
   * a member of an Ozi Family and Carer plan, the payer's card ("one card pays", ruling 58).
   */
  payBy: z.enum(['card', 'bank', 'family']).default('card'),
  /**
   * Rule One. A confirmation is an explicit act by the Shopper, not a default. The flag
   * must be present and true, and what they were told they were agreeing to is recorded
   * alongside it.
   */
  confirmation: z.object({
    confirmed: z.literal(true),
    /** How it was given: a press of the button, or a spoken yes. */
    channel: z.enum(['button', 'voice']).default('button'),
    /**
     * The delivery address was said to, or shown to, the Shopper, and they said yes to it
     * (docs/BUILD_PROMPT.md, Section D: before every order, of every type). Required.
     */
    addressConfirmed: z.literal(true, {
      errorMap: () => ({
        message: 'Please check the delivery address and say it is right before sending the order.',
      }),
    }),
    /** The exact words the Shopper agreed to, kept for the record. */
    statement: z.string().trim().min(1).max(400),
    /** What the Shopper was shown as the total, in pence, at the moment they confirmed. */
    agreedTotalPence: z.number().int().min(0),
  }),
  overrideBudgetCap: z.boolean().optional(),
  /**
   * A basket over £150 (ruling 61): true when the Shopper chose to keep everything, as linked
   * orders each with its own Runner, rather than take something out.
   */
  keepEverything: z.boolean().optional(),
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

/** What a Runner may do by hand, to an order they have accepted. */
const RUNNER_STEPS: readonly OrderStatus[] = ['shopping', 'delivering', 'delivered'];
/**
 * What a Shopper may do by hand. Cancelling is only possible before payment, because
 * afterwards the money has to go back, and there is no refund route yet: a person does that.
 */
const SHOPPER_STEPS: readonly OrderStatus[] = ['completed', 'cancelled'];

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
  /** A photo of the receipt, optional but encouraged (services/receipt-photo.ts). */
  photo: receiptPhotoSchema.optional(),
});

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments, now } = app.ctx;
  const symbol = config.store.currencySymbol;

  /**
   * Price the basket, which may be over one order (ruling 61). Over £150, the Shopper must have
   * chosen to keep everything; if not, they are told plainly, with both choices, and nothing is
   * charged.
   */
  function pricedForOrder(
    input: z.infer<typeof createOrderSchema>,
    catalogueItems: Parameters<typeof priceLinesInParts>[1],
    plan: Parameters<typeof priceLinesInParts>[3],
  ): PricedBasketInParts {
    const priced = priceLinesInParts(input.lines, catalogueItems, config.fees, plan);
    if (priced.parts.length > 1 && !input.keepEverything) {
      const money = (pence: number) => formatPence(pence, symbol);
      throw new BadRequestError(
        `${overOneRunnerWords(config.fees, money)} Nothing has been charged.`,
        {
          overOneRunner: true,
          parts: priced.parts.map((part) => ({
            part: part.part,
            goodsPence: part.goodsPence,
            itemChargesPence: part.itemChargesPence,
            feePence: part.feePence,
          })),
          totalPence: priced.totalPence,
        },
      );
    }
    return priced;
  }

  /**
   * Write the order, or, for a basket kept whole (ruling 61), its linked orders: the first
   * filled up to £150, then the next, each with its own Runner pay, the first at the Shopper's
   * plan price and each after it with the extra Runner's delivery (taken on collection for a
   * card, paid with the rest in a bank transfer). Returns them, the first first.
   */
  async function createOrders(
    priced: PricedBasketInParts,
    fields: Omit<
      Parameters<typeof repository.orders.create>[0],
      'goodsEstimatePence' | 'itemChargesPence' | 'feePence' | 'totalEstimatePence' | 'items' | 'runnerPaymentPence'
    >,
    extraStatus: 'pending' | 'transfer',
  ): Promise<Order[]> {
    const linked = priced.parts.length > 1;
    const created: Order[] = [];
    for (const part of priced.parts) {
      created.push(
        await repository.orders.create({
          ...fields,
          goodsEstimatePence: part.goodsPence,
          // Rule Two as amended by ruling 60: £5, or £7 for £120 or more of shopping.
          runnerPaymentPence: runnerPaymentFor(part.goodsPence, config.fees),
          itemChargesPence: part.itemChargesPence,
          feePence: part.feePence,
          totalEstimatePence: part.totalPence,
          ...(linked
            ? {
                ...(created[0] ? { basketGroupId: created[0].id } : {}),
                basketPart: part.part,
                basketOf: priced.parts.length,
                ...(part.extra ? { extraDeliveryStatus: extraStatus } : {}),
              }
            : {}),
          items: part.lines.map((line) => ({
            catalogueItemId: line.catalogueItemId,
            name: line.name,
            quantity: line.quantity,
            estimatedPricePence: line.unitPricePence,
          })),
        }),
      );
    }
    if (linked && created[0]) {
      created[0] = await repository.orders.update(created[0].id, { basketGroupId: created[0].id });
    }
    return created;
  }

  /**
   * An order paid by bank transfer to the business account (ruling 50, Anthony, 7 October
   * 2026). The same checks as a card order (prices, the cap, the confirmation, the voice
   * ceiling and home address), then the order waits, confirmed, with a reference for the
   * transfer. Staff mark the transfer as received in the Payments tab, and only then is it paid
   * and a Runner sent. The owner and staff are told at once, by their own channel.
   */
  async function placeBankTransferOrder(
    request: FastifyRequest,
    reply: FastifyReply,
    shopper: Shopper,
    input: z.infer<typeof createOrderSchema>,
  ) {
    const bank = bankSettings(app.ctx.env.storeConfigPath);
    if (!bank.enabled) {
      throw new BadRequestError(
        'Paying by bank transfer is not switched on yet. Please use a card.',
      );
    }
    const catalogueItems = await repository.catalogue.findManyByIds(
      input.lines.map((line) => line.catalogueItemId),
    );
    const priced = pricedForOrder(input, catalogueItems, await deliveryPlanFor(app.ctx, shopper, now()));
    if (!input.overrideBudgetCap && exceedsBudgetCap(priced.goodsPence, shopper.budgetCapPence)) {
      throw new BadRequestError(
        `This shop comes to ${formatPence(priced.goodsPence, symbol)}, which is over the limit you set of ${formatPence(shopper.budgetCapPence ?? 0, symbol)}. Say the word and we will send it anyway.`,
      );
    }
    if (input.confirmation.agreedTotalPence !== priced.totalPence) {
      throw new BadRequestError(
        `The price changed while you were deciding. It is now ${formatPence(priced.totalPence, symbol)}. Nothing has been charged. Please check it and confirm again.`,
        { agreedTotalPence: input.confirmation.agreedTotalPence, totalPence: priced.totalPence },
      );
    }
    if (
      input.confirmation.channel === 'voice' &&
      input.deliveryAddress
        .toLowerCase()
        .replace(/[\s,]+/g, ' ')
        .trim() !==
        shopper.deliveryAddress
          .toLowerCase()
          .replace(/[\s,]+/g, ' ')
          .trim()
    ) {
      throw new BadRequestError(
        'An order by voice always goes to your home address. To send it somewhere else, please use the screen.',
      );
    }
    const at = now();
    let reference = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      reference = bankReference(bank.referencePrefix);
      const taken = (await repository.orders.listByStatus('confirmed')).some(
        (order) => order.bankReference === reference,
      );
      if (!taken) break;
    }
    // One transfer, one reference, for the whole basket, extra Runners' deliveries included.
    const group = await createOrders(priced, {
      shopperId: shopper.id,
      status: 'confirmed',
      deliveryPlan: priced.plan,
      deliveryAddress: input.deliveryAddress,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      doorstepProtocolSnapshot: shopper.doorstepProtocol,
      spokenConfirmationAt: at,
      confirmationChannel: input.confirmation.channel,
      confirmationStatement: input.confirmation.statement,
      paidBy: 'bank',
      bankReference: reference,
    }, 'transfer');
    const order = group[0]!;
    void alertPayments(app.ctx, order, request.log, priced.totalPence);
    await alertTinyExtras(app.ctx, group);
    const amount = formatPence(priced.totalPence, symbol);
    void reply.status(201);
    return {
      order,
      bank: {
        accountName: bank.accountName,
        sortCode: bank.sortCode,
        accountNumber: bank.accountNumber,
        reference,
        amountPence: priced.totalPence,
        payWithinHours: bank.payWithinHours,
      },
      ...(group.length > 1 ? { orders: group } : {}),
      message: `Thank you. Please pay ${amount} by bank transfer to ${bank.accountName}, sort code ${bank.sortCode}, account ${bank.accountNumber}, with the reference ${reference}.${group.length > 1 ? ` Your shopping comes as ${group.length} orders, each with its own Runner. If a further Runner is not needed, their ${formatPence(config.fees.extraRunnerDeliveryPence, symbol)} delivery comes back to your account as Unused Runner fee credit.` : ''} A Runner is sent once your transfer arrives. A Faster Payments transfer usually arrives within minutes, and staff check for transfers at least every morning and evening. Nothing is taken from a card.`,
    };
  }

  app.post('/orders', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    const input = createOrderSchema.parse(request.body);

    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');

    // The demo account (ruling 60) orders with its demo card only: nothing is ever charged.
    if (shopper.isDemo && input.payBy !== 'card') {
      throw new ForbiddenError(DEMO_REFUSED);
    }
    if (input.payBy === 'bank') {
      return placeBankTransferOrder(request, reply, shopper, input);
    }

    // Ozi Family and Carer: a member's order is paid with the payer's card (ruling 58).
    const payer = input.payBy === 'family' ? await familyPayer(shopper) : shopper;
    let paymentMethod: PaymentMethod | null;
    if (input.payBy === 'family') {
      const cards = await repository.paymentMethods.listForShopper(payer.id);
      paymentMethod = cards.find((card) => card.isDefault) ?? cards[0] ?? null;
      if (!paymentMethod) {
        throw new ConflictError(
          `${payer.displayName} has no card saved for the family plan yet. Nothing has been charged.`,
        );
      }
    } else {
      if (!input.paymentMethodId) throw new BadRequestError('Please choose a card.');
      paymentMethod = await repository.paymentMethods.findById(input.paymentMethodId);
      if (!paymentMethod || paymentMethod.shopperId !== shopper.id) {
        throw new NotFoundError('payment card');
      }
    }
    if (!cardAccepted(config.payments.supportedCardRegions, paymentMethod.region)) {
      throw new BadRequestError(
        `We can only take cards from ${config.payments.supportedCardRegions.join(' and ')} at the moment.`,
      );
    }

    // A card saved before cards were attached to a Stripe customer is attached now, before
    // anything is created. If Stripe will no longer keep it — it was spent on an earlier
    // payment — the Shopper is asked to add it again, and nothing is charged.
    let customerId = payer.stripeCustomerId;
    if (!customerId) {
      try {
        ({ customerId } = await payments.saveCardForReuse({
          shopperId: payer.id,
          customerId: null,
          paymentMethodId: paymentMethod.stripePaymentMethodId,
        }));
        await repository.shoppers.update(payer.id, { stripeCustomerId: customerId });
      } catch (failure) {
        request.log.warn({ err: failure }, 'An old saved card could not be kept.');
        throw new ConflictError(
          'Please add your card again. We have improved how cards are saved, so it can be used for every order. Nothing has been charged.',
          { card: 'add_again' },
        );
      }
    }

    const catalogueItems = await repository.catalogue.findManyByIds(
      input.lines.map((line) => line.catalogueItemId),
    );

    // Rule Six is applied again here, not only at basket time, because the catalogue can
    // change between pricing a basket and sending it. Delivery follows the Shopper's plan.
    const priced = pricedForOrder(input, catalogueItems, await deliveryPlanFor(app.ctx, shopper, now()));

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

    // Ordering by voice (Sections D and E). A spoken confirmation is bounded twice over, so
    // that a copied voice can at worst buy what the ceiling allows, delivered to the account
    // holder's own front door. Both are checked here, where no screen can get round them.
    if (input.confirmation.channel === 'voice') {
      const ceiling = config.voice.paymentCeilingPence;
      if (priced.totalPence > ceiling) {
        throw new BadRequestError(
          `A payment confirmed by voice alone can be up to ${formatPence(ceiling, symbol)}. This one is ${formatPence(priced.totalPence, symbol)}, so please confirm it by touch on the screen. Nothing has been charged.`,
          { totalPence: priced.totalPence, ceilingPence: ceiling },
        );
      }
      const normalise = (address: string): string =>
        address
          .toLowerCase()
          .replace(/[\s,]+/g, ' ')
          .trim();
      if (normalise(input.deliveryAddress) !== normalise(shopper.deliveryAddress)) {
        throw new BadRequestError(
          'An order by voice always goes to your home address. To send it somewhere else, please use the screen. Nothing has been charged.',
        );
      }
    }

    // Family and Carer: above the payer's limit, the order waits for the payer's yes.
    const needsApproval =
      input.payBy === 'family' &&
      payer.approvalLimitPence !== null &&
      priced.totalPence > payer.approvalLimitPence;

    // Step one: write the order (or a basket's linked orders). Nothing has been charged.
    const drafts = await createOrders(priced, {
      shopperId: shopper.id,
      status: 'draft',
      deliveryPlan: priced.plan,
      ...(input.payBy === 'family'
        ? { payerShopperId: payer.id, approvalStatus: needsApproval ? 'waiting' : 'approved' }
        : {}),
      deliveryAddress: input.deliveryAddress,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      paymentMethodId: paymentMethod.id,
      // A demo order (ruling 60): no card is charged and no Runner is sent.
      ...(shopper.isDemo ? { isDemo: true } : {}),
      // The doorstep instructions as they stand right now, so a later profile edit cannot
      // change what the Runner was told.
      doorstepProtocolSnapshot: shopper.doorstepProtocol,
    }, 'pending');

    // Step two: record the single explicit confirmation, on every linked order alike.
    const confirmedAt = now();
    const confirmedAll: Order[] = [];
    for (const order of drafts) {
      assertNotAlreadyConfirmed(order);
      assertNotAlreadyPaid(order);
      confirmedAll.push(
        await repository.orders.update(order.id, {
          status: 'confirmed',
          spokenConfirmationAt: confirmedAt,
          confirmationChannel: input.confirmation.channel,
          confirmationStatement: input.confirmation.statement,
        }),
      );
    }
    const confirmed = confirmedAll[0]!;

    // Step three: refuse to go further unless the confirmation is on the stored order.
    // Rule One.
    for (const order of confirmedAll) assertConfirmedBeforePayment(order);

    if (needsApproval) {
      const total = formatPence(priced.totalPence, symbol);
      void tellShopperById(
        app.ctx,
        payer.id,
        `${shopper.displayName} has sent an order of ${total}, over your limit of ${formatPence(payer.approvalLimitPence ?? 0, symbol)}. Nothing has been taken. Open Family to approve it or say no.`,
        { url: '/plus', tag: `approve-${confirmed.id}` },
        request.log,
      );
      void reply.status(201);
      return {
        order: confirmed,
        waitingForApproval: true,
        message: `Thank you. Your order of ${total} is over the limit ${payer.displayName} set, so we have asked them to approve it. Nothing has been taken yet, and we will tell you as soon as they answer.`,
      };
    }

    // Step four, and not before: take payment.
    const outcome = await chargeAndSend(request, confirmed, paymentMethod, customerId, confirmedAt);
    void reply.status(201);
    return outcome;
  });

  /**
   * The payer of an Ozi Family and Carer plan this Shopper belongs to, for "one card pays".
   * Refused, with nothing charged, when the Shopper is not on one.
   */
  async function familyPayer(shopper: Shopper): Promise<Shopper> {
    const payer = shopper.familyOwnerId
      ? await repository.shoppers.findById(shopper.familyOwnerId)
      : null;
    if (!payer || activePlan(payer, now()) !== 'family') {
      throw new BadRequestError(
        'You are not on a family plan that pays for your orders. Please choose your own card. Nothing has been charged.',
      );
    }
    return payer;
  }

  /**
   * Take payment for a confirmed order, then send it to a Runner. Rule One has already been
   * checked on the stored order by the caller.
   */
  async function chargeAndSend(
    request: FastifyRequest,
    confirmed: Order,
    paymentMethod: PaymentMethod,
    customerId: string | null,
    confirmedAt: Date,
  ) {
    assertConfirmedBeforePayment(confirmed);

    // A demo order (ruling 60), from the app store reviewers' demo account: it is never sent to
    // Stripe, so no card is charged, and never offered to a Runner. The whole flow up to here,
    // the price read back and the one yes (Rule One), is exactly as it is for real.
    if (confirmed.isDemo) {
      const placed = await repository.orders.update(confirmed.id, { status: 'paid' });
      return {
        order: placed,
        payment: { id: `demo_${placed.id}`, status: 'succeeded', clientSecret: null, requiresAction: false },
        demo: true,
        message: `${DEMO_BANNER}. This order was not really placed: nothing was charged and no Runner is sent.`,
      };
    }
    //
    // If the gateway refuses, the order is closed rather than left where it stands. It used
    // to stay `confirmed` for ever — no payment, no rollback, no retry and no way for the
    // Shopper to cancel it — so a refused card left a row that nothing would ever move
    // again, and the Shopper saw only a bare five hundred. Cancelling says what happened:
    // this order is not going to happen, nothing was charged, send it again if you want to.
    // The confirmation stays written on the order either way, because it did happen and
    // Rule One is about the record, not about the outcome.
    // A basket kept whole (ruling 61): one payment for every linked order, without the further
    // Runners' deliveries, which are taken only as each of them collects.
    const group = (await basketGroup(app.ctx, confirmed)).filter(
      (row) => row.status === 'confirmed',
    );
    const amountPence = group.reduce((sum, row) => sum + chargedNowPence(row), 0);
    let intent;
    try {
      intent = await payments.createPaymentIntent({
        amountPence,
        currency: config.fees.currency,
        paymentMethodId: paymentMethod.stripePaymentMethodId,
        customerId,
        orderId: confirmed.id,
        description: `${config.productName} order ${confirmed.id}`,
        confirmationRecordedAt: confirmedAt.toISOString(),
      });
    } catch (failure) {
      for (const row of group) {
        await repository.orders.update(row.id, {
          status: 'cancelled',
          cancelledAt: now(),
          cancelReason: 'The card was refused when the order was sent.',
          ...(row.extraDeliveryStatus ? { extraDeliveryStatus: 'waived' as const } : {}),
        });
      }
      // The reason belongs in the log, where it can be acted on, and not in front of
      // somebody who is only trying to buy their shopping.
      request.log.error(
        { orderId: confirmed.id, err: failure },
        'The payment gateway refused, so the order was cancelled. Nothing was charged.',
      );
      throw new PaymentFailedError();
    }

    /**
     * Only Stripe gets to say a payment succeeded.
     *
     * A card in the United Kingdom usually has to be authenticated by the Shopper's bank,
     * and when it does Stripe answers `requires_action` rather than `succeeded`. Writing
     * `paid` here regardless would have been a lie on the order, and it also stepped on the
     * webhook: `payment_intent.succeeded` only advances an order that is still `confirmed`,
     * so an order marked paid too early could never be marked paid properly.
     *
     * So the status follows the intent. Anything short of `succeeded` stays `confirmed`,
     * the client secret goes back so the browser can carry out whatever the bank asks for,
     * and the webhook finishes the job when Stripe says it is done.
     */
    const succeeded = intent.status === 'succeeded';

    const placedAll: Order[] = [];
    for (const row of group) {
      placedAll.push(
        await repository.orders.update(row.id, {
          ...(succeeded ? { status: 'paid' as const } : {}),
          stripePaymentIntentId: intent.id,
        }),
      );
    }
    const placed = placedAll[0]!;

    // Straight to a Runner, rather than waiting for the next sweep. A failure to find one is
    // not a failure of the order: the sweep keeps trying, and the Shopper has paid.
    if (succeeded && app.ctx.autoOffer) {
      for (const row of placedAll) {
        await offerOrder(app.ctx, row.id).catch((failure: unknown) => {
          request.log.warn({ orderId: row.id, err: failure }, 'Could not offer the order yet');
        });
      }
    }

    // Gift card credit goes straight back to the card, now that the payment has gone through.
    const creditPence = succeeded ? await applyCredit(app.ctx, placed.id, request.log) : 0;
    if (succeeded) {
      for (const row of placedAll) {
        await recordOrder(app.ctx, row, 'order_paid', request.log);
        await recordOrderIncome(repository, payments, row, now(), chargedNowPence(row));
      }
      void tellShopper(app.ctx, placed, 'paid', request.log);
    }
    await alertTinyExtras(app.ctx, placedAll);
    const extraWords =
      placedAll.length > 1
        ? ` Your shopping comes as ${placedAll.length} orders, each with its own Runner. The ${formatPence(config.fees.extraRunnerDeliveryPence, symbol)} delivery for each further Runner is taken only when that Runner collects it.`
        : '';

    return {
      order: creditPence > 0 ? { ...placed, creditAppliedPence: creditPence } : placed,
      ...(placedAll.length > 1 ? { orders: placedAll } : {}),
      payment: {
        id: intent.id,
        status: intent.status,
        clientSecret: intent.clientSecret,
        /** The browser must finish this before any money moves. */
        requiresAction: !succeeded,
      },
      message: succeeded
        ? `Thank you. Your order is on its way to a Runner. We have taken ${formatPence(amountPence, symbol)}.${extraWords}` +
          (creditPence > 0
            ? ` ${formatPence(creditPence, symbol)} of gift card money is going straight back to your card.`
            : '')
        : 'Your bank wants to check it is really you. Nothing has been taken yet.',
    };
  }

  /* ------------------------------------------------ Ozi Family and Carer: the payer's view */

  /** Every order of everybody on the payer's family plan, newest first. */
  app.get('/plans/family/orders', async (request) => {
    const session = requireSession(request, 'shopper');
    const payer = await repository.shoppers.findById(session.accountId);
    if (!payer || payer.familyOwnerId !== null || activePlan(payer, now()) !== 'family') {
      throw new ForbiddenError('That is for the person who pays for a family plan.');
    }
    const rows = [];
    for (const member of await repository.shoppers.listFamily(payer.id)) {
      for (const order of await repository.orders.listForShopper(member.id)) {
        rows.push({
          id: order.id,
          person: member.displayName,
          status: order.status,
          approvalStatus: order.approvalStatus,
          totalPence: order.finalTotalPence ?? order.totalEstimatePence,
          items: order.items.reduce((sum, item) => sum + item.quantity, 0),
          createdAt: order.createdAt,
        });
      }
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { orders: rows, approvalLimitPence: payer.approvalLimitPence };
  });

  async function waitingFamilyOrder(request: FastifyRequest) {
    const session = requireSession(request, 'shopper');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const order = await repository.orders.findById(id);
    if (!order || order.payerShopperId !== session.accountId) throw new NotFoundError('order');
    if (order.approvalStatus !== 'waiting' || order.status !== 'confirmed') {
      throw new ConflictError('That order is not waiting for your approval.');
    }
    const payer = await repository.shoppers.findById(session.accountId);
    if (!payer) throw new NotFoundError('account');
    return { order, payer };
  }

  app.post('/plans/family/orders/:id/approve', async (request) => {
    const { order, payer } = await waitingFamilyOrder(request);
    const cards = await repository.paymentMethods.listForShopper(payer.id);
    const card = cards.find((method) => method.isDefault) ?? cards[0];
    if (!card) throw new ConflictError('Please save a card first. Nothing has been charged.');
    const approved = await repository.orders.update(order.id, {
      approvalStatus: 'approved',
      paymentMethodId: card.id,
    });
    // A basket kept whole (ruling 61): the payer's yes is for every linked order.
    for (const row of await basketGroup(app.ctx, approved)) {
      if (row.id !== approved.id && row.status === 'confirmed') {
        await repository.orders.update(row.id, { approvalStatus: 'approved', paymentMethodId: card.id });
      }
    }
    const outcome = await chargeAndSend(
      request,
      approved,
      card,
      payer.stripeCustomerId,
      approved.spokenConfirmationAt ?? now(),
    );
    void tellShopperById(
      app.ctx,
      order.shopperId,
      `${payer.displayName} approved your order, and it is on its way to a Runner.`,
      { url: '/my-order', tag: `order-${order.id}` },
      request.log,
    );
    return outcome;
  });

  app.post('/plans/family/orders/:id/decline', async (request) => {
    const { order, payer } = await waitingFamilyOrder(request);
    const updated = await repository.orders.update(order.id, {
      approvalStatus: 'declined',
      status: 'cancelled',
      cancelledAt: now(),
      cancelReason: 'The family plan payer did not approve it.',
    });
    for (const row of await basketGroup(app.ctx, updated)) {
      if (row.id !== updated.id && row.status === 'confirmed') {
        await repository.orders.update(row.id, {
          approvalStatus: 'declined',
          status: 'cancelled',
          cancelledAt: now(),
          cancelReason: 'The family plan payer did not approve it.',
          ...(row.extraDeliveryStatus ? { extraDeliveryStatus: 'waived' as const } : {}),
        });
      }
    }
    void tellShopperById(
      app.ctx,
      order.shopperId,
      `${payer.displayName} did not approve your order this time, so it has not been sent and nothing was taken.`,
      { url: '/orders', tag: `order-${order.id}` },
      request.log,
    );
    return { order: updated, message: 'The order has not been sent. Nothing was taken.' };
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

  /**
   * Moving an order on, by the people allowed to.
   *
   * Until 27 Sep 2026 this let either side move an order to any status the lifecycle allowed
   * next, so a Shopper could mark their own order `paid` without paying, and a Runner could
   * skip the receipt. Now each side has the few steps that are genuinely theirs, and every
   * other step — paid, offered, accepted, receipt submitted, refunded — only ever happens
   * through the route that does the real work behind it.
   */
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

    const allowed = session.role === 'runner' ? RUNNER_STEPS : SHOPPER_STEPS;
    if (!allowed.includes(status as OrderStatus)) {
      throw new ForbiddenError(
        session.role === 'runner'
          ? 'A Runner can mark an order as being shopped, on its way, or delivered. The till total goes in with the receipt.'
          : 'That is not something you can change yourself. If something is wrong with your order, phone us.',
      );
    }

    if (
      session.role === 'shopper' &&
      status === 'cancelled' &&
      order.status !== 'draft' &&
      order.status !== 'confirmed'
    ) {
      throw new ForbiddenError(
        'Your order has been paid for, so we need to cancel it and send the money back for you. Please phone us.',
      );
    }

    assertTransitionAllowed(order.status, status as OrderStatus);

    const at = now();
    const patch: Record<string, unknown> = { status };
    if (status === 'delivered') patch['deliveredAt'] = at;
    if (status === 'completed') patch['completedAt'] = at;
    if (status === 'cancelled') {
      patch['cancelledAt'] = at;
      patch['cancelReason'] = 'The Shopper cancelled before paying.';
    }

    const updated = await repository.orders.update(order.id, patch);
    // The whole order of a split part follows its parts (ruling 60).
    await syncSplitParent(app.ctx, updated.splitParentId);
    // A further Runner of a basket who is now not needed is never charged for (ruling 61).
    if (status === 'cancelled' && updated.extraDeliveryStatus) {
      await releaseExtraDelivery(app.ctx, updated, request.log);
    }
    // The order is over for the Runner's card too: frozen, if it is not already.
    if ((status === 'delivered' || status === 'cancelled') && order.payMethodUsed === 'card') {
      await releaseCard(app.ctx, order.runnerId, order.id, request.log);
    }
    if (status === 'delivered') await recordOrder(app.ctx, updated, 'order_delivered', request.log);
    if (status === 'delivering' || status === 'delivered') {
      void tellShopper(app.ctx, updated, status, request.log);
    }

    // Delivered is the end of the Runner's job, so it is where their place in the rotation
    // moves on. Waiting for the payout would leave it stuck until Stripe Connect exists.
    if (status === 'delivered' && order.runnerId) {
      await repository.runners.update(order.runnerId, { lastJobCompletedAt: at });
      // Straight to the Runner's own account. If it is not set up yet, nothing is lost: the
      // money is owed, and the payout sweep sends it as soon as it is.
      if (app.ctx.autoPayout) {
        try {
          const paid = await payOutOrder(app.ctx, order.id);
          return { order: paid.order, payout: paid.payout, notes: paid.notes };
        } catch (failure) {
          request.log.info({ orderId: order.id, err: failure }, 'Runner not paid yet');
        }
      }
    }

    return { order: updated };
  });

  /**
   * The Runner submits what the till actually said, and the order is repriced to it.
   *
   * The Shopper pays the shelf price. The fee is recalculated against the receipt rather
   * than carried over from the estimate, so Rule Three holds for the amount really charged.
   */
  app.post('/orders/:id/receipt', { bodyLimit: 12 * 1024 * 1024 }, async (request) => {
    const session = requireSession(request, 'runner');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = receiptSchema.parse(request.body);

    const order = await repository.orders.findById(id);
    if (!order) throw new NotFoundError('order');
    if (order.runnerId !== session.accountId) {
      throw new ForbiddenError('That order is not yours.');
    }
    // Once only. A second till total would settle the Shopper's card again and pay the Runner
    // back again (ruling 55); a mistake in it is put right by a person.
    if (order.receiptTotalPence !== null) {
      throw new ConflictError(
        'The till total for this order is already in. If it was wrong, please tell us and a person will put it right.',
      );
    }

    // The photo first, so a pay-back that needs one sees it.
    if (input.photo) await keepReceiptPhoto(app.ctx, order.id, input.photo);

    // Paid with the spending card: the till total is what the card actually paid, as long as
    // the receipt typed matches it within a few pence; otherwise a person looks.
    // A card that paid nothing (declined at the till, so they used their own) is an own-card
    // order after all: they are paid back as ruling 55 has it.
    const byCard = order.payMethodUsed === 'card' && (order.cardSpentPence ?? 0) > 0;
    if (order.payMethodUsed === 'card' && !byCard) {
      await repository.orders.update(order.id, { payMethodUsed: 'own' });
      await releaseCard(app.ctx, order.runnerId, order.id, request.log);
    }
    const card = byCard ? cardTill(order, input.receiptTotalPence, symbol) : null;

    const repricing = repriceToReceipt(card ? card.tillPence : input.receiptTotalPence, order);

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

    if (byCard) {
      // The shopping is paid for: the card is frozen and its limit put back to nothing.
      await releaseCard(app.ctx, order.runnerId, order.id, request.log);
    }

    // The difference from the estimate is settled on the same card at once (ruling 52). A card
    // order whose receipt does not match the card waits for a person instead.
    // A split part (ruling 60): the Shopper's card is settled once, on the whole order, when
    // every part's till total is in (services/split.ts).
    let settled: TillOutcome;
    if (card?.mismatch) {
      await flagCardTill(app.ctx, updated, card.mismatch, request.log);
      settled = { kind: 'needs-person', pence: 0, reason: `card: ${card.mismatch}` };
      if (updated.splitParentId) await settleSplitTill(app.ctx, updated, request.log);
    } else if (updated.splitParentId) {
      settled = await settleSplitTill(app.ctx, updated, request.log);
    } else {
      settled = await settleTill(app.ctx, updated, request.log);
    }
    await syncSplitParent(app.ctx, updated.splitParentId);

    // The Runner paid at the till with their own card, so they are paid back straight away,
    // or, when the till needs a person, as soon as a person approves it (ruling 55). Like
    // settling, this never undoes the receipt: a failure is logged, and the sweep tries again.
    // With the spending card there is nothing to pay back: the business paid the shop.
    let reimbursement = null;
    if (!byCard) {
      try {
        reimbursement = await startReimbursement(app.ctx, updated, settled, request.log);
      } catch (failure) {
        request.log.error({ err: failure, orderId: order.id }, 'The Runner pay-back did not start.');
      }
    }
    const delivery = formatPence(updated.runnerPaymentPence, symbol);
    const cardWords = !byCard
      ? null
      : card?.mismatch
        ? `The receipt does not match what the card paid, so a person will check it. Your ${delivery} for the delivery is not affected.`
        : `The shop was paid with your ${config.assistantName} card, so there is nothing to pay back. Your ${delivery} for the delivery follows when you hand the shopping over.`;

    const tillWords =
      repricing.differenceFromEstimatePence > 0
        ? `The shopping came to ${formatPence(repricing.receiptTotalPence, symbol)}, which is ${formatPence(repricing.differenceFromEstimatePence, symbol)} less than we thought.`
        : `The shopping came to ${formatPence(repricing.receiptTotalPence, symbol)}.`;

    return {
      order: (await repository.orders.findById(order.id)) ?? updated,
      repricing,
      settled,
      reimbursement,
      message: cardWords
        ? `${tillWords} ${cardWords}`
        : reimbursement
          ? `${tillWords} ${reimbursement.message}`
          : tillWords,
    };
  });
}
