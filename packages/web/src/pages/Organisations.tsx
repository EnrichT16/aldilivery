import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/FormFields';
import { sendOrganisationEnquiry } from '../lib/api';
import { money, planDeliveryWords } from '../lib/money';
import { ordinal } from '../lib/partnership';

import { storeConfig } from '../config';

/**
 * For organisations: councils, charities, care providers and businesses arranging shopping for
 * the people they support (docs/BUILD_PROMPT.md, Sections Q and T2). Accounts for them are set up
 * by a person at Ozi, not by a form, so this page says what is offered and how to start.
 *
 * Since 30 October 2026 it promises only what the organisation's area really does (no single
 * invoice, no ordering on someone's behalf, no rounds), shows the price from config, and an
 * organisation agrees to the Organisation terms before asking. A shop asking here says it is a
 * shop, so the owner hears "a new shop".
 */
export function Organisations(): JSX.Element {
  const { telephonePlaceholder, telephoneIsPlaceholder } = storeConfig.contact;
  const [params] = useSearchParams();
  const shop = params.get('shop') === '1';
  const [sent, setSent] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const pricing = storeConfig.extras.organisations;

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string): string => String(data.get(name) ?? '').trim();
    if (!shop && !termsAgreed) {
      setProblem('Please tick to agree to the Organisation terms.');
      return;
    }
    setBusy(true);
    setProblem('');
    sendOrganisationEnquiry({
      kind: shop ? 'shop' : 'organisation',
      ...(shop ? {} : { termsAgreed }),
      organisation: value('enquiry-organisation'),
      contactName: value('enquiry-name'),
      telephone: value('enquiry-telephone'),
      email: value('enquiry-email'),
      people: value('enquiry-people'),
      message: value('enquiry-message'),
    })
      .then((result) => setSent(result.message))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be sent.'),
      )
      .finally(() => setBusy(false));
  };
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
          <li>
            Each person you support orders their own shopping, by talking to{' '}
            {storeConfig.assistantName}, by tapping, or by telephone, and pays for it as usual.
          </li>
          <li>
            Once they link to you with your code, their delivery is the Membership price:{' '}
            {planDeliveryWords('membership')}.
          </li>
          <li>
            Your own area shows the orders they place from then on, what they cost, their booked
            weekly shops and what you have spent, by office, with a statement to download.
          </li>
          <li>Only the person, or someone with legal authority to act for them, links to you.</li>
        </ul>
      </section>
      <section aria-labelledby="price-heading" className="space-y-3 max-w-xl">
        <h2 id="price-heading" className="text-lead font-bold">
          What it costs
        </h2>
        <p className="m-0">
          {money(pricing.clientMonthlyPence)} a month for each person you support, paid by you.
          Every {ordinal(pricing.discountEveryNthClient)} person is{' '}
          {money(pricing.discountedClientMonthlyPence)}.
        </p>
        <Link to="/organisation/terms" className="inline-flex items-center min-h-control underline">
          Read the Organisation terms
        </Link>
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
          className="control bg-highlight text-on-accent text-lead"
        >
          {telephonePlaceholder}
        </a>
        {telephoneIsPlaceholder && (
          <p className="m-0 text-paper/80">
            This number is a placeholder while we get the line set up. It will not connect yet.
          </p>
        )}
      </section>
      <section id="enquiry" aria-labelledby="enquiry-heading" className="space-y-4 max-w-xl">
        <h2 id="enquiry-heading" className="text-lead font-bold">
          {shop ? 'Ask to work with us as a shop' : 'Or tell us about your organisation'}
        </h2>
        {sent !== '' ? (
          <p role="status" className="m-0 text-lead">
            {sent}
          </p>
        ) : (
          <form onSubmit={send} className="space-y-4">
            {problem !== '' && (
              <p
                role="alert"
                className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0"
              >
                {problem}
              </p>
            )}
            <Field
              id="enquiry-organisation"
              label={shop ? 'The shop’s name' : 'Your organisation’s name'}
              hint={
                shop
                  ? 'As it is on the shop front.'
                  : 'A council, charity, care provider or business.'
              }
              autoComplete="organization"
            />
            <Field
              id="enquiry-name"
              label="Your name"
              hint="So we know who to ask for."
              autoComplete="name"
            />
            <Field
              id="enquiry-telephone"
              label="A telephone number"
              hint="A person rings you back within two working days."
              type="tel"
              autoComplete="tel"
            />
            <Field
              id="enquiry-email"
              label="Email (optional)"
              hint="If you'd rather we wrote."
              type="email"
              autoComplete="email"
            />
            {!shop && (
              <Field
                id="enquiry-people"
                label="How many people you support (optional)"
                hint="A rough number is fine."
              />
            )}
            <Field
              id="enquiry-message"
              label="Anything else (optional)"
              hint="What you need, in your own words."
              multiline
            />
            {!shop && (
              <div className="flex items-center gap-3 min-h-control">
                <input
                  type="checkbox"
                  id="enquiry-terms"
                  checked={termsAgreed}
                  onChange={(event) => setTermsAgreed(event.target.checked)}
                  aria-required="true"
                  className="h-6 w-6 shrink-0"
                />
                <label htmlFor="enquiry-terms" className="m-0 font-bold">
                  I agree to the Organisation terms
                </label>
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="control bg-highlight text-on-accent text-lead disabled:opacity-70"
            >
              Send
            </button>
          </form>
        )}
      </section>
      <section aria-labelledby="signin-heading" className="space-y-2 max-w-xl">
        <h2 id="signin-heading" className="text-lead font-bold">
          Already working with us?
        </h2>
        <Link to="/business" className="control bg-highlight text-on-accent">
          Sign in to your organisation’s area
        </Link>
      </section>
      <Link to="/" className="control bg-paper/10 text-paper underline">
        Back to the start
      </Link>
    </div>
  );
}
