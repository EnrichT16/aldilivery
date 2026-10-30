import {
  counterPricePence,
  markedUpPricePence,
  markupDisclosureWords,
  preferredRankingWords,
  SHOP_PARTNER_TERMS_VERSION,
} from '@aldilivery/core';
import { Link } from 'react-router-dom';

import { CompanyDetails, DetailsToFollowNotice, companyFacts } from '../components/CompanyDetails';
import { storeConfig } from '../config';
import { money } from '../lib/money';
import { SHOP_PRICES_WORDS } from '../lib/partnership';

/**
 * The Shop Partner terms, in plain words (Anthony, 30 October 2026), agreed with a tick box when
 * a shop, café, takeaway or service joins at /business/join; the server keeps when, and which
 * version (SHOP_PARTNER_TERMS_VERSION in packages/core).
 *
 * Written only from what the service really does (routes/business.ts and lib/spotlight.ts):
 * the free listing and Partner Plus, Spotlight, restaurants (no commission; an optional discount
 * for Ozi, paid in full at the counter at the agreed price; the Preferred Partner level it
 * decides, Anthony, 30 October 2026), paying through Stripe from the dashboard, each product
 * checked before Shoppers see it, and what each side sees. Every figure comes from
 * config/store.json, so a price changed there changes here.
 */
export function PartnerTerms(): JSX.Element {
  const name = storeConfig.productName;
  const assistant = storeConfig.assistantName;
  const { partners, spotlightPence, spotlightPlusPence, spotlightPerWeek, spotlightPlusPerWeek } =
    storeConfig.extras;
  const company = companyFacts();
  const { preferredDiscountPercent } = storeConfig.restaurants;
  // The worked example, from config: a dish of the smallest restaurant order's price.
  const exampleDish = storeConfig.restaurants.minimumOrderPence;

  return (
    <article className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Shop Partner terms</h1>
      <p className="m-0 text-lead">
        These are the terms between us and a shop, café, takeaway or service listed on {name}. If
        you would like them read to you, or in another format, ring us.
      </p>
      <DetailsToFollowNotice />

      <section aria-labelledby="who" className="space-y-3">
        <h2 id="who" className="text-lead font-bold">
          Who we are
        </h2>
        <p className="m-0">
          {name} is run by {company.name}. In these terms, &ldquo;we&rdquo; and &ldquo;us&rdquo;
          means that company, and &ldquo;you&rdquo; means the business that joins.
        </p>
        <CompanyDetails />
      </section>

      <section aria-labelledby="joining" className="space-y-3">
        <h2 id="joining" className="text-lead font-bold">
          Joining
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You join with a short form and confirm your mobile with a code. You can add products
            straight away; your page goes public once a person at {name} has checked it.
          </li>
          <li>
            Each product is checked before Shoppers see it. We never list alcohol, tobacco,
            medicines, cash or anything age restricted, and we cannot list a service that needs a
            licence from the FCA, the SRA or the MHRA.
          </li>
          <li>
            If {assistant} listed your shop from public details, you can claim its page, except a
            branch of a national chain. We check a claim before the page goes live again.
          </li>
        </ul>
      </section>

      <section aria-labelledby="plans" className="space-y-3">
        <h2 id="plans" className="text-lead font-bold">
          What a shop gets
        </h2>
        <h3 className="font-bold m-0">A basic listing</h3>
        <p className="m-0">
          Your name, address, opening hours and up to {partners.freeProductLimit} products, without
          photos. The first {partners.freeListingCount} shops to join get it free, with no monthly
          fee. Once those have all gone, we say so on the form and do not offer it.
        </p>
        <h3 className="font-bold m-0">Partner Plus</h3>
        <p className="m-0">
          {money(partners.plusMonthlyPence)} a month
          {partners.plusFirstMonthFree ? ', with the first month free, taken once' : ''}. Your full
          catalogue with photos; the chance to be our Shoppers&rsquo; Shop of the Month, decided by
          their ratings, for shops whose Partner Plus is paid; Spotlight on top if you want it; and
          first place among shops at the same distance, in search and on the shops list.
        </p>
        <h3 className="font-bold m-0">Spotlight and Spotlight Plus</h3>
        <p className="m-0">
          For shops on paid Partner Plus: {money(spotlightPence)} a month for Spotlight, or{' '}
          {money(spotlightPlusPence)} for Spotlight Plus. When a Shopper searches for something you
          sell, {assistant} may mention you after the genuine results, called an advert, with
          checkable facts only, such as &ldquo;is sold at&rdquo; and the price. Each Shopper hears
          you at most {spotlightPerWeek} time{spotlightPerWeek === 1 ? '' : 's'} a week on
          Spotlight, or {spotlightPlusPerWeek} times on Spotlight Plus, and Shoppers on our Plus and
          Family plans hear no adverts at all.
        </p>
      </section>

      <section aria-labelledby="restaurants" className="space-y-3">
        <h2 id="restaurants" className="text-lead font-bold">
          Restaurants, cafés and takeaways
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You pay {name} no commission and no monthly fee on orders placed through {name}.
          </li>
          <li>
            You may agree a discount for {name}: you sell to us at a lower price than your shop
            price. For example, a dish at {money(exampleDish)} in your shop, sold to us at{' '}
            {money(counterPricePence(exampleDish, preferredDiscountPercent))}, is a discount of{' '}
            {preferredDiscountPercent}%. A person at {name} records the discount you agree, and you
            can change it by ringing us. Agreeing one is your choice.
          </li>
          <li>
            Shoppers see and pay your shop price, with any mark-up you agreed. Our Runner pays you
            at the counter, in full, at the agreed price: your shop price less the discount, or your
            shop price if you have agreed none. We keep the difference.
          </li>
          <li>
            You may also agree a mark-up: we show your dishes to Shoppers at your shop price plus
            that percentage, and keep it. For example, a mark-up of 50% shows a dish at{' '}
            {money(exampleDish)} in your shop at {money(markedUpPricePence(exampleDish, 50))}. You
            are still paid your shop price, less any discount. Next to your prices, Shoppers are
            told: &ldquo;{markupDisclosureWords(assistant, 'food')}&rdquo; A person at {name}{' '}
            records the mark-up you agree, up to {storeConfig.restaurants.maximumMarkupPercent}%,
            and you can change it by ringing us. A shop may agree a discount or a mark-up in the
            same way, and its Shoppers are told prices may be higher than in the shop.
          </li>
          <li>
            Shoppers pay a flat restaurant fee in place of delivery:{' '}
            {money(storeConfig.restaurants.feePence)}, or{' '}
            {money(storeConfig.restaurants.largeOrderFeePence)} for{' '}
            {money(storeConfig.restaurants.largeOrderFromPence)} of dishes or more. It pays our
            Runner and us, and never comes out of what you are paid.
          </li>
          <li>
            There are two levels, and the discount alone decides them. A restaurant with a discount
            of {preferredDiscountPercent}% or more is an {assistant} Preferred Partner; every other
            restaurant is listed normally. Shoppers pay nothing more either way.
          </li>
          <li>
            A Preferred Partner is listed first in its area and food type, on the lists, in search
            and when {assistant} suggests a place for a dish, with a &ldquo;Preferred Partner&rdquo;
            badge. Next to every list it changes, Shoppers are told why: &ldquo;
            {preferredRankingWords(assistant)}&rdquo;
          </li>
          <li>
            While it keeps the discount, a Preferred Partner has Partner Plus free, and is never
            charged for it; one free Spotlight week each calendar month, taken from its dashboard or
            given by us; and, where two places are rated equally by our Shoppers, it wins the tie
            for Shop of the Month. If the discount goes below {preferredDiscountPercent}%, these
            stop, and nothing is owed.
          </li>
        </ul>
      </section>

      <section aria-labelledby="money" className="space-y-3">
        <h2 id="money" className="text-lead font-bold">
          Fees and paying
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Partner Plus, Spotlight and Spotlight Plus are paid from your dashboard, a month or more
            at a time, on Stripe&rsquo;s secure page. Your card is given to Stripe, never to us.
            Nothing is taken from you automatically. A payment made to a person at {name}, by
            arrangement, is recorded on your dashboard the same way.
          </li>
          <li>
            Restaurants, cafés and takeaways pay no monthly fee and no commission. Your dashboard
            and your statement show your orders through {name} each month, and the discount you have
            agreed, if any.
          </li>
          <li>Services are listed free. No payment for a service goes through {name}.</li>
          <li>
            Cancelling Partner Plus: there is nothing to cancel. It runs for the months you have
            paid and ends when they run out. Then your products are hidden until you pay again, and
            no new ones can be added; your name, address and hours stay listed.
          </li>
          <li>Your statement, as a PDF, is on your dashboard whenever you want it.</li>
        </ul>
      </section>

      <section aria-labelledby="yours" className="space-y-3">
        <h2 id="yours" className="text-lead font-bold">
          What you are responsible for
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Your products, prices and opening hours are accurate, and you keep them up to date from
            your dashboard. A Runner buys at your till; the Shopper sees{' '}
            {SHOP_PRICES_WORDS.toLowerCase()}.
          </li>
          <li>What you sell is legal, safe and as you describe it.</li>
          <li>
            A service provider checks its own qualifications and registrations. We show an Ofsted
            number as you give it and do not check it.
          </li>
        </ul>
      </section>

      <section aria-labelledby="removing" className="space-y-3">
        <h2 id="removing" className="text-lead font-bold">
          Taking things off, and removing a listing
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>You can take any product off at any time from your dashboard.</li>
          <li>To close your listing, ring us and we take it off.</li>
          <li>
            We may pause or remove a listing, or refuse a product, if it breaks these terms, if
            something on it is wrong or unsafe, or if it is something we never list.
          </li>
        </ul>
      </section>

      <section aria-labelledby="data" className="space-y-3">
        <h2 id="data" className="text-lead font-bold">
          What each side shares
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>
            You give us your business&rsquo;s name, address, postcode and hours, a contact name, a
            mobile number and an email address, and your products. Shoppers see your name, what you
            say about yourself, your area, address, hours, products, prices and photos.
          </li>
          <li>
            Your mobile is for sign-in codes and for us to ring you about your listing. It is never
            shown to Shoppers. Your email is for statements and anything in writing.
          </li>
          <li>
            You see how many purchases were made from you, never who made them. A service sees the
            name of a Shopper who asks for a quote or a call back, and the contact they chose to
            give.
          </li>
          <li>
            How we look after personal information is on our{' '}
            <Link to="/privacy" className="underline">
              privacy page
            </Link>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="law" className="space-y-3">
        <h2 id="law" className="text-lead font-bold">
          Changes, and the law that applies
        </h2>
        <p className="m-0">
          If we change these terms, we tell you before the change takes effect, and ask you to agree
          to the new version on your dashboard. Your listing stays live while you read them; changes
          from your dashboard wait until you agree. These terms are under the law of England and
          Wales, and the courts of England and Wales deal with any dispute.
        </p>
        <p className="m-0">These terms were written on 30 October 2026.</p>
        <p className="m-0 extra">Version {SHOP_PARTNER_TERMS_VERSION}.</p>
      </section>

      <Link to="/business/join" className="control bg-highlight text-on-accent">
        Join as a shop
      </Link>
    </article>
  );
}
