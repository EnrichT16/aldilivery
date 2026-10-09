/**
 * The payments gateway.
 *
 * Rule Ten, made structural. Look at `PaymentsGateway` below: there is no method on it that
 * accepts a card number, an expiry date or a security code, because no part of the service
 * ever handles one. The Shopper's browser sends card details straight to Stripe and gets
 * back a payment method identifier; that identifier is all that ever reaches this server.
 *
 * The Runner's money is moved by a Connect transfer to the Runner's own account. The service
 * does not hold it, does not pool it, and cannot spend it.
 */

import Stripe from 'stripe';

export interface CreatePaymentIntentInput {
  amountPence: number;
  currency: string;
  /** A Stripe payment method identifier. Never a card number. */
  paymentMethodId: string;
  orderId: string;
  /** The Shopper's Stripe customer, which the saved card is attached to. */
  customerId?: string | null;
  description: string;
  /** Recorded on the intent so a dispute can be answered without guesswork. */
  confirmationRecordedAt: string;
}

export interface PaymentIntentResult {
  id: string;
  status: string;
  clientSecret: string | null;
}

/**
 * Taking a charge the Shopper has already agreed to, without them at the screen: what an in-app
 * call cost, agreed before it started (Rule One). Never anything they have not said yes to.
 */
export interface ChargeSavedCardInput {
  amountPence: number;
  currency: string;
  paymentMethodId: string;
  /** The Shopper's Stripe customer. A saved card can only be used again through one. */
  customerId: string | null;
  description: string;
  /** What was agreed, and when: recorded on the payment. */
  reference: string;
  agreedAt: string;
}

export interface CreateTransferInput {
  amountPence: number;
  currency: string;
  destinationAccountId: string;
  orderId: string;
  description: string;
  /**
   * The Shopper's payment this money came from. Tying the transfer to it means the Runner can
   * be paid as soon as the order is delivered, from money Stripe is still settling, instead of
   * failing for "insufficient funds" until the platform balance catches up.
   */
  sourcePaymentIntentId?: string | undefined;
  /**
   * A reference that makes the transfer happen once only, however often it is asked for, such
   * as reimburse:<order id> for paying a Runner back for the shopping. Stripe returns the first
   * transfer for a repeated reference instead of making a second.
   */
  idempotencyKey?: string | undefined;
}

/** Where a Runner is with setting up how they are paid. */
export interface ConnectedAccountStatus {
  /** They have finished Stripe's form. */
  detailsSubmitted: boolean;
  /** Money can be sent to them. */
  transfersActive: boolean;
}

export interface TransferResult {
  id: string;
  amountPence: number;
}

/** A Stripe page to pay on, sent by text after a telephone order (ruling 48). */
export interface CreatePaymentLinkInput {
  orderId: string;
  amountPence: number;
  currency: string;
  description: string;
  /** The Shopper's Stripe customer, if they have one; otherwise Stripe makes one. */
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
  /** When the link stops working, in seconds since 1970. Stripe allows up to a day. */
  expiresAt: number;
}

/** What a paid link tells us: the card is kept for next time, and where the shopping goes. */
export interface PaidLink {
  paymentIntentId: string;
  customerId: string | null;
  paymentMethodId: string;
  lastFour: string;
  brand: string | null;
  /** The card's country, as Stripe gives it: `GB`. */
  country: string | null;
  /** The delivery address given on Stripe's page, on one line. */
  address: string;
}

/**
 * The Runner spending card (Stripe Issuing; Anthony, 9 October 2026). Only grocery shops: the
 * merchant categories a supermarket and the food shops beside it are filed under. Checked by
 * Stripe on the card itself, and again by our own authorization webhook.
 */
export const GROCERY_CATEGORIES = [
  'grocery_stores_supermarkets',
  'miscellaneous_food_stores',
  'bakeries',
  'dairy_products_stores',
] as const;

/** The Stripe API version this service speaks, sent back on a real-time authorization answer. */
export const STRIPE_API_VERSION = '2024-12-18.acacia';

/** A Runner as a Stripe Issuing cardholder. Their address goes to Stripe and is not kept by us. */
export interface CreateCardholderInput {
  runnerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  billing: { line1: string; line2?: string; city: string; postalCode: string; country: 'GB' };
  /** The cardholder terms, accepted by the Runner: when, from where, and in which browser. */
  termsAcceptedAt: Date;
  termsAcceptedIp: string;
  userAgent?: string;
}

export interface IssuingCard {
  id: string;
  last4: string;
  status: 'active' | 'inactive';
}

/**
 * Loading a card for one order: at most this much at a time, grocery shops only, switched on.
 * There is no all-time limit, because Stripe's all-time limit counts every order the card has
 * ever been used for; our own authorization webhook keeps the running total for each order.
 */
export interface LoadCardInput {
  cardId: string;
  limitPence: number;
  orderId: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: unknown;
}

export interface PaymentsGateway {
  /**
   * Which gateway this actually is.
   *
   * It lives here, on the gateway itself, because it used to be worked out separately in the
   * health route from whether a Stripe secret key was configured — and that is not the same
   * question. Building the real gateway needs the webhook secret as well, so a server with a
   * secret key and no webhook secret ran the rehearsal gateway while `/health` cheerfully
   * reported `paymentsMode: stripe`. DEPLOY.md tells Anthony to read that field as proof that
   * money can move, so it has to be the truth rather than an inference about it.
   */
  readonly mode: 'stripe' | 'rehearsal';
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  createTransfer(input: CreateTransferInput): Promise<TransferResult>;
  /** Succeeds, or throws: there is no half-taken charge. */
  chargeSavedCard(input: ChargeSavedCardInput): Promise<{ id: string }>;
  /** Give money back to the card a payment came from. Part of it, or all. */
  refundPayment(input: {
    paymentIntentId: string;
    amountPence: number;
    reference: string;
  }): Promise<{ id: string }>;
  /**
   * Keep a card for use again: make the Shopper's Stripe customer if they have none yet, and
   * attach the card to it. Throws if Stripe will not keep the card (for example, one already
   * spent on a payment before it was attached).
   */
  saveCardForReuse(input: {
    shopperId: string;
    customerId: string | null;
    paymentMethodId: string;
  }): Promise<{ customerId: string }>;
  /**
   * A Stripe account of the Runner's own, for their pay to go to (Rule Ten: The service never
   * holds a Runner's money). Stripe collects their bank details on its own pages; they never
   * pass through the service.
   */
  createConnectedAccount(input: { runnerId: string }): Promise<{ id: string }>;
  /** A one-time link to Stripe's form for that account. Expires after a few minutes. */
  createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  getConnectedAccount(accountId: string): Promise<ConnectedAccountStatus>;
  /** Verifies the signature. A webhook that does not verify is not an event, it is noise. */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): WebhookEvent;
  /**
   * A Stripe Checkout page for one order (ruling 48): the card and the delivery address are
   * typed on Stripe's page, never given to us or to Ozi, and the card is kept for next time.
   */
  createPaymentLink(input: CreatePaymentLinkInput): Promise<{ id: string; url: string }>;
  /** What a link that has been paid says, or null when it has not been paid. */
  paidByLink(sessionId: string): Promise<PaidLink | null>;
  /**
   * How often Stripe pays what is in a Runner's own Stripe account into their bank (ruling 16):
   * weekly, on a Friday, or every day. Money reaches their Stripe account the same either way.
   */
  setPayoutSchedule(input: { accountId: string; interval: 'weekly' | 'daily' }): Promise<void>;
  /** What a Runner's own Stripe account could pay out instantly now, in pence. */
  instantPayoutAvailable(input: { accountId: string; currency: string }): Promise<number>;
  /**
   * An instant payout from a Runner's own Stripe account to their debit card, asked for by them
   * after seeing Stripe's fee. The reference makes it happen once only.
   */
  createInstantPayout(input: {
    accountId: string;
    amountPence: number;
    currency: string;
    reference: string;
  }): Promise<{ id: string; amountPence: number }>;
  /**
   * The same card, whoever saved it: Stripe's fingerprint for the card behind a payment method,
   * or null when there is none. Used only to keep the referral reward honest (ruling 16).
   */
  cardFingerprint(paymentMethodId: string): Promise<string | null>;

  /**
   * Stripe Issuing: a Runner as a cardholder, with the cardholder terms they accepted. Nothing
   * here takes or returns a card number; the number is shown to the Runner by Stripe's own
   * Issuing Elements, in Stripe's frame, with a short-lived key (`createCardKey`).
   */
  createCardholder(input: CreateCardholderInput): Promise<{ id: string }>;
  /** A virtual card in pounds, created switched off (inactive) and grocery shops only. */
  createVirtualCard(input: { cardholderId: string; runnerId: string }): Promise<IssuingCard>;
  /** Load a card for one order and switch it on. */
  loadCard(input: LoadCardInput): Promise<void>;
  /** Freeze (inactive) or unfreeze (active) a card. */
  setCardStatus(input: { cardId: string; status: 'active' | 'inactive' }): Promise<void>;
  /** Put the card's limit back to nothing, after an order. */
  clearCardLimit(input: { cardId: string }): Promise<void>;
  /**
   * A short-lived key for Stripe Issuing Elements to show this one card to its Runner, made
   * with the nonce their browser got from Stripe.js. Only the key's secret is returned.
   */
  createCardKey(input: { cardId: string; nonce: string }): Promise<{ secret: string }>;
}

/**
 * Stripe wants a cardholder's first and last names apart, with no numbers or unusual signs in
 * them. A single name is used for both, rather than refused.
 */
export function splitName(name: string): { first: string; last: string } {
  const cleaned = name
    .replace(/[^\p{L}\s.,'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 0) return { first: 'Runner', last: 'Runner' };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

export function stripeGateway(secretKey: string, webhookSecret: string): PaymentsGateway {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });

  return {
    mode: 'stripe',
    async createPaymentIntent(input) {
      const intent = await stripe.paymentIntents.create({
        amount: input.amountPence,
        currency: input.currency.toLowerCase(),
        payment_method: input.paymentMethodId,
        ...(input.customerId ? { customer: input.customerId } : {}),
        confirm: true,
        off_session: false,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: input.description,
        metadata: {
          orderId: input.orderId,
          // Rule One, written onto the payment itself: the confirmation came first.
          shopperConfirmedAt: input.confirmationRecordedAt,
        },
      });
      return { id: intent.id, status: intent.status, clientSecret: intent.client_secret };
    },

    async refundPayment(input) {
      const refund = await stripe.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: input.amountPence,
        metadata: { reference: input.reference },
      });
      return { id: refund.id };
    },

    async saveCardForReuse(input) {
      const customerId =
        input.customerId ??
        (await stripe.customers.create({ metadata: { shopperId: input.shopperId } })).id;
      const method = await stripe.paymentMethods.retrieve(input.paymentMethodId);
      if (method.customer !== customerId) {
        await stripe.paymentMethods.attach(input.paymentMethodId, { customer: customerId });
      }
      return { customerId };
    },

    async chargeSavedCard(input) {
      if (!input.customerId) {
        // A card that is not attached to a customer is spent after one payment, so it cannot
        // be charged with nobody at the screen. The charge waits as outstanding.
        throw new Error('This card was not saved in a way that lets it be charged again.');
      }
      const intent = await stripe.paymentIntents.create({
        amount: input.amountPence,
        currency: input.currency.toLowerCase(),
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        confirm: true,
        off_session: true,
        description: input.description,
        metadata: { reference: input.reference, shopperAgreedAt: input.agreedAt },
      });
      if (intent.status !== 'succeeded') {
        throw new Error(`The charge did not go through (${intent.status}).`);
      }
      return { id: intent.id };
    },

    async createTransfer(input) {
      let sourceTransaction: string | undefined;
      if (input.sourcePaymentIntentId) {
        const intent = await stripe.paymentIntents.retrieve(input.sourcePaymentIntentId);
        const charge = intent.latest_charge;
        sourceTransaction = typeof charge === 'string' ? charge : charge?.id;
      }
      const transfer = await stripe.transfers.create(
        {
          amount: input.amountPence,
          currency: input.currency.toLowerCase(),
          destination: input.destinationAccountId,
          description: input.description,
          metadata: {
            orderId: input.orderId,
            ...(input.idempotencyKey ? { reference: input.idempotencyKey } : {}),
          },
          ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
      return { id: transfer.id, amountPence: transfer.amount };
    },

    async createConnectedAccount(input) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        business_type: 'individual',
        capabilities: { transfers: { requested: true } },
        metadata: { runnerId: input.runnerId },
      });
      return { id: account.id };
    },

    async createOnboardingLink(input) {
      const link = await stripe.accountLinks.create({
        account: input.accountId,
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
        type: 'account_onboarding',
      });
      return { url: link.url };
    },

    async getConnectedAccount(accountId) {
      const account = await stripe.accounts.retrieve(accountId);
      return {
        detailsSubmitted: account.details_submitted ?? false,
        transfersActive: account.capabilities?.transfers === 'active',
      };
    },

    constructWebhookEvent(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return { id: event.id, type: event.type, data: event.data };
    },
    async createPaymentLink(input) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountPence,
              product_data: { name: input.description },
            },
            quantity: 1,
          },
        ],
        ...(input.customerId ? { customer: input.customerId } : { customer_creation: 'always' }),
        // Kept for next time, and for the till's real total (Rule Three). The intent carries
        // `orderLink`, not `orderId`, so the payment_intent webhook leaves this order to the
        // checkout webhook, which also has the address.
        payment_intent_data: {
          setup_future_usage: 'off_session',
          metadata: { orderLink: input.orderId },
        },
        shipping_address_collection: { allowed_countries: ['GB'] },
        metadata: { orderId: input.orderId },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: input.expiresAt,
      });
      if (!session.url) throw new Error('Stripe gave no address for the payment page.');
      return { id: session.id, url: session.url };
    },
    async setPayoutSchedule(input) {
      await stripe.accounts.update(input.accountId, {
        settings: {
          payouts: {
            schedule:
              input.interval === 'weekly'
                ? { interval: 'weekly', weekly_anchor: 'friday' }
                : { interval: 'daily' },
          },
        },
      });
    },
    async instantPayoutAvailable(input) {
      const balance = await stripe.balance.retrieve({ stripeAccount: input.accountId });
      const currency = input.currency.toLowerCase();
      return (balance.instant_available ?? [])
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.amount, 0);
    },
    async createInstantPayout(input) {
      const payout = await stripe.payouts.create(
        {
          amount: input.amountPence,
          currency: input.currency.toLowerCase(),
          method: 'instant',
          metadata: { reference: input.reference },
        },
        { stripeAccount: input.accountId, idempotencyKey: input.reference },
      );
      return { id: payout.id, amountPence: payout.amount };
    },
    async cardFingerprint(paymentMethodId) {
      const method = await stripe.paymentMethods.retrieve(paymentMethodId);
      return method.card?.fingerprint ?? null;
    },
    async createCardholder(input) {
      const { first, last } = splitName(input.name);
      const cardholder = await stripe.issuing.cardholders.create({
        type: 'individual',
        // Stripe prints at most 24 characters on a card.
        name: input.name.slice(0, 24),
        ...(input.phone ? { phone_number: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        billing: {
          address: {
            line1: input.billing.line1,
            ...(input.billing.line2 ? { line2: input.billing.line2 } : {}),
            city: input.billing.city,
            postal_code: input.billing.postalCode,
            country: input.billing.country,
          },
        },
        individual: {
          first_name: first,
          last_name: last,
          card_issuing: {
            user_terms_acceptance: {
              date: Math.floor(input.termsAcceptedAt.getTime() / 1000),
              ip: input.termsAcceptedIp,
              ...(input.userAgent ? { user_agent: input.userAgent } : {}),
            },
          },
        },
        status: 'active',
        metadata: { runnerId: input.runnerId },
      });
      return { id: cardholder.id };
    },
    async createVirtualCard(input) {
      const card = await stripe.issuing.cards.create({
        cardholder: input.cardholderId,
        type: 'virtual',
        currency: 'gbp',
        status: 'inactive',
        spending_controls: { allowed_categories: [...GROCERY_CATEGORIES] },
        metadata: { runnerId: input.runnerId },
      });
      return {
        id: card.id,
        last4: card.last4,
        status: card.status === 'active' ? 'active' : 'inactive',
      };
    },
    async loadCard(input) {
      await stripe.issuing.cards.update(input.cardId, {
        status: 'active',
        spending_controls: {
          allowed_categories: [...GROCERY_CATEGORIES],
          spending_limits: [{ amount: input.limitPence, interval: 'per_authorization' }],
        },
        metadata: { orderId: input.orderId },
      });
    },
    async setCardStatus(input) {
      await stripe.issuing.cards.update(input.cardId, { status: input.status });
    },
    async clearCardLimit(input) {
      await stripe.issuing.cards.update(input.cardId, {
        spending_controls: {
          allowed_categories: [...GROCERY_CATEGORIES],
          spending_limits: [{ amount: 0, interval: 'per_authorization' }],
        },
        metadata: { orderId: '' },
      });
    },
    async createCardKey(input) {
      const key = await stripe.ephemeralKeys.create(
        { issuing_card: input.cardId, nonce: input.nonce },
        { apiVersion: STRIPE_API_VERSION },
      );
      if (!key.secret) throw new Error('Stripe gave no key to show the card with.');
      return { secret: key.secret };
    },
    async paidByLink(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent.payment_method'],
      });
      if (session.payment_status !== 'paid') return null;
      const intent = session.payment_intent as Stripe.PaymentIntent | null;
      const method = intent?.payment_method as Stripe.PaymentMethod | null | undefined;
      if (!intent || !method) return null;
      const shipping = session as unknown as {
        shipping_details?: { address?: Stripe.Address | null } | null;
        collected_information?: { shipping_details?: { address?: Stripe.Address | null } };
      };
      const address =
        shipping.shipping_details?.address ??
        shipping.collected_information?.shipping_details?.address;
      return {
        paymentIntentId: intent.id,
        customerId:
          typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
        paymentMethodId: method.id,
        lastFour: method.card?.last4 ?? '0000',
        brand: method.card?.brand ?? null,
        country: method.card?.country ?? null,
        address: [address?.line1, address?.line2, address?.city, address?.postal_code]
          .filter((part): part is string => Boolean(part))
          .join(', '),
      };
    },
  };
}

/**
 * A gateway that moves no money, for tests and for running the shell locally before any
 * Stripe account exists. It records what it was asked to do so tests can assert on it, and
 * it is selected only when the real thing cannot be built — which needs a Stripe secret key
 * *and* a webhook secret, because a gateway that can take a payment but cannot verify what
 * Stripe says happened to it is half a gateway. It says so loudly in the log at startup, and
 * `mode` above carries the same fact to `/health` and `/config` so nothing has to guess.
 */
export interface RecordedCall {
  kind:
    | 'payment_intent'
    | 'transfer'
    | 'connected_account'
    | 'saved_card_charge'
    | 'refund'
    | 'payment_link'
    | 'payout_schedule'
    | 'instant_payout'
    | 'cardholder'
    | 'issuing_card'
    | 'card_load'
    | 'card_status'
    | 'card_clear'
    | 'card_key';
  input:
    | CreatePaymentIntentInput
    | CreatePaymentLinkInput
    | CreateTransferInput
    | ChargeSavedCardInput
    | { paymentIntentId: string; amountPence: number; reference: string }
    | { runnerId: string }
    | { accountId: string; interval: 'weekly' | 'daily' }
    | { accountId: string; amountPence: number; currency: string; reference: string }
    | CreateCardholderInput
    | { cardholderId: string; runnerId: string }
    | LoadCardInput
    | { cardId: string; status: 'active' | 'inactive' }
    | { cardId: string }
    | { cardId: string; nonce: string };
}

export interface RehearsalGateway extends PaymentsGateway {
  readonly calls: RecordedCall[];
  /** For tests: the next saved-card charge is refused, as a card with no money would be. */
  declineNextCharge: boolean;
  /** For tests: the next card cannot be kept, as one already spent would not be. */
  refuseNextSave: boolean;
  /** For tests: what each Runner's account could pay out instantly, by account. */
  instantAvailable: Map<string, number>;
  /** For tests: the card behind each payment method, so two can be the same card. */
  fingerprints: Map<string, string>;
  /** For tests: each spending card as Stripe would hold it now. */
  issuingCards: Map<string, { status: 'active' | 'inactive'; limitPence: number }>;
  /** For tests: the next spending card cannot be loaded, as if Stripe could not be reached. */
  refuseNextCardLoad: boolean;
}

export function rehearsalGateway(): RehearsalGateway {
  const calls: RecordedCall[] = [];
  const transfersByKey = new Map<string, TransferResult>();
  let counter = 0;

  const gateway: RehearsalGateway = {
    mode: 'rehearsal',
    calls,
    declineNextCharge: false,
    refuseNextSave: false,
    instantAvailable: new Map(),
    fingerprints: new Map(),
    issuingCards: new Map(),
    refuseNextCardLoad: false,
    async createCardholder(input) {
      counter += 1;
      calls.push({ kind: 'cardholder', input });
      return { id: `ich_rehearsal_${counter}` };
    },
    async createVirtualCard(input) {
      counter += 1;
      calls.push({ kind: 'issuing_card', input });
      const id = `ic_rehearsal_${counter}`;
      gateway.issuingCards.set(id, { status: 'inactive', limitPence: 0 });
      return { id, last4: String(4000 + counter).slice(-4), status: 'inactive' };
    },
    async loadCard(input) {
      if (gateway.refuseNextCardLoad) {
        gateway.refuseNextCardLoad = false;
        throw new Error('Stripe could not be reached.');
      }
      calls.push({ kind: 'card_load', input });
      gateway.issuingCards.set(input.cardId, { status: 'active', limitPence: input.limitPence });
    },
    async setCardStatus(input) {
      calls.push({ kind: 'card_status', input });
      const card = gateway.issuingCards.get(input.cardId) ?? { status: 'inactive', limitPence: 0 };
      gateway.issuingCards.set(input.cardId, { ...card, status: input.status });
    },
    async clearCardLimit(input) {
      calls.push({ kind: 'card_clear', input });
      const card = gateway.issuingCards.get(input.cardId) ?? { status: 'inactive', limitPence: 0 };
      gateway.issuingCards.set(input.cardId, { ...card, limitPence: 0 });
    },
    async createCardKey(input) {
      calls.push({ kind: 'card_key', input });
      return { secret: `ek_rehearsal_${input.cardId}` };
    },
    async setPayoutSchedule(input) {
      calls.push({ kind: 'payout_schedule', input });
    },
    async instantPayoutAvailable(input) {
      return gateway.instantAvailable.get(input.accountId) ?? 0;
    },
    async createInstantPayout(input) {
      const available = gateway.instantAvailable.get(input.accountId) ?? 0;
      if (input.amountPence > available) {
        throw new Error('There is not that much available for an instant payout.');
      }
      gateway.instantAvailable.set(input.accountId, available - input.amountPence);
      counter += 1;
      calls.push({ kind: 'instant_payout', input });
      return { id: `po_rehearsal_${counter}`, amountPence: input.amountPence };
    },
    async cardFingerprint(paymentMethodId) {
      // Each saved card is its own card here, unless a test says two are the same.
      return gateway.fingerprints.get(paymentMethodId) ?? `fp_${paymentMethodId}`;
    },
    async refundPayment(input) {
      counter += 1;
      calls.push({ kind: 'refund', input });
      return { id: `re_rehearsal_${counter}` };
    },
    async saveCardForReuse(input) {
      if (gateway.refuseNextSave) {
        gateway.refuseNextSave = false;
        throw new Error('This PaymentMethod was previously used without being attached.');
      }
      counter += 1;
      return { customerId: input.customerId ?? `cus_rehearsal_${counter}` };
    },
    async chargeSavedCard(input) {
      if (!input.customerId) {
        throw new Error('This card was not saved in a way that lets it be charged again.');
      }
      if (gateway.declineNextCharge) {
        gateway.declineNextCharge = false;
        throw new Error('Your card was declined.');
      }
      counter += 1;
      calls.push({ kind: 'saved_card_charge', input });
      return { id: `pi_rehearsal_${counter}` };
    },
    async createPaymentIntent(input) {
      counter += 1;
      calls.push({ kind: 'payment_intent', input });
      return {
        id: `pi_rehearsal_${counter}`,
        status: 'succeeded',
        clientSecret: `pi_rehearsal_${counter}_secret`,
      };
    },
    async createTransfer(input) {
      // As Stripe does: the same reference twice gives back the first transfer, not a second.
      const earlier = input.idempotencyKey ? transfersByKey.get(input.idempotencyKey) : undefined;
      if (earlier) return earlier;
      counter += 1;
      calls.push({ kind: 'transfer', input });
      const transfer = { id: `tr_rehearsal_${counter}`, amountPence: input.amountPence };
      if (input.idempotencyKey) transfersByKey.set(input.idempotencyKey, transfer);
      return transfer;
    },
    async createConnectedAccount(input) {
      counter += 1;
      calls.push({ kind: 'connected_account', input });
      return { id: `acct_rehearsal_${counter}` };
    },
    async createOnboardingLink(input) {
      // No Stripe to visit: straight back, as if the form had been filled in.
      return { url: input.returnUrl };
    },
    async getConnectedAccount() {
      return { detailsSubmitted: true, transfersActive: true };
    },
    async createPaymentLink(input) {
      counter += 1;
      calls.push({ kind: 'payment_link', input });
      return {
        id: `cs_rehearsal_${counter}`,
        url: `https://checkout.rehearsal.invalid/cs_rehearsal_${counter}`,
      };
    },
    async paidByLink() {
      counter += 1;
      return {
        paymentIntentId: `pi_rehearsal_${counter}`,
        customerId: `cus_rehearsal_${counter}`,
        paymentMethodId: `pm_rehearsal_${counter}`,
        lastFour: '4242',
        brand: 'visa',
        country: 'GB',
        address: '1 Rehearsal Road, London, AB1 2CD',
      };
    },
    constructWebhookEvent(rawBody) {
      const parsed = JSON.parse(
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
      ) as {
        id?: string;
        type?: string;
        data?: unknown;
      };
      return {
        id: parsed.id ?? 'evt_rehearsal',
        type: parsed.type ?? 'unknown',
        data: parsed.data ?? {},
      };
    },
  };
  return gateway;
}
