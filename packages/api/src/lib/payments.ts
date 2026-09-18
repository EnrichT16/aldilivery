/**
 * The payments gateway.
 *
 * Rule Ten, made structural. Look at `PaymentsGateway` below: there is no method on it that
 * accepts a card number, an expiry date or a security code, because no part of Aldilivery
 * ever handles one. The Shopper's browser sends card details straight to Stripe and gets
 * back a payment method identifier; that identifier is all that ever reaches this server.
 *
 * The Runner's money is moved by a Connect transfer to the Runner's own account. Aldilivery
 * does not hold it, does not pool it, and cannot spend it.
 */

import Stripe from 'stripe';

export interface CreatePaymentIntentInput {
  amountPence: number;
  currency: string;
  /** A Stripe payment method identifier. Never a card number. */
  paymentMethodId: string;
  orderId: string;
  description: string;
  /** Recorded on the intent so a dispute can be answered without guesswork. */
  confirmationRecordedAt: string;
}

export interface PaymentIntentResult {
  id: string;
  status: string;
  clientSecret: string | null;
}

export interface CreateTransferInput {
  amountPence: number;
  currency: string;
  destinationAccountId: string;
  orderId: string;
  description: string;
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
  /** Verifies the signature. A webhook that does not verify is not an event, it is noise. */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): WebhookEvent;
}

export function stripeGateway(secretKey: string, webhookSecret: string): PaymentsGateway {
  const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion });

  return {
    mode: 'stripe',
    async createPaymentIntent(input) {
      const intent = await stripe.paymentIntents.create({
        amount: input.amountPence,
        currency: input.currency.toLowerCase(),
        payment_method: input.paymentMethodId,
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

    async createTransfer(input) {
      const transfer = await stripe.transfers.create({
        amount: input.amountPence,
        currency: input.currency.toLowerCase(),
        destination: input.destinationAccountId,
        description: input.description,
        metadata: { orderId: input.orderId },
      });
      return { id: transfer.id, amountPence: transfer.amount };
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
  kind: 'payment_intent' | 'transfer';
  input: CreatePaymentIntentInput | CreateTransferInput;
}

export interface RehearsalGateway extends PaymentsGateway {
  readonly calls: RecordedCall[];
}

export function rehearsalGateway(): RehearsalGateway {
  const calls: RecordedCall[] = [];
  let counter = 0;

  return {
    mode: 'rehearsal',
    calls,
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
    constructWebhookEvent(rawBody) {
      const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as {
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
}
