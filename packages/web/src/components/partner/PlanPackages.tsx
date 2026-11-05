/**
 * The three Shop Partner packages on the dashboard (ruling 96, 5 November 2026): what each
 * costs and gives, which one the shop is on, and one button to start, upgrade or renew. Every
 * word and figure comes from the server, which reads config/store.json.
 */

import type { PartnerPackage } from '../../lib/api';
import { money } from '../../lib/money';

export function PlanPackages({
  packages,
  busy,
  onPay,
}: {
  packages: PartnerPackage[];
  busy: boolean;
  onPay: (kind: 'plan' | 'pro') => void;
}): JSX.Element {
  return (
    <ul className="list-none m-0 p-0 grid gap-3 sm:grid-cols-3" aria-label="The packages">
      {packages.map((pack) => {
        const kind = pack.tier === 'pro' ? 'pro' : 'plan';
        const label =
          pack.action === 'renew'
            ? `Renew ${pack.name}, ${money(pack.payPence)} for a month`
            : pack.action === 'start'
              ? pack.firstMonthFree
                ? `Start ${pack.name}, first month free`
                : `Start ${pack.name}, ${money(pack.payPence)} a month`
              : pack.action === 'upgrade'
                ? pack.firstMonthFree
                  ? `Move to ${pack.name}, first month free`
                  : `Move to ${pack.name}, ${money(pack.payPence)} a month`
                : null;
        return (
          <li
            key={pack.tier}
            className={`rounded-2xl p-4 space-y-2 border-2 ${pack.current ? 'border-highlight' : 'border-paper/40'}`}
            aria-current={pack.current ? 'true' : undefined}
          >
            <h3 className="m-0 text-lead font-bold">
              {pack.name}
              {pack.current && <span className="visually-hidden"> (your package)</span>}
            </h3>
            <p className="m-0 font-bold">
              {pack.monthlyPence === 0
                ? 'Free'
                : pack.payPence !== pack.monthlyPence
                  ? `${money(pack.payPence)} a month for you (${money(pack.monthlyPence)} otherwise)`
                  : `${money(pack.monthlyPence)} a month`}
            </p>
            {pack.current && (
              <p className="m-0">{pack.paid ? 'Your package.' : 'Your package, not paid at the moment.'}</p>
            )}
            <ul className="m-0 ps-5 space-y-1">
              {pack.gives.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {label && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onPay(kind)}
                className={`control w-full ${pack.action === 'renew' ? 'border-paper bg-paper/10 text-paper' : 'bg-highlight text-on-accent'} disabled:opacity-70`}
              >
                {label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
