/**
 * The Shop Partner catalogue, built the way the professionals build it (ruling 96, 5 November
 * 2026): one place that takes a product in, checks it against the package's limits and the
 * taxonomy, and sends it on to the automatic check; one place that edits it; and the CSV a Pro
 * shop uploads, validated row by row.
 *
 * Every figure and word of the taxonomy comes from config/store.json (`catalogue`,
 * `extras.partners.plans`). The shop's counter price is what it types; Shoppers see the marked-up
 * price (services/partner-products.ts), never this one.
 */

import {
  BULK_COLUMNS,
  categoriesFor,
  categoryById,
  excludedServiceKind,
  excludedServiceWords,
  formatPence,
  missingDetails,
  paidPlan,
  photoFeedback,
  planMonthlyPence,
  unknownAllergens,
  UNIT_KINDS,
} from '@aldilivery/core';
import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { PartnerProduct, PartnerShop } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { NEVER_FOUND } from '../lib/restricted.js';
import { plusPaid } from '../lib/partner-standing.js';
import { measurePhoto, UnreadablePhotoError } from '../lib/photo-quality.js';
import { checkInBackground, checkPartnerProduct } from './auto-check.js';
import { addProductPhoto, limitsFor, PHOTO_TYPES } from './partner-photos.js';
import { shopperPricePence } from './partner-products.js';

/** A product's name as two listings are compared: "Apples, 6 pack" and "apples 6-pack" match. */
export function sameNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface PhotoInput {
  base64: string;
  contentType: string;
}

export interface NewProductInput {
  name: string;
  pricePence: number;
  tags: string;
  expiresOn?: string | undefined;
  durationMinutes?: number | undefined;
  barcode?: string | undefined;
  priceEstimated: boolean;
  description?: string | undefined;
  categoryId?: string | undefined;
  unitQuantity?: number | undefined;
  unitKind?: string | undefined;
  /** Undefined when the shop has not said; [] for none. */
  allergens?: string[] | undefined;
  /** The product this is a size or pack of (ruling 96): the group's first product. */
  variantOf?: string | undefined;
  variantLabel?: string | undefined;
  photos: PhotoInput[];
}

export interface CreatedProduct {
  product: PartnerProduct;
  /** What the shop is told about each photo, if anything. */
  photoNotes: string[];
}

type CatalogueContext = AppContext;

function money(ctx: Pick<AppContext, 'config'>, pence: number): string {
  return formatPence(pence, ctx.config.store.currencySymbol);
}

/** The listing is paused, or a paid package has lapsed: nothing new until it is put right. */
export function assertMayAdd(ctx: Pick<AppContext, 'config' | 'now'>, shop: PartnerShop): void {
  if (shop.status === 'removed' || !shop.active) {
    throw new ConflictError('This listing is paused, so nothing can be added. Please ring us.');
  }
  // A shop on a paid package that has lapsed keeps a free listing's allowance (ruling 65, 96).
  if (
    shop.kind === 'shop' &&
    paidPlan(shop.plan) &&
    !plusPaid(shop, ctx.now(), ctx.config) &&
    !shop.freeForever
  ) {
    const name = ctx.config.extras.partners.plans[shop.plan].name;
    const price = planMonthlyPence(shop.plan, ctx.config.extras.partners);
    throw new ConflictError(
      `${name} is not paid at the moment, so new products cannot be added. Pay from your dashboard, ${formatPence(price, ctx.config.store.currencySymbol)} a month, or ring us.`,
    );
  }
}

/** The plain words when the package's product count is used up. */
export function productLimitWords(
  ctx: Pick<AppContext, 'config'>,
  shop: PartnerShop,
  limit: number,
): string {
  const { plans, plusMonthlyPence, proMonthlyPence, plusFirstMonthFree } =
    ctx.config.extras.partners;
  const first = plusFirstMonthFree && !shop.plusTrialUsed ? ', the first month free' : '';
  if (shop.plan === 'free' || !plusPaid(shop, new Date(), ctx.config)) {
    return `A free listing carries up to ${limit} products. ${plans.plus.name}, ${money(ctx, plusMonthlyPence)} a month${first}, carries ${plans.plus.products}; ${plans.pro.name}, ${money(ctx, proMonthlyPence)} a month, carries ${plans.pro.products}. Upgrade from your dashboard.`;
  }
  if (shop.plan === 'plus') {
    return `${plans.plus.name} carries up to ${limit} products. ${plans.pro.name}, ${money(ctx, proMonthlyPence)} a month, carries ${plans.pro.products}. Upgrade from your dashboard.`;
  }
  return `${plans.pro.name} carries up to ${limit} products. Take some off, or ring us.`;
}

/** Everything the taxonomy asks of the details given: the category, the size, the allergens. */
function checkDetails(
  ctx: Pick<AppContext, 'config'>,
  shop: PartnerShop,
  details: {
    categoryId: string | null;
    unitQuantity: number | null;
    unitKind: string | null;
    allergens: string[] | null;
    expiresOn: Date | null;
  },
): void {
  const { catalogue } = ctx.config;
  if (details.unitKind !== null && !(UNIT_KINDS as readonly string[]).includes(details.unitKind)) {
    throw new BadRequestError(
      `The unit must be one of ${UNIT_KINDS.join(', ')}: grams, kilograms, millilitres, litres, each, or a pack.`,
    );
  }
  if ((details.unitQuantity === null) !== (details.unitKind === null)) {
    throw new BadRequestError('Please give the size as a quantity and a unit together, such as 500 g.');
  }
  if (details.allergens) {
    const unknown = unknownAllergens(details.allergens, catalogue);
    if (unknown.length > 0) {
      throw new BadRequestError(
        `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on the list of fourteen allergens. Please tick from the list.`,
      );
    }
  }
  if (details.categoryId !== null) {
    const category = categoryById(details.categoryId, catalogue);
    const allowed = categoriesFor(shop.kind, catalogue);
    if (!category || !allowed.some((entry) => entry.id === category.id)) {
      throw new BadRequestError(
        `Please choose a category from the list: ${allowed.map((entry) => entry.name).join(', ')}.`,
      );
    }
    const missing = missingDetails(category, details);
    if (missing.length > 0) {
      throw new BadRequestError(missing.map((entry) => entry.words).join(' '));
    }
  }
}

/** The allergens as given, each spelt as the list spells it. */
function tidyAllergens(ctx: Pick<AppContext, 'config'>, given: string[]): string[] {
  const byLower = new Map(ctx.config.catalogue.allergens.map((name) => [name.toLowerCase(), name]));
  return [...new Set(given.map((name) => byLower.get(name.trim().toLowerCase()) ?? name.trim()))];
}

/** Photos are looked at before anything is written, so a refused one costs nothing. */
async function assertPhotosReadable(ctx: Pick<AppContext, 'config'>, photos: PhotoInput[]): Promise<void> {
  const rules = ctx.config.catalogue.photos;
  for (const [index, photo] of photos.entries()) {
    const which = photos.length === 1 ? 'That photo' : `Photo ${index + 1}`;
    if (!(PHOTO_TYPES as readonly string[]).includes(photo.contentType)) {
      throw new BadRequestError(`${which} is not a picture we can show: please send a JPEG, PNG or WebP.`);
    }
    const bytes = Buffer.from(photo.base64, 'base64');
    if (bytes.length === 0 || bytes.length > rules.maxBytes) {
      throw new BadRequestError(`${which} is empty or too large. Please take it again.`);
    }
    try {
      const feedback = photoFeedback(await measurePhoto(bytes), rules);
      if (feedback?.refused) throw new BadRequestError(feedback.words);
    } catch (failure) {
      if (failure instanceof UnreadablePhotoError) throw new BadRequestError(failure.message);
      throw failure;
    }
  }
}

/**
 * A new product or service, checked against the package and the taxonomy, written, given its
 * photos, and sent to the automatic check (ruling 74), which approves the clear ones at once.
 */
export async function createPartnerProduct(
  ctx: CatalogueContext,
  shop: PartnerShop,
  input: NewProductInput,
  log?: FastifyBaseLogger,
): Promise<CreatedProduct> {
  const { repository, config } = ctx;
  assertMayAdd(ctx, shop);
  const limits = limitsFor(ctx, shop);
  const all = await repository.partnerProducts.listForShop(shop.id);
  const listed = all.filter((row) => row.status === 'approved' || row.status === 'pending');
  if (limits.products !== null && listed.length >= limits.products) {
    throw new ConflictError(productLimitWords(ctx, shop, limits.products));
  }
  if (input.photos.length > limits.photosPerProduct) {
    throw new BadRequestError(
      limits.photosPerProduct === 1
        ? `Your package carries one photo a product. ${config.extras.partners.plans.plus.name} carries ${config.extras.partners.plans.plus.photosPerProduct}, ${config.extras.partners.plans.pro.name} ${config.extras.partners.plans.pro.photosPerProduct}.`
        : `Your package carries up to ${limits.photosPerProduct} photos a product.`,
    );
  }
  const description = (input.description ?? '').trim();
  if (description.length > config.catalogue.descriptionMaxLength) {
    throw new BadRequestError(
      `The description is too long: up to ${config.catalogue.descriptionMaxLength} characters, please.`,
    );
  }
  // A variant (ruling 96): a size or pack of a product already listed, on a package with variants.
  let variantGroupId: string | null = null;
  let variantLabel: string | null = null;
  if (input.variantOf) {
    if (!limits.variants) {
      throw new BadRequestError(
        `Sizes and packs of one product come with ${config.extras.partners.plans.plus.name} and ${config.extras.partners.plans.pro.name}. On your package, add it as its own product.`,
      );
    }
    const parent = all.find((row) => row.id === input.variantOf && row.status !== 'removed');
    if (!parent) throw new NotFoundError('product');
    const label = (input.variantLabel ?? '').trim();
    if (!label) throw new BadRequestError('Please say which size or pack this is, such as "1 kg" or "pack of 6".');
    variantGroupId = parent.variantGroupId ?? parent.id;
    variantLabel = label;
    if (!parent.variantGroupId) {
      await repository.partnerProducts.update(parent.id, { variantGroupId: parent.id });
    }
  }
  // One product is one listing with one price, never one per pack (ruling 75); a variant with its
  // own label is a different size of the same thing.
  const nameKey = `${sameNameKey(input.name)}|${(variantLabel ?? '').toLowerCase()}`;
  const already = listed.find(
    (row) =>
      (input.barcode !== undefined && row.barcode === input.barcode) ||
      (`${sameNameKey(row.name)}|${(row.variantLabel ?? '').toLowerCase()}` === nameKey &&
        row.pricePence === input.pricePence),
  );
  if (already) throw new ConflictError(`${already.name} is already added.`);
  if (NEVER_FOUND.test(`${input.name} ${input.tags} ${description}`)) {
    throw new BadRequestError(
      `${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted, so that cannot be listed.`,
    );
  }
  if (shop.kind === 'service') {
    const refused = excludedServiceKind(
      `${input.name} ${input.tags} ${description}`,
      config.extras.partners.excludedServiceKinds,
    );
    if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
    if (!input.durationMinutes) {
      throw new BadRequestError('Please say how long the service takes, in minutes.');
    }
  }
  const expiresOn = input.expiresOn ? new Date(`${input.expiresOn}T00:00:00Z`) : null;
  const allergens = input.allergens === undefined ? null : tidyAllergens(ctx, input.allergens);
  const details = {
    categoryId: input.categoryId ?? null,
    unitQuantity: input.unitQuantity ?? null,
    unitKind: input.unitKind ?? null,
    allergens,
    expiresOn,
  };
  checkDetails(ctx, shop, details);
  await assertPhotosReadable(ctx, input.photos);

  const product = await repository.partnerProducts.create({
    partnerShopId: shop.id,
    name: input.name,
    pricePence: input.pricePence,
    tags: input.tags,
    expiresOn,
    photo: null,
    photoType: null,
    durationMinutes: shop.kind === 'service' ? (input.durationMinutes ?? null) : null,
    barcode: shop.kind === 'service' ? null : (input.barcode ?? null),
    priceEstimated: input.priceEstimated,
    description,
    categoryId: details.categoryId,
    unitQuantity: details.unitQuantity,
    unitKind: details.unitKind,
    allergens: allergens ?? [],
    allergensGiven: allergens !== null,
    variantGroupId,
    variantLabel,
    sortOrder: all.length,
  });
  const photoNotes: string[] = [];
  for (const photo of input.photos) {
    const added = await addProductPhoto(ctx, shop, product, photo);
    if (added.note) photoNotes.push(added.note);
  }
  // The automatic check (ruling 74): clear ones are approved at once, clearly restricted ones
  // refused by the rule lists, and anything doubtful goes to the owner.
  await checkInBackground(ctx, log, () => checkPartnerProduct(ctx, product.id, log));
  const latest = (await repository.partnerProducts.findById(product.id)) ?? product;
  return { product: latest, photoNotes };
}

export interface EditProductInput {
  name?: string;
  description?: string;
  categoryId?: string | null;
  tags?: string;
  pricePence?: number;
  expiresOn?: string | null;
  unitQuantity?: number | null;
  unitKind?: string | null;
  allergens?: string[] | null;
  variantLabel?: string | null;
  durationMinutes?: number | null;
}

/**
 * Full editing (ruling 96). A new price applies at once (prices are estimates, and the Shopper
 * pays the till); a change of name, category, description or labels re-runs the automatic check,
 * which may ask the owner; the catalogue item Shoppers buy is kept in step.
 */
export async function editPartnerProduct(
  ctx: CatalogueContext,
  shop: PartnerShop,
  product: PartnerProduct,
  input: EditProductInput,
  log?: FastifyBaseLogger,
): Promise<PartnerProduct> {
  const { repository, config } = ctx;
  const description = input.description === undefined ? product.description : input.description.trim();
  if (description.length > config.catalogue.descriptionMaxLength) {
    throw new BadRequestError(
      `The description is too long: up to ${config.catalogue.descriptionMaxLength} characters, please.`,
    );
  }
  const name = input.name === undefined ? product.name : input.name.trim();
  const tags = input.tags === undefined ? product.tags : input.tags.trim();
  if (NEVER_FOUND.test(`${name} ${tags} ${description}`)) {
    throw new BadRequestError(
      `${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted, so that cannot be listed.`,
    );
  }
  if (shop.kind === 'service') {
    const refused = excludedServiceKind(
      `${name} ${tags} ${description}`,
      config.extras.partners.excludedServiceKinds,
    );
    if (refused) throw new BadRequestError(excludedServiceWords(refused, config.productName));
  }
  const expiresOn =
    input.expiresOn === undefined
      ? product.expiresOn
      : input.expiresOn === null
        ? null
        : new Date(`${input.expiresOn}T00:00:00Z`);
  const allergens =
    input.allergens === undefined
      ? product.allergensGiven
        ? product.allergens
        : null
      : input.allergens === null
        ? null
        : tidyAllergens(ctx, input.allergens);
  const details = {
    categoryId: input.categoryId === undefined ? product.categoryId : input.categoryId,
    unitQuantity: input.unitQuantity === undefined ? product.unitQuantity : input.unitQuantity,
    unitKind: input.unitKind === undefined ? product.unitKind : input.unitKind,
    allergens,
    expiresOn,
  };
  checkDetails(ctx, shop, details);
  if (input.variantLabel !== undefined && product.variantGroupId && !input.variantLabel?.trim()) {
    throw new BadRequestError('A size or pack of a product needs its label, such as "1 kg".');
  }
  const pricePence = input.pricePence ?? product.pricePence;
  const updated = await repository.partnerProducts.update(product.id, {
    name,
    description,
    tags,
    pricePence,
    ...(input.pricePence !== undefined ? { priceEstimated: false } : {}),
    expiresOn,
    categoryId: details.categoryId,
    unitQuantity: details.unitQuantity,
    unitKind: details.unitKind,
    allergens: allergens ?? [],
    allergensGiven: allergens !== null,
    ...(input.variantLabel !== undefined
      ? { variantLabel: input.variantLabel?.trim() || null }
      : {}),
    ...(input.durationMinutes !== undefined && shop.kind === 'service'
      ? { durationMinutes: input.durationMinutes }
      : {}),
  });
  if (product.catalogueItemId) {
    await repository.catalogue.update(product.catalogueItemId, {
      name: catalogueName(updated, shop),
      // What Shoppers pay: with any agreed mark-up (Anthony, 30 October 2026).
      estimatedPricePence: shopperPricePence(shop, pricePence),
      lastSeenAt: ctx.now(),
    });
  }
  // A change is checked like a new one (ruling 74): a doubtful name or price goes to the owner.
  await checkInBackground(ctx, log, () =>
    checkPartnerProduct(ctx, product.id, log, { edited: true }),
  );
  return (await repository.partnerProducts.findById(product.id)) ?? updated;
}

/** The catalogue item's name: "Bananas, bunch of 5 (Corner Shop)". */
export function catalogueName(product: Pick<PartnerProduct, 'name' | 'variantLabel'>, shop: Pick<PartnerShop, 'name'>): string {
  return `${product.name}${product.variantLabel ? `, ${product.variantLabel}` : ''} (${shop.name})`;
}

/* ------------------------------------------------------------------ bulk add (Pro) */

/** The CSV template a Pro shop downloads: the columns, then one example row. */
export function bulkTemplateCsv(): string {
  return [
    BULK_COLUMNS.join(','),
    [
      'Bananas',
      '1.20',
      'Fruit and vegetables',
      '5',
      'each',
      'none',
      '',
      'Five ripe bananas, sold as a bunch.',
    ]
      .map(csvCell)
      .join(','),
  ].join('\r\n');
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows of cells from CSV text, quotes honoured, blank lines skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at] as string;
    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          cell += '"';
          at += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[at + 1] === '\n') at += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

export type BulkRowResult =
  | { row: number; ok: true; name: string; status: PartnerProduct['status'] }
  | { row: number; ok: false; name: string; error: string };

/**
 * A CSV of products (Pro, ruling 96): the header must be the template's columns; each row is
 * checked and added like a product typed in, and a row that fails says why, in plain words, while
 * the rest go on. Nothing is half-added.
 */
export async function bulkAddProducts(
  ctx: CatalogueContext,
  shop: PartnerShop,
  csv: string,
  log?: FastifyBaseLogger,
): Promise<{ results: BulkRowResult[]; added: number; failed: number }> {
  const limits = limitsFor(ctx, shop);
  if (!limits.bulkAdd) {
    throw new BadRequestError(
      `Adding products from a spreadsheet comes with ${ctx.config.extras.partners.plans.pro.name}. Upgrade from your dashboard, or add them one at a time.`,
    );
  }
  const rows = parseCsv(csv);
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const expected = BULK_COLUMNS.map((column) => column.toLowerCase());
  if (header.length < expected.length || expected.some((column, at) => header[at] !== column)) {
    throw new BadRequestError(
      `The first line must be the template's columns, in order: ${BULK_COLUMNS.join(', ')}. Download the template and fill it in.`,
    );
  }
  if (rows.length > 501) {
    throw new BadRequestError('Up to 500 products at a time, please. Split the file and send the rest after.');
  }
  const categories = categoriesFor(shop.kind, ctx.config.catalogue);
  const results: BulkRowResult[] = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    const at = (column: (typeof BULK_COLUMNS)[number]): string =>
      (cells[BULK_COLUMNS.indexOf(column)] ?? '').trim();
    const name = at('name');
    try {
      if (name.length < 2) throw new BadRequestError('The name is missing.');
      const pounds = Number(at('price').replace(/[£\s]/g, ''));
      if (!Number.isFinite(pounds) || pounds <= 0) {
        throw new BadRequestError('The price must be in pounds, such as 2.50.');
      }
      const categoryWord = at('category');
      const category = categoryWord
        ? categories.find(
            (entry) =>
              entry.id === categoryWord.toLowerCase() ||
              entry.name.toLowerCase() === categoryWord.toLowerCase(),
          )
        : undefined;
      if (categoryWord && !category) {
        throw new BadRequestError(
          `"${categoryWord}" is not a category. Use one of: ${categories.map((entry) => entry.name).join(', ')}.`,
        );
      }
      const quantityWord = at('unit quantity');
      const unitWord = at('unit').toLowerCase();
      const unitQuantity = quantityWord ? Number(quantityWord) : undefined;
      if (quantityWord && !(Number.isFinite(unitQuantity) && (unitQuantity as number) > 0)) {
        throw new BadRequestError('The unit quantity must be a number, such as 500.');
      }
      const barcode = at('barcode').replace(/\s+/g, '');
      if (barcode && !/^\d{8,14}$/.test(barcode)) {
        throw new BadRequestError('A barcode is 8 to 14 digits.');
      }
      // "Milk; Eggs" as the list spells them, or "none"; empty is "not said".
      const allergensWord = at('allergens');
      const allergens =
        allergensWord === ''
          ? undefined
          : /^none$/i.test(allergensWord)
            ? []
            : allergensWord
                .split(/[;|]/)
                .map((name) => name.trim())
                .filter(Boolean);
      const created = await createPartnerProduct(
        ctx,
        shop,
        {
          name: name.slice(0, 120),
          pricePence: Math.round(pounds * 100),
          tags: category?.name ?? '',
          priceEstimated: false,
          ...(category ? { categoryId: category.id } : {}),
          ...(unitQuantity !== undefined ? { unitQuantity } : {}),
          ...(unitWord ? { unitKind: unitWord } : {}),
          ...(allergens !== undefined ? { allergens } : {}),
          ...(barcode ? { barcode } : {}),
          description: at('description').slice(0, ctx.config.catalogue.descriptionMaxLength),
          photos: [],
        },
        log,
      );
      results.push({ row: rowNumber, ok: true, name, status: created.product.status });
    } catch (failure) {
      results.push({
        row: rowNumber,
        ok: false,
        name: name || '(no name)',
        error: failure instanceof Error ? failure.message : 'That row could not be added.',
      });
    }
  }
  return {
    results,
    added: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };
}
