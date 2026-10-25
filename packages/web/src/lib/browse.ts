/**
 * The four pages for browsing places (ruling 82): Restaurants, Shops, Convenience stores and
 * Services, each with its own address so it can be printed on a flyer. The cuisines, shop
 * specialities and service categories come from `browse` in config/store.json, never from here.
 */

import { storeConfig } from '../config';
import type { BrowseSection, ShopsQuery } from './api';

export interface BrowseFilter {
  /** The address's and the API's name for it: /restaurants?cuisine=African. */
  param: 'cuisine' | 'speciality' | 'category';
  /** The button at the top right that opens the list. */
  button: string;
  /** The list's heading, said by a screen reader as the list opens. */
  heading: string;
  list: readonly string[];
}

export interface BrowseInfo {
  section: BrowseSection;
  path: string;
  /** The word on the tab and the tile. */
  tab: string;
  heading: string;
  emoji: string;
  /** One line under the heading. */
  about: string;
  /** What the places are called in a sentence: "restaurants", "convenience stores". */
  noun: string;
  filter: BrowseFilter | null;
}

export const BROWSE: Record<BrowseSection, BrowseInfo> = {
  restaurants: {
    section: 'restaurants',
    path: '/restaurants',
    tab: 'Restaurants',
    heading: 'Restaurants, cafés and takeaways',
    emoji: '🍽️',
    about: 'The restaurants, cafés and takeaways we have an agreement with.',
    noun: 'restaurants',
    filter: {
      param: 'cuisine',
      button: 'Country and continental',
      heading: 'Cuisines',
      list: storeConfig.browse.cuisines,
    },
  },
  shops: {
    section: 'shops',
    path: '/shops',
    tab: 'Shops',
    heading: 'Shops',
    emoji: '🛍️',
    about: 'Local shops we have an agreement with, and well-known shops we list ourselves.',
    noun: 'shops',
    filter: {
      param: 'speciality',
      button: 'Country and continental',
      heading: 'Shop specialities',
      list: storeConfig.browse.shopOrigins,
    },
  },
  convenience: {
    section: 'convenience',
    path: '/convenience',
    tab: 'Convenience stores',
    heading: 'Convenience stores',
    emoji: '🏪',
    about: 'Corner shops, convenience stores and mini-markets.',
    noun: 'convenience stores',
    filter: null,
  },
  services: {
    section: 'services',
    path: '/services',
    tab: 'Services',
    heading: 'Services',
    emoji: '🧰',
    about: 'People and businesses who come to you: ask them for a quote or a call back.',
    noun: 'services',
    filter: {
      param: 'category',
      button: 'Kinds of service',
      heading: 'Kinds of service',
      list: storeConfig.browse.serviceCategories,
    },
  },
};

export const BROWSE_ORDER: BrowseSection[] = ['restaurants', 'shops', 'convenience', 'services'];

/** The postcode in a delivery address, or ''. */
export function postcodeIn(address: string): string {
  const match = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i.exec(address);
  return match ? `${match[1]} ${match[2]}`.toUpperCase() : '';
}

/** The entry of a list a word names, spelt as the list spells it, or ''. */
export function listEntry(list: readonly string[], value: string): string {
  const wanted = value.trim().toLowerCase();
  return list.find((entry) => entry.toLowerCase() === wanted) ?? '';
}

/** The page's address with its filter: /restaurants?cuisine=African. */
export function browsePath(section: BrowseSection, filter: string | null): string {
  const info = BROWSE[section];
  if (!filter || !info.filter) return info.path;
  return `${info.path}?${new URLSearchParams({ [info.filter.param]: filter }).toString()}`;
}

/** What the API is asked for a section and its filter. */
export function browseQuery(
  section: BrowseSection,
  filter: string,
  extra: Pick<ShopsQuery, 'q' | 'near'> = {},
): ShopsQuery {
  const info = BROWSE[section];
  return {
    section,
    ...(info.filter && filter ? { [info.filter.param]: filter } : {}),
    ...extra,
  };
}

/** "African restaurants", "plumber services", "convenience stores": in a sentence. */
export function browseNoun(section: BrowseSection, filter: string): string {
  const info = BROWSE[section];
  if (!filter) return info.noun;
  return section === 'services' ? `${filter.toLowerCase()} services` : `${filter} ${info.noun}`;
}

/** The honest, encouraging words when nothing is listed yet (ruling 82). */
export function emptyWords(section: BrowseSection, filter: string, search: string): string {
  const where = storeConfig.assistantName;
  const join = `Know one? Tell them to join at ${storeConfig.browse.joinAddress}`;
  if (search.trim() !== '') {
    return `Nothing on ${where} matches “${search.trim()}” in ${browseNoun(section, filter)} yet. ${join}`;
  }
  return `No ${browseNoun(section, filter)} on ${where} yet. ${join}`;
}
