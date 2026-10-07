/** Ozi Recipes, a paid extra (6 October 2026): price agreed first, taken from the saved card. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, signUpShopper, type SignedInShopper, type TestHarness } from './helpers.js';

let harness: TestHarness;
let shopper: SignedInShopper;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
  shopper = await signUpShopper(harness);
});

afterEach(async () => {
  await harness.close();
});

function buy(payload: object = { priceAccepted: true }) {
  return harness.app.inject({
    method: 'POST',
    url: '/extras/recipe-pass',
    headers: shopper.authHeader,
    payload,
  });
}

describe('the recipe pass', () => {
  it('needs the price agreed first, and takes nothing without it', async () => {
    const response = await buy({});
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/agree to the price first: £1\.99/);
    expect(harness.payments.calls.filter((c) => c.kind === 'saved_card_charge')).toEqual([]);
  });

  it('charges the saved card and unlocks Recipes for thirty days, adding to any time left', async () => {
    const first = await buy();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().message).toMatch(
      /^Recipes is unlocked until Friday 6 November\. £1\.99 was taken/,
    );
    expect(harness.payments.calls.filter((c) => c.kind === 'saved_card_charge')).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ amountPence: 199 }) }),
    ]);
    const again = await buy();
    expect(new Date(again.json().recipePassUntil).toISOString().slice(0, 10)).toBe('2026-12-06');

    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    expect(me.json().shopper.recipePassUntil).toBeTruthy();
  });

  it('unlocks nothing when the card is declined', async () => {
    harness.payments.declineNextCharge = true;
    const response = await buy();
    expect(response.statusCode).toBe(503);
    const me = await harness.app.inject({ method: 'GET', url: '/me', headers: shopper.authHeader });
    expect(me.json().shopper.recipePassUntil).toBeNull();
  });

  it('is offered in /config with its price', async () => {
    const config = await harness.app.inject({ method: 'GET', url: '/config' });
    expect(config.json().extras).toEqual(
      expect.objectContaining({ recipePassPence: 199, recipePassDays: 30, plusPence: 799 }),
    );
  });
});
