import rawGifts from '@gifts';
import rawOffers from '@offers';
import rawRecipes from '@recipes';

import { searchCatalogue, type CatalogueItem } from './api';

/**
 * Ozi Recipes and Little Gifts (6 October 2026), read from config/recipes.json and
 * config/gifts.json, and the one thing both need: putting named catalogue items in the basket.
 */

export interface Recipe {
  id: string;
  name: string;
  summary: string;
  serves: number;
  minutes: number;
  ingredients: Array<{ item: string; quantity: number }>;
  method: string[];
}

export interface Gift {
  id: string;
  name: string;
  forWho: string;
  items: string[];
}

function list<T>(raw: unknown, key: string, file: string): T[] {
  const value = (raw as Record<string, unknown>)?.[key];
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${file} needs a "${key}" list.`);
  return value as T[];
}

/** A shop's offer, agreed in writing with the shop (config/offers.json). */
export interface Offer {
  id: string;
  shop: string;
  title: string;
  details: string;
  /** The last day, YYYY-MM-DD. */
  until: string;
  /** The exact name of a catalogue item, when it can be added to the basket. */
  item?: string;
}

/** Offers still running today. An empty list is allowed: there may be none just now. */
export function currentOffers(now = new Date()): Offer[] {
  const value = (rawOffers as Record<string, unknown>)?.['offers'];
  if (!Array.isArray(value)) throw new Error('offers.json needs an "offers" list.');
  const today = now.toISOString().slice(0, 10);
  return (value as Offer[]).filter((offer) => offer.until >= today);
}

export const RECIPES: Recipe[] = list<Recipe>(rawRecipes, 'recipes', 'recipes.json');
export const GIFTS: Gift[] = list<Gift>(rawGifts, 'gifts', 'gifts.json');

/** Whether Ozi Recipes is unlocked now. */
export function recipePassActive(until: string | null | undefined, now = new Date()): boolean {
  return Boolean(until) && new Date(until as string).getTime() > now.getTime();
}

/** Finds each named item in the catalogue and adds it; says which could not be found. */
export async function addNamedItems(
  entries: Array<{ item: string; quantity: number }>,
  basket: {
    add: (item: CatalogueItem) => void;
    setQuantity: (id: string, quantity: number) => void;
    lines: Array<{ item: CatalogueItem; quantity: number }>;
  },
): Promise<{ added: string[]; missing: string[] }> {
  const added: string[] = [];
  const missing: string[] = [];
  for (const entry of entries) {
    try {
      const { items } = await searchCatalogue(entry.item);
      const found = items.find((item) => item.name === entry.item) ?? items[0];
      if (!found) {
        missing.push(entry.item);
        continue;
      }
      const already = basket.lines.find((line) => line.item.id === found.id)?.quantity ?? 0;
      basket.add(found);
      basket.setQuantity(found.id, already + Math.max(1, entry.quantity));
      added.push(found.name);
    } catch {
      missing.push(entry.item);
    }
  }
  return { added, missing };
}

/** "milk, bread and eggs". */
export function listInWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
