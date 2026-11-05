/**
 * One of a shop's own products on its dashboard (ruling 96, 5 November 2026): every detail, its
 * photos (add one with the camera or from the phone, take one off, choose the cover), full
 * editing, a quick change of price, taking it off, a size or pack of it as a variant (Plus and
 * Pro), and, on Pro, featuring it and moving it up or down the page.
 */

import { useState } from 'react';

import {
  addPartnerProductPhoto,
  makePartnerProductCover,
  photoSrc,
  removePartnerProduct,
  removePartnerProductPhoto,
  setPartnerPrice,
  setPartnerProductFeatured,
  type PartnerCatalogueOptions,
  type PartnerKind,
  type PartnerPlanLimits,
  type PartnerProductRow,
} from '../../lib/api';
import { money } from '../../lib/money';
import { preparePhoto } from '../../lib/photo';
import { PhotoChoice } from '../PhotoChoice';
import { ProductForm } from './ProductForm';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

export const STATUS_WORDS: Record<PartnerProductRow['status'], string> = {
  pending: 'waiting to be checked',
  approved: 'live',
  rejected: 'not accepted',
  removed: 'taken off',
};

function longDate(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function ProductCard({
  product,
  kind,
  catalogue,
  limits,
  canMoveUp,
  canMoveDown,
  onNews,
  onProblem,
  onChanged,
  onMove,
  onAddVariant,
}: {
  product: PartnerProductRow;
  kind: PartnerKind;
  catalogue: PartnerCatalogueOptions;
  limits: PartnerPlanLimits;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onNews: (words: string) => void;
  onProblem: (words: string) => void;
  onChanged: () => void;
  onMove: (direction: -1 | 1) => void;
  onAddVariant: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const photos = product.photos ?? [];
  const photosLeft = Math.max(0, limits.photosPerProduct - photos.length);
  const tell = (promise: Promise<{ message: string }>): void => {
    void promise
      .then((result) => {
        onNews(result.message);
        onChanged();
      })
      .catch((failure: unknown) =>
        onProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  const addPhoto = async (file: File): Promise<void> => {
    try {
      const ready = await preparePhoto(file);
      tell(addPartnerProductPhoto(product.id, { photo: ready.base64, photoType: ready.contentType }));
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : 'That photo could not be read.');
    }
  };
  const details = [
    product.category ? product.category.name : '',
    product.unit?.quantityWords ? `Size ${product.unit.quantityWords}` : '',
    product.unit?.words ?? '',
    product.allergenWords ?? '',
    product.expiresOn ? `Best before ${longDate(product.expiresOn)}` : '',
    product.variantLabel ? `Size or pack: ${product.variantLabel}` : '',
  ].filter(Boolean);

  return (
    <li className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        {photos[0] && (
          <picture>
            <source srcSet={photoSrc(photos[0].thumb)} type="image/webp" />
            <img
              src={photoSrc(photos[0].thumbJpeg)}
              alt={photos[0].alt}
              className="w-20 h-20 object-cover rounded-xl"
            />
          </picture>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="m-0 font-bold">
            {product.name}
            {product.variantLabel ? `, ${product.variantLabel}` : ''}, {money(product.pricePence)}
            {product.featured && <span className="ms-2 rounded-full px-2 bg-highlight text-on-accent text-base">Featured</span>}
          </h3>
          <p className="m-0">
            {STATUS_WORDS[product.status][0]?.toUpperCase()}
            {STATUS_WORDS[product.status].slice(1)}.{product.note ? ` ${product.note}` : ''}
          </p>
          {details.length > 0 && <p className="m-0 text-paper/80">{details.join('. ')}.</p>}
          {product.description && <p className="m-0">{product.description}</p>}
        </div>
      </div>
      {product.priceEstimated && (
        <p className="m-0 font-bold">
          <span aria-hidden="true">⚠️</span> The price is an estimate: please check it, and change it
          below if it is not right.
        </p>
      )}

      {editing ? (
        <ProductForm
          kind={kind}
          catalogue={catalogue}
          limits={limits}
          product={product}
          onDone={(words) => {
            setEditing(false);
            onNews(words);
            onChanged();
          }}
          onProblem={onProblem}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const pounds = Number(
              String(new FormData(event.currentTarget).get('price') ?? '').replace(/[£\s]/g, ''),
            );
            if (!Number.isFinite(pounds) || pounds <= 0) return;
            tell(setPartnerPrice(product.id, Math.round(pounds * 100)));
          }}
          className="flex flex-wrap gap-2 items-end"
        >
          <label className="block">
            New price
            <input name="price" inputMode="decimal" className={field} />
          </label>
          <button type="submit" className="control border-paper bg-paper/10 text-paper">
            Change the price<span className="visually-hidden"> of {product.name}</span>
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="control border-paper bg-paper/10 text-paper"
          >
            Change the details<span className="visually-hidden"> of {product.name}</span>
          </button>
          <button
            type="button"
            onClick={() => tell(removePartnerProduct(product.id))}
            className="control bg-paper/10 text-paper underline"
          >
            Take it off<span className="visually-hidden">: {product.name}</span>
          </button>
        </form>
      )}

      {kind !== 'service' && (
        <section aria-label={`Photos of ${product.name}`} className="space-y-2">
          {photos.length > 1 && (
            <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <li key={photo.id} className="space-y-1">
                  <picture>
                    <source srcSet={photoSrc(photo.thumb)} type="image/webp" />
                    <img
                      src={photoSrc(photo.thumbJpeg)}
                      alt={`${photo.alt}${index === 0 ? ' (the cover)' : ''}`}
                      className="w-20 h-20 object-cover rounded-xl"
                    />
                  </picture>
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => tell(makePartnerProductCover(product.id, photo.id))}
                      className="control w-full bg-paper/10 text-paper underline !py-1"
                    >
                      Make it the cover<span className="visually-hidden"> of {product.name}, photo {index + 1}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => tell(removePartnerProductPhoto(product.id, photo.id))}
                    className="control w-full bg-paper/10 text-paper underline !py-1"
                  >
                    Take it off<span className="visually-hidden">: photo {index + 1} of {product.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photos.length === 1 && (
            <button
              type="button"
              onClick={() => tell(removePartnerProductPhoto(product.id, photos[0]!.id))}
              className="control bg-paper/10 text-paper underline"
            >
              Take the photo off<span className="visually-hidden"> {product.name}</span>
            </button>
          )}
          {photosLeft > 0 ? (
            <PhotoChoice
              takeLabel={photos.length === 0 ? 'Take a photo' : 'Take another photo'}
              chooseLabel={photos.length === 0 ? 'Choose a photo' : 'Choose another photo'}
              takeClassName="control border-paper bg-paper/10 text-paper"
              onFile={(file) => void addPhoto(file)}
            />
          ) : (
            <p className="m-0 text-paper/80">
              {limits.photosPerProduct === 1 ? 'One photo' : `${limits.photosPerProduct} photos`} is the
              most on your package.
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {limits.variants && !product.variantLabel && kind !== 'service' && (
          <button type="button" onClick={onAddVariant} className="control border-paper bg-paper/10 text-paper">
            Add a size or pack of this<span className="visually-hidden">: {product.name}</span>
          </button>
        )}
        {limits.featured && (
          <>
            <button
              type="button"
              onClick={() => tell(setPartnerProductFeatured(product.id, !product.featured))}
              className="control border-paper bg-paper/10 text-paper"
            >
              {product.featured ? 'Stop featuring' : 'Feature it'}
              <span className="visually-hidden">: {product.name}</span>
            </button>
            <button
              type="button"
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
              className="control border-paper bg-paper/10 text-paper disabled:opacity-50"
            >
              Move up<span className="visually-hidden">: {product.name}</span>
            </button>
            <button
              type="button"
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
              className="control border-paper bg-paper/10 text-paper disabled:opacity-50"
            >
              Move down<span className="visually-hidden">: {product.name}</span>
            </button>
          </>
        )}
      </div>
    </li>
  );
}
