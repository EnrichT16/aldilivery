/**
 * Shops, cafés, takeaways and services that join as partners (ruling 65, 16 and 17 October
 * 2026). The pure rules live here, with every figure coming from `extras.partners` in
 * `config/store.json`: what a partner pays, how many free listings there are, and which kinds of
 * service are never listed. A café, restaurant or takeaway owes no commission (Anthony, 30
 * October 2026): it may agree a discount for Ozi instead (restaurants.ts).
 */

/** What kind of business a partner is. A service lists services, not goods. */
export const PARTNER_KINDS = ['shop', 'food', 'service'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_KIND_WORDS: Record<PartnerKind, string> = {
  shop: 'Shop',
  food: 'Café or takeaway',
  service: 'Service',
};

/**
 * The three packages a shop can be on (ruling 96, 5 November 2026): Free, Shop Partner Plus and
 * Shop Partner Pro. A café, takeaway or service is on the free one unless it is a Preferred
 * Partner (Plus free) or has bought Pro.
 */
export const PARTNER_PLANS = ['free', 'plus', 'pro'] as const;
export type PartnerPlan = (typeof PARTNER_PLANS)[number];

/** Where a package's products wait: Pro's first, then everybody else's, oldest first. */
export type ApprovalPriority = 'normal' | 'high';

/** What one package gives, from `extras.partners.plans` in config/store.json. */
export interface PartnerPlanLimits {
  /** The package's name as partners and Shoppers read it. */
  readonly name: string;
  /** The most products listed, live or waiting. */
  readonly products: number;
  /** How many photos each product may carry; the first is the cover. */
  readonly photosPerProduct: number;
  /** Sizes and packs of one product grouped as variants, each with its own price and photos. */
  readonly variants: boolean;
  /** Featured products first, and the shop's own order of its page. */
  readonly featured: boolean;
  /** A CSV of products uploaded in one go. */
  readonly bulkAdd: boolean;
  /** A Runner may ring the shop about a product. */
  readonly runnerCalls: boolean;
  readonly approvalPriority: ApprovalPriority;
}

export interface PartnerPricing {
  /** The first this-many shops to join are listed free for ever. */
  readonly freeListingCount: number;
  /** A free listing carries up to this many products (the same figure as `plans.free.products`). */
  readonly freeProductLimit: number;
  /** Shop Partner Plus, a month. */
  readonly plusMonthlyPence: number;
  /** Shop Partner Pro, a month (ruling 96). */
  readonly proMonthlyPence: number;
  /** The first month of a paid package costs nothing. */
  readonly plusFirstMonthFree: boolean;
  /** What each package gives (ruling 96). */
  readonly plans: Readonly<Record<PartnerPlan, PartnerPlanLimits>>;
  /** Kinds of service that are never listed, each as plain words found in what the business says it does. */
  readonly excludedServiceKinds: readonly string[];
}

/** Whether a plan is one that is paid for. */
export function paidPlan(plan: PartnerPlan): plan is 'plus' | 'pro' {
  return plan === 'plus' || plan === 'pro';
}

/** What a package costs a month: nothing for Free. */
export function planMonthlyPence(plan: PartnerPlan, pricing: PartnerPricing): number {
  if (plan === 'plus') return pricing.plusMonthlyPence;
  if (plan === 'pro') return pricing.proMonthlyPence;
  return 0;
}

/**
 * The package whose limits apply now: the one chosen while it is paid, Free when a paid one has
 * lapsed (ruling 96: products beyond Free's limit and photos beyond its one are hidden, never
 * deleted).
 */
export function effectivePlan(shop: { plan: PartnerPlan; plusPaid: boolean }): PartnerPlan {
  if (paidPlan(shop.plan)) return shop.plusPaid ? shop.plan : 'free';
  return 'free';
}

/**
 * What a shop may do now (ruling 96): the limits of the package that applies. A café, takeaway
 * or service has no product count, as it never had, and Plus's other limits while on Free, so
 * its menu keeps its photos; a Preferred Partner's Plus is paid for it; Pro bought is Pro.
 */
export function planLimits(
  shop: { kind: PartnerKind; plan: PartnerPlan; plusPaid: boolean },
  pricing: PartnerPricing,
): Omit<PartnerPlanLimits, 'products'> & { products: number | null } {
  const effective = effectivePlan(shop);
  const base =
    shop.kind !== 'shop' && effective === 'free' ? pricing.plans.plus : pricing.plans[effective];
  return { ...base, products: shop.kind === 'shop' ? pricing.plans[effective].products : null };
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

/**
 * How many products a partner may have listed (live or waiting), or null for no limit: Free 10,
 * Plus 300, Pro 3000 (ruling 96), from `extras.partners.plans`; a café, takeaway or service has
 * no limit.
 */
export function productLimit(
  shop: { kind: PartnerKind; plan: PartnerPlan; plusPaid: boolean },
  pricing: PartnerPricing,
): number | null {
  return planLimits(shop, pricing).products;
}

/* ------------------------------------------------------------------ units and unit prices */

/** The units a product may be sold in (ruling 96). */
export const UNIT_KINDS = ['g', 'kg', 'ml', 'l', 'each', 'pack'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_WORDS: Record<UnitKind, string> = {
  g: 'grams',
  kg: 'kilograms',
  ml: 'millilitres',
  l: 'litres',
  each: 'each',
  pack: 'in a pack',
};

/** "500 g", "1.5 kg", "6 each", "4 in a pack": the quantity as the label would print it. */
export function unitQuantityWords(quantity: number, unit: UnitKind): string {
  const amount = Number.isInteger(quantity)
    ? String(quantity)
    : String(Math.round(quantity * 100) / 100);
  if (unit === 'each') return quantity === 1 ? '1' : `${amount} each`;
  if (unit === 'pack') return `${amount} in a pack`;
  return `${amount} ${unit}`;
}

/**
 * The unit price the Price Marking Order 2004 asks shops to show beside a grocery's price: per
 * kilogram for anything by weight, per litre for anything by volume, each for things counted,
 * and per item for a pack. Null when the quantity makes no sense.
 */
export function unitPrice(
  pricePence: number,
  quantity: number,
  unit: UnitKind,
): { pence: number; per: string } | null {
  if (!(quantity > 0) || !Number.isFinite(quantity) || pricePence <= 0) return null;
  switch (unit) {
    case 'g':
      return { pence: Math.round((pricePence * 1000) / quantity), per: 'kg' };
    case 'kg':
      return { pence: Math.round(pricePence / quantity), per: 'kg' };
    case 'ml':
      return { pence: Math.round((pricePence * 1000) / quantity), per: 'litre' };
    case 'l':
      return { pence: Math.round(pricePence / quantity), per: 'litre' };
    case 'each':
      return { pence: Math.round(pricePence / quantity), per: 'each' };
    case 'pack':
      return { pence: Math.round(pricePence / quantity), per: 'item' };
  }
}

/** "£2.40 per kg", "80p each", from a unit price and a money formatter. */
export function unitPriceWords(
  price: { pence: number; per: string },
  money: (pence: number) => string,
): string {
  return price.per === 'each'
    ? `${money(price.pence)} each`
    : `${money(price.pence)} per ${price.per}`;
}

/** The first part of a UK postcode ("ME7 1ER" gives "ME7"), the area a shop is in. */
export function postcodeArea(postcode: string): string {
  const tidy = postcode.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/.exec(tidy);
  if (match) return match[1]!;
  return tidy.replace(/\d[A-Z]{2}$/, '') || tidy;
}
