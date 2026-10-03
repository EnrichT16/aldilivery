/**
 * A photo from the phone's camera, made ready to send: shrunk so a long side is at most 1600
 * pixels and saved as a JPEG, which turns a several-megabyte photo into a few hundred kilobytes
 * that still reads clearly. Where the browser cannot draw it (an old browser, or the tests), the
 * photo is sent as it is.
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
    const scale = Math.min(1, LONGEST_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0) throw new Error('no canvas');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return split(canvas.toDataURL('image/jpeg', 0.85), 'image/jpeg');
  } catch {
    return split(original, file.type || 'image/jpeg');
  }
}
