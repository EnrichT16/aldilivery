import { Link } from 'react-router-dom';

import { storeConfig } from '../config';

/**
 * The privacy policy, in plain words (UK GDPR and the Data Protection Act 2018).
 *
 * A DRAFT, written from what the service actually does, for Anthony's solicitor to check before
 * the public launch. It says so at the top. Every fact in it should stay true to the code: when a
 * new kind of information is collected, or a new company handles it, this page changes too.
 */
export function Privacy(): JSX.Element {
  const name = storeConfig.productName;
  const company = storeConfig.store.legalEntityIsPlaceholder
    ? 'the company that runs it (its registered name and number will be shown here)'
    : storeConfig.store.legalEntityName;
  const days = storeConfig.accountDeletion.recycleBinDays;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Privacy</h1>
      <p className="m-0 border-2 border-paper rounded-xl p-4">
        This is a draft, being checked by our solicitor before we open to everyone. If anything here
        is unclear, ring us and a person will explain it.
      </p>

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company}. We decide what happens to the information on this page, which
          makes us its &ldquo;controller&rdquo; in the law&rsquo;s words.
        </p>
      </section>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold">
          What we keep, and why
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            <strong>Your name, mobile number and address</strong>, to bring your shopping and to
            sign you in. We text a code to your number to sign you in.
          </li>
          <li>
            <strong>What you tell the Runner at the door</strong>, such as &ldquo;knock loudly, I am
            slow to the door&rdquo;, so they can do it.
          </li>
          <li>
            <strong>Your orders</strong>: what you asked for, what the shop charged, and what you
            paid, because we have to keep money records by law.
          </li>
          <li>
            <strong>Your card</strong>: only the last four numbers and the type of card. The full
            card number goes straight to our payment company, Stripe, and never to us.
          </li>
          <li>
            <strong>Your four-number PIN</strong>, kept only in a scrambled form that cannot be
            turned back into the number.
          </li>
          <li>
            <strong>Problems you report</strong>, with any voice notes, photos and notes you send,
            so a person can put things right.
          </li>
          <li>
            <strong>In-app calls</strong>: who called whom and for how long, to charge the right
            amount. Calls are not recorded. Nobody&rsquo;s telephone number is shown to anyone.
          </li>
          <li>
            <strong>Your Ozi settings</strong>, such as whether Ozi speaks aloud, kept on your own
            phone.
          </li>
        </ul>
        <p className="m-0">
          We use this information to provide the service you ask for (the law calls this a
          contract), to keep money records the law requires, and to keep the service safe.
        </p>
      </section>

      <section aria-labelledby="voice" className="space-y-3">
        <h2 id="voice" className="text-lead font-bold">
          When you speak to Ozi
        </h2>
        <p className="m-0">
          While Ozi&rsquo;s button is green, Ozi is listening. For now, your phone or browser turns
          what you say into words. Depending on your phone and browser, that may happen on the phone
          itself, or the sound may be sent to the company that makes your browser, such as Google or
          Apple, to be turned into words. We receive only the words, never the sound: the names of
          the things you ask for, to find them. When Ozi is muted, it is not listening at all.
        </p>
      </section>

      <section aria-labelledby="runners" className="space-y-3">
        <h2 id="runners" className="text-lead font-bold">
          If you are a Runner
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            We check your right to work in the UK and a DBS certificate, as the law and our
            Shoppers&rsquo; safety need. For a car or motorbike we also check your driving licence
            and insurance.
          </li>
          <li>
            Photos of your documents are deleted as soon as a person has checked them. We keep a
            record of what was checked, by whom and when. Your face photo is kept, because Shoppers
            see it so they know it is you at the door.
          </li>
          <li>While you are on shift, we use where you are to offer you jobs nearby.</li>
          <li>Your bank details go to Stripe, on Stripe&rsquo;s own pages, never to us.</li>
          <li>
            You see each job&rsquo;s area and order number, never the Shopper&rsquo;s name, number
            or full address once the job is done.
          </li>
        </ul>
      </section>

      <section aria-labelledby="share" className="space-y-3">
        <h2 id="share" className="text-lead font-bold">
          Who else handles it
        </h2>
        <p className="m-0">
          We never sell your information. These companies handle parts of it for us, under contract,
          only to do their part:
        </p>
        <ul className="m-0 ps-6 space-y-2">
          <li>DigitalOcean, which runs our servers, in London.</li>
          <li>Stripe, for card payments, and for paying Runners.</li>
          <li>Twilio, which sends the sign-in codes by text.</li>
          <li>LiveKit, which carries in-app calls, in the European Union.</li>
          <li>
            The notification services built into phones and browsers, if you choose to have
            notifications.
          </li>
        </ul>
        <p className="m-0">
          Some of these companies are based in the United States. Where your information leaves the
          UK, it is protected by the safeguards the law requires.
        </p>
        <p className="m-0">
          We may use figures about what people buy, added up across many people, to improve the
          service and to work with shops. Every figure covers at least ten people, never anything
          about you alone, and never anything that could reveal someone&rsquo;s health.
        </p>
      </section>

      <section aria-labelledby="keep" className="space-y-3">
        <h2 id="keep" className="text-lead font-bold">
          How long we keep it
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Order and money records: seven years, then anonymised, as tax law requires.</li>
          <li>
            Your account: until you close it. When you close it, it waits {days} days in case you
            change your mind, then it is removed, apart from the money records above.
          </li>
          <li>Runner document photos: until a person has checked them.</li>
        </ul>
      </section>

      <section aria-labelledby="rights" className="space-y-3">
        <h2 id="rights" className="text-lead font-bold">
          Your rights
        </h2>
        <p className="m-0">
          You can ask us for a copy of what we hold about you, ask us to correct it, ask us to
          delete it, or object to how we use it. Ring us, and we will answer within a month. If you
          are not happy with how we handle your information, you can complain to the Information
          Commissioner&rsquo;s Office, at ico.org.uk or on 0303 123 1113.
        </p>
      </section>

      <Link to="/terms" className="control bg-paper/10 text-paper underline">
        Our terms
      </Link>
    </article>
  );
}
