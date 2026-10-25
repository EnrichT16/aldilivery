import { storeConfig } from '../config';
import type { BrowseFields as BrowseFieldValues, PartnerKind } from '../lib/api';

/** "Middle Eastern" as part of an id: "middle-eastern". */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * How Shoppers find a place (ruling 82), on the join form, the partner's dashboard and the
 * admin panel: a restaurant's cuisines, a shop's specialities and whether it is a convenience
 * store, a service's categories and a childminder's Ofsted registration number. Every choice is
 * a real checkbox with its words beside it, in a fieldset with a legend; the lists come from
 * `browse` in config/store.json. Read back with `readBrowseFields`.
 */
export function BrowseFields({
  kind,
  prefix,
  initial,
}: {
  kind: PartnerKind;
  /** Keeps ids apart when several forms are on one page. */
  prefix: string;
  initial?: Partial<BrowseFieldValues>;
}): JSX.Element {
  const browse = storeConfig.browse;
  const boxes = (name: string, list: readonly string[], chosen: readonly string[] = []) => (
    <div className="grid gap-x-4 sm:grid-cols-2">
      {list.map((entry) => {
        const id = `${prefix}-${name}-${slug(entry)}`;
        return (
          <div key={entry} className="flex items-center gap-3 min-h-control">
            <input
              type="checkbox"
              id={id}
              name={`${prefix}-${name}`}
              value={entry}
              defaultChecked={chosen.includes(entry)}
              className="h-6 w-6 shrink-0"
            />
            <label htmlFor={id} className="m-0">
              {entry}
            </label>
          </div>
        );
      })}
    </div>
  );

  if (kind === 'food') {
    return (
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="text-lead font-bold">Country and continental: what do you cook?</legend>
        <p className="m-0 text-paper/90">
          Choose as many as fit. Shoppers find you under each one on the Restaurants page.
        </p>
        {boxes('cuisines', browse.cuisines, initial?.cuisines)}
      </fieldset>
    );
  }
  if (kind === 'shop') {
    const convenienceId = `${prefix}-convenience`;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 min-h-control">
          <input
            type="checkbox"
            id={convenienceId}
            name={convenienceId}
            defaultChecked={initial?.convenience ?? false}
            className="h-6 w-6 shrink-0"
          />
          <label htmlFor={convenienceId} className="m-0 font-bold">
            We are a corner shop, convenience store or mini-market
          </label>
        </div>
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="text-lead font-bold">
            Country and continental: what do you specialise in? (optional)
          </legend>
          <p className="m-0 text-paper/90">
            Choose any that fit. Shoppers find you under each one on the Shops page.
          </p>
          {boxes('specialities', browse.shopOrigins, initial?.specialities)}
        </fieldset>
      </div>
    );
  }
  const ofstedId = `${prefix}-ofsted`;
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="text-lead font-bold">What kind of service is it?</legend>
        <p className="m-0 text-paper/90">
          Choose as many as fit. Shoppers find you under each one on the Services page.
        </p>
        {boxes('categories', browse.serviceCategories, initial?.categories)}
      </fieldset>
      <div className="space-y-2">
        <label htmlFor={ofstedId} className="block text-lead font-bold">
          Ofsted registration number
        </label>
        <p id={`${ofstedId}-hint`} className="m-0 text-paper/90">
          A childminder must be registered with Ofsted and give the number here. We show it on your
          page as you give it. {storeConfig.productName} does not check it.
        </p>
        <input
          id={ofstedId}
          name={ofstedId}
          defaultValue={initial?.ofstedNumber ?? ''}
          aria-describedby={`${ofstedId}-hint`}
          autoComplete="off"
          className="w-full max-w-xs min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
        />
      </div>
    </div>
  );
}

/** What the fields above hold now, for the kind given: only the fields that kind has. */
export function readBrowseFields(
  root: ParentNode,
  prefix: string,
  kind: PartnerKind,
): Partial<BrowseFieldValues> {
  const checked = (name: string): string[] =>
    Array.from(
      root.querySelectorAll<HTMLInputElement>(`input[name="${prefix}-${name}"]:checked`),
    ).map((input) => input.value);
  if (kind === 'food') return { cuisines: checked('cuisines') };
  if (kind === 'shop') {
    const convenience = root.querySelector<HTMLInputElement>(`[id="${prefix}-convenience"]`);
    return { specialities: checked('specialities'), convenience: convenience?.checked ?? false };
  }
  const ofsted = root.querySelector<HTMLInputElement>(`[id="${prefix}-ofsted"]`);
  return { categories: checked('categories'), ofstedNumber: ofsted?.value.trim() ?? '' };
}
