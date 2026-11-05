/**
 * The Shop Partner catalogue (ruling 96, 5 November 2026): the taxonomy and what each category
 * requires, the fourteen allergens, the photo rules in plain words, and the unit words in a
 * spoken order ("five bunches of bananas").
 */

import { describe, expect, it } from 'vitest';

import {
  allergenWords,
  categoriesFor,
  categoryById,
  missingDetails,
  photoFeedback,
  unknownAllergens,
} from '../src/catalogue.js';
import { parseStoreConfig } from '../src/config.js';
import { loadStoreConfig } from '../src/node.js';
import { parseQuantity, parseSpokenItem } from '../src/spoken-order.js';

const config = loadStoreConfig();
const catalogue = config.catalogue;

describe('the taxonomy in config/store.json', () => {
  it('has categories for shops, restaurants and services, each with its required details', () => {
    expect(categoriesFor('shop', catalogue).map((c) => c.name)).toEqual(
      expect.arrayContaining(['Fruit and vegetables', 'Bakery', 'Dairy and eggs', 'Drinks']),
    );
    expect(categoriesFor('food', catalogue).map((c) => c.name)).toEqual(
      expect.arrayContaining(['Starters', 'Mains', 'Desserts']),
    );
    expect(categoriesFor('service', catalogue).length).toBeGreaterThan(0);
    expect(categoryById('fruit-veg', catalogue)?.requires).toEqual(['unit']);
    expect(categoryById('dairy-eggs', catalogue)?.requires).toEqual(['unit', 'allergens']);
    expect(categoryById('meat-fish', catalogue)?.requires).toContain('bestBefore');
    expect(categoryById('nothing', catalogue)).toBeNull();
    expect(catalogue.allergens).toHaveLength(14);
    expect(catalogue.allergens).toContain('Peanuts');
    expect(catalogue.units).toEqual(['g', 'kg', 'ml', 'l', 'each', 'pack']);
    expect(catalogue.descriptionMaxLength).toBe(600);
    expect(catalogue.photos).toEqual(
      expect.objectContaining({
        sizes: { thumb: 320, medium: 800, full: 1600 },
        minimumLongSide: 800,
        hardFloorLongSide: 500,
      }),
    );
  });

  it('refuses a broken taxonomy', () => {
    const raw = JSON.parse(JSON.stringify(config)) as {
      catalogue: { categories: Array<Record<string, unknown>>; allergens: string[] };
    };
    raw.catalogue.categories[0]!.requires = ['colour'];
    expect(() => parseStoreConfig(raw)).toThrow(/requires\[0\] must be one of unit, allergens/);
    const twice = JSON.parse(JSON.stringify(config)) as typeof raw;
    twice.catalogue.categories[1]!.id = twice.catalogue.categories[0]!.id;
    expect(() => parseStoreConfig(twice)).toThrow(/is used twice/);
    const thirteen = JSON.parse(JSON.stringify(config)) as typeof raw;
    thirteen.catalogue.allergens = thirteen.catalogue.allergens.slice(1);
    expect(() => parseStoreConfig(thirteen)).toThrow(/fourteen UK allergens/);
  });

  it('says which required details a product has not given', () => {
    const dairy = categoryById('dairy-eggs', catalogue)!;
    expect(
      missingDetails(dairy, {
        unitQuantity: null,
        unitKind: null,
        allergens: null,
        expiresOn: null,
      }).map((m) => m.detail),
    ).toEqual(['unit', 'allergens']);
    // An empty list of allergens is "none", which is an answer.
    expect(
      missingDetails(dairy, { unitQuantity: 500, unitKind: 'ml', allergens: [], expiresOn: null }),
    ).toEqual([]);
    const meat = categoryById('meat-fish', catalogue)!;
    expect(
      missingDetails(meat, { unitQuantity: 1, unitKind: 'kg', allergens: [], expiresOn: null })
        .map((m) => m.words)
        .join(' '),
    ).toMatch(/best before or use by date/);
    expect(unknownAllergens(['Milk', 'Gluten'], catalogue)).toEqual(['Gluten']);
    expect(allergenWords(null)).toBeNull();
    expect(allergenWords([])).toBe('No listed allergens');
    expect(allergenWords(['Milk'])).toBe('Contains milk');
    expect(allergenWords(['Milk', 'Eggs', 'Tree nuts'])).toBe('Contains milk, eggs and tree nuts');
  });
});

describe('the photo rules', () => {
  const rules = catalogue.photos;
  const fine = { width: 1200, height: 900, brightness: 120, sharpness: 300 };

  it('accepts a clear, well-lit photo of a good size without a word', () => {
    expect(photoFeedback(fine, rules)).toBeNull();
  });

  it('refuses one too small to show, and warns about dark, bright, blurry or small ones', () => {
    expect(photoFeedback({ ...fine, width: 400, height: 300 }, rules)).toEqual({
      words: expect.stringMatching(/too small to show clearly \(400 pixels/),
      refused: true,
    });
    expect(photoFeedback({ ...fine, brightness: 20 }, rules)).toEqual({
      words: 'That photo is too dark. Try it near a window.',
      refused: false,
    });
    expect(photoFeedback({ ...fine, brightness: 240 }, rules)).toEqual({
      words: 'That photo is too bright. Move it out of direct light.',
      refused: false,
    });
    expect(photoFeedback({ ...fine, sharpness: 5 }, rules)).toEqual({
      words: 'That photo is blurry. Hold the phone still, then try again.',
      refused: false,
    });
    expect(photoFeedback({ ...fine, width: 700, height: 500 }, rules)).toEqual({
      words: expect.stringMatching(/small \(700 pixels/),
      refused: false,
    });
  });
});

describe('unit words in a spoken order', () => {
  it('hears how many and in what', () => {
    expect(parseSpokenItem('five bunches of bananas')).toEqual({
      quantity: 5,
      unit: 'bunch',
      item: 'bananas',
    });
    expect(parseSpokenItem('two packs of crisps')).toEqual({
      quantity: 2,
      unit: 'pack',
      item: 'crisps',
    });
    expect(parseSpokenItem('a kilo of apples')).toEqual({ quantity: 1, unit: 'kg', item: 'apples' });
    expect(parseSpokenItem('2 litres of milk')).toEqual({ quantity: 2, unit: 'l', item: 'milk' });
    expect(parseSpokenItem('three tins of beans')).toEqual({
      quantity: 3,
      unit: 'tin',
      item: 'beans',
    });
  });

  it('knows a dozen and half a dozen are counts', () => {
    expect(parseSpokenItem('half a dozen eggs')).toEqual({ quantity: 6, unit: null, item: 'eggs' });
    expect(parseSpokenItem('a dozen eggs')).toEqual({ quantity: 12, unit: null, item: 'eggs' });
    expect(parseSpokenItem('two dozen eggs')).toEqual({ quantity: 24, unit: null, item: 'eggs' });
    expect(parseSpokenItem('a couple of bananas')).toEqual({
      quantity: 2,
      unit: null,
      item: 'bananas',
    });
    expect(parseQuantity('half a dozen')).toBe(6);
    expect(parseQuantity('a dozen')).toBe(12);
  });

  it('keeps halves and plain items honest', () => {
    expect(parseSpokenItem('half a kilo of rice')).toEqual({
      quantity: 1,
      unit: '500 g',
      item: 'rice',
    });
    expect(parseSpokenItem('two bananas')).toEqual({ quantity: 2, unit: null, item: 'bananas' });
    expect(parseSpokenItem('bananas')).toEqual({ quantity: null, unit: null, item: 'bananas' });
    expect(parseSpokenItem('some bananas')).toEqual({ quantity: null, unit: null, item: 'bananas' });
    // "a" alone is "some", not a firm one.
    expect(parseSpokenItem('a loaf of bread')).toEqual({ quantity: 1, unit: 'loaf', item: 'bread' });
    expect(parseSpokenItem('a cabbage')).toEqual({ quantity: null, unit: null, item: 'cabbage' });
  });
});
