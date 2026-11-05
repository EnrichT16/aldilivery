/**
 * The Shop Partner catalogue's taxonomy (ruling 96, 5 November 2026): the small list of
 * categories a partner files each product under, by kind of partner, each saying which details a
 * product in it must give; the fourteen UK allergens; the units; and the photo rules. Every word
 * and figure comes from `catalogue` in config/store.json.
 */

import type { PartnerKind } from './partners.js';

/** Which kind of partner a category is for. */
export const CATEGORY_KINDS = ['grocery', 'restaurant', 'service'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** A detail a category may require of every product in it. */
export const CATEGORY_DETAILS = ['unit', 'allergens', 'bestBefore'] as const;
export type CategoryDetail = (typeof CATEGORY_DETAILS)[number];

export interface CatalogueCategory {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly requires: readonly CategoryDetail[];
}

export interface PhotoRules {
  /** The long side, in pixels, of each derivative made from a photo. */
  readonly sizes: { readonly thumb: number; readonly medium: number; readonly full: number };
  readonly webpQuality: number;
  readonly jpegQuality: number;
  /** Below this long side a photo is refused outright. */
  readonly hardFloorLongSide: number;
  /** Below this long side a photo is accepted with a warning. */
  readonly minimumLongSide: number;
  /** Mean brightness (0 to 255) below which a photo is too dark, and above which too bright. */
  readonly darkBelow: number;
  readonly brightAbove: number;
  /** The variance of a Laplacian below which a photo is blurry. */
  readonly blurBelow: number;
  /** The most bytes a photo may be as it arrives. */
  readonly maxBytes: number;
}

export interface CatalogueSettings {
  readonly categories: readonly CatalogueCategory[];
  /** The fourteen allergens UK food law names. */
  readonly allergens: readonly string[];
  readonly units: readonly string[];
  readonly descriptionMaxLength: number;
  readonly photos: PhotoRules;
}

/** Which categories a partner of this kind files products under. */
export function categoryKindFor(kind: PartnerKind): CategoryKind {
  return kind === 'food' ? 'restaurant' : kind === 'service' ? 'service' : 'grocery';
}

export function categoriesFor(
  kind: PartnerKind,
  settings: Pick<CatalogueSettings, 'categories'>,
): CatalogueCategory[] {
  const wanted = categoryKindFor(kind);
  return settings.categories.filter((category) => category.kind === wanted);
}

export function categoryById(
  id: string | null | undefined,
  settings: Pick<CatalogueSettings, 'categories'>,
): CatalogueCategory | null {
  if (!id) return null;
  return settings.categories.find((category) => category.id === id) ?? null;
}

/** What a product gives, as the taxonomy checks it. */
export interface ProductDetails {
  unitQuantity: number | null;
  unitKind: string | null;
  /** Null when the partner has not said; an empty list is "none", which is an answer. */
  allergens: readonly string[] | null;
  expiresOn: Date | string | null;
}

/**
 * The details a category requires that the product has not given, in plain words, in the order
 * the form asks them. Empty when everything required is there.
 */
export function missingDetails(
  category: CatalogueCategory,
  product: ProductDetails,
): Array<{ detail: CategoryDetail; words: string }> {
  const missing: Array<{ detail: CategoryDetail; words: string }> = [];
  for (const detail of category.requires) {
    if (
      detail === 'unit' &&
      !(product.unitQuantity && product.unitQuantity > 0 && product.unitKind)
    ) {
      missing.push({
        detail,
        words: `${category.name} needs the size: how much, and in what (grams, kilograms, millilitres, litres, each, or a pack).`,
      });
    }
    if (detail === 'allergens' && product.allergens === null) {
      missing.push({
        detail,
        words: `${category.name} needs the allergens: tick any of the fourteen it contains, or "None".`,
      });
    }
    if (detail === 'bestBefore' && !product.expiresOn) {
      missing.push({ detail, words: `${category.name} needs a best before or use by date.` });
    }
  }
  return missing;
}

/** The allergens given that are not on the list of fourteen, so a typo is never shown as fact. */
export function unknownAllergens(
  given: readonly string[],
  settings: Pick<CatalogueSettings, 'allergens'>,
): string[] {
  const known = new Set(settings.allergens.map((name) => name.toLowerCase()));
  return given.filter((name) => !known.has(name.trim().toLowerCase()));
}

/** "Contains milk, eggs and tree nuts", or "No listed allergens", for the shop page. */
export function allergenWords(allergens: readonly string[] | null): string | null {
  if (allergens === null) return null;
  if (allergens.length === 0) return 'No listed allergens';
  const lower = allergens.map((name) => name.toLowerCase());
  if (lower.length === 1) return `Contains ${lower[0]}`;
  return `Contains ${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

/** What was measured of a photo, against which the rules are read. */
export interface PhotoMeasure {
  width: number;
  height: number;
  /** Mean brightness, 0 to 255. */
  brightness: number;
  /** The variance of a Laplacian over the picture: low is blurry. */
  sharpness: number;
}

/**
 * The plain words shown to a partner about a photo, from what was measured against the rules:
 * null when it is fine, otherwise one sentence saying what to do, and whether it is refused.
 */
export function photoFeedback(
  measured: PhotoMeasure,
  rules: PhotoRules,
): { words: string; refused: boolean } | null {
  const longSide = Math.max(measured.width, measured.height);
  if (longSide < rules.hardFloorLongSide) {
    return {
      words: `That photo is too small to show clearly (${longSide} pixels on its long side). Please take it again, closer, with the camera itself.`,
      refused: true,
    };
  }
  if (measured.brightness < rules.darkBelow) {
    return { words: 'That photo is too dark. Try it near a window.', refused: false };
  }
  if (measured.brightness > rules.brightAbove) {
    return { words: 'That photo is too bright. Move it out of direct light.', refused: false };
  }
  if (measured.sharpness < rules.blurBelow) {
    return { words: 'That photo is blurry. Hold the phone still, then try again.', refused: false };
  }
  if (longSide < rules.minimumLongSide) {
    return {
      words: `That photo is small (${longSide} pixels on its long side). It will do, but a bigger one looks better.`,
      refused: false,
    };
  }
  return null;
}

/** The photo rules the big delivery apps give, in plain words, for the add form (ruling 96). */
export const PHOTO_RULES_WORDS: readonly string[] = [
  'One product in the photo, in the middle, filling most of it.',
  'Show what is actually sold: a four-pack shows four, a loaf shows the loaf.',
  'Plain background, good light, nothing blurry. Near a window is best.',
  'No words, prices or other products laid over it.',
];

/**
 * The columns of the CSV a Pro shop uploads (ruling 96), in order. Allergens are written as the
 * list spells them, separated by semicolons, or "none".
 */
export const BULK_COLUMNS = [
  'name',
  'price',
  'category',
  'unit quantity',
  'unit',
  'allergens',
  'barcode',
  'description',
] as const;
