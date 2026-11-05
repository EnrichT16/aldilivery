/**
 * Move Shop Partners' product photos into DigitalOcean Spaces (ruling 96, 5 November 2026).
 *
 * Until the SPACES_* settings are set, photos are kept in the database: the sizes made since
 * ruling 96 in StoredFile, and, for products from before it, one picture on the product's own row
 * (PartnerProduct.photo). This script moves both into the Space, once, and can be run as often as
 * anyone likes: a photo already in Spaces is left alone, and nothing is deleted from the database
 * until its copy is confirmed in the Space.
 *
 * It needs the database address and the six SPACES_* settings (SPACES_CDN_URL may be left out),
 * the same ones the API reads. Lists what it would do and stops; add --yes to do it.
 *
 *   DATABASE_URL="postgresql://..." SPACES_KEY=... SPACES_SECRET=... SPACES_BUCKET=... \
 *     SPACES_REGION=lon1 SPACES_ENDPOINT=lon1.digitaloceanspaces.com \
 *     node packages/api/scripts/move-photos-to-spaces.mjs --yes
 *
 * Run from the repository root after `pnpm --filter @aldilivery/api build`, which makes the
 * compiled helpers it uses (the same code the server runs).
 */

import { PrismaClient } from '@prisma/client';

import { makeDerivatives, measurePhoto } from '../dist/lib/photo-quality.js';
import { spacesPhotoStore, spacesSettingsFrom } from '../dist/lib/photo-store.js';

const reallyMove = process.argv.includes('--yes');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set, so there is no database to work on.');
  process.exit(1);
}

const settings = spacesSettingsFrom({
  spacesKey: process.env.SPACES_KEY,
  spacesSecret: process.env.SPACES_SECRET,
  spacesBucket: process.env.SPACES_BUCKET,
  spacesRegion: process.env.SPACES_REGION,
  spacesEndpoint: process.env.SPACES_ENDPOINT,
  spacesCdnUrl: process.env.SPACES_CDN_URL,
});
if (!settings) {
  console.error(
    'SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION and SPACES_ENDPOINT must all be set.',
  );
  process.exit(1);
}

/** The photo rules the server uses, from config/store.json; the defaults if it cannot be read. */
async function photoRules() {
  try {
    const { loadStoreConfig } = await import('@aldilivery/core/node');
    return loadStoreConfig(process.env.STORE_CONFIG_PATH).catalogue.photos;
  } catch {
    return {
      sizes: { thumb: 320, medium: 800, full: 1600 },
      webpQuality: 82,
      jpegQuality: 85,
      hardFloorLongSide: 500,
      minimumLongSide: 800,
      darkBelow: 50,
      brightAbove: 215,
      blurBelow: 40,
      maxBytes: 4 * 1024 * 1024,
    };
  }
}

const prisma = new PrismaClient();
const store = spacesPhotoStore(settings);
const rules = await photoRules();

const sizes = ['thumb', 'medium', 'full'];
const keyOf = (photo, size, format) => {
  const webp = size === 'thumb' ? photo.thumbKey : size === 'medium' ? photo.mediumKey : photo.fullKey;
  return format === 'webp' ? webp : webp.replace(/\.webp$/, '.jpg');
};

try {
  // 1. Sizes already made, kept in StoredFile: copy each file up, then mark the row and tidy.
  const dbPhotos = await prisma.partnerProductPhoto.findMany({ where: { storage: 'db' } });
  console.log(`${dbPhotos.length} photo${dbPhotos.length === 1 ? '' : 's'} kept in the database.`);
  let moved = 0;
  for (const photo of dbPhotos) {
    const keys = [];
    for (const size of sizes) for (const format of ['webp', 'jpeg']) keys.push(keyOf(photo, size, format));
    if (!reallyMove) {
      console.log(`  would move ${photo.id} (${keys.length} files)`);
      continue;
    }
    let complete = true;
    for (const key of keys) {
      const file = await prisma.storedFile.findUnique({ where: { key } });
      if (!file) {
        complete = false;
        console.log(`  ${photo.id}: ${key} is missing from the database; left as it is.`);
        break;
      }
      await store.put(key, file.data, file.contentType);
      const check = await store.get(key);
      if (!check || check.bytes.length !== file.data.length) {
        complete = false;
        console.log(`  ${photo.id}: ${key} did not arrive whole; left as it is.`);
        break;
      }
    }
    if (!complete) continue;
    await prisma.partnerProductPhoto.update({ where: { id: photo.id }, data: { storage: 'spaces' } });
    await prisma.storedFile.deleteMany({ where: { key: { in: keys } } });
    moved += 1;
    console.log(`  moved ${photo.id}`);
  }

  // 2. Products from before ruling 96 with one picture on the row: make its sizes, put them up,
  //    give the product a photo row, and clear the bytes on the row.
  const legacy = await prisma.partnerProduct.findMany({
    where: { photo: { not: null }, status: { not: 'removed' } },
    select: { id: true, photo: true, photoType: true, createdAt: true },
  });
  console.log(`${legacy.length} older product${legacy.length === 1 ? '' : 's'} with a picture on the row.`);
  let converted = 0;
  for (const product of legacy) {
    const already = await prisma.partnerProductPhoto.count({ where: { productId: product.id } });
    if (already > 0) {
      if (reallyMove) {
        await prisma.partnerProduct.update({ where: { id: product.id }, data: { photo: null, photoType: null } });
        console.log(`  ${product.id}: already has photos; row picture cleared.`);
      }
      continue;
    }
    if (!reallyMove) {
      console.log(`  would convert ${product.id}`);
      continue;
    }
    let measured;
    try {
      measured = await measurePhoto(product.photo);
    } catch {
      console.log(`  ${product.id}: the picture on the row cannot be read; left as it is.`);
      continue;
    }
    const base = `partner-products/${product.id}/moved-${product.createdAt.getTime().toString(36)}`;
    const derivatives = await makeDerivatives(product.photo, rules);
    for (const derivative of derivatives) {
      await store.put(
        `${base}-${derivative.size}.${derivative.format === 'webp' ? 'webp' : 'jpg'}`,
        derivative.bytes,
        derivative.contentType,
      );
    }
    await prisma.partnerProductPhoto.create({
      data: {
        productId: product.id,
        position: 0,
        storage: 'spaces',
        thumbKey: `${base}-thumb.webp`,
        mediumKey: `${base}-medium.webp`,
        fullKey: `${base}-full.webp`,
        width: measured.width,
        height: measured.height,
        bytes: product.photo.length,
      },
    });
    await prisma.partnerProduct.update({ where: { id: product.id }, data: { photo: null, photoType: null } });
    converted += 1;
    console.log(`  converted ${product.id}`);
  }

  if (!reallyMove) {
    console.log('Nothing was moved. Add --yes to move them.');
  } else {
    console.log(`Done: ${moved} moved, ${converted} converted. Run again any time; it changes nothing twice.`);
  }
} finally {
  await prisma.$disconnect();
}
