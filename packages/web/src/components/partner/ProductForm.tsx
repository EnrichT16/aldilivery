/**
 * Adding or editing a product the way the professionals do (ruling 96, 5 November 2026): the
 * name and counter price, a description, the category from the taxonomy (which says what else
 * is needed: the size for a unit price, the allergens, a best before), labels, and photos taken
 * with the camera or chosen from the phone, each looked at by the server as it arrives and said
 * about in plain words. A size or pack of a product already listed is added as a variant.
 *
 * Everything the form offers (categories, allergens, units, how many photos, the photo rules)
 * comes from the dashboard's `catalogue` and `plan.limits`, which read config/store.json.
 */

import { useId, useState, type FormEvent } from 'react';

import {
  addPartnerProduct,
  editPartnerProduct,
  photoSrc,
  type PartnerCatalogueOptions,
  type PartnerKind,
  type PartnerPlanLimits,
  type PartnerProductRow,
  type PhotoInput,
} from '../../lib/api';
import { preparePhoto } from '../../lib/photo';
import { PhotoChoice } from '../PhotoChoice';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

/** A photo waiting to be sent, with a small picture of it for the shop to see. */
interface PendingPhoto {
  key: string;
  input: PhotoInput;
  preview: string;
}

export interface ProductFormProps {
  kind: PartnerKind;
  catalogue: PartnerCatalogueOptions;
  limits: PartnerPlanLimits;
  /** Editing this product; otherwise adding a new one. */
  product?: PartnerProductRow;
  /** Adding a size or pack of this product (ruling 96). */
  variantOf?: PartnerProductRow;
  busy?: boolean;
  onDone: (message: string) => void;
  onProblem: (message: string) => void;
  onCancel?: () => void;
}

export function ProductForm({
  kind,
  catalogue,
  limits,
  product,
  variantOf,
  busy = false,
  onDone,
  onProblem,
  onCancel,
}: ProductFormProps): JSX.Element {
  const id = useId();
  const service = kind === 'service';
  const editing = product !== undefined;
  const [categoryId, setCategoryId] = useState(product?.category?.id ?? '');
  const [allergensSaid, setAllergensSaid] = useState(
    product ? product.allergens !== null && product.allergens !== undefined : false,
  );
  const [noAllergens, setNoAllergens] = useState(
    product ? product.allergens !== null && product.allergens?.length === 0 : false,
  );
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const category = catalogue.categories.find((entry) => entry.id === categoryId);
  const needsUnit = category?.requires.includes('unit') ?? false;
  const needsAllergens = category?.requires.includes('allergens') ?? false;
  const needsBestBefore = category?.requires.includes('bestBefore') ?? false;
  const existingPhotos = product?.photos?.length ?? 0;
  const photosLeft = editing ? 0 : Math.max(0, limits.photosPerProduct - pending.length);
  const name = (part: string): string => `${id}-${part}`;

  const takePhoto = async (file: File): Promise<void> => {
    if (photosLeft <= 0) return;
    try {
      const ready = await preparePhoto(file);
      setPending((before) => [
        ...before,
        {
          key: `${Date.now()}-${before.length}`,
          input: { photo: ready.base64, photoType: ready.contentType },
          preview: `data:${ready.contentType};base64,${ready.base64}`,
        },
      ]);
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : 'That photo could not be read.');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const value = (part: string): string => String(values.get(name(part)) ?? '').trim();
    const pounds = Number(value('price').replace(/[£\s]/g, ''));
    if (value('name') === '' || !Number.isFinite(pounds) || pounds <= 0) {
      onProblem('Please give the product’s name and its price in pounds, like 3.50.');
      return;
    }
    const minutes = Number(value('minutes'));
    if (service && (!Number.isFinite(minutes) || minutes < 5)) {
      onProblem('Please say how long the service takes, in minutes.');
      return;
    }
    const quantityWord = value('unit-quantity');
    const unitKind = value('unit-kind');
    const unitQuantity = quantityWord ? Number(quantityWord) : null;
    if (quantityWord && !(Number.isFinite(unitQuantity) && (unitQuantity as number) > 0)) {
      onProblem('Please give the size as a number, such as 500, with its unit.');
      return;
    }
    const allergens = !allergensSaid
      ? undefined
      : noAllergens
        ? []
        : catalogue.allergens.filter((allergen) => values.get(name(`allergen-${allergen}`)) === 'on');
    const variantLabel = value('variant-label');
    if ((variantOf || product?.variantLabel) && variantLabel === '') {
      onProblem('Please say which size or pack this is, such as "1 kg" or "pack of 6".');
      return;
    }
    setSending(true);
    try {
      if (editing) {
        const result = await editPartnerProduct(product.id, {
          name: value('name'),
          pricePence: Math.round(pounds * 100),
          tags: value('tags'),
          description: value('description'),
          categoryId: categoryId || null,
          unitQuantity: unitQuantity && unitKind ? unitQuantity : null,
          unitKind: unitQuantity && unitKind ? unitKind : null,
          allergens: allergens ?? null,
          expiresOn: value('expires') || null,
          ...(product.variantLabel !== null && product.variantLabel !== undefined
            ? { variantLabel }
            : {}),
          ...(service ? { durationMinutes: minutes } : {}),
        });
        onDone(result.message);
      } else {
        const result = await addPartnerProduct({
          name: value('name'),
          pricePence: Math.round(pounds * 100),
          tags: value('tags'),
          description: value('description'),
          ...(categoryId ? { categoryId } : {}),
          ...(unitQuantity && unitKind ? { unitQuantity, unitKind } : {}),
          ...(allergens !== undefined ? { allergens } : {}),
          ...(value('expires') ? { expiresOn: value('expires') } : {}),
          ...(pending.length > 0 ? { photos: pending.map((photo) => photo.input) } : {}),
          ...(service ? { durationMinutes: minutes } : {}),
          ...(variantOf ? { variantOf: variantOf.id, variantLabel } : {}),
        });
        form.reset();
        setPending([]);
        setCategoryId('');
        setAllergensSaid(false);
        setNoAllergens(false);
        onDone(result.message);
      }
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : 'That could not be saved.');
    } finally {
      setSending(false);
    }
  };

  const thing = service ? 'service' : 'product';
  const heading = editing
    ? `Change ${product.name}`
    : variantOf
      ? `Add a size or pack of ${variantOf.name}`
      : `Add a ${thing}`;
  // Food of any kind may carry allergens: the question is always there for a shop or a café.
  const showAllergens = !service;
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3" aria-labelledby={name('heading')}>
      <h2 id={name('heading')} className="text-lead font-bold m-0">
        {heading}
      </h2>
      {!editing && (
        <p className="m-0">
          We check each new {thing}, usually within one working day, then Shoppers see it.
          {variantOf
            ? ` It is shown with ${variantOf.name} as a size or pack to choose, with its own price.`
            : ''}
        </p>
      )}
      {(variantOf || (editing && product.variantLabel)) && (
        <>
          <label htmlFor={name('variant-label')} className="block font-bold">
            Which size or pack, such as “1 kg” or “pack of 6”
          </label>
          <input
            id={name('variant-label')}
            name={name('variant-label')}
            defaultValue={product?.variantLabel ?? ''}
            className={field}
          />
        </>
      )}
      <label htmlFor={name('name')} className="block font-bold">
        What it is
      </label>
      <input id={name('name')} name={name('name')} defaultValue={product?.name ?? variantOf?.name ?? ''} className={field} />
      <label htmlFor={name('price')} className="block font-bold">
        {service ? 'Price from, in pounds' : 'Your counter price, in pounds'}
      </label>
      <input
        id={name('price')}
        name={name('price')}
        inputMode="decimal"
        defaultValue={product ? (product.pricePence / 100).toFixed(2) : ''}
        className={field}
      />
      {!service && (
        <p className="m-0 text-paper/80">
          Shoppers see the price with the item charge and any agreed mark-up on it, never your
          counter price.
        </p>
      )}
      {service && (
        <>
          <label htmlFor={name('minutes')} className="block font-bold">
            How long it takes, in minutes
          </label>
          <input
            id={name('minutes')}
            name={name('minutes')}
            inputMode="numeric"
            defaultValue={product?.durationMinutes ?? ''}
            className={field}
          />
        </>
      )}
      <label htmlFor={name('description')} className="block font-bold">
        A few words about it (optional, up to {catalogue.descriptionMaxLength} characters)
      </label>
      <textarea
        id={name('description')}
        name={name('description')}
        rows={3}
        maxLength={catalogue.descriptionMaxLength}
        defaultValue={product?.description ?? ''}
        className={field}
      />
      <label htmlFor={name('category')} className="block font-bold">
        Category
      </label>
      <select
        id={name('category')}
        name={name('category')}
        value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}
        className={field}
      >
        <option value="">Choose a category</option>
        {catalogue.categories.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      {!service && (
        <fieldset className="m-0 p-0 border-0 space-y-2">
          <legend className="font-bold">
            Size{needsUnit ? ', so Shoppers see the price per kilo, litre or each' : ' (optional)'}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={name('unit-quantity')} className="block">
              How much
              <input
                id={name('unit-quantity')}
                name={name('unit-quantity')}
                inputMode="decimal"
                defaultValue={product?.unit?.quantity ?? ''}
                className={field}
              />
            </label>
            <label htmlFor={name('unit-kind')} className="block">
              In what
              <select
                id={name('unit-kind')}
                name={name('unit-kind')}
                defaultValue={product?.unit?.unit ?? ''}
                className={field}
              >
                <option value="">Choose</option>
                {catalogue.units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitWords(unit)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
      )}
      {showAllergens && (
        <fieldset className="m-0 p-0 border-0 space-y-2">
          <legend className="font-bold">
            Allergens{needsAllergens ? ': tick any it contains, or none' : ' (optional)'}
          </legend>
          <label className="flex items-center gap-2 min-h-control">
            <input
              type="checkbox"
              name={name('no-allergens')}
              checked={allergensSaid && noAllergens}
              onChange={(event) => {
                setAllergensSaid(true);
                setNoAllergens(event.target.checked);
              }}
              className="w-6 h-6"
            />
            None of the fourteen
          </label>
          <ul className="list-none m-0 p-0 grid grid-cols-2 gap-1">
            {catalogue.allergens.map((allergen) => (
              <li key={allergen}>
                <label className="flex items-center gap-2 min-h-control">
                  <input
                    type="checkbox"
                    name={name(`allergen-${allergen}`)}
                    defaultChecked={product?.allergens?.includes(allergen) ?? false}
                    disabled={noAllergens}
                    onChange={() => setAllergensSaid(true)}
                    className="w-6 h-6"
                  />
                  {allergen}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label htmlFor={name('tags')} className="block font-bold">
        Labels, to help people find it (optional)
      </label>
      <input id={name('tags')} name={name('tags')} defaultValue={product?.tags ?? ''} className={field} />
      <label htmlFor={name('expires')} className="block font-bold">
        Best before or use by{needsBestBefore ? '' : ' (optional)'}
      </label>
      <input
        id={name('expires')}
        name={name('expires')}
        type="date"
        defaultValue={product?.expiresOn ? product.expiresOn.slice(0, 10) : ''}
        className={field}
      />
      {!editing && (
        <fieldset className="m-0 p-0 border-0 space-y-2">
          <legend className="font-bold">
            Photos: up to {limits.photosPerProduct} on your package
            {limits.photosPerProduct === 1 ? '' : ', the first is the cover'}
          </legend>
          <ul className="m-0 ps-5 space-y-1" aria-label="How to take a good photo">
            {catalogue.photoRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          {pending.length > 0 && (
            <ul className="list-none m-0 p-0 flex flex-wrap gap-2" aria-label="Photos to send">
              {pending.map((photo, index) => (
                <li key={photo.key} className="space-y-1">
                  <img
                    src={photo.preview}
                    alt={index === 0 ? 'The cover, to send' : `Number ${index + 1}, to send`}
                    className="w-24 h-24 object-cover rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setPending((before) => before.filter((entry) => entry.key !== photo.key))}
                    className="control w-full bg-paper/10 text-paper underline !py-1"
                  >
                    Remove<span className="visually-hidden"> photo {index + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {photosLeft > 0 ? (
            <PhotoChoice takeLabel="Take a photo" chooseLabel="Choose a photo" onFile={(file) => void takePhoto(file)} />
          ) : (
            <p className="m-0">
              That is {limits.photosPerProduct === 1 ? 'the photo' : `all ${limits.photosPerProduct} photos`} your
              package carries.
            </p>
          )}
        </fieldset>
      )}
      {editing && existingPhotos > 0 && (
        <p className="m-0 text-paper/80">Photos are changed under the product, below.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || sending}
          className="control bg-highlight text-on-accent disabled:opacity-70"
        >
          {editing ? 'Save the changes' : 'Send it to be checked'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="control bg-paper/10 text-paper underline">
            Never mind
          </button>
        )}
      </div>
    </form>
  );
}

/** The unit as people read it: "kg" is "kilograms (kg)". */
export function unitWords(unit: string): string {
  switch (unit) {
    case 'g':
      return 'grams (g)';
    case 'kg':
      return 'kilograms (kg)';
    case 'ml':
      return 'millilitres (ml)';
    case 'l':
      return 'litres (l)';
    case 'each':
      return 'each (a count)';
    case 'pack':
      return 'in a pack';
    default:
      return unit;
  }
}

/** A small picture of a product's cover photo, or nothing. */
export function CoverThumb({ product }: { product: PartnerProductRow }): JSX.Element | null {
  const cover = product.photos?.[0];
  if (!cover) return null;
  return (
    <picture>
      <source srcSet={photoSrc(cover.thumb)} type="image/webp" />
      <img src={photoSrc(cover.thumbJpeg)} alt={cover.alt} className="w-20 h-20 object-cover rounded-xl" />
    </picture>
  );
}
