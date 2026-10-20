/**
 * Each item's picture matches its name (20 October 2026: "the picture of milk does not match the
 * name cheese"), not just its category.
 */

import { describe, expect, it } from 'vitest';

import { itemEmoji } from '../src/lib/shop-look';

describe('item pictures', () => {
  it.each([
    ['Mature cheddar, 400g', 'Dairy', '🧀'],
    ['Salted butter, 250g', 'Dairy', '🧈'],
    ['Semi skimmed milk, 2 pints', 'Dairy', '🥛'],
    ['Natural yoghurt, 500g', 'Dairy', '🥣'],
    ['Large free range eggs, 6', 'Dairy', '🥚'],
    ['Baking potatoes, 2.5kg', 'Fruit and vegetables', '🥔'],
    ['Bananas, loose, per kilogram', 'Fruit and vegetables', '🍌'],
    ['Braeburn apples, 6 pack', 'Fruit and vegetables', '🍎'],
    ['Carrots, 1kg', 'Fruit and vegetables', '🥕'],
    ['Chopped tomatoes, 400g', 'Cupboard', '🥫'],
    ['White sliced bread, 800g', 'Bakery', '🍞'],
    ['Box of milk chocolates, 200g', 'Cards and gifts', '🍫'],
    ['AA batteries, 4 pack', 'Everyday essentials', '🔋'],
    ['LED light bulb, bayonet', 'Everyday essentials', '💡'],
    ['USB phone charging cable', 'Everyday essentials', '🔌'],
    ['Toilet roll, 9 pack', 'Household', '🧻'],
    ['Washing up liquid, 900ml', 'Household', '🧴'],
    ['Birthday card', 'Cards and gifts', '💌'],
    ['Salmon fillets, 240g', 'Meat and fish', '🐟'],
    ['Beef mince 5% fat, 500g', 'Meat and fish', '🥩'],
    ['Something new', 'Bakery', '🍞'],
    ['Something else', 'Nowhere', '🛍️'],
  ])('%s is %s', (name, category, emoji) => {
    expect(itemEmoji(name, category)).toBe(emoji);
  });
});
