import { Link } from 'react-router-dom';

import { storeConfig } from '../config';

/**
 * For organisations: councils, charities, care providers and businesses arranging shopping for
 * the people they support (docs/BUILD_PROMPT.md, Sections Q and T2). Accounts for them are set up
 * by a person at Ozi, not by a form, so this page says what is offered and how to start.
 */
export function Organisations(): JSX.Element {
  const { telephonePlaceholder, telephoneIsPlaceholder } = storeConfig.contact;
  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">For organisations</h1>
      <p className="text-lead m-0 max-w-xl">
        {storeConfig.productName} brings shopping to blind, partially sighted and elderly people. If
        you arrange support for people — as a council, a charity, a care provider or a business — we
        can work with you.
      </p>
      <section aria-labelledby="what-heading" className="space-y-3 max-w-xl">
        <h2 id="what-heading" className="text-lead font-bold">
          What we can do with you
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Shopping for the people you support, ordered by them, by you, or by telephone.</li>
          <li>One invoice to your organisation, instead of payments from each person.</li>
          <li>Reports on deliveries for the people you are responsible for.</li>
          <li>Regular rounds for sheltered housing and similar schemes.</li>
        </ul>
      </section>
      <section aria-labelledby="start-heading" className="space-y-3 max-w-xl">
        <h2 id="start-heading" className="text-lead font-bold">
          How to start
        </h2>
        <p className="m-0">
          Ring us and a person will set your organisation up and talk through what you need.
        </p>
        <a
          href={`tel:${telephonePlaceholder.replace(/\s/g, '')}`}
          className="control bg-highlight text-ink text-lead"
        >
          {telephonePlaceholder}
        </a>
        {telephoneIsPlaceholder && (
          <p className="m-0 text-paper/80">
            This number is a placeholder while we get the line set up. It will not connect yet.
          </p>
        )}
      </section>
      <Link to="/" className="control bg-paper/10 text-paper underline">
        Back to the start
      </Link>
    </div>
  );
}
