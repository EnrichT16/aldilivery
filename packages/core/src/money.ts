/**
 * Money formatting.
 *
 * Pence in, a string out. Nothing in this codebase converts money to a float in order to
 * display it, and nothing displays money without going through here, so a rounding change
 * has exactly one place to happen.
 */

/**
 * Format a whole number of pence as a currency string, for example `812` becomes `£8.12`.
 *
 * The symbol comes from configuration (Rule Nine), so a future non sterling market is a
 * configuration change.
 */
export function formatPence(pence: number, currencySymbol = '£'): string {
  if (!Number.isInteger(pence)) {
    throw new TypeError(`Money must be a whole number of pence, received ${pence}.`);
  }
  const negative = pence < 0;
  const absolute = Math.abs(pence);
  const pounds = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const body = `${currencySymbol}${pounds}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Whole pounds to pence, for readable test and seed data. */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}
