/**
 * The shops Ozi lists itself (ruling 65, 17 October 2026): well-known local shops with their
 * public addresses and typical hours, from `config/shops-seed.json` beside `store.json`. Names
 * and addresses live in that file, never here.
 *
 * Each is listed by Ozi, is not a partner, and has no products of its own: the community
 * catalogue applies, and its public page invites the owner to claim it, unless it is a branch
 * of a national chain (`chain: true`), whose page never does: a branch manager cannot sign up
 * for the whole company (Anthony, 30 October 2026). The seed runs at
 * start-up only when there are no shops at all, and from the admin panel's button at any time;
 * either way a shop is added once only, by its key.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PARTNER_KINDS, type PartnerKind } from '@aldilivery/core';
import { storeConfigPath } from '@aldilivery/core/node';

import type { Repository } from '../data/repository.js';

export interface SeedShop {
  key: string;
  name: string;
  kind: PartnerKind;
  address: string;
  postcode: string;
  hours: string;
  about: string;
  /** Ruling 82: what it is browsed under, from the lists in `browse` in config/store.json. */
  cuisines: string[];
  specialities: string[];
  categories: string[];
  convenience: boolean;
  /** A branch of a national chain: its page has no "Claim this shop" (30 October 2026). */
  chain: boolean;
}

/** Reads and checks the file, throwing a sentence that says which entry is wrong. */
export function parseShopsSeed(raw: unknown, file = 'shops-seed.json'): SeedShop[] {
  const list = (raw as { shops?: unknown })?.shops;
  if (!Array.isArray(list)) throw new Error(`${file} must have a "shops" list.`);
  const keys = new Set<string>();
  return list.map((entry, index) => {
    const e = entry as Partial<SeedShop>;
    const where = `${file} entry ${index + 1}${e.key ? ` (${e.key})` : ''}`;
    const text = (
      name: Exclude<
        keyof SeedShop,
        'cuisines' | 'specialities' | 'categories' | 'convenience' | 'chain'
      >,
      required: boolean,
    ): string => {
      const value = e[name];
      if (value === undefined && !required) return '';
      if (typeof value !== 'string' || (required && value.trim() === '')) {
        throw new Error(`${where} needs ${String(name)}.`);
      }
      return value.trim();
    };
    const list = (name: 'cuisines' | 'specialities' | 'categories'): string[] => {
      const value = e[name];
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new Error(`${where}: ${name} must be a list of words.`);
      }
      return value.map((entry) => entry.trim()).filter(Boolean);
    };
    if (e.convenience !== undefined && typeof e.convenience !== 'boolean') {
      throw new Error(`${where}: convenience must be true or false.`);
    }
    if (e.chain !== undefined && typeof e.chain !== 'boolean') {
      throw new Error(`${where}: chain must be true or false.`);
    }
    const key = text('key', true);
    if (!/^[a-z0-9-]+$/.test(key))
      throw new Error(`${where}: the key is letters, numbers and dashes.`);
    if (keys.has(key)) throw new Error(`${where}: the key is used twice.`);
    keys.add(key);
    const kind = (e.kind ?? 'shop') as PartnerKind;
    if (!PARTNER_KINDS.includes(kind)) {
      throw new Error(`${where}: kind must be one of ${PARTNER_KINDS.join(', ')}.`);
    }
    return {
      key,
      name: text('name', true),
      kind,
      address: text('address', true),
      postcode: text('postcode', false),
      hours: text('hours', false),
      about: text('about', false),
      cuisines: list('cuisines'),
      specialities: list('specialities'),
      categories: list('categories'),
      convenience: e.convenience === true,
      chain: e.chain === true,
    };
  });
}

/** The seed from the folder beside `store.json`. An empty list when there is no file. */
export function loadShopsSeed(explicitConfigPath?: string): SeedShop[] {
  const file = join(dirname(storeConfigPath(explicitConfigPath)), 'shops-seed.json');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return parseShopsSeed(JSON.parse(raw) as unknown);
}

/**
 * Adds every seed shop not already there, by key. Returns how many were added, so the
 * admin panel can say "14 added" the first time and "nothing to add" after that.
 */
export async function seedShops(
  repository: Repository,
  shops: SeedShop[],
  now: () => Date = () => new Date(),
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const shop of shops) {
    const existing = await repository.partnerShops.findBySeedKey(shop.key);
    if (existing) {
      // Listed before ruling 82 and still nobody's: what it is browsed under comes from the file.
      const unset =
        !existing.convenience &&
        existing.cuisines.length === 0 &&
        existing.specialities.length === 0 &&
        existing.categories.length === 0;
      const described =
        shop.convenience ||
        shop.cuisines.length + shop.specialities.length + shop.categories.length > 0;
      // Still nobody's, and the file's words about it have changed (an unchecked sentence taken
      // out, 30 October 2026): the page says what the file says now.
      if (existing.source === 'ozi' && existing.about !== shop.about) {
        await repository.partnerShops.update(existing.id, { about: shop.about });
      }
      if (existing.source === 'ozi' && unset && described) {
        await repository.partnerShops.update(existing.id, {
          cuisines: shop.cuisines,
          specialities: shop.specialities,
          categories: shop.categories,
          convenience: shop.convenience,
        });
      }
      skipped += 1;
      continue;
    }
    await repository.partnerShops.create({
      name: shop.name,
      address: shop.address,
      telephone: '',
      about: shop.about,
      monthlyPence: 0,
      kind: shop.kind,
      status: 'approved',
      plan: 'free',
      freeForever: false,
      source: 'ozi',
      seedKey: shop.key,
      postcode: shop.postcode,
      hours: shop.hours,
      approvedAt: now(),
      cuisines: shop.cuisines,
      specialities: shop.specialities,
      categories: shop.categories,
      convenience: shop.convenience,
    });
    added += 1;
  }
  return { added, skipped };
}
