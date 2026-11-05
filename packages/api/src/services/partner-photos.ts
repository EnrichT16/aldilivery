/**
 * A partner's product photos (ruling 96, 5 November 2026): each one is looked at as it arrives
 * (size, light, sharpness), told about in plain words, made into three sizes as WebP and JPEG, and
 * put in object storage or, until that is set up, the database. The first photo is the cover.
 * The package decides how many a product may carry; a lapsed package hides the rest, never
 * deletes them.
 */

import { photoFeedback, planLimits, type PhotoRules } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { PartnerProduct, PartnerProductPhoto, PartnerShop } from '../domain.js';
import { BadRequestError, ConflictError } from '../errors.js';
import { makeDerivatives, measurePhoto, UnreadablePhotoError } from '../lib/photo-quality.js';
import { plusPaid } from '../lib/partner-standing.js';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoSize = 'thumb' | 'medium' | 'full';
export const PHOTO_SIZES: readonly PhotoSize[] = ['thumb', 'medium', 'full'];

type PhotoContext = Pick<AppContext, 'repository' | 'config' | 'photoStore' | 'now'>;

/** The package's limits for this shop now (ruling 96). */
export function limitsFor(ctx: Pick<AppContext, 'config' | 'now'>, shop: PartnerShop) {
  return planLimits(
    { kind: shop.kind, plan: shop.plan, plusPaid: plusPaid(shop, ctx.now(), ctx.config) },
    ctx.config.extras.partners,
  );
}

/** The key of one size and format, from the WebP key kept on the row. */
export function keyFor(photo: PartnerProductPhoto, size: PhotoSize, format: 'webp' | 'jpeg'): string {
  const webp = size === 'thumb' ? photo.thumbKey : size === 'medium' ? photo.mediumKey : photo.fullKey;
  return format === 'webp' ? webp : webp.replace(/\.webp$/, '.jpg');
}

export interface AddedPhoto {
  photo: PartnerProductPhoto;
  /** What the shop is told about it, if anything ("too dark"). */
  note: string | null;
}

/**
 * One photo, as base64, added to a product: refused if unreadable, too large or too small to
 * show, or if the package's count is used up; otherwise measured, made into its sizes, stored
 * and recorded, with a plain note when it is dark, bright, blurry or small.
 */
export async function addProductPhoto(
  ctx: PhotoContext,
  shop: PartnerShop,
  product: PartnerProduct,
  input: { base64: string; contentType: string },
  options: { position?: number } = {},
): Promise<AddedPhoto> {
  const rules = ctx.config.catalogue.photos;
  const limits = limitsFor(ctx, shop);
  const existing = await ctx.repository.partnerProductPhotos.listForProduct(product.id);
  if (existing.length >= limits.photosPerProduct) {
    throw new ConflictError(photoLimitWords(ctx, shop, limits.photosPerProduct));
  }
  if (!(PHOTO_TYPES as readonly string[]).includes(input.contentType)) {
    throw new BadRequestError('Please send a photo: a JPEG, PNG or WebP picture.');
  }
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length === 0 || bytes.length > rules.maxBytes) {
    throw new BadRequestError(
      `That photo is empty or too large (over ${Math.round(rules.maxBytes / 1024 / 1024)} MB). Please take it again.`,
    );
  }
  let measured;
  try {
    measured = await measurePhoto(bytes);
  } catch (failure) {
    if (failure instanceof UnreadablePhotoError) throw new BadRequestError(failure.message);
    throw failure;
  }
  const feedback = photoFeedback(measured, rules);
  if (feedback?.refused) throw new BadRequestError(feedback.words);
  const derivatives = await makeDerivatives(bytes, rules);
  const base = `partner-products/${product.id}/${ctx.now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  for (const derivative of derivatives) {
    const key = `${base}-${derivative.size}.${derivative.format === 'webp' ? 'webp' : 'jpg'}`;
    await ctx.photoStore.put(key, derivative.bytes, derivative.contentType);
  }
  const photo = await ctx.repository.partnerProductPhotos.create({
    productId: product.id,
    position: options.position ?? existing.length,
    storage: ctx.photoStore.kind,
    thumbKey: `${base}-thumb.webp`,
    mediumKey: `${base}-medium.webp`,
    fullKey: `${base}-full.webp`,
    width: measured.width,
    height: measured.height,
    bytes: bytes.length,
    note: feedback?.words ?? null,
  });
  return { photo, note: feedback?.words ?? null };
}

/** The plain words when a package's photos are used up. */
export function photoLimitWords(
  ctx: Pick<AppContext, 'config'>,
  shop: PartnerShop,
  photosPerProduct: number,
): string {
  const { plans } = ctx.config.extras.partners;
  const more =
    shop.kind === 'shop' && shop.plan === 'free'
      ? ` ${plans.plus.name} gives ${plans.plus.photosPerProduct} a product, and ${plans.pro.name} ${plans.pro.photosPerProduct}.`
      : shop.kind === 'shop' && shop.plan === 'plus'
        ? ` ${plans.pro.name} gives ${plans.pro.photosPerProduct} a product.`
        : '';
  return `This product already has ${photosPerProduct === 1 ? 'its photo' : `${photosPerProduct} photos`}, the most on your package. Take one off to add another.${more}`;
}

/** Deletes a photo's files and its row, then closes the gap in the positions. */
export async function removeProductPhoto(
  ctx: PhotoContext,
  product: PartnerProduct,
  photo: PartnerProductPhoto,
): Promise<void> {
  for (const size of PHOTO_SIZES) {
    for (const format of ['webp', 'jpeg'] as const) {
      await ctx.photoStore.remove(keyFor(photo, size, format)).catch(() => undefined);
    }
  }
  await ctx.repository.partnerProductPhotos.remove(photo.id);
  const rest = await ctx.repository.partnerProductPhotos.listForProduct(product.id);
  for (const [index, row] of rest.entries()) {
    if (row.position !== index) {
      await ctx.repository.partnerProductPhotos.update(row.id, { position: index });
    }
  }
}

/** Makes this photo the cover: first, the others keeping their order. */
export async function makeCoverPhoto(
  ctx: PhotoContext,
  product: PartnerProduct,
  photo: PartnerProductPhoto,
): Promise<void> {
  const rows = await ctx.repository.partnerProductPhotos.listForProduct(product.id);
  const ordered = [photo, ...rows.filter((row) => row.id !== photo.id)];
  for (const [index, row] of ordered.entries()) {
    if (row.position !== index) {
      await ctx.repository.partnerProductPhotos.update(row.id, { position: index });
    }
  }
}

/** One photo's addresses for a page, in every size, WebP and JPEG, with its alt text. */
export interface PhotoUrls {
  id: string;
  alt: string;
  width: number;
  height: number;
  thumb: string;
  medium: string;
  full: string;
  thumbJpeg: string;
  mediumJpeg: string;
  fullJpeg: string;
}

/**
 * Where a browser fetches each size: straight from storage (or the CDN) when the store gives a
 * public address, otherwise the API route given, which the client prefixes with its own API base.
 */
export function photoUrls(
  ctx: Pick<AppContext, 'photoStore'>,
  photo: PartnerProductPhoto,
  alt: string,
  apiPath: (photoId: string, size: PhotoSize, format: 'webp' | 'jpg') => string,
): PhotoUrls {
  const where = (size: PhotoSize, format: 'webp' | 'jpeg'): string =>
    (photo.storage === ctx.photoStore.kind
      ? ctx.photoStore.publicUrl(keyFor(photo, size, format))
      : null) ?? apiPath(photo.id, size, format === 'webp' ? 'webp' : 'jpg');
  return {
    id: photo.id,
    alt,
    width: photo.width,
    height: photo.height,
    thumb: where('thumb', 'webp'),
    medium: where('medium', 'webp'),
    full: where('full', 'webp'),
    thumbJpeg: where('thumb', 'jpeg'),
    mediumJpeg: where('medium', 'jpeg'),
    fullJpeg: where('full', 'jpeg'),
  };
}

/**
 * The photos a product shows: the first `photosPerProduct` of the package that applies now
 * (ruling 96), so a lapsed package hides the rest and deletes nothing.
 */
export async function shownPhotos(
  ctx: PhotoContext,
  shop: PartnerShop,
  product: PartnerProduct,
): Promise<PartnerProductPhoto[]> {
  const limits = limitsFor(ctx, shop);
  const rows = await ctx.repository.partnerProductPhotos.listForProduct(product.id);
  return rows.slice(0, limits.photosPerProduct);
}

/**
 * The cover photo's bytes for the automatic check (a medium JPEG is plenty for the model), or the
 * photo kept on the row itself for a product from before ruling 96.
 */
export async function coverForCheck(
  ctx: PhotoContext,
  product: PartnerProduct,
): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } | null> {
  const [cover] = await ctx.repository.partnerProductPhotos.listForProduct(product.id);
  if (cover) {
    const stored = await ctx.photoStore.get(keyFor(cover, 'medium', 'jpeg'));
    if (stored) return { data: Buffer.from(stored.bytes).toString('base64'), mediaType: 'image/jpeg' };
  }
  if (product.photo && product.photoType) {
    const type = product.photoType;
    if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif') {
      return { data: Buffer.from(product.photo).toString('base64'), mediaType: type };
    }
  }
  return null;
}

/** Whether the product has any picture at all: photos of its own, or the one on its row. */
export async function hasAnyPhoto(
  ctx: Pick<AppContext, 'repository'>,
  product: PartnerProduct,
): Promise<boolean> {
  if (product.photo) return true;
  return (await ctx.repository.partnerProductPhotos.listForProduct(product.id)).length > 0;
}

export type { PhotoRules };
