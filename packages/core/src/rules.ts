/**
 * The ten inviolable rules, and the constants that carry them.
 *
 * These are NOT configuration. `config/store.json` may describe the store, the brand and
 * the commercial bands, but it may never contradict this file. `parseStoreConfig` in
 * `config.ts` refuses to load a configuration that disagrees with any constant here, so a
 * well meaning edit to a JSON file cannot quietly break a promise made to a Shopper or to
 * a Runner.
 *
 * See RULES.md at the repository root.
 */

/** The ten rules, word for word, for display and for tests. */
export const INVIOLABLE_RULES: readonly string[] = [
  'A single explicit confirmation from the Shopper is required before any payment is taken.',
  'The Runner receives five pounds on every completed order, without exception.',
  'Aldilivery never nets below two pounds on any order after payment processing costs.',
  'No surge pricing, no small order fee, no minimum spend.',
  'A notice is sent thirty minutes before any recurring Set order fires, with a one word skip.',
  'No age restricted goods in version one.',
  'Every screen meets WCAG two point two level double A.',
  'Aldilivery shares no code, database, login or payment account with any other product.',
  'Store identity, name, colours, catalogue source and legal entity are configuration, never code.',
  'Aldilivery never stores card numbers and never holds Runner money.',
] as const;

/**
 * Rule Two. Five pounds, in pence, to the Runner on every completed order.
 *
 * This figure is deliberately a constant and not a setting. Every payout in the system
 * reads it from here. Pooled orders each pay it in full.
 */
export const RUNNER_PAYMENT_PENCE = 500;

/**
 * Rule Three. Two pounds, in pence. Aldilivery net, after the Runner is paid and after
 * modelled payment processing costs, is never below this on any order.
 */
export const MINIMUM_NET_PENCE = 200;

/** Rule Five. Minutes of notice before a recurring Set order fires. */
export const SET_NOTICE_MINUTES_BEFORE = 30;

/** Rule Six. Age restricted goods are not sold in version one. Full stop. */
export const AGE_RESTRICTED_GOODS_ALLOWED = false;

/**
 * Rule Four, expressed as an absence.
 *
 * There is no surge multiplier, no small order fee and no minimum spend anywhere in this
 * codebase. The fee is a function of the goods band and nothing else — see
 * `feeForGoodsPence`, whose signature accepts no time, no distance, no demand and no
 * order history, which is what makes surge pricing unrepresentable rather than merely
 * forbidden.
 */
export const MINIMUM_SPEND_PENCE = 0;

/** Rule Seven. The accessibility standard every screen is held to. */
export const ACCESSIBILITY_STANDARD = 'WCAG 2.2 AA';

/** The upper bound of an order status lifecycle, shared by the API and the web shell. */
export const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Which status may follow which. The API status transition route consults this map and
 * refuses anything not listed, so an order cannot, for example, reach `completed` without
 * having been `delivered`, and cannot be `paid` without having been `confirmed` (Rule One).
 */
export const ALLOWED_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['paid', 'cancelled'],
  paid: ['offered', 'cancelled', 'refunded'],
  offered: ['accepted', 'offered', 'cancelled', 'refunded'],
  accepted: ['shopping', 'offered', 'cancelled', 'refunded'],
  shopping: ['receipt_submitted', 'cancelled', 'refunded'],
  receipt_submitted: ['delivering', 'cancelled', 'refunded'],
  delivering: ['delivered', 'cancelled'],
  delivered: ['completed', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_ORDER_TRANSITIONS[from].includes(to);
}
