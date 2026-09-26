/**
 * Which of the store's card regions a card belongs to.
 *
 * Stripe describes a card by the country that issued it, as a two letter ISO code — `GB`, `FR`,
 * `US`. The store configuration describes what it accepts in regions — `UK`, `EU`. Until
 * 26 Sep 2026 the two were compared directly, so `GB` never matched `UK` and every real card
 * was refused with "We can only take cards from UK and EU". The tests had only ever sent
 * `UK` straight in, which is not something Stripe ever says.
 *
 * A value that is already a region name is passed through, so anything that sends one keeps
 * working. A country outside both is returned as it is, and is refused by the caller.
 */

/** The United Kingdom, and the Crown Dependencies whose cards are issued as British. */
const UK = new Set(['GB', 'UK', 'GG', 'JE', 'IM']);

/** The twenty seven member states of the European Union. */
const EU = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

export function cardRegionFor(countryOrRegion: string): string {
  const code = countryOrRegion.trim().toUpperCase();
  if (code === 'EU') return 'EU';
  if (UK.has(code)) return 'UK';
  if (EU.has(code)) return 'EU';
  return code;
}
