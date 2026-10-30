/**
 * Partners (ruling 65): the pure rules for the free listings, Partner Plus, no café commission,
 * the kinds of service never listed, and a shop's area from its postcode.
 */

import { describe, expect, it } from 'vitest';

import {
  basisPointsWords,
  excludedServiceKind,
  excludedServiceWords,
  freeListingAvailable,
  postcodeArea,
  productLimit,
} from '../src/partners.js';
import { parseStoreConfig } from '../src/config.js';
import { formatPence } from '../src/money.js';
import { ORGANISATION_CONSENT_VERSION, organisationConsentWords } from '../src/organisations.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const pricing = config.extras.partners;

describe('the partner pricing in config/store.json', () => {
  it('is the pricing Anthony ruled: 100 free listings of 10 products, Plus at £14.99, no commission for food', () => {
    expect(pricing).toEqual(
      expect.objectContaining({
        freeListingCount: 100,
        freeProductLimit: 10,
        plusMonthlyPence: 1499,
        plusFirstMonthFree: true,
      }),
    );
    // The 10% café commission was replaced by an optional discount (Anthony, 30 October 2026).
    expect(pricing).not.toHaveProperty('foodCommissionBasisPoints');
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
  it('says a share in basis points plainly', () => {
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

describe('what a person agrees to when linking to an organisation (30 October 2026)', () => {
  const money = (pence: number): string => formatPence(pence, '£');
  const words = organisationConsentWords(
    'Medway Care',
    config.extras.organisations,
    config.fees,
    money,
  );

  it('lists exactly what is shared, from now on only', () => {
    expect(words.intro).toBe('Linking lets Medway Care see:');
    expect(words.shared).toEqual([
      'your name',
      'the office label they give you, saying which office or team looks after you',
      'the weekly shops you have booked',
      'the orders you place from now on, and what each one costs',
    ]);
    expect(words.notShared).toMatch(/never see orders from before you link/);
  });

  it('says the organisation pays its own fee, and the delivery is the Membership price, from config', () => {
    expect(words.fee).toBe(
      'Medway Care pays us its own fee for you, £10.00 a month. You still pay for your own shopping.',
    );
    expect(words.delivery).toMatch(/^Your delivery becomes the Membership price: £7\.99/);
  });

  it('says who may agree, and has a version for the record', () => {
    expect(words.authority).toBe(
      'Only you, or someone with legal authority to act for you, such as a Lasting Power of Attorney, may agree to this.',
    );
    expect(words.tick).toBe('I agree that Medway Care will see these things from now on.');
    expect(ORGANISATION_CONSENT_VERSION).toMatch(/^organisation-consent-\d{4}-\d{2}-\d{2}$/);
  });
});
