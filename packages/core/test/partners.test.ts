/**
 * Partners (ruling 65): the pure rules for the free listings, Partner Plus, a café's commission,
 * the kinds of service never listed, and a shop's area from its postcode.
 */

import { describe, expect, it } from 'vitest';

import {
  basisPointsWords,
  commissionPence,
  excludedServiceKind,
  excludedServiceWords,
  freeListingAvailable,
  postcodeArea,
  productLimit,
} from '../src/partners.js';
import { parseStoreConfig } from '../src/config.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const pricing = config.extras.partners;

describe('the partner pricing in config/store.json', () => {
  it('is the pricing Anthony ruled: 100 free listings of 10 products, Plus at £14.99, 10% for food', () => {
    expect(pricing).toEqual(
      expect.objectContaining({
        freeListingCount: 100,
        freeProductLimit: 10,
        plusMonthlyPence: 1499,
        plusFirstMonthFree: true,
        foodCommissionBasisPoints: 1000,
      }),
    );
    expect(pricing.excludedServiceKinds).toEqual(
      expect.arrayContaining(['credit', 'loans', 'mortgages', 'insurance', 'financial advice']),
    );
    // The old £29.99 plan is gone everywhere.
    expect(JSON.stringify(config)).not.toContain('2999');
  });

  it('refuses a list of excluded kinds that is not a list of words', () => {
    const raw = JSON.parse(JSON.stringify(config)) as {
      extras: { partners: { excludedServiceKinds: unknown } };
    };
    raw.extras.partners.excludedServiceKinds = 'loans';
    expect(() => parseStoreConfig(raw)).toThrow(/excludedServiceKinds must be a list/);
  });
});

describe('the rules', () => {
  it('works out a café’s commission to the penny', () => {
    expect(commissionPence(1250, 1000)).toBe(125);
    expect(commissionPence(999, 1000)).toBe(100);
    expect(commissionPence(0, 1000)).toBe(0);
    expect(basisPointsWords(1000)).toBe('10%');
    expect(basisPointsWords(1250)).toBe('12.5%');
  });

  it('gives the first free listings and then no more', () => {
    expect(freeListingAvailable(0, pricing)).toBe(true);
    expect(freeListingAvailable(99, pricing)).toBe(true);
    expect(freeListingAvailable(100, pricing)).toBe(false);
  });

  it('caps a free shop at the configured products, and nobody else', () => {
    expect(productLimit({ kind: 'shop', plan: 'free', plusPaid: false }, pricing)).toBe(10);
    expect(productLimit({ kind: 'shop', plan: 'plus', plusPaid: false }, pricing)).toBe(10);
    expect(productLimit({ kind: 'shop', plan: 'plus', plusPaid: true }, pricing)).toBeNull();
    expect(productLimit({ kind: 'food', plan: 'free', plusPaid: false }, pricing)).toBeNull();
    expect(productLimit({ kind: 'service', plan: 'free', plusPaid: false }, pricing)).toBeNull();
  });

  it('finds an excluded kind of service as whole words, the most specific first', () => {
    const excluded = ['credit', 'loans', 'payday loans', 'mortgages', 'insurance'];
    expect(excludedServiceKind('Quick Payday Loans', excluded)).toBe('payday loans');
    expect(excludedServiceKind('Home and car insurance', excluded)).toBe('insurance');
    expect(excludedServiceKind("Tony's Barbers, on Sloane Street", excluded)).toBeNull();
    expect(excludedServiceKind('Credit-free dog walking', excluded)).toBe('credit');
    expect(excludedServiceWords('loans', config.productName)).toMatch(
      /cannot list loans, or anything that needs a licence from the FCA, the SRA or the MHRA/,
    );
  });

  it('reads the area from a postcode', () => {
    expect(postcodeArea('ME7 1ER')).toBe('ME7');
    expect(postcodeArea('me71er')).toBe('ME7');
    expect(postcodeArea('SW1A 1AA')).toBe('SW1A');
    expect(postcodeArea('')).toBe('');
  });
});
