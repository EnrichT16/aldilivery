/**
 * Tests for the store configuration contract, and the repository scan that keeps Rule Nine
 * honest.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  inviolableRules,
  maxGoodsFor,
  modeCarries,
  needsVehicle,
  parseStoreConfig,
  runnerPaymentFor,
  modeTakesPart,
  planSplit,
  splitPartLimitPence,
  StoreConfigError,
} from '../src/index.js';
import { findWorkspaceRoot, loadStoreConfig, storeConfigPath } from '../src/node.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = findWorkspaceRoot(here);
const config = loadStoreConfig();

/** A known-good configuration to mutate in the failure cases below. */
function goodConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
}

function withFees(overrides: Record<string, unknown>): Record<string, unknown> {
  const raw = goodConfig();
  raw['fees'] = { ...(raw['fees'] as Record<string, unknown>), ...overrides };
  return raw;
}

describe('the live configuration file', () => {
  it('loads and validates', () => {
    expect(config.productName).toBe('Ozi Delivery');
    expect(config.assistantName).toBe('Ozi');
    expect(config.store.displayName.length).toBeGreaterThan(0);
  });

  it('carries the brand colours', () => {
    expect(config.brand.colours.navy).toBe('#0B1F3A');
    expect(config.brand.colours.gold).toBe('#D4AF37');
    expect(config.brand.colours.white).toBe('#FFFFFF');
  });

  it('names a catalogue source mode that is one of the allowed modes', () => {
    expect(config.store.catalogueSource.allowedModes).toContain(config.store.catalogueSource.mode);
    expect(config.store.catalogueSource.mode).toBe('community');
  });

  it('takes cards from any country (ruling, 2 October 2026)', () => {
    expect(config.payments.supportedCardRegions).toEqual(['ANY']);
  });

  it('names the company that runs the service, and flags each detail still to follow', () => {
    expect(config.store.legalEntityIsPlaceholder).toBe(false);
    expect(config.store.legalEntityName.length).toBeGreaterThan(0);
    // Until Anthony fills them in (docs/LEGAL_REVIEW.md), the legal pages say "to follow"
    // instead of showing a made-up number. Each flag is set by hand when the real detail is in.
    expect(config.store.registeredIn).toBe('England and Wales');
    expect(typeof config.store.companyNumberIsPlaceholder).toBe('boolean');
    expect(typeof config.store.registeredOfficeIsPlaceholder).toBe('boolean');
    expect(typeof config.store.icoRegistrationIsPlaceholder).toBe('boolean');
    expect(config.contact.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('names OZIDELIVERY LTD of Gillingham as the company, its D-U-N-S number public (ruling 59)', () => {
    expect(config.store.legalEntityName).toBe('OZIDELIVERY LTD');
    expect(config.store.registeredOffice).toBe('107 King Street, Gillingham, ME7 1ER');
    expect(config.store.registeredOfficeIsPlaceholder).toBe(false);
    expect(config.store.registeredIn).toBe('England and Wales');
    expect(config.store.dunsNumber).toBe('235209172');
    // The company number is in (Companies House, 10 October 2026, ruling 60); the ICO number is
    // still to follow.
    expect(config.store.companyNumber).toBe('17497650');
    expect(config.store.companyNumberIsPlaceholder).toBe(false);
    expect(config.store.icoRegistrationIsPlaceholder).toBe(true);
  });

  it('refuses a D-U-N-S number that is not nine digits, and allows none', () => {
    const raw = goodConfig();
    raw['store'] = { ...(raw['store'] as Record<string, unknown>), dunsNumber: '12345' };
    expect(() => parseStoreConfig(raw)).toThrow(/store.dunsNumber must be nine digits/);
    raw['store'] = { ...(raw['store'] as Record<string, unknown>), dunsNumber: undefined };
    expect(parseStoreConfig(raw).store.dunsNumber).toBeNull();
  });

  it('carries up to £60 on foot or bicycle, £70 by motorbike, any order by car or van (ruling 60)', () => {
    const limits = config.dispatch.maxGoodsPenceByMode;
    expect(limits).toEqual({ foot: 6000, bicycle: 6000, motorbike: 7000, car: 15000, van: 15000 });
    expect(config.dispatch.waitingAlertMinutes).toBe(15);
    // Ruling 61: ten minutes before splitting.
    expect(config.dispatch.splitAfterMinutes).toBe(10);
    expect(config.dispatch.splitPartMaxPenceByMode).toEqual({ motorbike: 7500, foot: 6000 });
    // Anthony's figure: £5 for each Runner of a split job.
    expect(config.dispatch.splitRunnerPayPence).toBe(500);
    expect(maxGoodsFor('on_foot', limits)).toBe(6000);
    expect(modeCarries('bicycle', 6000, limits)).toBe(true);
    expect(modeCarries('bicycle', 6001, limits)).toBe(false);
    expect(modeCarries('motorbike', 7000, limits)).toBe(true);
    expect(modeCarries('motorbike', 7001, limits)).toBe(false);
    expect(modeCarries('car', 15000, limits)).toBe(true);
    expect(modeCarries('van', 15000, limits)).toBe(true);
    expect(modeCarries('hovercraft', 1, limits)).toBe(false);
    expect(needsVehicle(6000, limits)).toBe(false);
    expect(needsVehicle(6001, limits)).toBe(true);
    expect(splitPartLimitPence(limits)).toBe(6000);
    // The whole-order goods cap stays £150 (Anthony confirmed, 10 October 2026).
    expect(config.fees.maximumOrderGoodsPence).toBe(15000);
    const raw = goodConfig();
    delete raw['dispatch'];
    expect(parseStoreConfig(raw).dispatch).toEqual({
      maxGoodsPenceByMode: { foot: 6000, bicycle: 6000, motorbike: 7000, car: 15000, van: 15000 },
      waitingAlertMinutes: 15,
      splitAfterMinutes: 10,
      splitPartMaxPenceByMode: { motorbike: 7500, foot: 6000 },
      tinyExtraBelowPence: 500,
      splitRunnerPayPence: 500,
    });
  });

  it('changes split-part pay with one line of configuration (ruling 60)', () => {
    const raw = goodConfig();
    raw['dispatch'] = { splitRunnerPayPence: 600 };
    expect(parseStoreConfig(raw).dispatch.splitRunnerPayPence).toBe(600);
  });

  it('pays £7 for an order of £120 or more delivered whole, £5 below (ruling 60)', () => {
    expect(config.fees.largeOrderRunnerPaymentPence).toBe(700);
    expect(config.fees.largeOrderFromPence).toBe(12000);
    expect(runnerPaymentFor(11999, config.fees)).toBe(500);
    expect(runnerPaymentFor(12000, config.fees)).toBe(700);
    expect(runnerPaymentFor(15000, config.fees)).toBe(700);
    const raw = goodConfig();
    raw['fees'] = { ...(raw['fees'] as Record<string, unknown>), largeOrderRunnerPaymentPence: 400 };
    expect(() => parseStoreConfig(raw)).toThrow(/largeOrderRunnerPaymentPence must be a whole number of at least 500/);
  });

  it('refuses a walking or cycling limit below the dearest product, and an unknown way of travelling', () => {
    const raw = goodConfig();
    raw['dispatch'] = { maxGoodsPenceByMode: { foot: 5000 } };
    expect(() => parseStoreConfig(raw)).toThrow(/foot and .bicycle must each be at least/);
    raw['dispatch'] = { maxGoodsPenceByMode: { rocket: 9000 } };
    expect(() => parseStoreConfig(raw)).toThrow(/not a way of travelling/);
  });

  describe('the split cascade by vehicle (ruling 61)', () => {
    const MAX = { motorbike: 7500, foot: 6000 };
    /** £150 of shopping: ten items of £15. */
    const ORDER_150 = [{ key: 'item', unitPricePence: 1500, quantity: 10 }];
    /** £130 of shopping: twenty-six items of £5. */
    const ORDER_130 = [{ key: 'item', unitPricePence: 500, quantity: 26 }];
    const shape = (parts: ReturnType<typeof planSplit>) =>
      parts.map((part) => [part.mode, part.goodsPence]);

    it('gives £150 to two motorbike riders when two or more are on shift', () => {
      expect(shape(planSplit(ORDER_150, 2, MAX))).toEqual([
        ['motorbike', 7500],
        ['motorbike', 7500],
      ]);
      // A third rider is not used: the fewest Runners possible.
      expect(shape(planSplit(ORDER_150, 5, MAX))).toEqual([
        ['motorbike', 7500],
        ['motorbike', 7500],
      ]);
    });

    it('gives £150 to one motorbike rider (£75) and two footers (£60 and £15) with one rider', () => {
      expect(shape(planSplit(ORDER_150, 1, MAX))).toEqual([
        ['motorbike', 7500],
        ['foot', 6000],
        ['foot', 1500],
      ]);
    });

    it('gives £130 to one motorbike rider and one footer', () => {
      expect(shape(planSplit(ORDER_130, 1, MAX))).toEqual([
        ['motorbike', 7500],
        ['foot', 5500],
      ]);
      // Thirteen £10 items fill the motorbike part as far as whole items go: £70 and £60.
      expect(shape(planSplit([{ key: 'ten', unitPricePence: 1000, quantity: 13 }], 1, MAX))).toEqual([
        ['motorbike', 7000],
        ['foot', 6000],
      ]);
    });

    it('gives £150 to three footers, each part £60 or less, with no motorbike riders', () => {
      const parts = planSplit(ORDER_150, 0, MAX);
      expect(parts).toHaveLength(3);
      expect(parts.every((part) => part.mode === 'foot' && part.goodsPence <= 6000)).toBe(true);
      expect(parts.reduce((sum, part) => sum + part.goodsPence, 0)).toBe(15000);
    });

    it('never splits a product, fills the larger parts first, and keeps every unit', () => {
      const lines = [
        { key: 'a', unitPricePence: 4000, quantity: 2 },
        { key: 'b', unitPricePence: 1000, quantity: 3 },
        { key: 'c', unitPricePence: 450, quantity: 4 },
      ];
      const parts = planSplit(lines, 1, MAX);
      expect(parts[0]!.mode).toBe('motorbike');
      expect(parts.every((part) => part.goodsPence <= MAX[part.mode])).toBe(true);
      const units = (key: string) =>
        parts.flatMap((part) => part.lines).filter((line) => line.key === key).reduce((n, line) => n + line.quantity, 0);
      expect([units('a'), units('b'), units('c')]).toEqual([2, 3, 4]);
      expect(parts.reduce((sum, part) => sum + part.goodsPence, 0)).toBe(4000 * 2 + 1000 * 3 + 450 * 4);
      // Three £50 items with no riders: one per footer, never cut.
      expect(shape(planSplit([{ key: 'x', unitPricePence: 5000, quantity: 3 }], 0, MAX))).toEqual([
        ['foot', 5000],
        ['foot', 5000],
        ['foot', 5000],
      ]);
      expect(() => planSplit([{ key: 'z', unitPricePence: 6001, quantity: 1 }], 1, MAX)).toThrow(RangeError);
    });

    it('offers a motorbike part to motorbike, car and van, and a foot part to foot and bicycle', () => {
      expect(['motorbike', 'car', 'van'].map((mode) => modeTakesPart(mode, 'motorbike'))).toEqual([true, true, true]);
      expect(['on_foot', 'bicycle'].map((mode) => modeTakesPart(mode, 'motorbike'))).toEqual([false, false]);
      expect(['on_foot', 'bicycle'].map((mode) => modeTakesPart(mode, 'foot'))).toEqual([true, true]);
      expect(['motorbike', 'car', 'van'].map((mode) => modeTakesPart(mode, 'foot'))).toEqual([false, false, false]);
    });

    it('takes its part sizes from configuration, each at least the dearest product', () => {
      const raw = goodConfig();
      raw['dispatch'] = { splitPartMaxPenceByMode: { motorbike: 8000 } };
      expect(parseStoreConfig(raw).dispatch.splitPartMaxPenceByMode).toEqual({ motorbike: 8000, foot: 6000 });
      raw['dispatch'] = { splitPartMaxPenceByMode: { foot: 1000 } };
      expect(() => parseStoreConfig(raw)).toThrow(/must each be at least fees.maximumProductPence/);
      raw['dispatch'] = { splitPartMaxPenceByMode: { car: 9000 } };
      expect(() => parseStoreConfig(raw)).toThrow(/not a kind of split part/);
    });
  });

  it('refuses a contact email that is not an email address', () => {
    const raw = goodConfig();
    raw['contact'] = { ...(raw['contact'] as Record<string, unknown>), email: 'ring us' };
    expect(() => parseStoreConfig(raw)).toThrow(/contact.email must be an email address/);
  });

  it('sets the accessibility floor: 20 pixel text and 48 pixel controls (Rule Seven)', () => {
    expect(config.accessibility.baseFontSizePx).toBe(20);
    expect(config.accessibility.minimumControlHeightPx).toBe(48);
  });

  it('gives thirty minutes of notice with a one word skip (Rule Five)', () => {
    expect(config.recurringOrders.noticeMinutesBefore).toBe(30);
    expect(config.recurringOrders.skipWord).not.toMatch(/\s/);
  });

  it('holds an offer for sixty seconds and pools within one mile', () => {
    expect(config.allocation.offerHoldSeconds).toBe(60);
    expect(config.allocation.poolingRadiusMiles).toBe(1);
  });

  it('keeps age restricted goods switched off (Rule Six)', () => {
    expect(config.versionOneRestrictions.ageRestrictedGoodsAllowed).toBe(false);
  });

  it('holds a cool bag deposit of one thousand pence released after twenty deliveries', () => {
    expect(config.fees.coolBag.depositPence).toBe(1000);
    expect(config.fees.coolBag.releaseAfterCompletedDeliveries).toBe(20);
  });

  it('keeps deleted accounts in a seven day recycle bin', () => {
    expect(config.accountDeletion.recycleBinDays).toBe(7);
  });
});

describe('the configuration parser refuses to contradict a rule', () => {
  it('rejects a Runner payment that is not five pounds (Rule Two)', () => {
    expect(() => parseStoreConfig(withFees({ runnerPaymentPence: 450 }))).toThrow(StoreConfigError);
  });

  it('rejects any delivery price, on any plan, that would not cover the Runner (Rule Two)', () => {
    const delivery = (goodConfig()['fees'] as Record<string, Record<string, unknown>>)['delivery'];
    for (const key of [
      'payAsYouGoSmallOrderPence',
      'payAsYouGoPence',
      'membershipPence',
      'plusPence',
    ]) {
      expect(() => parseStoreConfig(withFees({ delivery: { ...delivery, [key]: 500 } }))).toThrow(
        /does not cover the Runner/,
      );
    }
  });

  it('requires the delivery prices, the item charge and the most one product may cost', () => {
    expect(() => parseStoreConfig(withFees({ delivery: undefined }))).toThrow(StoreConfigError);
    expect(() => parseStoreConfig(withFees({ itemCharge: undefined }))).toThrow(StoreConfigError);
    expect(() => parseStoreConfig(withFees({ maximumProductPence: undefined }))).toThrow(
      StoreConfigError,
    );
  });

  it('defaults the whole-order goods cap to £150, and refuses one below the dearest product', () => {
    expect(parseStoreConfig(withFees({ maximumOrderGoodsPence: undefined })).fees.maximumOrderGoodsPence).toBe(15000);
    expect(() => parseStoreConfig(withFees({ maximumOrderGoodsPence: 5000 }))).toThrow(
      /at least fees.maximumProductPence/,
    );
  });

  it('rejects a notice period that is not thirty minutes (Rule Five)', () => {
    const raw = goodConfig();
    raw['recurringOrders'] = { noticeMinutesBefore: 10, skipWord: 'skip' };
    expect(() => parseStoreConfig(raw)).toThrow(StoreConfigError);
  });

  it('rejects a skip phrase that is more than one word (Rule Five)', () => {
    const raw = goodConfig();
    raw['recurringOrders'] = { noticeMinutesBefore: 30, skipWord: 'skip this one' };
    expect(() => parseStoreConfig(raw)).toThrow(/single word/);
  });

  it('rejects switching age restricted goods on (Rule Six)', () => {
    const raw = goodConfig();
    raw['versionOneRestrictions'] = { ageRestrictedGoodsAllowed: true };
    expect(() => parseStoreConfig(raw)).toThrow(/Rule Six/);
  });

  it('rejects controls shorter than 48 pixels (Rule Seven)', () => {
    const raw = goodConfig();
    raw['accessibility'] = {
      targetStandard: 'WCAG 2.2 AA',
      baseFontSizePx: 20,
      minimumControlHeightPx: 32,
    };
    expect(() => parseStoreConfig(raw)).toThrow(/48 pixels/);
  });

  it('rejects a brand colour that is not a hex colour', () => {
    const raw = goodConfig();
    raw['brand'] = { colours: { navy: 'navy', gold: '#D4AF37', white: '#FFFFFF' } };
    expect(() => parseStoreConfig(raw)).toThrow(/hex colour/);
  });

  it('rejects a catalogue source mode that is not allowed', () => {
    const raw = goodConfig();
    const store = raw['store'] as Record<string, unknown>;
    store['catalogueSource'] = {
      mode: 'scraped',
      allowedModes: ['partner_feed', 'community'],
      attribution: 'x',
    };
    expect(() => parseStoreConfig(raw)).toThrow(/partner_feed, community/);
  });

  it('rejects a missing section outright rather than guessing a default', () => {
    const raw = goodConfig();
    delete raw['fees'];
    expect(() => parseStoreConfig(raw)).toThrow(/fees must be an object/);
  });
});

/**
 * Rule Nine, enforced by a scan rather than by discipline.
 *
 * The supermarket's name is configuration. It may appear in `config/store.json` and in
 * documentation. If it appears in a source file, this test fails and says where — because
 * once the store name is in the code, changing supermarket is a code change, and Rule Nine
 * is gone.
 */
describe('Rule Nine: nothing about the store is hard coded', () => {
  const SKIP_DIRECTORIES = new Set([
    'node_modules',
    'dist',
    '.git',
    'coverage',
    'build',
    'dev-dist',
    '.pnpm-store',
  ]);
  const SKIP_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.lock']);
  const SKIP_FILES = new Set([
    join('config', 'store.json'),
    'pnpm-lock.yaml',
    join('packages', 'core', 'test', 'config.test.ts'),
  ]);

  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      if (statSync(absolute).isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          sourceFiles(absolute, found);
        }
        continue;
      }
      if (SKIP_EXTENSIONS.has(extname(entry))) continue;
      const relativePath = relative(workspaceRoot, absolute);
      if (SKIP_FILES.has(relativePath) || SKIP_FILES.has(relativePath.split('/').join(sep))) continue;
      found.push(absolute);
    }
    return found;
  }

  it('does not mention the store display name anywhere outside configuration and documentation', () => {
    // Word boundaries mean a longer word that merely begins with the store's name does not match.
    const storeName = new RegExp(`\\b${config.store.displayName}\\b`, 'i');
    const offenders: string[] = [];

    for (const file of sourceFiles(workspaceRoot)) {
      const contents = readFileSync(file, 'utf8');
      if (storeName.test(contents)) {
        offenders.push(relative(workspaceRoot, file));
      }
    }

    expect(
      offenders,
      'the store display name belongs in config/store.json alone (Rule Nine)',
    ).toEqual([]);
  });

  it('does not mention the legal entity name outside configuration and documentation', () => {
    const entity = new RegExp(config.store.legalEntityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const offenders: string[] = [];

    for (const file of sourceFiles(workspaceRoot)) {
      if (entity.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(workspaceRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * Anthony's separate company runs other projects, not this service (ruling 59). Its name
   * must never be shown as the operator of this site.
   */
  it('never names the separate company as the operator in any source file', () => {
    const other = /Tofadachi AI and IT Solutions/i;
    const offenders = sourceFiles(workspaceRoot).filter((file) => other.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(workspaceRoot, file))).toEqual([]);
  });

  /**
   * The product's own name is store identity too. Until 28 Sep 2026 nothing checked it, and the
   * old name had been written into eight places a person could see: the page title before
   * JavaScript loads, the line shown without JavaScript, the "cannot reach" message, two screens,
   * the notification fallback, the native app name and the favicon's label. The rename to Ozi
   * Delivery found them. This keeps the new name from going the same way.
   */
  it('does not write the product name into any source file', () => {
    const productName = new RegExp(`\\b${config.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const offenders = sourceFiles(workspaceRoot).filter((file) =>
      productName.test(readFileSync(file, 'utf8')),
    );
    expect(
      offenders.map((file) => relative(workspaceRoot, file)),
      'the product name belongs in config/store.json alone (Rule Nine)',
    ).toEqual([]);
  });

  /**
   * The name the product had before 28 Sep 2026 is retired (docs/BUILD_PROMPT.md, Section A),
   * and must not come back anywhere: not in code, not in comments, not in documentation. It is
   * held here encoded, so that this file does not spell it either.
   *
   * Two things are exempt, and each says why. Database migrations that have already run on the
   * live database are never edited, because changing one risks the server refusing to start.
   * And the lower case form still names things outside this repository's control until they are
   * renamed together — the code packages, the GitHub repository, and the DigitalOcean app and
   * database (BUILD_LOG Step 31) — so this looks for the name as a word, capitalised, which is
   * how it was ever shown to anybody.
   */
  it('does not use the retired product name anywhere', () => {
    const retired = Buffer.from('QWxkaWxpdmVyeQ==', 'base64').toString('utf8');
    const pattern = new RegExp(`\\b${retired}\\b`);
    const binary = new Set(['.png', '.jpg', '.jpeg', '.ico', '.webp', '.woff2', '.lock']);
    const skipDirectories = new Set([...SKIP_DIRECTORIES, 'migrations']);

    function everyFile(dir: string, found: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const absolute = join(dir, entry);
        if (statSync(absolute).isDirectory()) {
          if (!skipDirectories.has(entry)) everyFile(absolute, found);
          continue;
        }
        if (binary.has(extname(entry)) || entry === 'pnpm-lock.yaml') continue;
        found.push(absolute);
      }
      return found;
    }

    const offenders: string[] = [];
    for (const file of everyFile(workspaceRoot)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (pattern.test(line)) offenders.push(`${relative(workspaceRoot, file)}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the ten rules', () => {
  it('are filled in with the product name from configuration', () => {
    const rules = inviolableRules(config.productName);
    expect(rules).toHaveLength(10);
    expect(rules[1]).toBe(
      'The Runner receives five pounds on every standard delivery, untouched, whatever the basket.',
    );
    expect(rules[7]).toBe(
      `${config.productName} shares no code, database, login or payment account with any other product.`,
    );
    expect(rules.filter((rule) => rule.includes(config.productName))).toHaveLength(2);
  });
});
