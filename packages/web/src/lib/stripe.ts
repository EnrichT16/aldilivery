/**
 * Stripe, in the browser.
 *
 * Rule Ten is kept by where the code runs, not by being careful. Stripe.js draws the card
 * fields inside an iframe served by Stripe, so the digits a Shopper types are never in a
 * variable belonging to the service, never in our JavaScript, and never in a request to our
 * server. What comes back is an identifier — `pm_...` — and the last four digits, which is
 * all that is ever sent on.
 *
 * Nothing here is loaded until somebody actually goes to the card screen. Stripe.js is a
 * large script from another origin, and a Shopper who only ever browses should not pay for
 * it, in bandwidth or in being watched.
 */

import { loadStripe, type Stripe, type StripeCardNumberElement } from '@stripe/stripe-js';

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
 * A UK postcode, if one can be found in an address somebody typed, tidied to the usual form
 * with one space before the last three characters. Undefined rather than a guess otherwise.
 */
export function postcodeFrom(address: string): string | undefined {
  const match = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(address);
  return match ? `${match[1]} ${match[2]}`.toUpperCase() : undefined;
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
  cardNumber: StripeCardNumberElement,
  /**
   * Typed into an ordinary field of ours, not Stripe's. A postcode is not card data, and in
   * our own field it can have a real label and be filled in from the delivery address.
   */
  postalCode?: string,
): Promise<CardDetails> {
  // The number field is enough: Stripe collects the expiry and security code from the other
  // fields made by the same `elements()` group.
  const result = await stripe.createPaymentMethod({
    type: 'card',
    card: cardNumber,
    ...(postalCode ? { billing_details: { address: { postal_code: postalCode } } } : {}),
  });

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

/**
 * Apple Pay, Google Pay and Stripe's own Link, as one button (ruling 35). They come through
 * Stripe with no other account and no extra fee. A card already in the phone's wallet is
 * confirmed with Face ID, a fingerprint or the side button: nothing to type, nothing to read
 * out, which suits somebody who cannot see the screen better than anything else here.
 *
 * Like the card boxes, the button is Stripe's own, drawn in its frame; the wallet hands the
 * card to Stripe, and we get back the same reference and last four digits as a typed card.
 * Only the wallets this phone actually has are offered; with none, nothing is shown.
 */
export function mountWalletButton(
  stripe: Stripe,
  mount: HTMLElement,
  handlers: {
    /** Which wallets this phone offers, in words: "Apple Pay". Empty when it has none. */
    onAvailable: (wallets: string[]) => void;
    onDetails: (details: CardDetails) => Promise<void>;
    onError: (message: string) => void;
  },
): () => void {
  const elements = stripe.elements({
    mode: 'setup',
    currency: 'gbp',
    paymentMethodCreation: 'manual',
  });
  const button = elements.create('expressCheckout', {
    paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'auto' },
    buttonHeight: 55,
  });
  const WORDS: Record<string, string> = {
    applePay: 'Apple Pay',
    googlePay: 'Google Pay',
    link: 'Link',
  };
  button.on('ready', ({ availablePaymentMethods }) => {
    const offered = Object.entries(availablePaymentMethods ?? {})
      .filter(([, yes]) => Boolean(yes))
      .map(([key]) => WORDS[key] ?? key);
    handlers.onAvailable(offered);
  });
  button.on('confirm', () => {
    void (async () => {
      const submitted = await elements.submit();
      if (submitted.error) {
        handlers.onError(submitted.error.message ?? 'That did not work. Please try again.');
        return;
      }
      const result = await stripe.createPaymentMethod({ elements });
      if (result.error || !result.paymentMethod.card) {
        handlers.onError(result.error?.message ?? 'That card was not accepted.');
        return;
      }
      const card = result.paymentMethod.card;
      await handlers.onDetails({
        stripePaymentMethodId: result.paymentMethod.id,
        lastFour: card.last4,
        brand: card.brand,
        region: card.country ?? undefined,
      });
    })();
  });
  button.mount(mount);
  return () => button.destroy();
}
