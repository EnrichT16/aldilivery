/**
 * Protections against Ambassadors misusing the Ozi name (Anthony, 31 October 2026, the founder's
 * five decisions, in his order):
 *
 * 1. "Joining is free" everywhere, with the payment warning, in the same words each time: at the
 *    top of every business sign-up, on the partner dashboard, in the Shop Partner terms, on every
 *    printed Ambassador item and in the Ambassador Guide; and a welcome text when a business joins.
 * 2. A public "Check an Ambassador" page, which every printed QR code goes through, so a
 *    suspension takes effect at once on paper already printed.
 * 3. The business confirms an Ambassador's sign-up with its own code, on its own device; the first
 *    confirmed claim wins.
 * 4. Shares held, and staff told, when an order looks like the Ambassador's or the owner's own.
 * 5. "Were you promised anything that isn't in your agreement?", asked once, about a week in.
 *
 * Every name and figure here comes from config/store.json (Rule Nine): the words are in
 * `ambassadorProtection`, the prices in `extras`, the Preferred Partner discount in `restaurants`.
 */

/** `ambassadorProtection` in config/store.json. */
export interface AmbassadorProtectionSettings {
  /**
   * The payment warning, word for word. `{name}` is the assistant's name, `{extras}` the paid
   * extras joined with "and".
   */
  readonly freeJoiningWords: string;
  /** The optional paid extras, by name, in the order said: "Spotlight", "Partner Plus". */
  readonly paidExtras: readonly string[];
  /** How long a business's confirmation code lasts, in minutes. */
  readonly confirmCodeMinutes: number;
  /** Wrong tries at one confirmation code before a new one is needed. */
  readonly confirmCodeTries: number;
  /** "Were you promised anything…" is asked this many days after a business joins. */
  readonly promisedAskAfterDays: number;
  /** The question itself. */
  readonly promisedQuestion: string;
  /** Lookups of the public check page one internet address may make in ten minutes. */
  readonly checksPerTenMinutes: number;
  /** Reports one internet address may send from the public check page in ten minutes. */
  readonly reportsPerTenMinutes: number;
  /** What the public check page says about an Ambassador who is not active; `{name}` as above. */
  readonly notActiveWords: string;
  /** What it says about a code nobody has. */
  readonly unknownCodeWords: string;
  /** Staff links, never called by the service: `{name}` and `{postcode}` are filled in. */
  readonly companiesHouseSearch: string;
  readonly hygieneRatingSearch: string;
}

export const AMBASSADOR_PROTECTION_DEFAULTS: AmbassadorProtectionSettings = {
  freeJoiningWords:
    'Joining {name} is always free. We never charge you to join. Paid extras are optional: {extras}. You only pay if you choose them. Never pay an Ambassador. All payments are made only inside the app.',
  paidExtras: ['Spotlight', 'Partner Plus'],
  confirmCodeMinutes: 60,
  confirmCodeTries: 5,
  promisedAskAfterDays: 7,
  promisedQuestion: "Were you promised anything that isn't in your agreement?",
  checksPerTenMinutes: 30,
  reportsPerTenMinutes: 5,
  notActiveWords: "Not active. Please do not deal with this person on {name}'s behalf. Report it.",
  unknownCodeWords: "We don't know this code.",
  companiesHouseSearch:
    'https://find-and-update.company-information.service.gov.uk/search/companies?q={name}',
  hygieneRatingSearch: 'https://ratings.food.gov.uk/search?name={name}&location={postcode}',
};

/** "A", "A and B", "A, B and C". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** The paid extras, joined: "Spotlight and Partner Plus". */
export function paidExtrasWords(
  settings: Pick<AmbassadorProtectionSettings, 'paidExtras'>,
): string {
  return andList(settings.paidExtras);
}

/**
 * The payment warning, word for word, with the names from the settings: "Joining Ozi is always
 * free. We never charge you to join. Paid extras are optional: Spotlight and Partner Plus. You only
 * pay if you choose them. Never pay an Ambassador. All payments are made only inside the app."
 */
export function freeJoiningWords(config: {
  readonly assistantName: string;
  readonly ambassadorProtection: Pick<
    AmbassadorProtectionSettings,
    'freeJoiningWords' | 'paidExtras'
  >;
}): string {
  return config.ambassadorProtection.freeJoiningWords
    .replace(/\{name\}/g, config.assistantName)
    .replace(/\{extras\}/g, paidExtrasWords(config.ambassadorProtection));
}

/** The figures the partner dashboard's three lines need, from config. */
export interface PartnerCostFigures {
  readonly assistantName: string;
  readonly ambassadorProtection: Pick<AmbassadorProtectionSettings, 'paidExtras'>;
  readonly restaurants: { readonly preferredDiscountPercent: number };
  readonly extras: {
    readonly spotlightPence: number;
    readonly partners: { readonly plusMonthlyPence: number };
  };
}

/**
 * The three-line breakdown on the partner dashboard: joining is free; Preferred Partner is free and
 * earned with a discount; the paid extras are optional, with their prices. `money` turns pence into
 * words such as "£14.99".
 */
export function partnerCostLines(
  config: PartnerCostFigures,
  money: (pence: number) => string,
): { joining: string; preferred: string; extras: string } {
  const [spotlight = 'Spotlight', plus = 'Partner Plus'] = config.ambassadorProtection.paidExtras;
  const prices = [
    `${spotlight} ${money(config.extras.spotlightPence)} a month`,
    `${plus} ${money(config.extras.partners.plusMonthlyPence)} a month`,
  ];
  return {
    joining: 'Joining: free.',
    preferred: `Preferred Partner: free. You earn it by giving ${config.assistantName} a discount of ${config.restaurants.preferredDiscountPercent}% or more. It comes with free ${plus} and a free ${spotlight} week each month.`,
    extras: `${andList(config.ambassadorProtection.paidExtras)}: paid and optional (${andList(prices)}). You only pay if you choose them.`,
  };
}

/**
 * The welcome text a business gets when it joins: the free-joining and never-pay-an-Ambassador
 * lines, its real terms in brief, and how to report an Ambassador.
 */
export function welcomeTextWords(
  config: PartnerCostFigures & {
    readonly productName: string;
    readonly ambassadorProtection: Pick<
      AmbassadorProtectionSettings,
      'freeJoiningWords' | 'paidExtras'
    >;
  },
  business: { name: string; kind: 'shop' | 'food' | 'service'; plan: 'free' | 'plus' },
  money: (pence: number) => string,
): string {
  const [, plus = 'Partner Plus'] = config.ambassadorProtection.paidExtras;
  const terms =
    business.kind === 'food'
      ? `Your terms in brief: no commission and no monthly fee. Our Runner pays you at the counter. A discount of ${config.restaurants.preferredDiscountPercent}% or more makes you a Preferred Partner, free.`
      : business.kind === 'service'
        ? 'Your terms in brief: your listing is free. Shoppers ask you for a quote or a call back.'
        : business.plan === 'plus'
          ? `Your terms in brief: you chose ${plus}, ${money(config.extras.partners.plusMonthlyPence)} a month. Nothing is ever taken without you.`
          : 'Your terms in brief: your basic listing is free, with no monthly fee.';
  return [
    `${config.productName}: Welcome, ${business.name}.`,
    freeJoiningWords(config),
    terms,
    'To report an Ambassador, use "Report an Ambassador" in your partner dashboard.',
  ].join(' ');
}

/* ------------------------------------------------------------------ the public check page */

/** "Not active. Please do not deal with this person on Ozi's behalf. Report it." */
export function notActiveWords(config: {
  readonly assistantName: string;
  readonly ambassadorProtection: Pick<AmbassadorProtectionSettings, 'notActiveWords'>;
}): string {
  return config.ambassadorProtection.notActiveWords.replace(/\{name\}/g, config.assistantName);
}

/** An Ambassador's check code: six letters and numbers that are easy to read out. */
export const CHECK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CHECK_CODE_PATTERN = /^[A-Z2-9]{6}$/;

/** A code as typed: capitals, no spaces or dashes. */
export function tidyCheckCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Where a page may send somebody on after the check: a path on this site only, never another
 * site. Anything else is null.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  if (/[\s<>"']/.test(next)) return null;
  return next.slice(0, 300);
}

/**
 * The link every printed QR code carries: the check page, then on to `next` (the sign-up, the
 * shop's page) once the check shows the Ambassador is active.
 */
export function checkLink(origin: string, code: string, next?: string | null): string {
  const path = safeNextPath(next ?? null);
  return `${origin}/ambassador/check/${encodeURIComponent(code)}${path ? `?next=${encodeURIComponent(path)}` : ''}`;
}

/** The two staff links for a business, filled in from the settings' templates. */
export function businessCheckLinks(
  settings: Pick<AmbassadorProtectionSettings, 'companiesHouseSearch' | 'hygieneRatingSearch'>,
  business: { name: string; postcode: string },
): { companiesHouse: string; hygieneRating: string } {
  const fill = (template: string): string =>
    template
      .replace(/\{name\}/g, encodeURIComponent(business.name.trim()))
      .replace(/\{postcode\}/g, encodeURIComponent(business.postcode.trim()));
  return {
    companiesHouse: fill(settings.companiesHouseSearch),
    hygieneRating: fill(settings.hygieneRatingSearch),
  };
}

/* ------------------------------------------------------------------ fake orders */

/** A UK postcode found in an address, tidied: "ME71ER". */
function postcodeIn(address: string): string | null {
  const found = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(address);
  return found ? `${found[1]}${found[2]}`.toUpperCase() : null;
}

function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether two delivery addresses are the same place: the same words, or the same first line and
 * the same postcode. "1 High Street" is never "11 High Street".
 */
export function sameAddress(
  one: string | null | undefined,
  other: string | null | undefined,
): boolean {
  const a = (one ?? '').trim();
  const b = (other ?? '').trim();
  if (a === '' || b === '') return false;
  if (letters(a) !== '' && letters(a) === letters(b)) return true;
  const postcodeA = postcodeIn(a);
  if (!postcodeA || postcodeA !== postcodeIn(b)) return false;
  const first = (text: string): string => letters(text.split(/[,\n]/)[0] ?? '');
  return first(a) !== '' && first(a) === first(b);
}
