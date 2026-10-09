import { Link } from 'react-router-dom';

import { companyFacts } from '../components/CompanyDetails';
import { GetTheApp } from '../components/GetTheApp';
import { storeConfig } from '../config';

/**
 * Help and contact, at /help. The page the App Store and Google Play listings name as the
 * support address (docs/store-listing), and the page Google Play names for closing an account
 * without the app (its "delete account" link points at #close-account). Every fact is from
 * config/store.json; a placeholder reads "to follow".
 */
export function Help(): JSX.Element {
  const { productName, assistantName } = storeConfig;
  const facts = companyFacts();
  const days = storeConfig.accountDeletion.recycleBinDays;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Help and contact</h1>
      <p className="m-0 text-lead">
        If anything is not working, or you would like a person to help, ring us or email us.
      </p>

      <section aria-labelledby="help-person" className="space-y-3">
        <h2 id="help-person" className="text-lead font-bold">
          Talk to a person
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Telephone: {facts.telephoneIsPlaceholder ? 'to follow' : facts.telephone}.</li>
          <li>Email: {facts.email ?? 'to follow'}.</li>
        </ul>
        <p className="m-0">
          If something went wrong with an order, open Past orders and choose Report a problem, so a
          person sees the order straight away.
        </p>
      </section>

      <GetTheApp />

      <section aria-labelledby="close-account-heading" id="close-account" className="space-y-3">
        <h2 id="close-account-heading" className="text-lead font-bold">
          Closing your account
        </h2>
        <p className="m-0">
          You can close your {productName} account at any time, free of charge, in any of these
          ways:
        </p>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            In the app or on the website: open <Link to="/settings">Settings</Link> and choose Close
            my account.
          </li>
          <li>Ask {assistantName}: say &ldquo;close my account&rdquo;.</li>
          <li>Ring us or email us, from the number or address on your account.</li>
        </ul>
        <p className="m-0">
          It waits {days} days in case you change your mind, then your details are deleted. The law
          makes us keep the records of what you paid, for tax, for seven years, without your
          address. Runners can close their Runner account by ringing or emailing us.
        </p>
      </section>

      <section aria-labelledby="help-information" className="space-y-3">
        <h2 id="help-information" className="text-lead font-bold">
          Your information
        </h2>
        <p className="m-0">
          What we keep about you, why, and what you can ask us to do with it, is on our{' '}
          <Link to="/privacy">privacy page</Link>.
        </p>
      </section>
    </article>
  );
}
