/**
 * The Runner spending card (Stripe Issuing; Anthony, 9 October 2026), in the browser.
 *
 * Rule Ten is kept by where the card number goes: Stripe's Issuing Elements draw it inside
 * Stripe's own frame. Our server only ever makes a short-lived key for one card, from a nonce
 * Stripe.js makes here; the number goes from Stripe straight to this frame and is never in a
 * variable of ours, nor in any request to our server.
 */

import type { Stripe, StripeElementStyle } from '@stripe/stripe-js';

import { request } from './api';

export interface RunnerCardView {
  /** STRIPE_ISSUING_ENABLED on the server. When false, the card is "coming soon". */
  enabled: boolean;
  /** "Ozi card", from the store configuration. */
  cardName: string;
  /** How they pay at the till today. */
  payMethod: 'card' | 'own';
  /** What they chose, even if the card is switched off for now. */
  chosen: 'card' | 'own';
  termsAccepted: boolean;
  card: { id: string; last4: string; status: 'active' | 'inactive' } | null;
}

export function fetchRunnerCard(): Promise<RunnerCardView> {
  return request<RunnerCardView>('/runners/me/card', undefined, 'runner');
}

export function chooseTillPayMethod(
  method: 'card' | 'own',
): Promise<RunnerCardView & { message: string }> {
  return request(
    '/runners/me/pay-method',
    { method: 'POST', body: JSON.stringify({ method }) },
    'runner',
  );
}

export interface CardAddress {
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
}

/** Accept the cardholder terms and make the card. The address goes to Stripe for the card. */
export function setUpRunnerCard(
  address: CardAddress,
): Promise<RunnerCardView & { message: string }> {
  return request(
    '/runners/me/card',
    { method: 'POST', body: JSON.stringify({ acceptTerms: true, address }) },
    'runner',
  );
}

function fetchCardKey(nonce: string): Promise<{ cardId: string; secret: string }> {
  return request(
    '/runners/me/card/key',
    { method: 'POST', body: JSON.stringify({ nonce }) },
    'runner',
  );
}

/** Large and plain, in Stripe's frame, to match the page. */
const CARD_STYLE: StripeElementStyle = {
  base: {
    color: '#000000',
    fontSize: '22px',
    lineHeight: '32px',
    fontFamily: 'system-ui, sans-serif',
  },
};

/**
 * Show the card's number, expiry date and security code, each in Stripe's own frame, following
 * Stripe's nonce flow: a nonce from Stripe.js, a short-lived key for it from our server, then
 * Issuing Elements. Returns a function that takes them off the screen again.
 */
export async function showCardDetails(
  stripe: Stripe,
  cardId: string,
  mounts: { number: HTMLElement; expiry: HTMLElement; cvc: HTMLElement },
): Promise<() => void> {
  const made = await stripe.createEphemeralKeyNonce({ issuingCard: cardId });
  if (!made.nonce) {
    throw new Error(made.error?.message ?? 'Stripe could not show the card just now.');
  }
  const { secret } = await fetchCardKey(made.nonce);
  const shared = {
    issuingCard: cardId,
    nonce: made.nonce,
    ephemeralKeySecret: secret,
    style: CARD_STYLE,
  };
  const elements = stripe.elements();
  const number = elements.create('issuingCardNumberDisplay', shared);
  const expiry = elements.create('issuingCardExpiryDisplay', shared);
  const cvc = elements.create('issuingCardCvcDisplay', shared);
  number.mount(mounts.number);
  expiry.mount(mounts.expiry);
  cvc.mount(mounts.cvc);
  return () => {
    number.destroy();
    expiry.destroy();
    cvc.destroy();
  };
}
