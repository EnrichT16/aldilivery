import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { storeConfig } from '../config';
import { money, planAllowanceWords, planDeliveryWords } from '../lib/money';
import { ordinal } from '../lib/partnership';

/**
 * The Organisation terms, in plain words (Anthony, 30 October 2026), agreed with a tick box when
 * an organisation asks to work with us at /organisations; the server keeps when, and which
 * version (ORGANISATION_TERMS_VERSION in packages/core).
 *
 * Written only from what the service really does (routes/business.ts and services/plans.ts):
 * sign-ins set up by us, people linking themselves with the organisation's code after agreeing
 * to exactly what is shared, orders seen only from then on, Membership delivery for them, and the
 * monthly fee per person. What is shared matches ORGANISATION_SHARED_THINGS in packages/core,
 * said here of the person rather than to them. Every figure comes from config/store.json.
 */
export function OrganisationTerms(): JSX.Element {
  const name = storeConfig.productName;
  const pricing = storeConfig.extras.organisations;
  const company = companyFacts();
  const allowance = planAllowanceWords('membership');

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Organisation terms</h1>
      <p className="m-0 text-lead">
        These are the terms between us and a council, charity, care provider or business that
        supports people who shop with {name}. If you would like them read to you, or in another
        format, ring us.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company.name}. In these terms, &ldquo;we&rdquo; and &ldquo;us&rdquo;
          means that company, and &ldquo;you&rdquo; means the organisation.
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold">
          What we provide
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            A person at {name} sets up your organisation and a sign-in for each member of your
            staff, with the office or team they work in.
          </li>
          <li>
            You get a code and a link to share. Each person you support links their own account with
            it, or someone with legal authority to act for them, such as a Lasting Power of
            Attorney, does.
          </li>
          <li>
            Each person orders and pays for their own shopping, as any Shopper does. Once linked,
            their delivery is the Membership price: {planDeliveryWords('membership')}.
            {allowance ? ` Each has ${allowance}.` : ''}
          </li>
          <li>
            Your area shows their orders from the moment they linked, what those cost, their booked
            weekly shops, what you have spent by office, a monthly budget and an estimate of what
            you saved, with a statement to download.
          </li>
        </ul>
      </section>

      <section aria-labelledby="money" className="space-y-3">
        <h2 id="money" className="text-lead font-bold">
          What it costs
        </h2>
        <p className="m-0">
          {money(pricing.clientMonthlyPence)} a month for each person linked to you. Every{' '}
          {ordinal(pricing.discountEveryNthClient)} person is{' '}
          {money(pricing.discountedClientMonthlyPence)}. Your area shows the total for this month. A
          person at {name} agrees with you how it is paid when we set up your organisation.
        </p>
      </section>

      <section aria-labelledby="consent" className="space-y-3">
        <h2 id="consent" className="text-lead font-bold">
          Consent, and what you see
        </h2>
        <p className="m-0">Before linking, each person is told that you will see:</p>
        <ul className="m-0 ps-6 space-y-1">
          <li>their name</li>
          <li>the office label you give them</li>
          <li>the weekly shops they have booked</li>
          <li>the orders they place from then on, and what each one costs</li>
        </ul>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You never see orders from before they linked, their card or their messages. We keep the
            moment each person agreed, and the words they agreed to.
          </li>
          <li>
            Only the person, or someone with legal authority to act for them, may agree. Please
            never type the code for someone, or press them to link.
          </li>
          <li>
            They can stop it at any time in their Settings, and you can unlink anyone from your
            area. Either way, you no longer see anything of theirs.
          </li>
          <li>
            Use what you see only to support the person, and keep it safe and private, as data
            protection law asks of you.
          </li>
        </ul>
      </section>

      <section aria-labelledby="data" className="space-y-3">
        <h2 id="data" className="text-lead font-bold">
          What you share with us
        </h2>
        <p className="m-0">
          Your organisation&rsquo;s name, a contact&rsquo;s name, telephone number and email, your
          staff&rsquo;s names, usernames and offices, and any budget or staff trip cost you enter.
          How we look after personal information is on our{' '}
          <Link to="/privacy" className="underline">
            privacy page
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="ending" className="space-y-3">
        <h2 id="ending" className="text-lead font-bold">
          Ending
        </h2>
        <p className="m-0">
          Ring us to close your organisation&rsquo;s area. The people you support keep their own
          accounts.
        </p>
      </section>

      <section aria-labelledby="law" className="space-y-3">
        <h2 id="law" className="text-lead font-bold">
          Changes, and the law that applies
        </h2>
        <p className="m-0">
          If we change these terms, we tell you before the change takes effect. These terms are
          under the law of England and Wales, and the courts of England and Wales deal with any
          dispute.
        </p>
        <p className="m-0">These terms were written on 30 October 2026.</p>
      </section>

      <Link to="/organisations#enquiry" className="control bg-highlight text-on-accent">
        Ask to work with us
      </Link>
    </article>
  );
}
