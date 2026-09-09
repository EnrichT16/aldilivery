/**
 * What a Runner is paid, and the cool bag deposit.
 *
 * Rule Two is absolute: the Runner earns five pounds on every completed order, without
 * exception. The cool bag deposit does not change that. It is a withholding against money
 * already earned, taken a little at a time from early payouts, held, and then paid over in
 * full once the Runner has completed their twentieth delivery.
 *
 * `earnedPence` in every plan below is always five hundred. If that ever stops being true,
 * the tests in `test/payouts.test.ts` fail.
 */

import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';

import type { CoolBagDepositStatus } from '../domain.js';

export interface CoolBagPolicy {
  depositPence: number;
  withholdPerOrderPence: number;
  releaseAfterCompletedDeliveries: number;
}

export interface RunnerPayoutState {
  coolBagDepositStatus: CoolBagDepositStatus;
  coolBagWithheldPence: number;
  /** Completed deliveries BEFORE the one being paid for now. */
  completedDeliveryCount: number;
}

export interface PayoutPlan {
  /** Always five hundred pence. Rule Two. */
  earnedPence: number;
  /** Held back towards the deposit on this payout. Never more than leaves nothing behind. */
  coolBagWithheldPence: number;
  /** The deposit paid back to the Runner on this payout, once they have earned it back. */
  coolBagReleasedPence: number;
  /** What actually moves to the Runner's own Stripe account in this transfer. */
  transferredPence: number;
  /** The Runner's deposit state after this payout. */
  coolBagDepositStatusAfter: CoolBagDepositStatus;
  coolBagWithheldTotalAfter: number;
  completedDeliveryCountAfter: number;
}

export class PayoutRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutRuleError';
  }
}

/**
 * Work out one payout.
 *
 * The order of events matters. The Runner earns five pounds. If the deposit is not yet
 * collected, a small slice of that five pounds is held back — never so much that the Runner
 * finishes a delivery with nothing, which is why the configuration refuses a per-order
 * withholding of five pounds or more. Once this delivery takes the Runner to their
 * twentieth, everything held is released and transferred along with the earning.
 */
export function planPayout(runner: RunnerPayoutState, policy: CoolBagPolicy): PayoutPlan {
  const earnedPence = RUNNER_PAYMENT_PENCE;

  const completedDeliveryCountAfter = runner.completedDeliveryCount + 1;
  const alreadyHeld = runner.coolBagWithheldPence;
  const outstanding = Math.max(0, policy.depositPence - alreadyHeld);
  const released = runner.coolBagDepositStatus === 'released';

  const coolBagWithheldPence = released
    ? 0
    : Math.min(policy.withholdPerOrderPence, outstanding, earnedPence);

  let withheldTotalAfter = alreadyHeld + coolBagWithheldPence;

  const dueForRelease =
    !released && completedDeliveryCountAfter >= policy.releaseAfterCompletedDeliveries;

  const coolBagReleasedPence = dueForRelease ? withheldTotalAfter : 0;
  if (dueForRelease) {
    withheldTotalAfter = 0;
  }

  const transferredPence = earnedPence - coolBagWithheldPence + coolBagReleasedPence;

  if (transferredPence < 0) {
    throw new PayoutRuleError(
      'A payout may never be negative. The cool bag withholding has been misconfigured.',
    );
  }

  let coolBagDepositStatusAfter: CoolBagDepositStatus;
  if (released || dueForRelease) {
    coolBagDepositStatusAfter = 'released';
  } else if (withheldTotalAfter === 0) {
    coolBagDepositStatusAfter = 'not_started';
  } else if (withheldTotalAfter >= policy.depositPence) {
    coolBagDepositStatusAfter = 'held';
  } else {
    coolBagDepositStatusAfter = 'withholding';
  }

  return {
    earnedPence,
    coolBagWithheldPence,
    coolBagReleasedPence,
    transferredPence,
    coolBagDepositStatusAfter,
    coolBagWithheldTotalAfter: withheldTotalAfter,
    completedDeliveryCountAfter,
  };
}

/**
 * Replay a Runner's whole working life, one delivery at a time.
 *
 * Used by the tests to show that across any number of deliveries the Runner is paid exactly
 * five pounds per order, that the deposit is collected once and never twice, and that every
 * penny withheld comes back.
 */
export function replayPayouts(deliveries: number, policy: CoolBagPolicy): {
  plans: PayoutPlan[];
  totalEarnedPence: number;
  totalTransferredPence: number;
  heldAtEndPence: number;
} {
  let state: RunnerPayoutState = {
    coolBagDepositStatus: 'not_started',
    coolBagWithheldPence: 0,
    completedDeliveryCount: 0,
  };

  const plans: PayoutPlan[] = [];
  for (let i = 0; i < deliveries; i += 1) {
    const plan = planPayout(state, policy);
    plans.push(plan);
    state = {
      coolBagDepositStatus: plan.coolBagDepositStatusAfter,
      coolBagWithheldPence: plan.coolBagWithheldTotalAfter,
      completedDeliveryCount: plan.completedDeliveryCountAfter,
    };
  }

  return {
    plans,
    totalEarnedPence: plans.reduce((sum, plan) => sum + plan.earnedPence, 0),
    totalTransferredPence: plans.reduce((sum, plan) => sum + plan.transferredPence, 0),
    heldAtEndPence: state.coolBagWithheldPence,
  };
}
