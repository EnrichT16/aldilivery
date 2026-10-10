/**
 * The banner on the app store reviewers' demo account (ruling 60). Shown on every page of a demo
 * Shopper, and on the demo Runner's page, so nobody can mistake it for a real account.
 */
export const DEMO_BANNER_WORDS = 'Demo account — no real orders';

export function DemoBanner(): JSX.Element {
  return (
    <p
      role="note"
      className="m-0 border-2 border-highlight bg-highlight text-ink font-bold rounded-xl p-4"
    >
      {DEMO_BANNER_WORDS}
    </p>
  );
}
