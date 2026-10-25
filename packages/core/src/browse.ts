/**
 * Browsing places by kind (ruling 82, 25 October 2026): Restaurants, Shops, Convenience stores
 * and Services, each its own page, with the cuisines, shop specialities and service categories
 * a place chooses from the lists in `browse` in `config/store.json`, never from code. The pure
 * rules live here: which section a place is in, which of the listed words it chose, whether a
 * search finds it, and how near it is, by postcode district.
 */

import type { PartnerKind } from './partners.js';
import { postcodeArea } from './partners.js';

/** The four pages a Shopper browses places on, each with its own address. */
export const BROWSE_SECTIONS = ['restaurants', 'shops', 'convenience', 'services'] as const;
export type BrowseSection = (typeof BROWSE_SECTIONS)[number];

export interface BrowseSettings {
  /** What a restaurant, café or takeaway cooks: "African", "Caribbean", "Indian" and so on. */
  readonly cuisines: readonly string[];
  /** What a shop specialises in: "African", "Turkish", "Eastern European" and so on. */
  readonly shopOrigins: readonly string[];
  /** The kinds of service: "Plumber", "Electrician", "Nanny and childminder" and so on. */
  readonly serviceCategories: readonly string[];
  /** Service categories whose providers must be registered with Ofsted (childminders). */
  readonly ofstedCategories: readonly string[];
  /** Where a business joins, as it is printed for people: "example.co.uk/business". */
  readonly joinAddress: string;
}

/** The section a place is listed in: food is a restaurant, a shop marked convenience is one. */
export function sectionOf(place: { kind: PartnerKind; convenience: boolean }): BrowseSection {
  if (place.kind === 'food') return 'restaurants';
  if (place.kind === 'service') return 'services';
  return place.convenience ? 'convenience' : 'shops';
}

/** Lower case, letters and digits only, single spaces: how words are compared here. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The entries of a configured list a place chose, spelt as the list spells them, and anything
 * chosen that is not on the list. Case and spacing do not matter; each entry is kept once.
 */
export function chosenFrom(
  values: readonly string[],
  list: readonly string[],
): { chosen: string[]; unknown: string[] } {
  const chosen: string[] = [];
  const unknown: string[] = [];
  for (const value of values) {
    if (plain(value) === '') continue;
    const match = list.find((entry) => plain(entry) === plain(value));
    if (!match) unknown.push(value.trim());
    else if (!chosen.includes(match)) chosen.push(match);
  }
  // In the order of the list, so every page reads them the same way.
  chosen.sort((a, b) => list.indexOf(a) - list.indexOf(b));
  return { chosen, unknown };
}

/** The letters a postcode starts with ("ME7 1ER" gives "ME"), its postcode area. */
export function postcodeLetters(postcode: string): string {
  const district = postcodeArea(postcode);
  return /^[A-Z]{1,2}/.exec(district)?.[0] ?? '';
}

/**
 * How near a place is, by postcode alone (no table of places is kept): 0 in the same district
 * ("ME7" and "ME7"), 1 in the same area ("ME7" and "ME8"), 2 anywhere else or not known.
 */
export function postcodeNearness(from: string, to: string): 0 | 1 | 2 {
  if (from.trim() === '' || to.trim() === '') return 2;
  const a = postcodeArea(from);
  const b = postcodeArea(to);
  if (a !== '' && a === b) return 0;
  const letters = postcodeLetters(from);
  if (letters !== '' && letters === postcodeLetters(to)) return 1;
  return 2;
}

/** Words a search ignores: the asking, and the section's own name, which the page already is. */
const SEARCH_FILLER = new Set([
  'a',
  'an',
  'the',
  'any',
  'some',
  'me',
  'my',
  'i',
  'find',
  'show',
  'search',
  'for',
  'looking',
  'look',
  'want',
  'need',
  'near',
  'nearby',
  'close',
  'to',
  'in',
  'on',
  'around',
  'here',
  'please',
  'restaurant',
  'restaurants',
  'cafe',
  'cafes',
  'takeaway',
  'takeaways',
  'shop',
  'shops',
  'store',
  'stores',
  'service',
  'services',
  'place',
  'places',
]);

/** "plumbers" is "plumber", "takeaways" is "takeaway"; short words and "ss" are left alone. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** The words of a search that mean something, singular. Empty when it asks for everything. */
export function searchWords(query: string): string[] {
  return plain(query)
    .split(' ')
    .filter((word) => word !== '' && !SEARCH_FILLER.has(word))
    .map(singular);
}

/**
 * Whether a search finds a place: every meaningful word of it begins a word in the place's
 * name, its words about itself, or its cuisines, specialities or categories.
 */
export function matchesBrowseSearch(
  place: { name: string; about: string; tags: readonly string[] },
  query: string,
): boolean {
  const wanted = searchWords(query);
  if (wanted.length === 0) return true;
  const words = plain(`${place.name} ${place.about} ${place.tags.join(' ')}`)
    .split(' ')
    .map(singular);
  return wanted.every((want) => words.some((word) => word.startsWith(want)));
}

/** What Ozi heard a Shopper ask to browse: a section, and the cuisine, speciality or category. */
export interface HeardBrowse {
  section: BrowseSection;
  /** The configured cuisine, speciality or category, spelt as the list spells it. */
  filter: string | null;
}

/** Each entry's own words of four letters or more ("Door and window fitter": door, window, fitter). */
function entryWords(entry: string): string[] {
  return plain(entry)
    .split(' ')
    .filter((word) => word.length >= 4 && word !== 'and');
}

/** The entry of a list named in what was said, longest first ("Middle Eastern" before "Eastern"). */
function namedEntry(said: string, list: readonly string[]): string | null {
  const padded = ` ${said} `;
  const found = [...list]
    .sort((a, b) => plain(b).length - plain(a).length)
    .find((entry) => plain(entry) !== '' && padded.includes(` ${plain(entry)} `));
  return found ?? null;
}

// "Is there a barber on Ozi?" is a question the phrase book answers (ruling 65), not browsing.
const ASKING =
  /\b(find|show|search|look(ing)? for|want|need|get me|take me to|go to|open|list|book)\b/;
const NEAR = /\b(near me|nearby|near here|round here|around here|close by|local)\b/;

/**
 * "Find an African restaurant", "Turkish shop near me", "find a plumber", "show me the
 * convenience stores": what to browse, from the configured lists, or null when the words are
 * not about places at all (so "get me some kitchen cleaner" stays shopping).
 */
export function heardBrowse(text: string, browse: BrowseSettings): HeardBrowse | null {
  const said = plain(text);
  if (said === '') return null;
  const asking = ASKING.test(said) || NEAR.test(said);
  const words = ` ${said} `;

  // A cuisine with a word for eating out: "an African restaurant", "Indian takeaway".
  const eating = /\b(restaurants?|takeaways?|take aways?|cafes?|places? to eat|food near)\b/;
  if (eating.test(said)) {
    return { section: 'restaurants', filter: namedEntry(said, browse.cuisines) };
  }
  if (/\b(convenience stores?|convenience shops?|corner shops?|mini ?markets?)\b/.test(said)) {
    return { section: 'convenience', filter: null };
  }
  // A speciality with a word for a shop: "Turkish shop", "Polish grocer".
  const shopping = /\b(shops?|stores?|grocers?|grocery|supermarkets?)\b/;
  const origin = namedEntry(said, browse.shopOrigins);
  if (origin && shopping.test(said)) return { section: 'shops', filter: origin };

  // A service category, asked for as one thing ("a plumber", "an electrician near me").
  for (const category of browse.serviceCategories) {
    const named = entryWords(category).some(
      (word) =>
        new RegExp(`\\b(a|an|the) ${word}s?\\b`).test(said) ||
        new RegExp(`\\b${word}s? (near me|nearby|near here|round here|around here)\\b`).test(said),
    );
    if (named && asking) return { section: 'services', filter: category };
  }
  if (asking && /\bservices\b/.test(words)) return { section: 'services', filter: null };
  if (
    asking &&
    /\b(local )?shops\b/.test(said) &&
    /\b(show|open|list|go to|take me to)\b/.test(said)
  ) {
    return { section: 'shops', filter: null };
  }
  return null;
}

/** "African restaurants", "Turkish shops", "plumber services", "convenience stores": for the screen. */
export function browseWords(section: BrowseSection, filter: string | null): string {
  const noun: Record<BrowseSection, string> = {
    restaurants: 'restaurants',
    shops: 'shops',
    convenience: 'convenience stores',
    services: 'services',
  };
  if (!filter) return noun[section];
  if (section === 'services') return `${filter.toLowerCase()} services`;
  return `${filter} ${noun[section]}`;
}
