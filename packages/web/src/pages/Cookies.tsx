import { Link } from 'react-router-dom';

import { storeConfig } from '../config';

/**
 * What the website and app keep on your device (the Privacy and Electronic Communications
 * Regulations 2003, regulation 6), in plain words. Ruling 54, docs/LEGAL_REVIEW.md.
 *
 * Every item here is either needed for something the person asked for (signing in, paying, the
 * app working without signal) or remembers a choice they made, so no consent banner is needed.
 * Anything added that tracks people, counts visits for us or shows adverts based on them needs
 * consent first, and this page and a consent question must come with it. Keep this list true to
 * every use of localStorage, sessionStorage, cookies and the service worker in packages/web.
 */
export function Cookies(): JSX.Element {
  const assistant = storeConfig.assistantName;
  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">What we keep on your device</h1>
      <p className="m-0 text-lead">
        We use no advertising cookies and no tracking cookies, and nothing that follows you around
        other websites. The few things we keep on your phone or computer are listed here. Each one
        is needed for something you asked for, or remembers a choice you made, so we do not need to
        ask you first.
      </p>

      <section aria-labelledby="needed" className="space-y-3">
        <h2 id="needed" className="text-lead font-bold">
          Needed for the service
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            <strong>Staying signed in</strong>: a sign-in key, so you do not have to sign in every
            time. Kept until you sign out.
          </li>
          <li>
            <strong>Staff, shop and organisation sign-in</strong>: kept only until the browser tab
            is closed.
          </li>
          <li>
            <strong>Working without signal</strong>: a copy of the app itself, so it opens quickly
            and still works when the signal is poor. It holds no information about you.
          </li>
          <li>
            <strong>Paying by card</strong>: when you add a card, our payment company, Stripe, sets
            its own cookies to keep payments secure and stop fraud. They are covered by
            Stripe&rsquo;s own privacy notice.
          </li>
          <li>
            <strong>An invitation code</strong> from a link someone shared with you, kept until the
            tab is closed so the sign-up form can use it, and which kind of link brought you here,
            kept until you have signed up so the person who shared it is counted.
          </li>
        </ul>
      </section>

      <section aria-labelledby="choices" className="space-y-3">
        <h2 id="choices" className="text-lead font-bold">
          Remembering your choices
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            <strong>Your {assistant} settings</strong>: whether {assistant} speaks aloud, your
            language and voice, and whether the words are shown on the screen.
          </li>
          <li>
            <strong>Things {assistant} has already said this visit</strong>, so it does not repeat
            itself, and the day it last offered your weekly shop.
          </li>
          <li>
            <strong>Hiding the advert square</strong>, if you chose to hide it.
          </li>
        </ul>
      </section>

      <section aria-labelledby="clear" className="space-y-3">
        <h2 id="clear" className="text-lead font-bold">
          Clearing them
        </h2>
        <p className="m-0">
          Signing out removes your sign-in key. You can clear everything else in your
          browser&rsquo;s settings, under site data. {assistant} will then start again as if it were
          your first visit.
        </p>
      </section>

      <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
        <li>
          <Link to="/privacy" className="control bg-paper/10 text-paper underline">
            Privacy
          </Link>
        </li>
        <li>
          <Link to="/terms" className="control bg-paper/10 text-paper underline">
            Our terms
          </Link>
        </li>
      </ul>
    </article>
  );
}
