/**
 * What a person agrees to when they link their account to an organisation, and the versions of
 * the words partners and organisations agree to (Anthony, 30 October 2026; UK GDPR).
 *
 * The consent lists exactly what the organisation's dashboard and statement show: the person's
 * name, the office label the organisation gives them, their booked weekly shops, and the orders
 * they place from the moment they link, with what each costs. Nothing from before. Every figure
 * comes from config/store.json. When any of these words change, the version changes too, so
 * the server's record says which words each person, shop or organisation agreed to.
 */

import { deliveryStepsWords, type DeliveryFees, type OrganisationPricing } from './fees.js';

/** The consent wording a person agreed to when linking to an organisation. */
export const ORGANISATION_CONSENT_VERSION = 'organisation-consent-2026-11-05';

/**
 * The Shop Partner terms at /partner/terms. Changed in substance on 30 October 2026 (Anthony:
 * restaurant fee and Ambassador base), so a partner who agreed to an earlier version is asked to
 * agree again (`termsChanged`). Versions are compared for equality, never by order. Changed
 * again on 31 October 2026 (Anthony): the payment warning, that joining is always free and never
 * to pay an Ambassador, is a clause of its own, with how to report an Ambassador.
 */
export const SHOP_PARTNER_TERMS_VERSION = 'shop-partner-terms-2026-10-31a';

/** What a partner or Ambassador whose agreed terms are older is told, until they agree again. */
export const TERMS_CHANGED_WORDS = 'Our terms have changed. Please read and agree to keep going.';

/**
 * Whether somebody who agreed to `agreedVersion` must agree again to `currentVersion`. Never
 * having agreed (null) is not a change: that is joining, which has its own agreement.
 */
export function termsChanged(agreedVersion: string | null, currentVersion: string): boolean {
  return agreedVersion !== null && agreedVersion !== currentVersion;
}

/** The Organisation terms at /organisation/terms. */
export const ORGANISATION_TERMS_VERSION = 'organisation-terms-2026-11-05';

/** Who may say yes to linking an account. */
export const ORGANISATION_AUTHORITY_WORDS =
  'Only you, or someone with legal authority to act for you, such as a Lasting Power of Attorney, may agree to this.';

/** Exactly what an organisation sees about a person who links to it. */
export const ORGANISATION_SHARED_THINGS: readonly string[] = [
  'your name',
  'the office label they give you, saying which office or team looks after you',
  'the weekly shops you have booked',
  'the orders you place from now on, and what each one costs',
];

export interface OrganisationConsentWords {
  /** "Linking lets Ashdown Care see:" */
  intro: string;
  /** The things shared, one a line. */
  shared: readonly string[];
  /** What they never see. */
  notShared: string;
  /** Who pays what. */
  fee: string;
  /** The person's delivery price once linked. */
  delivery: string;
  authority: string;
  /** The words beside the tick box. */
  tick: string;
}

/** The consent, with the organisation's name (or "the organisation") and the prices from config. */
export function organisationConsentWords(
  organisation: string,
  pricing: OrganisationPricing,
  fees: Pick<DeliveryFees, 'delivery'>,
  money: (pence: number) => string,
): OrganisationConsentWords {
  return {
    intro: `Linking lets ${organisation} see:`,
    shared: ORGANISATION_SHARED_THINGS,
    notShared:
      'They never see orders from before you link, your card or your messages. You can stop it at any time in Settings.',
    fee: `${organisation} pays us its own fee for you, ${money(pricing.clientMonthlyPence)} a month. You still pay for your own shopping.`,
    delivery: `Your delivery becomes the Membership price: ${deliveryStepsWords('membership', fees, money)}.`,
    authority: ORGANISATION_AUTHORITY_WORDS,
    tick: `I agree that ${organisation} will see these things from now on.`,
  };
}
