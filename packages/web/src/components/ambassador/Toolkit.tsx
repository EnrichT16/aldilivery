import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { COUNTER_CARD_WAIT_WORDS } from '@aldilivery/core';

import { storeConfig } from '../../config';
import { fetchAmbassadorToolkit, type AmbassadorToolkit, type ReferralAs } from '../../lib/api';
import { FLYERS } from './Flyers';

/**
 * The Ambassador Toolkit (Anthony, 30 October 2026), for approved Ambassadors only. Everything is
 * made here, in the app, with the Ambassador's own QR code and link: the business link on business
 * materials, their referral link on Shopper and Runner materials. So it can only be printed from
 * the app. Each item has Print and Download PDF (the browser's print window, "Save as PDF"), and
 * Share where sharing makes sense.
 */

/** Shares a link with the phone's share sheet, or copies it where there is none. */
export async function shareLink(
  link: string,
  text: string,
  onNews: (words: string) => void,
): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: storeConfig.productName, text, url: link });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${link}`.trim());
    onNews('Copied. You can paste it into a message.');
  } catch {
    // They closed the share sheet: nothing to say.
  }
}

/** The ready-made messages, each with the right link (30 October 2026). */
export function readyMessages(toolkit: AmbassadorToolkit): Array<{
  key: string;
  title: string;
  text: string;
  link: string;
}> {
  const product = storeConfig.productName;
  const runnerPay = storeConfig.fees.runnerPaymentPence;
  const pounds = `${storeConfig.store.currencySymbol}${Math.round(runnerPay / 100)}`;
  return [
    {
      key: 'shoppers',
      title: 'For Shoppers',
      text: `Have you tried ${product}? You can order your shopping and takeaways by speaking, typing or ringing, and a checked local Runner brings it to your door. Prices are shown before you pay. Have a look:`,
      link: toolkit.shopperLink,
    },
    {
      key: 'runners',
      title: 'For Runners (drivers)',
      text: `${product} is looking for Runners (drivers) near you: ${pounds} a delivery, on your own hours, walking, cycling or driving. You need to be 18 or over with the right to work in the UK. Sign up here:`,
      link: toolkit.runnerLink,
    },
    {
      key: 'businesses',
      title: 'For restaurants and shops',
      text: `I'm an Ambassador for ${product}, a local delivery service for everyone, including older and disabled customers who order by voice or phone. You're paid in full at the counter, with no commission, and joining is free. Have a look and join here:`,
      link: toolkit.businessLink,
    },
  ];
}

export function Toolkit({
  as,
  onNews,
}: {
  as: ReferralAs;
  onNews: (words: string) => void;
}): JSX.Element {
  const [toolkit, setToolkit] = useState<AmbassadorToolkit | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    fetchAmbassadorToolkit(as)
      .then(setToolkit)
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'The Toolkit could not be opened.'),
      );
  }, [as]);

  if (!toolkit) {
    return (
      <section aria-labelledby="toolkit-heading" className="space-y-2">
        <h2 id="toolkit-heading" className="text-lead font-bold m-0">
          Toolkit
        </h2>
        {problem !== '' ? (
          <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
            {problem}
          </p>
        ) : (
          <p className="m-0">Opening your Toolkit.</p>
        )}
      </section>
    );
  }

  const cardsWait = toolkit.cardsWaitWords ?? COUNTER_CARD_WAIT_WORDS;
  const signed = toolkit.businesses.filter((business) => business.agreementReference);

  return (
    <section aria-labelledby="toolkit-heading" className="space-y-8">
      <h2 id="toolkit-heading" className="text-lead font-bold m-0">
        Toolkit
      </h2>
      <p className="m-0">
        Everything here carries your own QR code and link, so whoever joins through it is counted
        for you. Print it, or save it as a PDF from the print window.
      </p>

      <section aria-labelledby="signup-heading" className="space-y-2">
        <h3 id="signup-heading" className="font-bold m-0">
          Sign up this business now
        </h3>
        <p className="m-0">With the owner beside you: fill it in together, then they agree.</p>
        <Link to="/ambassador/sign-up-business" className="control bg-highlight text-on-accent">
          Sign up a business now
        </Link>
      </section>

      <section aria-labelledby="flyers-heading" className="space-y-3">
        <h3 id="flyers-heading" className="font-bold m-0">
          Flyers (A5)
        </h3>
        <ul className="list-none m-0 p-0 space-y-4">
          {FLYERS.map((flyer) => {
            const link = flyer.link(toolkit);
            return (
              <li key={flyer.key} className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
                <p className="m-0 font-bold">{flyer.title}</p>
                <PrintButtons
                  to={`/ambassador/print/flyer/${flyer.key}`}
                  what={`the ${flyer.title} flyer`}
                  onShare={() => void shareLink(link, flyer.shareText, onNews)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="presentation-heading" className="space-y-2">
        <h3 id="presentation-heading" className="font-bold m-0">
          Presentation for business owners
        </h3>
        <p className="m-0">
          Six slides to show on your phone or tablet. Swipe, or use the arrow keys.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/ambassador/presentation" className="control bg-highlight text-on-accent">
            Show the presentation
          </Link>
          <Link
            to="/ambassador/presentation?action=print"
            className="control border-paper bg-paper/10 text-paper"
            aria-label="Print the presentation"
          >
            Print
          </Link>
          <Link
            to="/ambassador/presentation?action=pdf"
            className="control border-paper bg-paper/10 text-paper"
            aria-label="Download PDF of the presentation"
          >
            Download PDF
          </Link>
        </div>
      </section>

      <section aria-labelledby="agreements-heading" className="space-y-2">
        <h3 id="agreements-heading" className="font-bold m-0">
          Shop Partner agreement sheets
        </h3>
        {signed.length === 0 ? (
          <p className="m-0">
            When you sign a business up now, its agreement sheet is here to print for the owner.
          </p>
        ) : (
          <ul className="list-none m-0 p-0 space-y-3">
            {signed.map((business) => (
              <li key={business.id} className="space-y-2">
                <p className="m-0">
                  {business.name}, reference {business.agreementReference}: {business.statusWords}
                </p>
                <PrintButtons
                  to={`/ambassador/print/agreement/${business.agreementReference ?? ''}`}
                  what={`the agreement sheet for ${business.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cards-heading" className="space-y-2">
        <h3 id="cards-heading" className="font-bold m-0">
          Counter cards and window stickers
        </h3>
        <p className="m-0">
          &ldquo;Order from us on {storeConfig.productName}&rdquo;, with a QR code to the
          shop&rsquo;s own page, for each business you introduced. {cardsWait}
        </p>
        {toolkit.businesses.length === 0 ? (
          <p className="m-0">None yet.</p>
        ) : (
          <ul className="list-none m-0 p-0 space-y-3">
            {toolkit.businesses.map((business) => (
              <li key={business.id} className="space-y-2">
                <p className="m-0 font-bold">{business.name}</p>
                {business.cardsAllowed === true && business.shopLink ? (
                  <>
                    <PrintButtons
                      to={`/ambassador/print/card/${business.id}`}
                      what={`the counter card for ${business.name}`}
                    />
                    <PrintButtons
                      to={`/ambassador/print/sticker/${business.id}`}
                      what={`the window sticker for ${business.name}`}
                    />
                  </>
                ) : (
                  <p className="m-0">{cardsWait}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="messages-heading" className="space-y-3">
        <h3 id="messages-heading" className="font-bold m-0">
          Ready-made messages
        </h3>
        <ul className="list-none m-0 p-0 space-y-4">
          {readyMessages(toolkit).map((message) => {
            const whole = `${message.text} ${message.link}`;
            return (
              <li key={message.key} className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
                <p className="m-0 font-bold">{message.title}</p>
                <p className="m-0 break-words">{whole}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(whole)
                        .then(() => onNews('Copied. You can paste it into a message.'))
                        .catch(() => undefined);
                    }}
                    className="control bg-highlight text-on-accent"
                    aria-label={`Copy the message ${message.title.toLowerCase()}`}
                  >
                    Copy
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(whole)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="control border-paper bg-paper/10 text-paper"
                    aria-label={`Send the message ${message.title.toLowerCase()} on WhatsApp`}
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`sms:?&body=${encodeURIComponent(whole)}`}
                    className="control border-paper bg-paper/10 text-paper"
                    aria-label={`Send the message ${message.title.toLowerCase()} by text`}
                  >
                    Text
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(message.link)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="control border-paper bg-paper/10 text-paper"
                    aria-label={`Share the link ${message.title.toLowerCase()} on Facebook`}
                  >
                    Facebook
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}

/** Print, Download PDF, and Share where it makes sense, each saying which item it is for. */
function PrintButtons({
  to,
  what,
  onShare,
}: {
  to: string;
  what: string;
  onShare?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to={`${to}?action=print`}
        className="control bg-highlight text-on-accent"
        aria-label={`Print ${what}`}
      >
        Print
      </Link>
      <Link
        to={`${to}?action=pdf`}
        className="control border-paper bg-paper/10 text-paper"
        aria-label={`Download PDF of ${what}`}
      >
        Download PDF
      </Link>
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          className="control border-paper bg-paper/10 text-paper"
          aria-label={`Share the link on ${what}`}
        >
          Share
        </button>
      )}
    </div>
  );
}
