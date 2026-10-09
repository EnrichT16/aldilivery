import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * The terms for Shoppers, in plain words.
 *
 * Written from the rules the service actually enforces: the flat fee, the most one delivery
 * carries, paying what the till says, nothing charged without a yes, nothing swapped without a
 * yes, the refund timeline and the call price. Every figure comes from configuration, so a price
 * changed there changes here. Reviewed against the Consumer Contracts Regulations 2013, the
 * Consumer Rights Act 2015 and the E-Commerce Regulations 2002 on 9 October 2026 (ruling 54,
 * docs/LEGAL_REVIEW.md). Runners have their own agreement, at /runner/agreement.
 */
export function Terms(): JSX.Element {
  const name = storeConfig.productName;
  const assistant = storeConfig.assistantName;
  const { standardDeliveryPence, maximumGoodsPence, runnerPaymentPence } = storeConfig.fees;
  const { instantRefundUpToPence, decideWithinWorkingDays } = storeConfig.problems;
  const { extras, calls, voice } = storeConfig;
  const company = companyFacts();

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Our terms</h1>
      <p className="m-0 text-lead">
        These are the terms of our agreement with you when you shop with us. Nothing here takes away
        your rights under UK consumer law. If you would like them read to you, or in another format,
        ring us.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company.name}. In these terms, &ldquo;we&rdquo; and &ldquo;us&rdquo;
          means that company, and &ldquo;you&rdquo; means the Shopper.
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="what" className="space-y-3">
        <h2 id="what" className="text-lead font-bold">
          What we do
        </h2>
        <p className="m-0">
          You tell us what shopping you need, by talking to {assistant}, by tapping, or by
          telephone. A Runner buys it for you at the shop and brings it to your door. Runners are
          self-employed people who work with us; we are responsible to you for the service.
        </p>
        <p className="m-0">
          Our service is for adults. You must be 18 or over to open an account, and the shopping is
          for you or your household, not for a business.
        </p>
      </section>

      <section aria-labelledby="price" className="space-y-3">
        <h2 id="price" className="text-lead font-bold">
          What it costs
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Delivery is {money(standardDeliveryPence)}, the only fee on an order. There is no
            minimum spend and no extra charge at busy times. {money(runnerPaymentPence)} of it goes
            to your Runner, every time.
          </li>
          <li>
            One delivery carries up to {money(maximumGoodsPence)} of shopping. More than that goes
            as a second delivery, with its own fee, and we tell you before you order.
          </li>
          <li>
            The prices shown are estimates. You pay what the shop&rsquo;s till charges, shown on the
            receipt. We take the estimate when you order. When your Runner sends the till total: if
            it is less, we give the difference straight back to your card; if it is more, we take
            the difference from the same card, up to {money(500)} or a fifth of the shopping
            estimate, whichever is more. We will not take more than that without speaking to you
            first. We tell you each time.
          </li>
          <li>
            In-app calls cost {calls.pencePerMinute}p a minute for each person on the call, paid by
            the Shopper. {assistant} tells you the price and waits for your yes before each call.
          </li>
          <li>
            Extras, if you choose them: Recipe Pass {money(extras.recipePassPence)} for{' '}
            {extras.recipePassDays} days; Plus {money(extras.plusPence)}, or{' '}
            {money(extras.plusFamilyPence)} for a family, for {extras.plusDays} days; {assistant}{' '}
            Finds It {money(extras.findItPence)}, given back if nothing is found. None of them
            renews by itself. Each price is told to you and agreed before it is taken.
          </li>
          <li>All prices include any VAT that applies.</li>
        </ul>
      </section>

      <section aria-labelledby="yes" className="space-y-3">
        <h2 id="yes" className="text-lead font-bold">
          Ordering and paying: nothing without your yes
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Before you order, the shopping, the delivery fee, the total and the delivery address are
            put to you. Your order is made, and you agree to pay, when you press the button to send
            it, or say yes when {assistant} reads it back. We then confirm it on the screen or by
            text.
          </li>
          <li>
            You pay by a card kept safely by our payment company, Stripe, by a secure payment link
            we text you, or by bank transfer. Nobody is sent to the shop until it is paid.
          </li>
          <li>
            An order made by voice only ever goes to an address already saved on your account. Above{' '}
            {money(voice.paymentCeilingPence)}, a yes by voice is not enough: you also confirm it
            with a touch.
          </li>
          <li>
            If something is not on the shelf, your Runner asks you. Nothing is swapped without your
            say. If you do not answer, it is left out, and you are not charged for it.
          </li>
          <li>
            You can ask someone you trust, such as a family member or carer, to add your card for
            you. You are responsible for orders made on your account, so keep your PIN to yourself
            and tell us straight away if your phone is lost.
          </li>
        </ul>
      </section>

      <section aria-labelledby="not" className="space-y-3">
        <h2 id="not" className="text-lead font-bold">
          What we cannot bring
        </h2>
        <p className="m-0">
          Alcohol, tobacco, medicines, cash and anything else with an age limit are not delivered.
          Your Runner will leave out anything the shop or the law does not allow us to bring, and
          you are not charged for it.
        </p>
      </section>

      <section aria-labelledby="delivery" className="space-y-3">
        <h2 id="delivery" className="text-lead font-bold">
          Delivery
        </h2>
        <p className="m-0">
          We tell you when a Runner has your order, when it is on its way and when it is delivered.
          Your Runner follows your door instructions. If your Runner cannot reach you at the door,
          they will try to call you in the app, and a person will contact you to agree what happens
          next. If we cannot deliver at all, we refund you in full.
        </p>
      </section>

      <section aria-labelledby="cancel" className="space-y-3">
        <h2 id="cancel" className="text-lead font-bold">
          Changing your mind
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            When you send an order, you ask us to start straight away. You can cancel it free, with
            a full refund, at any time before your Runner starts shopping. Ring us or email us. You
            can use words like: &ldquo;I want to cancel my order&rdquo;, with your name and the
            order number.
          </li>
          <li>
            Once your Runner has started shopping, you can still cancel, but you pay for the
            shopping already bought and the delivery fee, because the work has been done for you.
          </li>
          <li>
            Once your shopping is delivered, our service is complete, and the usual 14 days to
            change your mind no longer applies to it. Fresh, chilled and frozen food cannot be
            returned because you changed your mind. None of this affects your rights when something
            is wrong, below.
          </li>
          <li>
            Recipe Pass and Plus: you can cancel within 14 days of buying, by ringing or emailing
            us. We refund you, less a fair part for the days you have already had. Gift cards: you
            can cancel within 14 days for a full refund if the card has not been used.
          </li>
        </ul>
      </section>

      <section aria-labelledby="wrong" className="space-y-3">
        <h2 id="wrong" className="text-lead font-bold">
          When something goes wrong, and refunds
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Tell us on the order&rsquo;s &ldquo;Report a problem&rdquo; page in the app, or ring us.
            You can add photos, voice notes or a note.
          </li>
          <li>
            Asking for {money(instantRefundUpToPence)} or less back? It is refunded straight away.
          </li>
          <li>
            Otherwise a person decides within {decideWithinWorkingDays} working days and tells you
            why. A refund goes back to your card the day it is decided, and always within 14 days. A
            refund for a bank transfer is paid back to your bank account by a person, and can take a
            few days longer.
          </li>
          <li>
            Your rights under the Consumer Rights Act 2015 always apply: the goods must be of
            satisfactory quality, fit for purpose and as described, and our service must be done
            with reasonable care and skill. If they are not, you are entitled to have it put right,
            or to a refund.
          </li>
        </ul>
      </section>

      <section aria-labelledby="responsible" className="space-y-3">
        <h2 id="responsible" className="text-lead font-bold">
          What we are responsible for
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            We are responsible for loss or damage you suffer that is a foreseeable result of us
            breaking these terms or not taking reasonable care. Loss is foreseeable if it was
            obvious it would happen, or if we both knew it might when you ordered.
          </li>
          <li>
            We never limit our responsibility for death or injury caused by our negligence or that
            of our Runners, for fraud, or for anything else the law does not allow us to limit.
          </li>
          <li>
            We are not responsible for delays caused by events outside our control, such as severe
            weather or a shop closing. If that happens, we tell you, and you can cancel for a full
            refund.
          </li>
        </ul>
      </section>

      <section aria-labelledby="help" className="space-y-3">
        <h2 id="help" className="text-lead font-bold">
          Help and adjustments
        </h2>
        <p className="m-0">
          We built {name} for everyone, and especially for people who are blind, partially sighted,
          older, or find shopping hard. Every screen aims to meet the WCAG 2.2 AA accessibility
          standard and works with screen readers and Braille displays. You can order by voice, by
          touch or by telephone. If anything makes it hard for you to use our service, tell us, and
          we will make reasonable changes to help, as the Equality Act 2010 asks of us, such as
          reading these terms to you, ringing you instead of texting, or giving you more time.
        </p>
      </section>

      <section aria-labelledby="account" className="space-y-3">
        <h2 id="account" className="text-lead font-bold">
          Your account, and changes to these terms
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You can close your account at any time by ringing us. It waits{' '}
            {storeConfig.accountDeletion.recycleBinDays} days in case you change your mind.
          </li>
          <li>
            We may close an account that is used for fraud or to abuse a Runner or our staff. We
            will tell you why, unless the law stops us.
          </li>
          <li>
            If we change these terms, we tell you before the change takes effect. A change never
            applies to an order you have already made.
          </li>
        </ul>
      </section>

      <section aria-labelledby="complaints" className="space-y-3">
        <h2 id="complaints" className="text-lead font-bold">
          Complaints, and the law that applies
        </h2>
        <p className="m-0">
          If you are unhappy, ring us or email us, and a person will look into it and reply within{' '}
          {decideWithinWorkingDays} working days. If we cannot agree, free advice is available from
          the Citizens Advice consumer helpline, on 0808 223 1133, and you can take a claim to
          court.
        </p>
        <p className="m-0">
          These terms are under the law of England and Wales. If you live in Scotland or Northern
          Ireland, you keep the protections of the law where you live, and you can bring a claim in
          your own courts.
        </p>
        <p className="m-0">These terms were last reviewed on 9 October 2026.</p>
      </section>

      <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
        <li>
          <Link to="/privacy" className="control bg-paper/10 text-paper underline">
            Privacy
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
