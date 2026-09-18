/**
 * Stripe, in the browser.
 *
 * Rule Ten is kept by where the code runs, not by being careful. Stripe.js draws the card
 * fields inside an iframe served by Stripe, so the digits a Shopper types are never in a
 * variable belonging to Aldilivery, never in our JavaScript, and never in a request to our
 * server. What comes back is an identifier — `pm_...` — and the last four digits, which is
 * all that is ever sent on.
 *
 * Nothing here is loaded until somebody actually goes to the card screen. Stripe.js is a
 * large script from another origin, and a Shopper who only ever browses should not pay for
 * it, in bandwidth or in being watched.
 */

import { loadStripe, type Stripe, type StripeCardElement } from '@stripe/stripe-js';

import { fetchPaymentsConfig } from './api';

export type CardSetup =
  | { ready: true; stripe: Stripe; supportedRegions: string[] }
  /**
   * Why it cannot be done, in words a person can act on. Each of these is a real state, and
   * saying which one it is beats a spinner that never stops.
   */
  | { ready: false; reason: 'rehearsal' | 'no-key' | 'script-blocked' };

/** Loaded once per page. Stripe.js is not cheap and there is no reason to fetch it twice. */
let cached: Promise<CardSetup> | null = null;

export function prepareCardEntry(): Promise<CardSetup> {
  cached ??= (async (): Promise<CardSetup> => {
    const config = await fetchPaymentsConfig();

    // No secret key on the server: nothing could be charged even if a card were saved.
    if (config.mode !== 'stripe') return { ready: false, reason: 'rehearsal' };
    if (!config.publishableKey) return { ready: false, reason: 'no-key' };

    let stripe: Stripe | null = null;
    try {
      stripe = await loadStripe(config.publishableKey);
    } catch {
      // A blocked script, an offline browser, or an extension that removed it.
      return { ready: false, reason: 'script-blocked' };
    }
    if (!stripe) return { ready: false, reason: 'script-blocked' };

    return { ready: true, stripe, supportedRegions: config.supportedCardRegions };
  })();

  return cached;
}

/** For tests, which must not share a memoised Stripe between cases. */
export function forgetCardEntry(): void {
  cached = null;
}

export interface CardDetails {
  stripePaymentMethodId: string;
  lastFour: string;
  brand: string | undefined;
  region: string | undefined;
}

/**
 * Turn what was typed into an identifier.
 *
 * The error message is Stripe's own where there is one, because "your card number is
 * incomplete" is more use than anything generic we could write, and Stripe has already
 * translated it.
 */
export async function createCardPaymentMethod(
  stripe: Stripe,
  card: StripeCardElement,
): Promise<CardDetails> {
  const result = await stripe.createPaymentMethod({ type: 'card', card });

  if (result.error) {
    throw new Error(result.error.message ?? 'That card was not accepted. Please check it.');
  }

  const method = result.paymentMethod;
  const details = method.card;
  if (!details) {
    throw new Error('That card was not accepted. Please check it.');
  }

  return {
    stripePaymentMethodId: method.id,
    lastFour: details.last4,
    brand: details.brand,
    // Stripe gives the issuing country, which is what decides whether we can take it.
    region: details.country ?? undefined,
  };
}
