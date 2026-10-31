import { freeJoiningWords } from '@aldilivery/core';

import { storeConfig } from '../config';

/**
 * The payment warning (Anthony, 31 October 2026), word for word, with the names from
 * config/store.json: at the top of every business sign-up, before any field, and kept on the
 * partner dashboard. Printed items use `FREE_JOINING_WORDS` on its own.
 */
export const FREE_JOINING_WORDS = freeJoiningWords(storeConfig);

export function FreeJoiningNotice({
  headingLevel = 2,
  id = 'free-joining-heading',
}: {
  headingLevel?: 2 | 3;
  id?: string;
}): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={id} className="space-y-2 border-4 border-highlight rounded-2xl p-4">
      <Heading id={id} className="text-lead font-bold m-0">
        Joining is free
      </Heading>
      <p className="m-0">{FREE_JOINING_WORDS}</p>
    </section>
  );
}
