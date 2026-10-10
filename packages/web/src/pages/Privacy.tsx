import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { storeConfig } from '../config';

/**
 * The privacy notice, in plain words (UK GDPR Articles 13 and 14, and the Data Protection Act
 * 2018). Reviewed against the law on 9 October 2026 (ruling 54, docs/LEGAL_REVIEW.md).
 *
 * Every fact here must stay true to the code: when a new kind of information is collected, or a
 * new company handles it, this page changes too. Company details come from config/store.json;
 * any still marked as placeholders show as "to follow".
 */
export function Privacy(): JSX.Element {
  const name = storeConfig.productName;
  const assistant = storeConfig.assistantName;
  const company = companyFacts();
  const days = storeConfig.accountDeletion.recycleBinDays;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Privacy</h1>
      <p className="m-0 text-lead">
        This page says what information we keep about you, why, who else sees it, how long we keep
        it, and what you can ask us to do. If anything is unclear, ring us and a person will explain
        it, or read it to you.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company.name}. We decide what happens to the information on this page,
          which makes us its &ldquo;controller&rdquo; in the law&rsquo;s words. You can reach us
          about anything on this page by telephone, by email, or by post to our registered office.
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold">
          What we keep, and why
        </h2>
        <p className="m-0">
          For each thing, we say why we keep it and which reason the law allows us to rely on.
        </p>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            <strong>Your name, telephone number and address</strong>, to sign you in and bring your
            shopping. We text or ring a code to your number to sign you in. Reason: to provide the
            service you asked for (the law calls this a contract).
          </li>
          <li>
            <strong>What you tell the Runner at the door</strong>, such as &ldquo;knock loudly, I am
            slow to the door&rdquo;. Your Runner sees it, in your words, so they can do it. Reason:
            a contract. If what you write or say tells us about your health or a disability, we keep
            it only because you chose to tell us so that we can help you: in law, your explicit
            consent. You can ask us to change or delete it at any time.
          </li>
          <li>
            <strong>Your orders</strong>: what you asked for, what the shop charged, what you paid,
            and how you said yes, with a photo of the till receipt if your Runner took one, and
            anything you told us about how the delivery went. Reason: a contract, and because tax
            law makes us keep money records.
          </li>
          <li>
            <strong>Your card</strong>: only the last four numbers and the type of card. The full
            card number goes straight to our payment company, Stripe, and never to us. If you pay by
            bank transfer, we see your name and the reference on the payment. Reason: a contract.
          </li>
          <li>
            <strong>Your four-number PIN</strong>, kept only in a scrambled form that cannot be
            turned back into the number. Reason: to keep your account safe (our legitimate interest,
            and yours).
          </li>
          <li>
            <strong>Problems you report</strong>, with any voice notes, photos and notes you send,
            so a person can put things right. Reason: a contract, and our legal duties to you as a
            customer.
          </li>
          <li>
            <strong>In-app calls</strong>: who called whom and for how long, to charge the right
            amount. Calls are not recorded. Nobody&rsquo;s telephone number is shown to anyone.
            Reason: a contract.
          </li>
          <li>
            <strong>Ordering by telephone</strong>: the number you ring from and the name you give,
            so we can find your account, ring you back if the call drops, and text you a payment
            link. If you ring but do not go on to order or open an account, your number is deleted
            soon after the call. Telephone calls to {assistant} are not recorded. Reason: a
            contract, or the steps you asked us to take before one.
          </li>
          <li>
            <strong>Notifications</strong>, if you turn them on: an address your phone or browser
            gives us so we can tell you how your order is going. Reason: a contract, and you can
            turn them off at any time.
          </li>
          <li>
            <strong>Your {assistant} settings</strong>, such as whether {assistant} speaks aloud,
            your language and whether you asked for extra help. These are kept on your own phone,
            not by us. The page &ldquo;What we keep on your device&rdquo;, linked at the bottom of
            this page, lists them.
          </li>
          <li>
            <strong>Security records</strong>: when you signed in and from which internet address,
            to stop people guessing codes and passwords. Reason: our legitimate interest in keeping
            everybody&rsquo;s account safe.
          </li>
        </ul>
      </section>

      <section aria-labelledby="voice" className="space-y-3">
        <h2 id="voice" className="text-lead font-bold">
          When you speak to {assistant}
        </h2>
        <p className="m-0">
          While {assistant}&rsquo;s button is green, {assistant} is listening. What you say is
          turned into words in one of two ways. Usually, the sound is sent to our own voice service,
          Oluoma Voice, run for us, which turns it into words and sends the words back; the sound is
          not kept. If that service is not available, your phone or browser turns what you say into
          words itself: depending on your phone and browser, that may happen on the phone, or the
          sound may be sent to the company that makes your browser, such as Google or Apple.
        </p>
        <p className="m-0">
          If you turn off only the talking, {assistant} is silent but still listening, so that you
          can turn it back on by voice. If you press {assistant}&rsquo;s button so that it shows
          &ldquo;Muted&rdquo;, it is not listening at all.
        </p>
        <p className="m-0">
          We never keep recordings of your voice, and we do not use your voice to recognise who you
          are. We use the words to find the things you ask for. If {assistant} cannot answer
          something you said, we may keep those words, with names, numbers and addresses taken out,
          so a person can teach {assistant} a better answer. Reason: a contract, and our legitimate
          interest in making {assistant} understand people better.
        </p>
      </section>

      <section aria-labelledby="runners" className="space-y-3">
        <h2 id="runners" className="text-lead font-bold">
          If you are a Runner
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Your name, mobile number, how you deliver, and your Runner ID. Reason: our agreement
            with you.
          </li>
          <li>
            We check your right to work in the UK. Reason: the law, and our legitimate interest in
            working only with people allowed to do this work.
          </li>
          <li>
            We check a DBS certificate, because many of our Shoppers are older, disabled or live
            alone. A DBS check is information about criminal records, which the law protects
            specially. We rely on the condition in the Data Protection Act 2018 for safeguarding
            people at risk, and we keep a written policy on how we handle it.
          </li>
          <li>
            For a car or motorbike, we check your driving licence and insurance. Reason: the law,
            and Shoppers&rsquo; safety.
          </li>
          <li>
            Photos of your documents are deleted as soon as a person has checked them. We keep a
            record of what was checked, by whom and when. Your face photo is kept while you are a
            Runner, because Shoppers see it so they know it is you at the door.
          </li>
          <li>
            While you are on shift, we use where you are to offer you jobs nearby. We keep only
            where you last were, not a history of your journeys. Off shift, we do not track you.
          </li>
          <li>
            If you press SOS, your phone shares where you are, kept up to date until you say you are
            safe, with our owner and staff only: by a private link texted to the owner, which stops
            working soon after, and in our admin panel. It is never shared with a Shopper. We keep a
            record of the SOS, with the last place shared, to look after your safety and answer for
            what we did.
          </li>
          <li>
            Your bank details go to Stripe, on Stripe&rsquo;s own pages, never to us. We keep a
            record of what you were paid, and of anything held back, as money records.
          </li>
          <li>
            The law may require us to report what Runners earn through us to HM Revenue and Customs,
            with your name, address and tax details. If so, we will ask you for what is needed and
            tell you before we report it.
          </li>
          <li>
            You see each job&rsquo;s area and order number, never the Shopper&rsquo;s name, number
            or full address once the job is done.
          </li>
          <li>
            You can close your Runner account at any time on your Runner page, or by asking{' '}
            {assistant}. Your name, number, where you last were and any document photos are deleted{' '}
            {days} days later, once nothing is owed either way. Pay records are kept as money
            records, and the record of your checks for two years.
          </li>
          <li>
            Jobs are offered by a fair rotation: nearest first, then whoever has waited longest. A
            computer does the sharing out, but whether you may deliver at all, and any decision that
            you were responsible for a problem, is always made by a person.
          </li>
        </ul>
      </section>

      <section aria-labelledby="analytics" className="space-y-3">
        <h2 id="analytics" className="text-lead font-bold">
          Figures about how the service is used
        </h2>
        <p className="m-0">
          To understand and improve the service, we keep a separate record of each purchase,
          delivery and search, without your name, telephone number or address: which shop, when, the
          postcode district (such as ME7), what kinds of things, how much, and your age group if you
          chose to give one in Settings. You appear in it only as a code that cannot be turned back
          into your name. The law still counts this as information about you, so we tell you about
          it. Reason: our legitimate interest in understanding and improving the service. You can
          ask us to stop including you at any time, and we will.
        </p>
        <p className="m-0">
          We may share or sell figures added up across many people, for example to show a shop what
          people in an area look for. Every figure covers at least ten people, never anything about
          you alone, and never anything that could reveal someone&rsquo;s health. We never sell your
          information.
        </p>
      </section>

      <section aria-labelledby="share" className="space-y-3">
        <h2 id="share" className="text-lead font-bold">
          Who else handles it
        </h2>
        <p className="m-0">
          These companies handle parts of your information for us, under contract, only to do their
          part, and only as we instruct:
        </p>
        <ul className="m-0 ps-6 space-y-2">
          <li>DigitalOcean, which runs our servers and database, in London.</li>
          <li>
            Stripe, for card payments and payment links, for paying Runners, and to check payments
            for fraud.
          </li>
          <li>
            Twilio, which sends sign-in codes and order texts, and carries telephone calls to us.
          </li>
          <li>LiveKit, which carries in-app calls, in the European Union.</li>
          <li>
            Oluoma Voice, our voice service, which turns speech into words and words into speech.
          </li>
          <li>
            The notification services built into phones and browsers (Google, Apple and Mozilla), if
            you turn notifications on.
          </li>
        </ul>
        <p className="m-0">
          Your Runner sees what they need to do the job: your name, your shopping, your address and
          your door instructions, until the job is done. Shops do not receive your details from us.
          If an organisation, such as a council or care provider, arranges your shopping, it sees
          the orders it arranges. We share information with the police, HM Revenue and Customs or a
          court only when the law requires it.
        </p>
        <p className="m-0">
          Some of these companies are based in the United States, or may reach your information from
          there. Where your information leaves the UK, it goes only to a country the UK recognises
          as protecting it properly, or to a company signed up to the UK&ndash;US &ldquo;data
          bridge&rdquo;, or under the contract terms the Information Commissioner has approved. Ring
          us for a copy of the safeguards.
        </p>
      </section>

      <section aria-labelledby="keep" className="space-y-3">
        <h2 id="keep" className="text-lead font-bold">
          How long we keep it
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Order, payment and call records: seven years, as tax law requires, then made anonymous.
          </li>
          <li>
            Your account: until you close it, in Settings or by asking {assistant}. When you close
            it, it waits {days} days in case you change your mind, then it is removed, apart from
            the money records above, which are kept without your address.
          </li>
          <li>
            Problems you report, with their photos and voice notes: two years after the problem is
            closed, unless they are needed for a legal claim.
          </li>
          <li>
            The telephone number of someone who rang but did not order or open an account: no longer
            than 30 days.
          </li>
          <li>Runner document photos: until a person has checked them.</li>
          <li>
            A Runner account: until you close it on your Runner page or by asking {assistant}. It
            is removed {days} days later, apart from the records of what you were paid, which are
            kept for seven years as money records.
          </li>
          <li>
            Records of a Runner&rsquo;s checks: while they are a Runner, and two years after they
            stop.
          </li>
          <li>
            The figures about how the service is used, with codes instead of names: three years.
          </li>
          <li>Security records of signing in: one year.</li>
        </ul>
      </section>

      <section aria-labelledby="rights" className="space-y-3">
        <h2 id="rights" className="text-lead font-bold">
          Your rights
        </h2>
        <p className="m-0">You can ask us, free of charge, to:</p>
        <ul className="m-0 ps-6 space-y-2">
          <li>give you a copy of what we hold about you;</li>
          <li>correct anything that is wrong;</li>
          <li>delete it, where we have no legal reason to keep it;</li>
          <li>
            stop or limit how we use it, or object to a use that relies on our legitimate interest;
          </li>
          <li>give you, or another company, your information in a common computer format;</li>
          <li>
            stop using something you agreed to, such as your door instructions about your health.
          </li>
        </ul>
        <p className="m-0">
          Ring us or email us, and a person will answer within one month. We may need to check it is
          really you first. No decision about you that matters in law is made by a computer alone: a
          person decides. The only automatic decisions are a refund of a small amount straight away,
          which is always in your favour, and Stripe&rsquo;s fraud checks on a payment; if a payment
          is refused and you think it is wrong, ring us.
        </p>
        <p className="m-0">
          If you are not happy with how we handle your information, please tell us first so we can
          put it right. You can also complain to the Information Commissioner&rsquo;s Office, at
          ico.org.uk or on 0303 123 1113.
        </p>
      </section>

      <section aria-labelledby="children" className="space-y-3">
        <h2 id="children" className="text-lead font-bold">
          Children
        </h2>
        <p className="m-0">
          Our service is for adults. You must be 18 or over to open an account or be a Runner. We do
          not knowingly keep information about children, apart from what an adult tells us when
          ordering for their household.
        </p>
      </section>

      <section aria-labelledby="changes" className="space-y-3">
        <h2 id="changes" className="text-lead font-bold">
          Changes to this page
        </h2>
        <p className="m-0">
          If we change how we use your information, we will change this page first, and tell you in
          the app or by text before a change that matters to you takes effect. This page was last
          reviewed on 9 October 2026.
        </p>
      </section>

      <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
        <li>
          <Link to="/terms" className="control bg-paper/10 text-paper underline">
            Our terms
          </Link>
        </li>
        <li>
          <Link to="/cookies" className="control bg-paper/10 text-paper underline">
            What we keep on your device
          </Link>
        </li>
      </ul>
    </article>
  );
}
