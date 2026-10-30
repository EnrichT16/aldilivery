/**
 * Ozi Ambassadors in the browser (Anthony, 30 October 2026): who is asking (a Shopper, a Runner,
 * or a shop or organisation signed in), the honest example earnings, the education note and the
 * plain rules, shared by the /ambassador page, the application, the Ambassador dashboard and the
 * Toolkit. Every figure comes from `ambassador` in config/store.json.
 */

import {
  ambassadorOrderSharePence,
  ambassadorPlanSharePence,
  rewardWords,
  shareWords,
} from '@aldilivery/core';

import { storeConfig } from '../config';
import { businessToken, type ReferralAs } from './api';
import { money } from './money';
import { readRunnerToken, readToken } from './session';

const AS_KEY = 'ozidelivery.ambassador.as';

/**
 * Which of their accounts a person is an Ambassador as: the one the dashboard card said (`?as=`),
 * or the one chosen before on this device, or whichever is signed in, a shop or organisation
 * first, then a Runner, then a Shopper. Null when nobody is signed in.
 */
export function ambassadorAs(given?: string | null): ReferralAs | null {
  const signedIn: ReferralAs[] = [];
  if (businessToken() !== '') signedIn.push('business');
  if (readRunnerToken()) signedIn.push('runner');
  if (readToken()) signedIn.push('shopper');
  const wanted = given === 'shopper' || given === 'runner' || given === 'business' ? given : null;
  let kept: string | null = null;
  try {
    kept = window.sessionStorage.getItem(AS_KEY);
  } catch {
    kept = null;
  }
  const choice =
    (wanted && signedIn.includes(wanted) ? wanted : null) ??
    (signedIn.find((one) => one === kept) || null) ??
    signedIn[0] ??
    null;
  if (choice) {
    try {
      window.sessionStorage.setItem(AS_KEY, choice);
    } catch {
      // Not kept: worked out again next time.
    }
  }
  return choice;
}

/** The education note (Anthony, 30 October 2026): never a condition, and never blocks anything. */
export const EDUCATION_NOTE =
  'Businesses only earn when there are Runners (drivers) to deliver and Shoppers to order. Introduce Runners and Shoppers too, with your referral link, and the businesses you bring will earn more, and so will you.';

/** Said with every example, so no example is ever taken as a promise. */
export const EXAMPLES_ONLY = 'Examples only. What you earn depends on real orders.';

/** How an Ambassador earns, each line with its figure from the settings. */
export function earningLines(): string[] {
  const rates = storeConfig.ambassador;
  const symbol = storeConfig.store.currencySymbol;
  return [
    `Restaurants, cafés and takeaways: ${shareWords(rates.restaurantMarkupShare)} of the mark-up we keep, plus ${shareWords(rates.restaurantDiscountShare)} of the discount we keep, on every order.`,
    `Grocery and other shops: ${shareWords(rates.groceryItemChargeShare)} of the item charges, ${shareWords(rates.groceryMarkupShare)} of any mark-up and ${shareWords(rates.groceryDiscountShare)} of any discount we keep, on every order.`,
    `Another branch of a business you introduced, through your link: a quarter of the rate (${shareWords(rates.restaurantMarkupShare * rates.branchShareFactor)} instead of ${shareWords(rates.restaurantMarkupShare)}).`,
    `A one-off ${shareWords(rates.planShare)} of a business's first Partner Plus payment, if it chooses Partner Plus.`,
    `For ${rates.months} months from the day we approve each business.`,
    `What you earn on an order is held for ${rates.holdDays} days after delivery, in case of a refund, then it is yours to withdraw.`,
    `You can withdraw to your bank once you have at least ${rewardWords(rates.payoutMinimumPence, symbol)} available.`,
  ];
}

/**
 * Honest worked examples, from the real rates. Only arithmetic on made-up orders, always
 * labelled `EXAMPLES_ONLY`.
 */
export function exampleLines(): string[] {
  const rates = storeConfig.ambassador;
  const restaurant = ambassadorOrderSharePence(
    { kind: 'restaurant', markupPence: 300, discountPence: 400, itemChargesPence: 0 },
    rates,
  );
  const grocery = ambassadorOrderSharePence(
    { kind: 'grocery', markupPence: 0, discountPence: 0, itemChargesPence: 1000 },
    rates,
  );
  const plan = ambassadorPlanSharePence(storeConfig.extras.partners.plusMonthlyPence, rates);
  return [
    `A takeaway order of ${money(2000)} of food, where we keep a ${money(300)} mark-up and a ${money(400)} discount: you earn ${money(restaurant)}. A hundred orders like it in a month: ${money(restaurant * 100)}.`,
    `A shop order with ${money(1000)} of item charges: you earn ${money(grocery)}.`,
    `A shop that chooses Partner Plus at ${money(storeConfig.extras.partners.plusMonthlyPence)} a month: a one-off ${money(plan)} when its first payment is confirmed.`,
  ];
}

/** The rules, in plain words: what an Ambassador must never do or say. */
export const AMBASSADOR_RULES: readonly string[] = [
  'Never promise anyone an income, or say how much a business will earn.',
  'Never say we have a partnership with any supermarket. We do not.',
  'Never promise anything on our behalf, such as prices, places or approval.',
  'Never collect money from a business, for anything.',
  'Never ask anyone for their card details.',
  'Never introduce your own business.',
  'Always say who you are: an independent Ambassador, not our employee.',
];
