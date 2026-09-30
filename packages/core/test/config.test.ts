/**
 * Tests for the store configuration contract, and the repository scan that keeps Rule Nine
 * honest.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inviolableRules, parseStoreConfig, StoreConfigError } from '../src/index.js';
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

  it('supports the UK and the EU card regions', () => {
    expect(config.payments.supportedCardRegions).toEqual(['UK', 'EU']);
  });

  it('holds the legal entity name as an acknowledged placeholder', () => {
    expect(config.store.legalEntityIsPlaceholder).toBe(true);
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

  it('rejects a standard delivery fee that would not cover the Runner (Rule Two)', () => {
    expect(() => parseStoreConfig(withFees({ standardDeliveryPence: 500 }))).toThrow(
      /does not cover the Runner/,
    );
  });

  it('requires a maximum basket and a standard delivery fee', () => {
    expect(() => parseStoreConfig(withFees({ maximumGoodsPence: undefined }))).toThrow(
      StoreConfigError,
    );
    expect(() => parseStoreConfig(withFees({ standardDeliveryPence: undefined }))).toThrow(
      StoreConfigError,
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
