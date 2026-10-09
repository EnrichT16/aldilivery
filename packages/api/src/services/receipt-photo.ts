/**
 * The photo of the till receipt (docs/STILL_TO_DO.md item 2).
 *
 * The Runner takes it in the app when the till total goes in, or adds it afterwards. It is kept
 * with the order, for the people who approve a pay-back (ruling 55) or settle a till total with
 * the Shopper. It is optional, but encouraged: without one, paying the Runner back more than
 * `receipts.photoNeededAbovePence` waits for a person (services/reimburse.ts).
 */

import { z } from 'zod';

import type { AppContext } from '../app.js';
import { BadRequestError } from '../errors.js';

/** The same kinds of photo a problem report takes (routes/problems.ts). */
export const RECEIPT_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const receiptPhotoSchema = z.object({
  /** The photo as base64, without the `data:` prefix, as the app's photo helper makes it. */
  data: z
    .string()
    .min(1)
    .max(12 * 1024 * 1024),
  contentType: z.string().max(40),
});

export type ReceiptPhotoInput = z.infer<typeof receiptPhotoSchema>;

/** Checks the photo and keeps it with the order, replacing any sent before. */
export async function keepReceiptPhoto(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  orderId: string,
  photo: ReceiptPhotoInput,
): Promise<void> {
  const type = photo.contentType.split(';')[0]?.trim() ?? '';
  if (!RECEIPT_PHOTO_TYPES.includes(type)) {
    throw new BadRequestError('Please send a photo of the receipt.');
  }
  const data = Buffer.from(photo.data, 'base64');
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) {
    throw new BadRequestError('That photo is too large to send. Please take it again.');
  }
  await ctx.repository.receiptPhotos.save({
    orderId,
    data,
    contentType: type,
    createdAt: ctx.now(),
  });
}
