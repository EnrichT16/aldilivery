/**
 * Which Runners may carry which order (ruling 59, Anthony, 10 October 2026).
 *
 * A large shop is too heavy and too bulky to carry on foot or on a bicycle. An order whose goods
 * total at shop prices is over `dispatch.carOnlyAbovePence` (£60 by default) goes only to a Runner
 * delivering by car or van, with a licence and in-date insurance accepted. Walking and cycling
 * are treated alike, up to that figure. The item charges and delivery do not count: they weigh
 * nothing.
 */

/** The ways of travelling that may carry a large order. A motorbike may not. */
export const LARGE_ORDER_TRAVEL_MODES = ['car', 'van'] as const;

/** Whether this order needs a Runner with a car. */
export function needsCarRunner(goodsPence: number, carOnlyAbovePence: number): boolean {
  return goodsPence > carOnlyAbovePence;
}

/** Whether a Runner travelling this way could carry a large order (insurance is checked apart). */
export function travelModeCarriesLargeOrders(mode: string): boolean {
  return (LARGE_ORDER_TRAVEL_MODES as readonly string[]).includes(mode);
}
