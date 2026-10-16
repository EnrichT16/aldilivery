/**
 * The small pieces of the card screen that do not need a browser: finding a postcode in an
 * address somebody typed, and handing it to Stripe with the card.
 */

import { describe, expect, it, vi } from 'vitest';

import { completeBankCheck, createCardPaymentMethod, postcodeFrom } from '../src/lib/stripe';

describe('finding a postcode in an address', () => {
  it('finds one at the end of an address, and tidies it', () => {
    expect(postcodeFrom('12 Made Up Street, Leeds, LS1 1AA')).toBe('LS1 1AA');
    expect(postcodeFrom('1 Test Street, London, sw1a1aa')).toBe('SW1A 1AA');
    expect(postcodeFrom('Flat 3, 20 High Road, M4 5BD')).toBe('M4 5BD');
  });

  it('gives nothing rather than a guess when there is no postcode', () => {
    expect(postcodeFrom('12 Made Up Street, Leeds')).toBeUndefined();
    expect(postcodeFrom('')).toBeUndefined();
  });
});

describe('saving a card with Stripe', () => {
  function fakeStripe() {
    return {
      createPaymentMethod: vi.fn().mockResolvedValue({
        paymentMethod: { id: 'pm_x', card: { last4: '4242', brand: 'visa', country: 'GB' } },
      }),
    };
  }

  it('sends the postcode as the billing postcode', async () => {
    const stripe = fakeStripe();
    await createCardPaymentMethod(stripe as never, {} as never, 'LS1 1AA');

    expect(stripe.createPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'card',
        billing_details: { address: { postal_code: 'LS1 1AA' } },
      }),
    );
  });

  it('sends no billing details at all when there is no postcode', async () => {
    const stripe = fakeStripe();
    await createCardPaymentMethod(stripe as never, {} as never);

    expect(stripe.createPaymentMethod.mock.calls[0]?.[0]).not.toHaveProperty('billing_details');
  });
});

describe('the bank’s own check on a payment (16 October 2026)', () => {
  it('opens it with the secret the server gave, and says yes when the bank does', async () => {
    const stripe = { handleNextAction: vi.fn().mockResolvedValue({ paymentIntent: {} }) };
    const result = await completeBankCheck('pi_1_secret', async () =>
      Promise.resolve({ ready: true, stripe: stripe as never, supportedRegions: ['GB'] }),
    );
    expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret' });
    expect(result).toEqual({ ok: true });
  });

  it('gives the bank’s own words when it says no, and a plain sentence when it gives none', async () => {
    const refused = await completeBankCheck('pi_1_secret', async () =>
      Promise.resolve({
        ready: true,
        stripe: { handleNextAction: async () => ({ error: { message: 'Declined.' } }) } as never,
        supportedRegions: ['GB'],
      }),
    );
    expect(refused).toEqual({ ok: false, message: 'Declined.' });
    const silent = await completeBankCheck('pi_1_secret', async () =>
      Promise.resolve({
        ready: true,
        stripe: { handleNextAction: async () => ({ error: {} }) } as never,
        supportedRegions: ['GB'],
      }),
    );
    expect(silent).toMatchObject({ ok: false, message: /Your bank did not approve the payment/ });
  });

  it('has nothing to open in a rehearsal, and lets the order carry on', async () => {
    const result = await completeBankCheck('pi_1_secret', async () =>
      Promise.resolve({ ready: false, reason: 'rehearsal' }),
    );
    expect(result).toEqual({ ok: true });
  });
});
