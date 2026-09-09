/**
 * The starting data: an everyday grocery catalogue, one Shopper and two Runners.
 *
 * Used in two places. `prisma/seed.ts` writes it into PostgreSQL, and the API writes it
 * into the in-memory backend at startup so that the shell can be walked through on a
 * machine with no database at all.
 *
 * These are grocery items, not any particular supermarket's products. Where the price
 * estimates come from is configuration, which is why `source` is passed in rather than
 * written here (Rule Nine).
 */

import type { StoreConfig } from '@aldilivery/core';

import type { CreateCatalogueItem, Repository } from './repository.js';

export function catalogueFor(config: StoreConfig): CreateCatalogueItem[] {
  const source = config.store.catalogueSource.mode;

  return [
    { name: 'Semi skimmed milk, 2 pints', category: 'Dairy', estimatedPricePence: 125, source },
    { name: 'Whole milk, 4 pints', category: 'Dairy', estimatedPricePence: 175, source },
    { name: 'Salted butter, 250g', category: 'Dairy', estimatedPricePence: 189, source },
    { name: 'Mature cheddar, 400g', category: 'Dairy', estimatedPricePence: 285, source },
    { name: 'Large free range eggs, 6', category: 'Dairy', estimatedPricePence: 165, source },
    { name: 'White sliced bread, 800g', category: 'Bakery', estimatedPricePence: 89, source },
    { name: 'Wholemeal loaf, 800g', category: 'Bakery', estimatedPricePence: 95, source },
    {
      name: 'Bananas, loose, per kilogram',
      category: 'Fruit and vegetables',
      estimatedPricePence: 84,
      source,
    },
    {
      name: 'Braeburn apples, 6 pack',
      category: 'Fruit and vegetables',
      estimatedPricePence: 145,
      source,
    },
    {
      name: 'Baking potatoes, 2.5kg',
      category: 'Fruit and vegetables',
      estimatedPricePence: 179,
      source,
    },
    { name: 'Carrots, 1kg', category: 'Fruit and vegetables', estimatedPricePence: 65, source },
    { name: 'Onions, 1kg', category: 'Fruit and vegetables', estimatedPricePence: 89, source },
    {
      name: 'Chicken breast fillets, 640g',
      category: 'Meat and fish',
      estimatedPricePence: 445,
      source,
    },
    { name: 'Beef mince 5% fat, 500g', category: 'Meat and fish', estimatedPricePence: 399, source },
    { name: 'Salmon fillets, 240g', category: 'Meat and fish', estimatedPricePence: 425, source },
    { name: 'Baked beans, 415g', category: 'Cupboard', estimatedPricePence: 45, source },
    { name: 'Chopped tomatoes, 400g', category: 'Cupboard', estimatedPricePence: 42, source },
    { name: 'Dried spaghetti, 500g', category: 'Cupboard', estimatedPricePence: 75, source },
    { name: 'Long grain rice, 1kg', category: 'Cupboard', estimatedPricePence: 135, source },
    { name: 'Tea bags, 80', category: 'Cupboard', estimatedPricePence: 189, source },
    { name: 'Instant coffee, 200g', category: 'Cupboard', estimatedPricePence: 349, source },
    { name: 'Digestive biscuits, 400g', category: 'Cupboard', estimatedPricePence: 99, source },
    { name: 'Porridge oats, 1kg', category: 'Cupboard', estimatedPricePence: 145, source },
    { name: 'Toilet roll, 9 pack', category: 'Household', estimatedPricePence: 335, source },
    { name: 'Washing up liquid, 900ml', category: 'Household', estimatedPricePence: 115, source },
    { name: 'Laundry liquid, 1.5 litre', category: 'Household', estimatedPricePence: 349, source },
    { name: 'Paracetamol, 16 tablets', category: 'Health', estimatedPricePence: 39, source },

    // Rule Six. Present on purpose, so the refusal can be seen working. It must never appear
    // in a search result and must never reach a basket.
    {
      name: 'Bottle of red wine, 75cl',
      category: 'Alcohol',
      estimatedPricePence: 549,
      ageRestricted: true,
      source,
    },
  ];
}

export interface SeedResult {
  catalogueItems: number;
  shoppers: number;
  runners: number;
  alreadySeeded: boolean;
}

/** Fill an empty repository with something to look at. Does nothing if it is not empty. */
export async function seedRepository(
  repository: Repository,
  config: StoreConfig,
  options: { withPeople?: boolean } = {},
): Promise<SeedResult> {
  const existing = await repository.catalogue.search('', {
    includeAgeRestricted: true,
    limit: 1,
  });
  if (existing.length > 0) {
    return { catalogueItems: 0, shoppers: 0, runners: 0, alreadySeeded: true };
  }

  const items = catalogueFor(config);
  for (const item of items) {
    await repository.catalogue.create(item);
  }

  if (options.withPeople === false) {
    return { catalogueItems: items.length, shoppers: 0, runners: 0, alreadySeeded: false };
  }

  await repository.shoppers.create({
    displayName: 'Margaret',
    handle: 'margaret',
    phone: '+447700900001',
    doorstepProtocol:
      'Knock loudly and wait. I am slow to the door. Please leave the bags on the step.',
    substitutionDefault: 'ask_me',
  });

  await repository.runners.create({
    name: 'Tomasz',
    phone: '+447700900101',
    vehicleType: 'car',
    rightToWorkVerified: true,
    criminalRecordCheckVerified: true,
    available: true,
    latitude: 52.4862,
    longitude: -1.8904,
  });

  await repository.runners.create({
    name: 'Ayesha',
    phone: '+447700900102',
    vehicleType: 'bicycle',
    rightToWorkVerified: true,
    criminalRecordCheckVerified: true,
    available: true,
    latitude: 52.4795,
    longitude: -1.9026,
  });

  return { catalogueItems: items.length, shoppers: 1, runners: 2, alreadySeeded: false };
}
