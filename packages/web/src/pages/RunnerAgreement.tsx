import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
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
 * It stays marked as a draft on purpose. Whether a Runner is self-employed in law depends on how
 * the work really happens, and two things in it still need Anthony's decision: how a Runner pays
 * at the till, and whether a Runner may send a checked substitute. See docs/LEGAL_REVIEW.md.
 * If the app changes how Runners work, this page must change with it.
 */
export function RunnerAgreement(): JSX.Element {
  const name = storeConfig.productName;
  const company = companyFacts();
  const { runnerPaymentPence, coolBag } = storeConfig.fees;
  const { recoveryPercentOfPay, writeOffUpToPence, instantRefundUpToPence } = storeConfig.problems;
  const holdSeconds = storeConfig.allocation.offerHoldSeconds;
  const recoveryPence = Math.floor((runnerPaymentPence * recoveryPercentOfPay) / 100);

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Runner agreement</h1>
      <p className="m-0 border-2 border-paper rounded-xl p-4">
        This is a draft. It says how working with us as a Runner works today. We will ask you to
        agree to the final version before your first job, and we will tell you if anything in it
        changes.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who this agreement is between
        </h2>
        <p className="m-0">
          This agreement is between you, the Runner, and {company.name}, which runs {name}
          (&ldquo;we&rdquo; or &ldquo;us&rdquo;).
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="status" className="space-y-3">
        <h2 id="status" className="text-lead font-bold">
          You are self-employed
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
            Because every Runner is checked by us and Shoppers see the Runner&rsquo;s photo at the
            door, you cannot send somebody else to do a job you have accepted.
          </li>
          <li>
            The law decides whether somebody is self-employed by how the work really happens, not
            only by what an agreement says. We have written this to match how the app works.
          </li>
        </ul>
      </section>

      <section aria-labelledby="checks" className="space-y-3">
        <h2 id="checks" className="text-lead font-bold">
          Checks before your first job
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Your right to work in the UK, a basic DBS check, and a face photo. For a car or
            motorbike, your driving licence and insurance that covers delivering for payment (often
            called hire and reward, or business use).
          </li>
          <li>
            A person at {name} looks at each one. Nobody is offered a job until they have passed.
          </li>
          <li>
            You must tell us straight away if anything changes, such as a new conviction, losing
            your licence or your insurance ending. Without vehicle insurance you can still deliver
            on foot, by bicycle or by public transport.
          </li>
          <li>
            Some jobs in future, such as handing shopping to the person, will need an enhanced DBS
            check.
          </li>
        </ul>
      </section>

      <section aria-labelledby="job" className="space-y-3">
        <h2 id="job" className="text-lead font-bold">
          Doing a job
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Before you accept, you see the pay and the distance.</li>
          <li>
            Buy what the Shopper asked for. If something is not on the shelf, ask the Shopper in the
            app. Never swap anything they have not agreed to. If they do not answer, leave it out.
          </li>
          <li>
            How you pay at the till for the Shopper&rsquo;s shopping will be set out in writing
            before your first job. You will never be left out of pocket for a Shopper&rsquo;s
            shopping.
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
          Your pay
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You get {money(runnerPaymentPence)} for every standard delivery you complete, whatever
            the basket. If we give you two orders in one trip, you get {money(runnerPaymentPence)}{' '}
            for each.
          </li>
          <li>
            Your pay goes to your own Stripe account, and from there to your bank. Stripe&rsquo;s
            own terms apply to that account. We send it after each delivery.
          </li>
          <li>Your Runner page shows what you earned for each job, today, this week and in all.</li>
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
          The cool bag deposit
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
          When something goes wrong
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
          Shoppers&rsquo; information
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
          Insurance
        </h2>
        <p className="m-0">
          If you drive or ride a motorbike for jobs, you must have insurance that covers delivering
          for payment, and keep it up to date. Ordinary car insurance does not cover this. We
          recommend you also have your own public liability insurance.
        </p>
      </section>

      <section aria-labelledby="ending" className="space-y-3">
        <h2 id="ending" className="text-lead font-bold">
          Stopping, and changes
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
          <li>This agreement is under the law of England and Wales.</li>
        </ul>
      </section>

      <Link to="/runner" className="control bg-paper/10 text-paper underline">
        Back to running with us
      </Link>
    </article>
  );
}
