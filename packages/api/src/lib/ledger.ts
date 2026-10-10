/**
 * The money ledger (7 October 2026): every card charge and every refund, written down as it
 * happens, by gateway, for the owner's eyes only. Order payments are written where the order is
 * known to be paid (lib/ledger.ts `recordOrderIncome`), since a payment intent can still be
 * waiting for the bank.
 *
 * The gateway is wrapped rather than changed, so nothing about how money moves is different:
 * the record is written after the gateway has said yes, and a record that cannot be written
 * never undoes a payment.
 */

import type { Repository } from '../data/repository.js';
import type { Order } from '../domain.js';
import type { PaymentsGateway } from './payments.js';

/** "recipe-pass:shopper:time" gives "recipe-pass"; "problem:report" gives "problem". */
function kindOf(reference: string): string {
  return reference.split(':')[0] || 'other';
}

export function gatewayName(payments: PaymentsGateway): string {
  return payments.mode === 'stripe' ? 'Stripe' : 'Rehearsal (no real money)';
}

export function withLedger(
  payments: PaymentsGateway,
  repository: Repository,
  now: () => Date,
): PaymentsGateway {
  const wrapped = Object.create(payments) as PaymentsGateway;
  wrapped.chargeSavedCard = async (input) => {
    const result = await payments.chargeSavedCard(input);
    await repository.income
      .record({
        at: now(),
        gateway: gatewayName(payments),
        kind: kindOf(input.reference),
        amountPence: input.amountPence,
        reference: result.id,
      })
      .catch(() => undefined);
    return result;
  };
  wrapped.refundPayment = async (input) => {
    const result = await payments.refundPayment(input);
    await repository.income
      .record({
        at: now(),
        gateway: gatewayName(payments),
        kind: `refund: ${kindOf(input.reference)}`,
        amountPence: -input.amountPence,
        reference: result.id,
      })
      .catch(() => undefined);
    return result;
  };
  return wrapped;
}

/** An order's payment, once it is known to have gone through. */
export async function recordOrderIncome(
  repository: Repository,
  payments: PaymentsGateway,
  order: Order,
  at: Date,
  /** What was actually taken, when not the whole estimate (ruling 61: a deferred delivery). */
  amountPence: number = order.totalEstimatePence,
): Promise<void> {
  await repository.income
    .record({
      at,
      gateway: gatewayName(payments),
      kind: 'order',
      amountPence,
      reference: order.stripePaymentIntentId ?? order.id,
    })
    .catch(() => undefined);
}
