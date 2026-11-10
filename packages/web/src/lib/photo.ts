/**
 * A photo from the phone's camera, made ready to send: shrunk so a long side is at most 1600
 * pixels and saved as a JPEG, which turns a several-megabyte photo into a few hundred kilobytes
 * that still reads clearly. Where the browser cannot draw it (an old browser, or the tests), the
 * photo is sent as it is.
 *
 * A second way to read it (10 November 2026, ruling 100). Some phones take more than four seconds
 * to open a large camera photo as a picture element, or cannot open that kind at all, and the
 * photo then went as it was: several megabytes, sometimes more than the server takes, so a
 * Runner's document never arrived. Before giving up, the browser is asked once to decode the
 * file itself (`createImageBitmap`), which is quicker and reads more kinds. Only if that fails
 * too is the photo sent as it is.
 */

const LONGEST_SIDE = 1600;

export interface ReadyPhoto {
  /** The photo as base64, without the `data:` prefix. */
  base64: string;
  contentType: string;
}

function asDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That photo could not be read. Please take it again.'));
    reader.readAsDataURL(file);
  });
}

function split(dataUrl: string, fallbackType: string): ReadyPhoto {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  return { contentType: match?.[1] ?? fallbackType, base64: match?.[2] ?? '' };
}

/** Draws a decoded picture no longer than 1600 pixels on its long side, and saves it as a JPEG. */
function shrunk(picture: CanvasImageSource, width: number, height: number): ReadyPhoto {
  const scale = Math.min(1, LONGEST_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0) throw new Error('no canvas');
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const ready = split(canvas.toDataURL('image/jpeg', 0.85), 'image/jpeg');
  if (ready.base64 === '') throw new Error('nothing drawn');
  return ready;
}

export async function preparePhoto(file: File): Promise<ReadyPhoto> {
  if (typeof window.createImageBitmap !== 'function') {
    // No way to draw it here: send it as it is.
    return split(await asDataUrl(file), file.type || 'image/jpeg');
  }
  const original = await asDataUrl(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      // A browser that never says either way is treated as one that cannot draw it.
      const giveUp = window.setTimeout(() => reject(new Error('timed out')), 4000);
      element.onload = () => {
        window.clearTimeout(giveUp);
        resolve(element);
      };
      element.onerror = () => {
        window.clearTimeout(giveUp);
        reject(new Error('unreadable'));
      };
      element.src = original;
    });
    return shrunk(image, image.width, image.height);
  } catch {
    // Too slow or unreadable that way: once more, decoded by the browser itself.
    try {
      const bitmap = await window.createImageBitmap(file);
      try {
        return shrunk(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close?.();
      }
    } catch {
      return split(original, file.type || 'image/jpeg');
    }
  }
}

/**
 * A PDF chosen from the phone or computer, sent as it is (27 October 2026): a DBS certificate
 * or an insurance certificate often arrives by email as one. The server takes up to 6 MB.
 */
export const MAX_PDF_BYTES = 6 * 1024 * 1024;

export async function preparePdf(file: File): Promise<ReadyPhoto> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      'That file is too large. Please choose one under 6 MB, or take a photo instead.',
    );
  }
  return split(await asDataUrl(file), 'application/pdf');
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
