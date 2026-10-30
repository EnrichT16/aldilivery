/**
 * Checkout insights (Anthony, 30 October 2026): why people do not pay.
 *
 * A Shopper who reaches the checkout is a checkout viewed (lib/analytics.ts). Views by the same
 * Shopper close together (`sameCheckoutMinutes`) are one checkout, as they come back to it after
 * changing something; what it shows is the last view's breakdown. A checkout is paid when that
 * Shopper pays an order between its first view and `paidWithinHours` after its last; each payment
 * pays one checkout only. Every other checkout was abandoned.
 *
 * The figures are counted by the total shown, in bands from config, restaurant or groceries, the
 * area, whether the no-Runner warning was shown, new or returning, and how they ordered; the
 * answers to "Can we ask what stopped you?" are counted on their own. An area with fewer than
 * `MINIMUM_GROUP` different Shoppers is counted with the other small areas, so nobody can be
 * picked out (rulings 13, 14 and 16). Pure, so every number is proved without a server.
 */

import { formatPence, type CheckoutInsightSettings } from '@aldilivery/core';

import type { AnalyticsEvent, CheckoutReason } from '../domain.js';

/** Fewer different Shoppers than this in an area, and it is not shown on its own. */
export const MINIMUM_GROUP = 10;

/** The answers' plain words, as the Shopper saw them. */
export const REASON_WORDS: Record<CheckoutReason, string> = {
  price: 'The price',
  looking: 'Just looking',
  no_runner: 'No Runner in my area',
  other: 'Something else',
};

/** One checkout: the views that made it, the last one's breakdown, and whether it was paid. */
export interface Checkout {
  shopperKey: string | null;
  first: Date;
  last: AnalyticsEvent;
  paid: boolean;
}

export interface InsightRow {
  label: string;
  viewed: number;
  paid: number;
  abandoned: number;
  /** Of those viewed, the share that paid, a whole percentage; null when none were viewed. */
  paidPercent: number | null;
}

export interface CheckoutInsights {
  days: number;
  viewed: number;
  paid: number;
  abandoned: number;
  paidPercent: number | null;
  byTotal: InsightRow[];
  byKind: InsightRow[];
  byArea: InsightRow[];
  byWarning: InsightRow[];
  byShopper: InsightRow[];
  byChannel: InsightRow[];
  reasons: Array<{ answer: CheckoutReason; label: string; count: number }>;
  /** In plain words, for the top of the page and for Ozi. */
  summary: string;
}

/** Views grouped into checkouts, each matched to at most one payment. */
export function checkoutsFrom(
  views: readonly AnalyticsEvent[],
  payments: readonly AnalyticsEvent[],
  settings: Pick<CheckoutInsightSettings, 'sameCheckoutMinutes' | 'paidWithinHours'>,
): Checkout[] {
  const gap = settings.sameCheckoutMinutes * 60_000;
  const within = settings.paidWithinHours * 3_600_000;
  const sorted = [...views].sort((a, b) => a.at.getTime() - b.at.getTime());
  const checkouts: Checkout[] = [];
  const open = new Map<string, Checkout>();
  for (const view of sorted) {
    const key = view.shopperKey;
    const current = key ? open.get(key) : undefined;
    if (current && view.at.getTime() - current.last.at.getTime() <= gap) {
      current.last = view;
      continue;
    }
    const checkout: Checkout = { shopperKey: key, first: view.at, last: view, paid: false };
    checkouts.push(checkout);
    if (key) open.set(key, checkout);
  }
  const used = new Set<AnalyticsEvent>();
  for (const checkout of checkouts) {
    if (!checkout.shopperKey) continue;
    const payment = payments.find(
      (row) =>
        !used.has(row) &&
        row.shopperKey === checkout.shopperKey &&
        row.at.getTime() >= checkout.first.getTime() &&
        row.at.getTime() <= checkout.last.at.getTime() + within,
    );
    if (payment) {
      used.add(payment);
      checkout.paid = true;
    }
  }
  return checkouts;
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

function row(label: string, checkouts: readonly Checkout[]): InsightRow {
  const paid = checkouts.filter((checkout) => checkout.paid).length;
  return {
    label,
    viewed: checkouts.length,
    paid,
    abandoned: checkouts.length - paid,
    paidPercent: percent(paid, checkouts.length),
  };
}

/** "Under £20", "£20 to £40", "£40 to £60", "Over £60", from the configured bands. */
export function bandLabels(bands: readonly number[], symbol: string): string[] {
  const short = (pence: number) => formatPence(pence, symbol).replace(/\.00$/, '');
  return [
    `Under ${short(bands[0]!)}`,
    ...bands.slice(1).map((top, index) => `${short(bands[index]!)} to ${short(top)}`),
    `Over ${short(bands[bands.length - 1]!)}`,
  ];
}

/** Which band a total falls in: 0 for under the first top, and so on. */
export function bandOf(totalPence: number, bands: readonly number[]): number {
  const index = bands.findIndex((top) => totalPence < top);
  return index === -1 ? bands.length : index;
}

/** Every figure on the Checkout insights page, for one period. */
export function checkoutInsights(
  events: readonly AnalyticsEvent[],
  days: number,
  settings: CheckoutInsightSettings,
  symbol: string,
): CheckoutInsights {
  const views = events.filter((event) => event.kind === 'checkout_viewed');
  const payments = events.filter((event) => event.kind === 'checkout_paid');
  const checkouts = checkoutsFrom(views, payments, settings);
  const total = row('All', checkouts);

  const labels = bandLabels(settings.totalBandsPence, symbol);
  const byTotal = labels.map((label, index) =>
    row(
      label,
      checkouts.filter(
        (checkout) => bandOf(checkout.last.totalPence ?? 0, settings.totalBandsPence) === index,
      ),
    ),
  );
  const split = (
    yes: string,
    no: string,
    test: (checkout: Checkout) => boolean | null | undefined,
  ): InsightRow[] => [
    row(
      yes,
      checkouts.filter((checkout) => test(checkout) === true),
    ),
    row(
      no,
      checkouts.filter((checkout) => test(checkout) !== true),
    ),
  ];

  // Areas: each with enough different Shoppers on its own, the rest together.
  const areas = new Map<string, Checkout[]>();
  for (const checkout of checkouts) {
    const area = checkout.last.toArea ?? 'Not known';
    areas.set(area, [...(areas.get(area) ?? []), checkout]);
  }
  const byArea: InsightRow[] = [];
  const small: Checkout[] = [];
  for (const [area, rows] of [...areas.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const people = new Set(rows.map((checkout) => checkout.shopperKey).filter(Boolean));
    if (people.size < MINIMUM_GROUP) small.push(...rows);
    else byArea.push(row(area, rows));
  }
  if (small.length > 0) {
    byArea.push(row(`Areas with fewer than ${MINIMUM_GROUP} Shoppers`, small));
  }

  const channels: Array<[string, string]> = [
    ['web', 'On the screen'],
    ['voice', 'By voice'],
    ['phone', 'By telephone'],
  ];
  const answers = events.filter((event) => event.kind === 'checkout_reason' && event.answer);
  const reasons = (Object.keys(REASON_WORDS) as CheckoutReason[]).map((answer) => ({
    answer,
    label: REASON_WORDS[answer],
    count: answers.filter((event) => event.answer === answer).length,
  }));

  const summary =
    total.viewed === 0
      ? `Nobody reached the checkout in the last ${days} days.`
      : `In the last ${days} days, ${total.viewed} checkout${total.viewed === 1 ? ' was' : 's were'} viewed and ${total.paid} paid, ${total.paidPercent}%. ${total.abandoned} ${total.abandoned === 1 ? 'was' : 'were'} left without paying.`;

  return {
    days,
    viewed: total.viewed,
    paid: total.paid,
    abandoned: total.abandoned,
    paidPercent: total.paidPercent,
    byTotal,
    byKind: split('Restaurant', 'Groceries', (checkout) => checkout.last.restaurant),
    byArea,
    byWarning: split(
      'With the no-Runner warning',
      'Without the warning',
      (checkout) => checkout.last.noRunnerWarning,
    ),
    byShopper: split('Returning Shoppers', 'New Shoppers', (checkout) => checkout.last.returning),
    byChannel: channels.map(([key, label]) =>
      row(
        label,
        checkouts.filter((checkout) => (checkout.last.channel ?? 'web') === key),
      ),
    ),
    reasons,
    summary,
  };
}
