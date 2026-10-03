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
}

export function stripeGateway(secretKey: string, webhookSecret: string): PaymentsGateway {
  const stripe = new Stripe(secretKey, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
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
      const transfer = await stripe.transfers.create({
        amount: input.amountPence,
        currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId,
        description: input.description,
        metadata: { orderId: input.orderId },
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
      });
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
  kind: 'payment_intent' | 'transfer' | 'connected_account' | 'saved_card_charge' | 'refund';
  input:
    | CreatePaymentIntentInput
    | CreateTransferInput
    | ChargeSavedCardInput
    | { paymentIntentId: string; amountPence: number; reference: string }
    | { runnerId: string };
}

export interface RehearsalGateway extends PaymentsGateway {
  readonly calls: RecordedCall[];
  /** For tests: the next saved-card charge is refused, as a card with no money would be. */
  declineNextCharge: boolean;
  /** For tests: the next card cannot be kept, as one already spent would not be. */
  refuseNextSave: boolean;
}

export function rehearsalGateway(): RehearsalGateway {
  const calls: RecordedCall[] = [];
  let counter = 0;

  const gateway: RehearsalGateway = {
    mode: 'rehearsal',
    calls,
    declineNextCharge: false,
    refuseNextSave: false,
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
      counter += 1;
      calls.push({ kind: 'transfer', input });
      return { id: `tr_rehearsal_${counter}`, amountPence: input.amountPence };
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
