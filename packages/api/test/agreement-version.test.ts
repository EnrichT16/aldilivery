/**
 * The Runner agreement of 2 November 2026 (ruling 90): self-employment in plain words and the
 * substitution rule. Its version was bumped, so every Runner on the earlier version is asked to
 * agree again before their next job, exactly as the Shop Partner terms re-agreement works; a
 * Runner already on a job finishes it first.
 */

import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';
import { describe, expect, it } from 'vitest';

import { AGREE_FIRST } from '../src/services/runner-agreement.js';
import { buildTestApp, seedCatalogue, signUpRunner, signUpShopper } from './helpers.js';

const EARLIER = '2026-10-30';

async function placeOrder(harness: Awaited<ReturnType<typeof buildTestApp>>) {
  const items = await seedCatalogue(harness.repository);
  const shopper = await signUpShopper(harness);
  const placed = await harness.app.inject({
    method: 'POST',
    url: '/orders',
    headers: shopper.authHeader,
    payload: {
      lines: [{ catalogueItemId: items.milk, quantity: 2 }],
      deliveryAddress: '12 Example Street, Birmingham',
      paymentMethodId: shopper.paymentMethodId,
      confirmation: {
        confirmed: true,
        addressConfirmed: true,
        channel: 'button',
        statement: 'Send my order and pay.',
        agreedTotalPence: 250 + 100 + 1099,
      },
    },
  });
  expect(placed.statusCode, placed.body).toBe(201);
  return (placed.json() as { order: { id: string } }).order.id;
}

describe('the agreement version of 2 November 2026', () => {
  it('is the new one', () => {
    expect(RUNNER_AGREEMENT_VERSION).toBe('2026-11-02');
    expect(RUNNER_AGREEMENT_VERSION > EARLIER).toBe(true);
  });

  it('asks a Runner on the earlier version to agree again before their next job', async () => {
    const harness = await buildTestApp(new Date('2026-11-02T09:00:00.000Z'), { autoOffer: true });
    const runner = await signUpRunner(harness);
    // They agreed before the change.
    await harness.repository.runners.update(runner.runnerId, { agreementVersion: EARLIER });

    const me = await harness.app.inject({
      method: 'GET',
      url: '/me',
      headers: runner.authHeader,
    });
    expect(me.json().runner.agreementCurrent).toBe(false);

    const orderId = await placeOrder(harness);
    // Not offered a job while on the old version; an offer made anyway cannot be accepted.
    expect(await harness.repository.offers.listForOrder(orderId)).toEqual([]);
    await harness.repository.orders.update(orderId, { status: 'offered' });
    const offer = await harness.repository.offers.create({
      orderId,
      runnerId: runner.runnerId,
      expiresAt: new Date(harness.now().getTime() + 60_000),
      queuePosition: 1,
    });
    const refused = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toBe(AGREE_FIRST);

    // An old page cannot agree to the new version by accident.
    const stale = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/agreement',
      headers: runner.authHeader,
      payload: { accepted: true, version: EARLIER, channel: 'button' },
    });
    expect(stale.statusCode).toBe(400);

    const agreed = await harness.app.inject({
      method: 'POST',
      url: '/runners/me/agreement',
      headers: runner.authHeader,
      payload: { accepted: true, version: RUNNER_AGREEMENT_VERSION, channel: 'button' },
    });
    expect(agreed.statusCode, agreed.body).toBe(200);
    expect((await harness.repository.runners.findById(runner.runnerId))?.agreementVersion).toBe(
      RUNNER_AGREEMENT_VERSION,
    );
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    await harness.close();
  });

  it('lets a Runner already on a job finish it first', async () => {
    const harness = await buildTestApp(new Date('2026-11-02T09:00:00.000Z'), { autoOffer: true });
    const runner = await signUpRunner(harness);
    const orderId = await placeOrder(harness);
    const offer = (await harness.repository.offers.listForOrder(orderId))[0]!;
    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/jobs/${offer.id}/accept`,
      headers: runner.authHeader,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    // The agreement changes under them, mid-job.
    await harness.repository.runners.update(runner.runnerId, { agreementVersion: EARLIER });
    const shopping = await harness.app.inject({
      method: 'POST',
      url: `/orders/${orderId}/status`,
      headers: runner.authHeader,
      payload: { status: 'shopping' },
    });
    expect(shopping.statusCode, shopping.body).toBe(200);
    await harness.close();
  });
});
