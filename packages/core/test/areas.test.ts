/**
 * Areas (Anthony, 30 October 2026): finding a postcode in an address, its area, and the
 * configuration that names the areas and groups London as one.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  areaName,
  areaOf,
  parseStoreConfig,
  postcodeIn,
  StoreConfigError,
  tidyPostcode,
} from '../src/index.js';
import { storeConfigPath } from '../src/node.js';

const raw = JSON.parse(readFileSync(storeConfigPath(), 'utf8')) as Record<string, unknown>;
const config = parseStoreConfig(raw);

describe('postcodes in addresses', () => {
  it('finds the last postcode, tidied, or nothing', () => {
    expect(postcodeIn('12 Example Street, Gillingham me71aa')).toBe('ME7 1AA');
    expect(postcodeIn('Flat 2, 1 SW1A 1AA Road, London SE1 7PB')).toBe('SE1 7PB');
    expect(postcodeIn('12 Example Street, Birmingham')).toBe('');
    expect(tidyPostcode(' ec1a1bb ')).toBe('EC1A 1BB');
    expect(tidyPostcode('not one')).toBe('');
  });
});

describe('areas', () => {
  it('groups the London areas as one, and names the rest from configuration', () => {
    expect(areaOf('SE1 7PB', config.areas)).toBe('London');
    expect(areaOf('WC2N', config.areas)).toBe('London');
    expect(areaOf('AB10 1XG', config.areas)).toBe('AB');
    expect(areaName('AB', config.areas)).toBe('Aberdeen');
    expect(areaName('London', config.areas)).toBe('London');
    // An area the names do not know is called by its letters.
    expect(areaName('QQ', config.areas)).toBe('QQ');
  });

  it('refuses letters in two groups, or that are not a postcode area', () => {
    const withGroups = (groups: unknown) =>
      parseStoreConfig({ ...raw, areas: { ...(raw['areas'] as object), groups } });
    expect(() => withGroups({ One: ['E'], Two: ['E'] })).toThrow(StoreConfigError);
    expect(() => withGroups({ One: ['E1'] })).toThrow(/not the letters of a postcode area/);
  });
});
