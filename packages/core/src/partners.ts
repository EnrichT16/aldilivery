/**
 * Shops, cafés, takeaways and services that join as partners (ruling 65, 16 and 17 October
 * 2026). The pure rules live here, with every figure coming from `extras.partners` in
 * `config/store.json`: what a partner pays, how many free listings there are, what a café or
 * takeaway owes on an order placed through the app, and which kinds of service are never listed.
 */

/** What kind of business a partner is. A service lists services, not goods. */
export const PARTNER_KINDS = ['shop', 'food', 'service'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_WORDS: Record<PartnerKind, string> = {
  shop: 'Shop',
  food: 'Café or takeaway',
  service: 'Service',
};

/** The two plans a shop can be on. A café, takeaway or service is always on the free one. */
export type PartnerPlan = 'free' | 'plus';

export interface PartnerPricing {
  /** The first this-many shops to join are listed free for ever. */
  readonly freeListingCount: number;
  /** A free listing carries up to this many products. */
  readonly freeProductLimit: number;
  /** Partner Plus: the full catalogue with photos, offers and Shop of the Month, a month. */
  readonly plusMonthlyPence: number;
  /** The first month of Partner Plus costs nothing. */
  readonly plusFirstMonthFree: boolean;
  /** What a café or takeaway owes on an order placed through the app, in basis points (1000 = 10%). */
  readonly foodCommissionBasisPoints: number;
  /** Kinds of service that are never listed, each as plain words found in what the business says it does. */
  readonly excludedServiceKinds: readonly string[];
}

/** The commission on goods bought from a café or takeaway through the app, rounded to the penny. */
export function commissionPence(goodsPence: number, basisPoints: number): number {
  if (goodsPence <= 0) return 0;
  return Math.round((goodsPence * basisPoints) / 10_000);
}

/** "10%" from 1000 basis points; "12.5%" from 1250. */
export function basisPointsWords(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** Lower case, letters and digits only, single spaces: how words are compared here. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The excluded kind of service found in what a business says about itself, or null. Each
 * excluded kind is found as whole words ("loans" is found in "payday loans", never in "sloane
 * street"), so a hairdresser is never refused for a word inside another.
 */
export function excludedServiceKind(text: string, excluded: readonly string[]): string | null {
  const said = ` ${plain(text)} `;
  // The most specific kind named ("payday loans" before "loans"), so the refusal says exactly what.
  const found = excluded
    .filter((kind) => plain(kind) !== '' && said.includes(` ${plain(kind)} `))
    .sort((a, b) => plain(b).length - plain(a).length);
  return found[0] ?? null;
}

/** The plain words a refused business is told. */
export function excludedServiceWords(kind: string, productName: string): string {
  return `${productName} cannot list ${kind}, or anything that needs a licence from the FCA, the SRA or the MHRA. We are sorry, and we wish you well.`;
}

/** Whether a new shop joining now gets one of the free-for-ever listings. */
export function freeListingAvailable(freeListedSoFar: number, pricing: PartnerPricing): boolean {
  return freeListedSoFar < pricing.freeListingCount;
}

/** How many products a partner may have listed (live or waiting), or null for no limit. */
export function productLimit(
  shop: { kind: PartnerKind; plan: PartnerPlan; plusPaid: boolean },
  pricing: PartnerPricing,
): number | null {
  if (shop.kind !== 'shop') return null;
  if (shop.plan === 'plus' && shop.plusPaid) return null;
  return pricing.freeProductLimit;
}

/** The first part of a UK postcode ("ME7 1ER" gives "ME7"), the area a shop is in. */
export function postcodeArea(postcode: string): string {
  const tidy = postcode.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/.exec(tidy);
  if (match) return match[1]!;
  return tidy.replace(/\d[A-Z]{2}$/, '') || tidy;
}
