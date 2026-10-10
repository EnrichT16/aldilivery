import { overOneRunnerWords, type BasketPartPricing } from '@aldilivery/core';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * A basket over £150 (ruling 61, Anthony, 10 October 2026): told plainly and gently, before
 * paying, that it is more than one Runner can carry, with both choices, and nothing hidden: if
 * they keep everything, every order, its Runner and its delivery.
 */
export function OverOneRunner({ parts }: { parts: readonly BasketPartPricing[] }): JSX.Element {
  return (
    <section aria-labelledby="over-one-runner" className="space-y-3">
      <h2 id="over-one-runner" className="text-lead font-bold">
        More than one Runner can carry
      </h2>
      <p className="m-0">{overOneRunnerWords(storeConfig.fees, money)}</p>
      <p className="m-0">If you keep everything, it comes as {parts.length} orders:</p>
      <ul className="m-0 ps-6 space-y-2">
        {parts.map((part) => (
          <li key={part.part} className="m-0">
            Runner {part.part}: {money(part.goodsPence)} of shopping at the shop&rsquo;s prices and{' '}
            {money(part.itemChargesPence)} of item charges, delivery {money(part.feePence)}
            {part.extra ? ', taken only when this Runner collects it' : ''}.
          </li>
        ))}
      </ul>
      <p className="m-0">
        If a further Runner is not needed after all, you are not charged for them.
      </p>
    </section>
  );
}
