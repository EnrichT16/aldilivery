import { AMBASSADOR_TERMS_VERSION, rewardWords, shareWords } from '@aldilivery/core';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { storeConfig } from '../config';
import { ambassadorEarningWords } from '../lib/partnership';

/**
 * The Ozi Ambassador terms, in plain words (Anthony, 30 October 2026), agreed with a tick box as
 * the first step of applying at /ambassador/apply; the server keeps when, and which version
 * (AMBASSADOR_TERMS_VERSION in packages/core). Changed the same day for applications: approval
 * only after the documents are checked and a short chat, and we may decline or suspend.
 *
 * Written only from what the service really does (services/ambassadors.ts). Every figure comes
 * from `ambassador` in config/store.json, so a change of rate there changes these words too.
 * Changed the same day for the founder's rulings: a quarter of the rate on another branch, and
 * earnings held for the refund window, following refunds, and withdrawn to a bank through Stripe.
 */
export function AmbassadorTerms(): JSX.Element {
  const name = storeConfig.productName;
  const company = companyFacts();
  const rates = storeConfig.ambassador;
  const symbol = storeConfig.store.currencySymbol;
  const earning = ambassadorEarningWords();
  const plan = shareWords(rates.planShare);
  const minimum = rewardWords(rates.payoutMinimumPence, symbol);
  const review = rewardWords(rates.reviewAbovePence, symbol);

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Ozi Ambassador terms</h1>
      <p className="m-0 text-lead">
        These are the terms for anyone who chooses to be an Ozi Ambassador and introduce businesses
        to {name}. If you would like them read to you, or in another format, ring us.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company.name}. In these terms, &ldquo;we&rdquo; and &ldquo;us&rdquo;
          means that company, and &ldquo;you&rdquo; means the Ambassador.
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="choosing" className="space-y-3">
        <h2 id="choosing" className="text-lead font-bold">
          Applying to be an Ambassador
        </h2>
        <p className="m-0">
          Being an Ambassador is your choice. To Become an Ozi Ambassador you apply on our
          Ambassador page: you agree to these terms, and we keep the time you agreed and which
          version of these terms you saw. Then you send us a photo ID, a proof of address from the
          last {rates.addressWithinMonths} months and a photo of your face, and we have a short chat
          with you.
        </p>
        <p className="m-0">
          We approve you only after we have checked your documents and had that chat. Only then do
          you get your &ldquo;Introduce a business&rdquo; link, the Ambassador Toolkit and your
          earnings. We may decline an application, and we tell you why. If we decline it, you have
          earned nothing, and you may apply again {rates.reapplyAfterMonths} months after.
        </p>
        <p className="m-0">
          We may suspend an Ambassador at any time, for example while we look into a complaint.
          While you are suspended your link, the Toolkit and withdrawals stop, but you keep what you
          earned from real, completed orders that were not refunded: it is held, and released in
          full if we lift the suspension. If we find fraud, we remove you as an Ambassador: the
          unpaid earnings from the businesses involved are cancelled, and you cannot apply again.
        </p>
        <p className="m-0">
          We ask you a separate question: may we compare your face photo with the photo on your ID
          automatically? You can say no. Then a person checks it in your chat with the founder, and
          your application goes on just the same.
        </p>
        <p className="m-0">
          If you became an Ambassador before applications began, your link keeps working and your
          earnings keep adding up. The Toolkit and withdrawals open once you have sent your
          documents, had the chat and been approved.
        </p>
        <p className="m-0">
          We keep your documents while you are an Ambassador and for {rates.documentsKeptMonths}{' '}
          months after you stop or are removed. If we decline your application, we delete them{' '}
          {rates.declinedDocumentsDeleteAfterDays} days after, and keep only a short note for{' '}
          {rates.declinedNoteKeptMonths} months, as our privacy notice says.
        </p>
      </section>

      <section aria-labelledby="independent" className="space-y-3">
        <h2 id="independent" className="text-lead font-bold">
          You are independent
        </h2>
        <p className="m-0">
          You act as an independent marketer for {name}. You are not our employee, worker or agent,
          and these terms do not make you one. You choose when and how you introduce businesses.
          There is no limit on how many you introduce: the more you introduce, the more you can
          earn.
        </p>
      </section>

      <section aria-labelledby="earn" className="space-y-3">
        <h2 id="earn" className="text-lead font-bold">
          What you earn
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            <strong>A share of what we keep</strong> on every order from a business you introduced,
            for {rates.months} months from the day we approve that business.
            <ul className="m-0 ps-6 space-y-1">
              <li>{earning.restaurant}</li>
              <li>{earning.grocery}</li>
            </ul>
          </li>
          <li>
            <strong>Each branch is its own business.</strong> The branch you introduced earns you
            the full rates. {earning.branch}
          </li>
          <li>
            <strong>A one-off {plan} of the business&rsquo;s first Partner Plus payment</strong>, if
            it chooses Partner Plus, once that payment is confirmed. The free month is not a
            payment.
          </li>
          <li>
            Only businesses we have approved, with real orders, earn you anything. Your dashboard
            shows the businesses you introduced, what is pending, what is available and what we have
            paid you. It never shows a business&rsquo;s orders.
          </li>
        </ul>
        <p className="m-0">
          What you earn on an order is worked out from what the customer finally paid. If an order
          is cancelled or refunded, you earn nothing on it; if part of it is refunded, you earn
          less. Your earnings on an order stay pending for {rates.holdDays} days after it is
          delivered, in case of a refund or complaint, and then become available. If a refund comes
          after that, for example a late complaint or a card payment the customer&rsquo;s bank takes
          back, we take it off what becomes available to you next. It never takes you below nothing,
          and it is shown on your dashboard.
        </p>
      </section>

      <section aria-labelledby="paid" className="space-y-3">
        <h2 id="paid" className="text-lead font-bold">
          How you are paid
        </h2>
        <p className="m-0">
          We only ever pay what is available, never what is pending. We pay you monthly once at
          least {minimum} is available, and you can also ask to withdraw it to your bank yourself
          from your dashboard. Until then, it carries on to the next month.
        </p>
        <p className="m-0">
          To withdraw, you give your bank details to Stripe, our payment provider, on Stripe&rsquo;s
          own form. They go straight to Stripe and never through us. Stripe then pays the money into
          your bank, usually within a few working days.
        </p>
        <p className="m-0">
          There is no limit on what you can earn. But if your earnings, or your withdrawals, in one
          month are over {review}, a person checks them before we pay, which can take a little
          longer. We may also check every payment for anyone whose introductions look unusual.
        </p>
        <p className="m-0">
          You must declare what you earn to HM Revenue and Customs yourself, and pay any tax on it.
          We do not take tax off for you.
        </p>
      </section>

      <section aria-labelledby="rules" className="space-y-3">
        <h2 id="rules" className="text-lead font-bold">
          What you must not do
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Do not introduce your own business. If the business&rsquo;s phone number or email is
            yours, the introduction is not recorded.
          </li>
          <li>
            Do not promise anything on our behalf, such as prices, places, approval, or how much a
            business will earn.
          </li>
          <li>Do not say anything about {name} that is untrue or misleading.</li>
        </ul>
        <p className="m-0">
          We may end the arrangement, and not pay what was earned through it, if you misuse it or
          make misleading claims. You can stop at any time by telling us.
        </p>
      </section>

      <section aria-labelledby="law" className="space-y-3">
        <h2 id="law" className="text-lead font-bold">
          The law
        </h2>
        <p className="m-0">
          These terms are governed by the law of England and Wales, and the courts of England and
          Wales deal with any dispute. We may change these terms; if we do, we ask you to agree to
          the new version. Your link keeps working while you read them, and withdrawals wait until
          you agree.
        </p>
        <p className="m-0 extra">Version {AMBASSADOR_TERMS_VERSION}.</p>
      </section>
    </article>
  );
}
