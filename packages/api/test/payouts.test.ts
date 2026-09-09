/**
 * Rule Two: the Runner receives five pounds on every completed order, without exception.
 *
 * The cool bag deposit is the only thing in the system that touches a Runner's payment, so
 * it is the thing most likely to erode the rule by accident. These tests replay a Runner's
 * whole working life and check that they earned five pounds per order and that every penny
 * withheld came back.
 */

import { describe, expect, it } from 'vitest';
import { RUNNER_PAYMENT_PENCE } from '@aldilivery/core';
import { loadStoreConfig } from '@aldilivery/core/node';

import { planPayout, replayPayouts } from '../src/services/payouts.js';

const policy = loadStoreConfig().fees.coolBag;

describe('Rule Two: five pounds, every time', () => {
  it('earns exactly five hundred pence on the first delivery', () => {
    const plan = planPayout(
      { coolBagDepositStatus: 'not_started', coolBagWithheldPence: 0, completedDeliveryCount: 0 },
      policy,
    );
    expect(plan.earnedPence).toBe(RUNNER_PAYMENT_PENCE);
  });

  it('earns exactly five hundred pence on every delivery, for a hundred deliveries', () => {
    const { plans } = replayPayouts(100, policy);
    expect(plans).toHaveLength(100);
    for (const plan of plans) {
      expect(plan.earnedPence).toBe(500);
    }
  });

  it('never transfers a negative amount', () => {
    const { plans } = replayPayouts(100, policy);
    for (const plan of plans) {
      expect(plan.transferredPence).toBeGreaterThanOrEqual(0);
    }
  });

  it('never leaves a Runner with nothing at the end of a delivery', () => {
    const { plans } = replayPayouts(100, policy);
    for (const plan of plans) {
      expect(plan.transferredPence).toBeGreaterThan(0);
    }
  });
});

describe('the cool bag deposit', () => {
  it('collects the deposit a little at a time rather than all at once', () => {
    const first = planPayout(
      { coolBagDepositStatus: 'not_started', coolBagWithheldPence: 0, completedDeliveryCount: 0 },
      policy,
    );
    expect(first.coolBagWithheldPence).toBe(policy.withholdPerOrderPence);
    expect(first.transferredPence).toBe(500 - policy.withholdPerOrderPence);
  });

  it('collects exactly the deposit and never a penny more', () => {
    const { plans } = replayPayouts(policy.releaseAfterCompletedDeliveries - 1, policy);
    const withheld = plans.reduce((sum, plan) => sum + plan.coolBagWithheldPence, 0);
    expect(withheld).toBe(policy.depositPence);
  });

  it('stops withholding once the deposit is collected', () => {
    const { plans } = replayPayouts(policy.releaseAfterCompletedDeliveries - 1, policy);
    const collectingPayouts = plans.filter((plan) => plan.coolBagWithheldPence > 0).length;
    expect(collectingPayouts).toBe(policy.depositPence / policy.withholdPerOrderPence);

    const later = plans[plans.length - 1]!;
    expect(later.coolBagWithheldPence).toBe(0);
    expect(later.transferredPence).toBe(500);
  });

  it('releases the whole deposit after the twentieth completed delivery', () => {
    const { plans } = replayPayouts(policy.releaseAfterCompletedDeliveries, policy);
    const twentieth = plans[policy.releaseAfterCompletedDeliveries - 1]!;

    expect(twentieth.completedDeliveryCountAfter).toBe(20);
    expect(twentieth.coolBagReleasedPence).toBe(policy.depositPence);
    expect(twentieth.transferredPence).toBe(500 + policy.depositPence);
    expect(twentieth.coolBagDepositStatusAfter).toBe('released');
    expect(twentieth.coolBagWithheldTotalAfter).toBe(0);
  });

  it('gives back every penny it withheld, so the deposit costs the Runner nothing', () => {
    const deliveries = 25;
    const { totalEarnedPence, totalTransferredPence, heldAtEndPence } = replayPayouts(
      deliveries,
      policy,
    );

    expect(totalEarnedPence).toBe(deliveries * 500);
    expect(totalTransferredPence).toBe(deliveries * 500);
    expect(heldAtEndPence).toBe(0);
  });

  it('never withholds again once the deposit has been released', () => {
    const { plans } = replayPayouts(40, policy);
    const afterRelease = plans.slice(policy.releaseAfterCompletedDeliveries);
    for (const plan of afterRelease) {
      expect(plan.coolBagWithheldPence).toBe(0);
      expect(plan.transferredPence).toBe(500);
    }
  });

  it('does not release a deposit that was never collected', () => {
    const noDeposit = { depositPence: 0, withholdPerOrderPence: 100, releaseAfterCompletedDeliveries: 20 };
    const { plans } = replayPayouts(25, noDeposit);
    for (const plan of plans) {
      expect(plan.coolBagWithheldPence).toBe(0);
      expect(plan.transferredPence).toBe(500);
    }
  });

  it('is described as a withholding, not a deduction: earning and transfer are separate figures', () => {
    const first = planPayout(
      { coolBagDepositStatus: 'not_started', coolBagWithheldPence: 0, completedDeliveryCount: 0 },
      policy,
    );
    expect(first.earnedPence).toBe(500);
    expect(first.earnedPence).not.toBe(first.transferredPence);
    expect(first.earnedPence - first.coolBagWithheldPence).toBe(first.transferredPence);
  });
});
