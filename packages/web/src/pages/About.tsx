import { Link } from 'react-router-dom';

import { GetTheApp } from '../components/GetTheApp';
import { SocialLinks, socialLinks } from '../components/SocialLinks';
import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * About us: the website's own page (ruling 50), for somebody finding us on the web. What we
 * do, how it works, who it is for, how to get the app, and where to follow us. The website and
 * the app are the same: everything can be done here too.
 */
export function About(): JSX.Element {
  const { productName, assistantName, motto, fees, extras } = storeConfig;
  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">About {productName}</h1>
      <p className="text-lead m-0">{motto}</p>
      <p className="m-0">
        Tell {assistantName} what shopping you need, by talking or by tapping. A Runner buys it and
        brings it to your door. Made for everyone, and especially for people who are blind,
        partially sighted, older, or find shopping hard.
      </p>

      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="text-lead font-bold">
          How it works
        </h2>
        <ol className="m-0 space-y-2">
          <li>Say or tap what you need. {assistantName} reads it back to you.</li>
          <li>You say yes. A Runner buys it, and you pay what the till says.</li>
          <li>
            It comes to your door. Delivery is {money(fees.standardDeliveryPence)}, every time.
          </li>
        </ol>
        <Link to="/shop" className="control bg-highlight text-ink">
          Start shopping
        </Link>
      </section>

      <GetTheApp />

      <section aria-labelledby="who-heading" className="space-y-3">
        <h2 id="who-heading" className="text-lead font-bold">
          Who it is for
        </h2>
        <ul className="list-none m-0 p-0 grid gap-3 sm:grid-cols-2">
          <li>
            <Link to="/sign-up" className="control w-full bg-paper text-ink">
              Shoppers
            </Link>
          </li>
          <li>
            <Link to="/runner" className="control w-full bg-paper text-ink">
              Earn as a Runner
            </Link>
          </li>
          <li>
            <Link to="/business" className="control w-full bg-paper text-ink">
              Shops: become a Shop Partner
            </Link>
          </li>
          <li>
            <Link to="/organisations" className="control w-full bg-paper text-ink">
              Councils, charities and care
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="advertise-heading" className="space-y-3">
        <h2 id="advertise-heading" className="text-lead font-bold">
          Advertise with us
        </h2>
        <p className="m-0">
          Local shops can join as Shop Partners for {money(extras.partnerMonthlyPence)} a month, and
          be mentioned by {assistantName} with Spotlight ({money(extras.spotlightPence)} a month) or
          Spotlight Plus ({money(extras.spotlightPlusPence)} a month). Every mention is called an
          advert.
        </p>
        <Link to="/business" className="control bg-paper text-ink">
          Find out more
        </Link>
      </section>

      {socialLinks().length > 0 && (
        <section aria-labelledby="follow-heading" className="space-y-3">
          <h2 id="follow-heading" className="text-lead font-bold">
            Follow us
          </h2>
          <SocialLinks />
        </section>
      )}
    </div>
  );
}
