/**
 * Looking at a product photo before anything else does (ruling 96, 5 November 2026): its size,
 * how dark or bright it is, and how sharp, so a shop is told at once, in plain words, "That photo
 * is too dark. Try it near a window." The thresholds and the derivative sizes are in
 * `catalogue.photos` in config/store.json; the words are in core (`photoFeedback`).
 *
 * The pictures themselves are made here too: three sizes (thumb, medium, full), each as WebP with
 * a JPEG beside it for browsers that cannot show WebP. Everything is done with sharp.
 */

import sharp from 'sharp';
import type { PhotoMeasure, PhotoRules } from '@aldilivery/core';

export interface Derivative {
  size: 'thumb' | 'medium' | 'full';
  format: 'webp' | 'jpeg';
  contentType: 'image/webp' | 'image/jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * What the picture is like. Brightness is the mean grey level, 0 to 255. Sharpness is the
 * variance of a Laplacian over the picture shrunk to a fixed width, so a big and a small photo of
 * the same thing measure alike; a photo with hardly any edges (blurry) comes out low.
 */
export async function measurePhoto(bytes: Uint8Array): Promise<PhotoMeasure> {
  const image = sharp(bytes, { failOn: 'none' }).rotate();
  let width = 0;
  let height = 0;
  try {
    const meta = await image.metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    // Not a picture at all: said plainly, below.
  }
  if (!width || !height) throw new UnreadablePhotoError();
  const grey = image.clone().greyscale();
  const stats = await grey.clone().stats();
  const brightness = stats.channels[0]?.mean ?? 0;
  const edges = await grey
    .clone()
    .resize({ width: Math.min(width, 500), withoutEnlargement: true })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer();
  let sum = 0;
  for (const value of edges) sum += value;
  const mean = edges.length ? sum / edges.length : 0;
  let squares = 0;
  for (const value of edges) squares += (value - mean) * (value - mean);
  const sharpness = edges.length ? squares / edges.length : 0;
  return { width, height, brightness, sharpness };
}

export class UnreadablePhotoError extends Error {
  constructor() {
    super('That photo could not be read. Please take it again.');
    this.name = 'UnreadablePhotoError';
  }
}

/** The three sizes, each as WebP and JPEG. Nothing is ever enlarged. */
export async function makeDerivatives(
  bytes: Uint8Array,
  rules: PhotoRules,
): Promise<Derivative[]> {
  const base = sharp(bytes, { failOn: 'none' }).rotate();
  const out: Derivative[] = [];
  for (const size of ['thumb', 'medium', 'full'] as const) {
    const longSide = rules.sizes[size];
    const resized = base.clone().resize({
      width: longSide,
      height: longSide,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const webp = await resized
      .clone()
      .webp({ quality: rules.webpQuality })
      .toBuffer({ resolveWithObject: true });
    out.push({
      size,
      format: 'webp',
      contentType: 'image/webp',
      bytes: webp.data,
      width: webp.info.width,
      height: webp.info.height,
    });
    const jpeg = await resized
      .clone()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: rules.jpegQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    out.push({
      size,
      format: 'jpeg',
      contentType: 'image/jpeg',
      bytes: jpeg.data,
      width: jpeg.info.width,
      height: jpeg.info.height,
    });
  }
  return out;
}

/** A plain test picture: a grey field of the given size, with optional noise for sharpness. */
export async function testPicture(options: {
  width: number;
  height: number;
  /** 0 (black) to 255 (white). */
  grey?: number;
  /** Draw sharp black and white squares, so the picture reads as sharp rather than blurry. */
  checkered?: boolean;
  blurred?: boolean;
  format?: 'jpeg' | 'png' | 'webp';
}): Promise<Buffer> {
  const { width, height } = options;
  const grey = options.grey ?? 128;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels, grey);
  if (options.checkered) {
    const cell = 16;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        const value = light ? Math.min(255, grey + 60) : Math.max(0, grey - 60);
        const at = (y * width + x) * channels;
        raw[at] = value;
        raw[at + 1] = value;
        raw[at + 2] = value;
      }
    }
  }
  let image = sharp(raw, { raw: { width, height, channels } });
  if (options.blurred) image = image.blur(12);
  const format = options.format ?? 'jpeg';
  return format === 'png' ? image.png().toBuffer() : format === 'webp' ? image.webp().toBuffer() : image.jpeg().toBuffer();
}
