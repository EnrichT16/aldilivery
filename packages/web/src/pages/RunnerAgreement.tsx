import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The Runner agreement, in plain words (ruling 54, docs/LEGAL_REVIEW.md).
 *
 * Written to match how the Runner app actually works, so that what it says is true in practice:
 * a Runner goes on and off shift whenever they like, with no minimum hours; any offer can be
 * declined or left to run out, with no reason and no effect on their place in the rotation
 * (`POST /jobs/:offerId/decline` and `services/allocation.ts`); the pay is a flat figure per
 * delivery (Rule Two); the cool bag deposit and the recovery rate come from config/store.json;
 * nothing is ever deducted without a written decision by a person.
 *
 * Paying at the till was decided on 9 October 2026 (ruling 55): the Runner pays with their own
 * card and is paid back the accepted till total straight away (`services/reimburse.ts`). A
 * Runner agrees to this page before their first job; the date, the version below and how they
 * agreed are kept, and no job is offered or accepted until they have.
 *
 * Issued as the final agreement on 25 October 2026 (Anthony): the draft notice is gone and the
 * terms are numbered. Whether a Runner is self-employed in law still depends on how the work
 * really happens, so the page must keep matching the app. If the app changes how Runners work,
 * this page must change with it, and so must
 * RUNNER_AGREEMENT_VERSION in packages/core, so every Runner is asked to agree again.
 */
export function RunnerAgreement(): JSX.Element {
  const name = storeConfig.productName;
  const company = companyFacts();
  const { runnerPaymentPence, coolBag } = storeConfig.fees;
  const { recoveryPercentOfPay, writeOffUpToPence, instantRefundUpToPence } = storeConfig.problems;
  const holdSeconds = storeConfig.allocation.offerHoldSeconds;
  const allocatedHoldMinutes = storeConfig.allocation.allocatedHoldMinutes;
  const recoveryPence = Math.floor((runnerPaymentPence * recoveryPercentOfPay) / 100);
  const { maximumOrderGoodsPence } = storeConfig.fees;
  const { maxGoodsPenceByMode, splitAfterMinutes, splitPartMaxPenceByMode } = storeConfig.dispatch;
  const versionDate = new Date(`${RUNNER_AGREEMENT_VERSION}T12:00:00Z`).toLocaleDateString(
    'en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Runner Services Agreement</h1>
      <p className="m-0">
        <strong>Effective from {versionDate}.</strong> Agreement version {RUNNER_AGREEMENT_VERSION}.
      </p>
      <p className="m-0 border-2 border-paper rounded-2xl p-4">
        These are the terms on which you provide shopping and delivery services through {name} as an
        independent, self-employed contractor. Please read them carefully. You accept them by
        agreeing in the app before your first job, and a record of the version, the date and how you
        agreed is kept on your account. If these terms change, you will be asked to agree to the new
        version before your next job.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          1. The parties
        </h2>
        <p className="m-0">
          This agreement is between you, the Runner, and {company.name}, which runs {name}
          (&ldquo;we&rdquo; or &ldquo;us&rdquo;).
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="status" className="space-y-3">
        <h2 id="status" className="text-lead font-bold">
          2. Your status as a self-employed contractor
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You work for yourself. You are not our employee, and you are free to run your own
            business as you choose. You are responsible for your own tax and National Insurance, and
            for registering with HM Revenue and Customs as self-employed.
          </li>
          <li>
            You decide whether, when and for how long you work. Go on shift when you want and off
            shift when you want. There are no minimum hours and no rota.
          </li>
          <li>
            You can say no to any job, without a reason, and nothing happens to you. A job is held
            for you for {holdSeconds} seconds; if you decline it or let the time run out, it goes to
            somebody else and your place in the rotation stays as it was. We never rank Runners by
            how many jobs they accept.
          </li>
          <li>You can work for anyone else at the same time, including other delivery apps.</li>
          <li>
            You use your own phone, your own way of getting about, and your own clothes. There is no
            uniform.
          </li>
          <li>
            A job sent to you directly by our office is held for you for {allocatedHoldMinutes}{' '}
            minutes. You are still free to decline it, with no reason and no effect on you.
          </li>
          <li>
            Because every Runner is checked by us and Shoppers see the Runner&rsquo;s photo at the
            door, you must carry out each job you accept yourself and may not pass it to anybody
            else.
          </li>
          <li>
            Nothing in this agreement creates employment, worker status, partnership or agency
            between you and us. You have no authority to make commitments on our behalf.
          </li>
        </ul>
      </section>

      <section aria-labelledby="checks" className="space-y-3">
        <h2 id="checks" className="text-lead font-bold">
          3. Checks before your first job
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Your right to work in the UK, a basic DBS check, and a face photo. For a car or
            motorbike, your driving licence and insurance that covers delivering for payment (often
            called hire and reward, or business use).
          </li>
          <li>
            We check each one. Documents that are clearly in order are approved straight away; any
            that are unclear are decided by a person at {name}, never refused automatically. Nobody
            is offered a job until every check has passed.
          </li>
          <li>
            You must tell us straight away if anything changes, such as a new conviction, losing
            your licence or your insurance ending. Without vehicle insurance you can still deliver
            on foot, by bicycle or by public transport.
          </li>
          <li>
            We may ask for an enhanced DBS check before offering you certain kinds of job. We will
            tell you which jobs need it and you are free not to take them.
          </li>
        </ul>
      </section>

      <section aria-labelledby="job" className="space-y-3">
        <h2 id="job" className="text-lead font-bold">
          4. Carrying out a job
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Before you accept, you see the pay and the distance.</li>
          <li>
            How much shopping, at the shop&rsquo;s prices, each way of travelling carries: on foot
            or by bicycle up to {money(maxGoodsPenceByMode.foot)}, by motorbike up to{' '}
            {money(maxGoodsPenceByMode.motorbike)}, by car or van up to{' '}
            {money(maxGoodsPenceByMode.car)}. You are only offered an order your way of travelling
            can carry. A motorbike, car or van needs your driving licence and in-date insurance
            checked.
          </li>
          <li>
            An order that nobody who can carry it takes within {splitAfterMinutes} minutes is split
            into parts, using as few Runners as possible: parts of up to{' '}
            {money(splitPartMaxPenceByMode.motorbike)} for motorbike riders first (a car or van may
            take one too), then parts of up to {money(splitPartMaxPenceByMode.foot)} for Runners on
            foot or by bicycle. Each part is offered only to Runners of its kind. Bring only the
            items on your list; another Runner brings the rest.
          </li>
          <li>
            Buy what the Shopper asked for. If something is not on the shelf, ask the Shopper in the
            app. Never swap anything they have not agreed to. If they do not answer, leave it out.
          </li>
          <li>
            You pay at the till for the Shopper&rsquo;s shopping with your own card. As soon as you
            put the till total into the app, we pay it back to you, straight to your own Stripe
            account. You are never left out of pocket for a Shopper&rsquo;s shopping.
          </li>
          <li>Type the till total exactly as it is on the receipt, and keep the receipt.</li>
          <li>
            Never buy or carry alcohol, tobacco, medicines, cash or anything with an age limit.
          </li>
          <li>
            Keep chilled and frozen food in a cool bag, and follow the Shopper&rsquo;s door
            instructions.
          </li>
          <li>
            Your safety comes first. You never have to challenge anybody, and you can stop a job and
            leave if you feel unsafe. Tell us, and we will sort it out with the Shopper.
          </li>
        </ul>
      </section>

      <section aria-labelledby="pay" className="space-y-3">
        <h2 id="pay" className="text-lead font-bold">
          5. Your pay
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You get {money(runnerPaymentPence)} for every standard delivery you complete, whatever
            the basket. If we give you two orders in one trip, you get {money(runnerPaymentPence)}{' '}
            for each.
          </li>
          <li>
            For an order of {money(storeConfig.fees.largeOrderFromPence)} or more of shopping at the
            shop&rsquo;s prices, delivered whole, you get{' '}
            {money(storeConfig.fees.largeOrderRunnerPaymentPence)} instead.
          </li>
          <li>
            A split job, one part of an order too big for one Runner to carry, pays{' '}
            {money(storeConfig.dispatch.splitRunnerPayPence)} for your part. You are told it is a
            split job, and what it pays, before you say yes.
          </li>
          <li>
            Your pay goes to your own Stripe account, and from there to your bank. Stripe&rsquo;s
            own terms apply to that account. We send it after each delivery. Stripe then pays it
            into your bank once a week, on a Friday, or every day if you choose that on your Money
            tab. If you need it sooner, you can take an instant payout to a debit card; Stripe
            charges a small fee for that, which you pay, and you are shown it before anything is
            sent.
          </li>
          <li>
            Paying you back for the shopping is separate from your pay, and never comes out of it.
            We pay back the till total straight away when it is close to what the Shopper was told:
            up to the estimate plus {money(500)} or a fifth of the estimate, whichever is more. If
            the till came to more than that, or to more than {money(maximumOrderGoodsPence)}, the
            most one order carries, a person at {name} checks it first, the same day where we can,
            and then pays it back. We pay back what the till says, never more, and you are told in
            plain words each time.
          </li>
          <li>
            If your Stripe account is not ready, the money is owed to you, shown on your Runner
            page, and sent as soon as it is.
          </li>
          <li>
            Your Runner page shows what you earned for each job, today, this week and in all, and
            what you have been paid back for the shopping.
          </li>
          <li>
            In-app calls never cost you anything. Your telephone number is never shown to a Shopper.
          </li>
          <li>
            We may have to report what you earn through us to HM Revenue and Customs. If so, we will
            ask you for the details needed and tell you before we report.
          </li>
        </ul>
      </section>

      <section aria-labelledby="bag" className="space-y-3">
        <h2 id="bag" className="text-lead font-bold">
          6. The cool bag deposit
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            We hold back {money(coolBag.withholdPerOrderPence)} from each of your first payments,
            until we hold {money(coolBag.depositPence)} in all. We never hold back more than that,
            and you always get the rest of your pay for the job.
          </li>
          <li>
            The deposit is your money. We pay all of it back to you with your pay for your{' '}
            {coolBag.releaseAfterCompletedDeliveries}th delivery.
          </li>
          <li>
            If you stop being a Runner before then, we pay back everything we hold within 14 days of
            you telling us, unless you owe us money under the next section, in which case we tell
            you in writing what we have kept and why.
          </li>
          <li>Every amount held back is shown on your Runner page, against the job.</li>
        </ul>
      </section>

      <section aria-labelledby="wrong" className="space-y-3">
        <h2 id="wrong" className="text-lead font-bold">
          7. When something goes wrong
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Accidents happen. If a Shopper is refunded for a split bag, a wrong item or damage, we
            pay for it, not you, unless you were careless.
          </li>
          <li>
            Small refunds of {money(instantRefundUpToPence)} or less are never counted against you.
          </li>
          <li>
            Nothing is ever taken from your pay automatically. A person looks at the evidence,
            including anything you send from the job&rsquo;s &ldquo;Report a problem&rdquo; page,
            and decides. You are told the decision and the reason in writing, and you can answer it
            and ask for it to be looked at again.
          </li>
          <li>
            Only if a person decides you were responsible: {recoveryPercentOfPay}% of each later
            job&rsquo;s pay ({money(recoveryPence)} of {money(runnerPaymentPence)}) goes towards the
            refund, until it is repaid. You always keep the rest. You agree to this when you agree
            to this agreement, before any job.
          </li>
          <li>
            If you stop being a Runner owing {money(writeOffUpToPence)} or less, we write it off. If
            you owe more, we ask you to repay it; we do not take it any other way.
          </li>
        </ul>
      </section>

      <section aria-labelledby="information" className="space-y-3">
        <h2 id="information" className="text-lead font-bold">
          8. Confidentiality and Shoppers&rsquo; information
        </h2>
        <p className="m-0">
          You see a Shopper&rsquo;s name, address and door instructions only while you have their
          job. Use them only for that job, never keep or share them, and never contact a Shopper
          outside the app. Our privacy page says what we keep about you.
        </p>
        <Link to="/privacy" className="control bg-paper/10 text-paper underline">
          Privacy
        </Link>
      </section>

      <section aria-labelledby="insurance" className="space-y-3">
        <h2 id="insurance" className="text-lead font-bold">
          9. Insurance and responsibility
        </h2>
        <p className="m-0">
          If you drive or ride a motorbike for jobs, you must have insurance that covers delivering
          for payment, and keep it up to date. Ordinary car insurance does not cover this. We
          recommend you also have your own public liability insurance. You are responsible for your
          own vehicle, equipment and conduct while carrying out a job, and for complying with the
          law, including road traffic and food hygiene rules.
        </p>
      </section>

      <section aria-labelledby="ending" className="space-y-3">
        <h2 id="ending" className="text-lead font-bold">
          10. Ending this agreement, changes and general terms
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>You can stop being a Runner at any time. Tell us, and we settle your pay.</li>
          <li>
            We can end this agreement if a check is failed or lapses, or for serious misconduct such
            as theft, violence or misusing a Shopper&rsquo;s information. We tell you why, and you
            can answer, except where we must act straight away to keep somebody safe.
          </li>
          <li>
            We tell you at least 14 days before a change to your pay or to this agreement, unless
            the law makes us change it sooner. You are free to stop if you do not agree.
          </li>
          <li>
            This agreement, together with our privacy page, is the whole agreement between you and
            us about your services as a Runner. If any part of it is found to be unenforceable, the
            rest still applies.
          </li>
          <li>
            This agreement is governed by the law of England and Wales, and the courts of England
            and Wales have jurisdiction over any dispute about it.
          </li>
          <li>
            Questions about this agreement: write to us at{' '}
            {storeConfig.contact.emailIsPlaceholder
              ? 'our registered office'
              : storeConfig.contact.email}
            , or ring {storeConfig.contact.telephonePlaceholder}.
          </li>
        </ul>
      </section>

      <Link to="/runner" className="control bg-paper/10 text-paper underline">
        Back to running with us
      </Link>
    </article>
  );
}
