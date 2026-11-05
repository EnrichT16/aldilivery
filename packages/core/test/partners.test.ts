/**
 * Partners (ruling 65): the pure rules for the free listings, Partner Plus, no café commission,
 * the kinds of service never listed, and a shop's area from its postcode.
 */

import { describe, expect, it } from 'vitest';

import {
  basisPointsWords,
  effectivePlan,
  excludedServiceKind,
  excludedServiceWords,
  freeListingAvailable,
  paidPlan,
  planLimits,
  planMonthlyPence,
  postcodeArea,
  productLimit,
  unitPrice,
  unitPriceWords,
  unitQuantityWords,
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
    // Ruling 96 (5 November 2026): Shop Partner Pro at £29.99 is the one £29.99 figure.
    expect(pricing.proMonthlyPence).toBe(2999);
    expect(pricing.plans.plus.name).toBe('Shop Partner Plus');
    expect(pricing.plans.pro.name).toBe('Shop Partner Pro');
  });

  it('gives each package what Anthony ruled (ruling 96)', () => {
    expect(pricing.plans.free).toEqual(
      expect.objectContaining({
        products: 10,
        photosPerProduct: 1,
        variants: false,
        featured: false,
        bulkAdd: false,
        runnerCalls: false,
        approvalPriority: 'normal',
      }),
    );
    expect(pricing.plans.plus).toEqual(
      expect.objectContaining({
        products: 300,
        photosPerProduct: 3,
        variants: true,
        featured: false,
        bulkAdd: false,
        runnerCalls: true,
        approvalPriority: 'normal',
      }),
    );
    expect(pricing.plans.pro).toEqual(
      expect.objectContaining({
        products: 3000,
        photosPerProduct: 6,
        variants: true,
        featured: true,
        bulkAdd: true,
        runnerCalls: true,
        approvalPriority: 'high',
      }),
    );
    expect(planMonthlyPence('free', pricing)).toBe(0);
    expect(planMonthlyPence('plus', pricing)).toBe(1499);
    expect(planMonthlyPence('pro', pricing)).toBe(2999);
  });

  it('refuses packages whose figures contradict each other', () => {
    const raw = JSON.parse(JSON.stringify(config)) as {
      extras: { partners: { plans: Record<string, Record<string, unknown>> } };
    };
    raw.extras.partners.plans.free!.products = 11;
    expect(() => parseStoreConfig(raw)).toThrow(/must equal extras.partners.freeProductLimit/);
    const again = JSON.parse(JSON.stringify(config)) as typeof raw;
    again.extras.partners.plans.plus!.products = 5000;
    expect(() => parseStoreConfig(again)).toThrow(/at least as many products/);
    const priority = JSON.parse(JSON.stringify(config)) as typeof raw;
    priority.extras.partners.plans.pro!.approvalPriority = 'urgent';
    expect(() => parseStoreConfig(priority)).toThrow(/approvalPriority must be normal or high/);
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

  it('caps a shop at its package’s products: Free 10, Plus 300, Pro 3000, and lapsed is Free (ruling 96)', () => {
    expect(productLimit({ kind: 'shop', plan: 'free', plusPaid: false }, pricing)).toBe(10);
    expect(productLimit({ kind: 'shop', plan: 'plus', plusPaid: false }, pricing)).toBe(10);
    expect(productLimit({ kind: 'shop', plan: 'plus', plusPaid: true }, pricing)).toBe(300);
    expect(productLimit({ kind: 'shop', plan: 'pro', plusPaid: true }, pricing)).toBe(3000);
    expect(productLimit({ kind: 'shop', plan: 'pro', plusPaid: false }, pricing)).toBe(10);
    // A café, takeaway or service lists its menu or services without a count, as before.
    expect(productLimit({ kind: 'food', plan: 'free', plusPaid: false }, pricing)).toBeNull();
    expect(productLimit({ kind: 'service', plan: 'free', plusPaid: false }, pricing)).toBeNull();
    expect(productLimit({ kind: 'food', plan: 'pro', plusPaid: true }, pricing)).toBeNull();
  });

  it('gives the package’s limits, and Free’s when a paid one has lapsed', () => {
    expect(effectivePlan({ plan: 'pro', plusPaid: true })).toBe('pro');
    expect(effectivePlan({ plan: 'pro', plusPaid: false })).toBe('free');
    expect(effectivePlan({ plan: 'free', plusPaid: true })).toBe('free');
    expect(planLimits({ kind: 'shop', plan: 'free', plusPaid: false }, pricing)).toEqual(
      expect.objectContaining({ products: 10, photosPerProduct: 1, variants: false }),
    );
    expect(planLimits({ kind: 'shop', plan: 'plus', plusPaid: true }, pricing)).toEqual(
      expect.objectContaining({ products: 300, photosPerProduct: 3, variants: true, bulkAdd: false }),
    );
    expect(planLimits({ kind: 'shop', plan: 'pro', plusPaid: true }, pricing)).toEqual(
      expect.objectContaining({
        products: 3000,
        photosPerProduct: 6,
        featured: true,
        bulkAdd: true,
        approvalPriority: 'high',
      }),
    );
    // Lapsed Pro: one photo and ten products, like Free. Nothing is deleted; the rest is hidden.
    expect(planLimits({ kind: 'shop', plan: 'pro', plusPaid: false }, pricing)).toEqual(
      expect.objectContaining({ products: 10, photosPerProduct: 1, featured: false }),
    );
    // A café keeps photos on its menu with no count; a Preferred Partner has Plus paid for it.
    expect(planLimits({ kind: 'food', plan: 'free', plusPaid: false }, pricing)).toEqual(
      expect.objectContaining({ products: null, photosPerProduct: 3 }),
    );
    expect(planLimits({ kind: 'food', plan: 'pro', plusPaid: true }, pricing)).toEqual(
      expect.objectContaining({ products: null, photosPerProduct: 6, bulkAdd: true }),
    );
    expect(paidPlan('free')).toBe(false);
    expect(paidPlan('pro')).toBe(true);
  });

  it('works the unit price the Price Marking Order asks for', () => {
    const pounds = (pence: number) => formatPence(pence, '£');
    expect(unitPrice(240, 500, 'g')).toEqual({ pence: 480, per: 'kg' });
    expect(unitPrice(300, 1.5, 'kg')).toEqual({ pence: 200, per: 'kg' });
    expect(unitPrice(99, 330, 'ml')).toEqual({ pence: 300, per: 'litre' });
    expect(unitPrice(180, 2, 'l')).toEqual({ pence: 90, per: 'litre' });
    expect(unitPrice(240, 6, 'each')).toEqual({ pence: 40, per: 'each' });
    expect(unitPrice(400, 4, 'pack')).toEqual({ pence: 100, per: 'item' });
    expect(unitPrice(400, 0, 'g')).toBeNull();
    expect(unitPrice(0, 100, 'g')).toBeNull();
    expect(unitPriceWords({ pence: 480, per: 'kg' }, pounds)).toBe('£4.80 per kg');
    expect(unitPriceWords({ pence: 40, per: 'each' }, pounds)).toBe('£0.40 each');
    expect(unitQuantityWords(500, 'g')).toBe('500 g');
    expect(unitQuantityWords(1.5, 'kg')).toBe('1.5 kg');
    expect(unitQuantityWords(4, 'pack')).toBe('4 in a pack');
    expect(unitQuantityWords(6, 'each')).toBe('6 each');
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
