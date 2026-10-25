/**
 * Browsing places by kind (ruling 82): the lists in `browse` in config/store.json, which section
 * a place is in, the chosen cuisines kept to the list, the search, the postcode nearness, and
 * what Ozi hears as a wish to browse.
 */

import { describe, expect, it } from 'vitest';

import {
  browseWords,
  chosenFrom,
  heardBrowse,
  matchesBrowseSearch,
  postcodeLetters,
  postcodeNearness,
  sectionOf,
} from '../src/browse.js';
import { parseStoreConfig } from '../src/config.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const browse = config.browse;

describe('the browse lists in config/store.json', () => {
  it('has the cuisines, shop specialities and service categories Anthony named', () => {
    expect(browse.cuisines).toEqual(
      expect.arrayContaining(['African', 'Caribbean', 'Indian', 'Middle Eastern', 'Polish']),
    );
    expect(browse.shopOrigins).toEqual(
      expect.arrayContaining(['African', 'Turkish', 'Eastern European', 'Chinese']),
    );
    expect(browse.serviceCategories).toEqual(
      expect.arrayContaining(['Plumber', 'Nanny and childminder', 'Cook and chef', 'Dog walker']),
    );
    expect(browse.ofstedCategories).toEqual(['Nanny and childminder']);
    expect(browse.joinAddress).toMatch(/\/business$/);
  });

  it('refuses a service category that is an excluded kind, and an Ofsted category not listed', () => {
    const raw = JSON.parse(JSON.stringify(config)) as {
      browse: { serviceCategories: string[]; ofstedCategories: string[] };
    };
    const bad = JSON.parse(JSON.stringify(raw)) as typeof raw;
    bad.browse.serviceCategories.push('Payday loans');
    expect(() => parseStoreConfig(bad)).toThrow(/never listed/);
    const odd = JSON.parse(JSON.stringify(raw)) as typeof raw;
    odd.browse.ofstedCategories = ['Juggler'];
    expect(() => parseStoreConfig(odd)).toThrow(/not in browse.serviceCategories/);
    const twice = JSON.parse(JSON.stringify(raw)) as typeof raw;
    twice.browse.serviceCategories.push('plumber');
    expect(() => parseStoreConfig(twice)).toThrow(/twice/);
  });
});

describe('the rules', () => {
  it('puts food in restaurants, a convenience shop in convenience, the rest by kind', () => {
    expect(sectionOf({ kind: 'food', convenience: false })).toBe('restaurants');
    expect(sectionOf({ kind: 'shop', convenience: false })).toBe('shops');
    expect(sectionOf({ kind: 'shop', convenience: true })).toBe('convenience');
    expect(sectionOf({ kind: 'service', convenience: false })).toBe('services');
  });

  it('keeps chosen words to the list, spelt as the list spells them, once each', () => {
    expect(
      chosenFrom(['middle eastern', 'AFRICAN', 'African', 'Martian'], browse.cuisines),
    ).toEqual({ chosen: ['African', 'Middle Eastern'], unknown: ['Martian'] });
  });

  it('searches names, words about the place and its tags, ignoring the asking', () => {
    const place = { name: 'Mama Joy', about: 'Jollof and suya.', tags: ['African'] };
    expect(matchesBrowseSearch(place, 'find an African restaurant near me')).toBe(true);
    expect(matchesBrowseSearch(place, 'jollof')).toBe(true);
    expect(matchesBrowseSearch(place, 'Thai')).toBe(false);
    expect(matchesBrowseSearch(place, '')).toBe(true);
    expect(matchesBrowseSearch({ name: 'Fix It', about: '', tags: ['Plumber'] }, 'plumbers')).toBe(
      true,
    );
  });

  it('orders by postcode: the same district, then the same area letters, then anywhere', () => {
    expect(postcodeLetters('ME7 1ER')).toBe('ME');
    expect(postcodeNearness('ME7 1ER', 'ME7 3PD')).toBe(0);
    expect(postcodeNearness('ME7 1ER', 'me8 0gx')).toBe(1);
    expect(postcodeNearness('ME7 1ER', 'DA1 1AA')).toBe(2);
    expect(postcodeNearness('', 'ME7 1AA')).toBe(2);
  });

  it('hears a wish to browse, and leaves shopping alone', () => {
    expect(heardBrowse('find an African restaurant', browse)).toEqual({
      section: 'restaurants',
      filter: 'African',
    });
    expect(heardBrowse('Turkish shop near me', browse)).toEqual({
      section: 'shops',
      filter: 'Turkish',
    });
    expect(heardBrowse('find a plumber', browse)).toEqual({
      section: 'services',
      filter: 'Plumber',
    });
    expect(heardBrowse('show me the convenience stores', browse)).toEqual({
      section: 'convenience',
      filter: null,
    });
    expect(heardBrowse('get me some kitchen cleaner', browse)).toBeNull();
    expect(heardBrowse('two pints of milk', browse)).toBeNull();
    expect(heardBrowse('is there a barber on Ozi', browse)).toBeNull();
  });

  it('names what is browsed in plain words', () => {
    expect(browseWords('restaurants', 'African')).toBe('African restaurants');
    expect(browseWords('services', 'Plumber')).toBe('plumber services');
    expect(browseWords('convenience', null)).toBe('convenience stores');
  });
});
