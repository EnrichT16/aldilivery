/**
 * Protections against Ambassadors misusing the name (Anthony, 31 October 2026): the payment
 * warning word for word from config, the partner's three lines, the welcome text, the check
 * page's links and onward paths, the staff links, matching addresses, and the settings parser.
 */

import { describe, expect, it } from 'vitest';

import {
  andList,
  businessCheckLinks,
  checkLink,
  freeJoiningWords,
  notActiveWords,
  parseStoreConfig,
  partnerCostLines,
  safeNextPath,
  sameAddress,
  welcomeTextWords,
} from '../src/index.js';
import { loadStoreConfig } from '../src/node.js';

const config = loadStoreConfig();
const money = (pence: number): string => `£${(pence / 100).toFixed(2)}`;

describe('the payment warning', () => {
  it('reads word for word, with the names from config', () => {
    expect(freeJoiningWords(config)).toBe(
      'Joining Ozi is always free. We never charge you to join. Paid extras are optional: Spotlight and Partner Plus. You only pay if you choose them. Never pay an Ambassador. All payments are made only inside the app.',
    );
    expect(config.ambassadorProtection.paidExtras).toEqual(['Spotlight', 'Partner Plus']);
  });

  it('follows the names in config', () => {
    const renamed = {
      ...config,
      assistantName: 'Ozzy',
      ambassadorProtection: { ...config.ambassadorProtection, paidExtras: ['A', 'B', 'C'] },
    };
    expect(freeJoiningWords(renamed)).toContain('Joining Ozzy is always free.');
    expect(freeJoiningWords(renamed)).toContain('Paid extras are optional: A, B and C.');
    expect(andList(['A'])).toBe('A');
  });

  it('is refused unless it says joining is free and never to pay an Ambassador', () => {
    const raw = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
    raw['ambassadorProtection'] = { freeJoiningWords: 'Pay us to join.' };
    expect(() => parseStoreConfig(raw)).toThrow(/Never pay an Ambassador/);
    raw['ambassadorProtection'] = { companiesHouseSearch: 'http://not-safe.example' };
    expect(() => parseStoreConfig(raw)).toThrow(/https address/);
    delete raw['ambassadorProtection'];
    expect(parseStoreConfig(raw).ambassadorProtection.confirmCodeMinutes).toBe(60);
  });
});

describe('the partner dashboard’s three lines and the welcome text', () => {
  it('says joining is free, how Preferred Partner is earned, and the paid extras’ prices', () => {
    const lines = partnerCostLines(config, money);
    expect(lines.joining).toBe('Joining: free.');
    expect(lines.preferred).toBe(
      `Preferred Partner: free. You earn it by giving Ozi a discount of ${config.restaurants.preferredDiscountPercent}% or more. It comes with free Partner Plus and a free Spotlight week each month.`,
    );
    expect(lines.extras).toBe(
      `Spotlight and Partner Plus: paid and optional (Spotlight ${money(config.extras.spotlightPence)} a month and Partner Plus ${money(config.extras.partners.plusMonthlyPence)} a month). You only pay if you choose them.`,
    );
  });

  it('welcomes a business with the warning, its terms in brief, and how to report', () => {
    const text = welcomeTextWords(config, { name: 'Mama Put', kind: 'food', plan: 'free' }, money);
    expect(text).toContain(freeJoiningWords(config));
    expect(text).toContain('no commission and no monthly fee');
    expect(text).toContain('"Report an Ambassador" in your partner dashboard');
    expect(text.startsWith(`${config.productName}: Welcome, Mama Put.`)).toBe(true);
    expect(welcomeTextWords(config, { name: 'X', kind: 'shop', plan: 'plus' }, money)).toContain(
      money(config.extras.partners.plusMonthlyPence),
    );
  });
});

describe('the check page', () => {
  it('says "Not active" with the name from config', () => {
    expect(notActiveWords(config)).toBe(
      "Not active. Please do not deal with this person on Ozi's behalf. Report it.",
    );
  });

  it('goes on only to a path on this site', () => {
    expect(safeNextPath('/business/join?ambassador=shopper-ada')).toBe(
      '/business/join?ambassador=shopper-ada',
    );
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      'javascript:x',
      '',
      null,
    ]) {
      expect(safeNextPath(bad)).toBeNull();
    }
    expect(checkLink('https://o.test', 'K7Q2MA', '/shops/1')).toBe(
      'https://o.test/ambassador/check/K7Q2MA?next=%2Fshops%2F1',
    );
    expect(checkLink('https://o.test', 'K7Q2MA', 'https://evil.example')).toBe(
      'https://o.test/ambassador/check/K7Q2MA',
    );
  });

  it('fills in the staff links with the name and postcode, and nothing else', () => {
    const links = businessCheckLinks(config.ambassadorProtection, {
      name: 'Mama Put & Sons',
      postcode: 'ME7 5TP',
    });
    expect(links.companiesHouse).toBe(
      'https://find-and-update.company-information.service.gov.uk/search/companies?q=Mama%20Put%20%26%20Sons',
    );
    expect(links.hygieneRating).toContain('Mama%20Put%20%26%20Sons');
    expect(links.hygieneRating).toContain('ME7%205TP');
  });
});

describe('matching delivery addresses', () => {
  it('matches the same place however it is written, and never a neighbour', () => {
    expect(
      sameAddress('12 High Street, Gillingham ME7 1AA', '12 high street, GILLINGHAM, me7 1aa'),
    ).toBe(true);
    expect(sameAddress('12 High Street, Gillingham ME7 1AA', '12 High Street, ME71AA')).toBe(true);
    expect(
      sameAddress('1 High Street, Gillingham ME7 1AA', '11 High Street, Gillingham ME7 1AA'),
    ).toBe(false);
    expect(sameAddress('12 High Street, ME7 1AA', '12 High Street, ME7 2BB')).toBe(false);
    expect(sameAddress('', '12 High Street')).toBe(false);
  });
});
