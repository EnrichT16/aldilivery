/**
 * A product's photos on a shop's page (ruling 96, 5 November 2026): the cover, with "Previous
 * photo" and "Next photo" buttons when there are more, each photo with its own alt text, WebP
 * with a JPEG beside it for browsers that cannot show WebP. Where a product has no photo, the
 * shop's emoji stands in, as before. Large controls, labelled for a screen reader.
 */

import { useState } from 'react';

import { photoSrc, type ProductPhoto } from '../lib/api';

export function ProductGallery({
  photos,
  fallback,
  background,
  name,
}: {
  photos: ProductPhoto[];
  /** What stands in for a photo, such as the shop's emoji. */
  fallback: string;
  background: string;
  name: string;
}): JSX.Element {
  const [at, setAt] = useState(0);
  const photo = photos[Math.min(at, Math.max(0, photos.length - 1))];
  return (
    <div
      className="relative shrink-0 w-28 h-28 rounded-2xl overflow-hidden flex items-center justify-center"
      style={{ background }}
      role={photos.length > 1 ? 'group' : undefined}
      aria-label={photos.length > 1 ? `Photos of ${name}, ${photos.length}` : undefined}
    >
      {photo ? (
        <picture>
          <source srcSet={photoSrc(photo.medium)} type="image/webp" />
          <img
            src={photoSrc(photo.mediumJpeg)}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </picture>
      ) : (
        <span aria-hidden="true" className="text-[3.2rem] leading-none">
          {fallback}
        </span>
      )}
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setAt((before) => (before - 1 + photos.length) % photos.length)}
            className="absolute inset-y-0 left-0 w-10 flex items-center justify-center bg-black/40 text-white text-2xl"
          >
            <span aria-hidden="true">‹</span>
            <span className="visually-hidden">Previous photo of {name}</span>
          </button>
          <button
            type="button"
            onClick={() => setAt((before) => (before + 1) % photos.length)}
            className="absolute inset-y-0 right-0 w-10 flex items-center justify-center bg-black/40 text-white text-2xl"
          >
            <span aria-hidden="true">›</span>
            <span className="visually-hidden">Next photo of {name}</span>
          </button>
          <span className="visually-hidden" aria-live="polite">
            Photo {Math.min(at, photos.length - 1) + 1} of {photos.length}
          </span>
        </>
      )}
    </div>
  );
}
