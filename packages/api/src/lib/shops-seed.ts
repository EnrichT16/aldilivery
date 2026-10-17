/**
 * The shops Ozi lists itself (ruling 65, 17 October 2026): well-known local shops with their
 * public addresses and typical hours, from `config/shops-seed.json` beside `store.json`. Names
 * and addresses live in that file, never here.
 *
 * Each is listed by Ozi, is not a partner, and has no products of its own: the community
 * catalogue applies, and its public page invites the owner to claim it. The seed runs at
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
}

/** Reads and checks the file, throwing a sentence that says which entry is wrong. */
export function parseShopsSeed(raw: unknown, file = 'shops-seed.json'): SeedShop[] {
  const list = (raw as { shops?: unknown })?.shops;
  if (!Array.isArray(list)) throw new Error(`${file} must have a "shops" list.`);
  const keys = new Set<string>();
  return list.map((entry, index) => {
    const e = entry as Partial<SeedShop>;
    const where = `${file} entry ${index + 1}${e.key ? ` (${e.key})` : ''}`;
    const text = (name: keyof SeedShop, required: boolean): string => {
      const value = e[name];
      if (value === undefined && !required) return '';
      if (typeof value !== 'string' || (required && value.trim() === '')) {
        throw new Error(`${where} needs ${String(name)}.`);
      }
      return value.trim();
    };
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
    if (await repository.partnerShops.findBySeedKey(shop.key)) {
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
    });
    added += 1;
  }
  return { added, skipped };
}
