/**
 * The store configuration contract.
 *
 * Rule Nine: store identity, name, colours, catalogue source and legal entity are
 * configuration, never code. Everything the product knows about the supermarket it shops
 * at lives in `config/store.json` and arrives in the application through this file.
 *
 * The parser is deliberately strict, and it does more than check shapes. It also refuses
 * any configuration that contradicts an inviolable rule — a delivery fee that would not cover
 * the Runner's five pounds, a Runner payment that is not five pounds, a notice period that is not thirty minutes, an
 * age restriction switched on. A JSON edit cannot break a promise: the process will not
 * start, and the error says exactly which rule was contradicted.
 */

import {
  AGE_RESTRICTED_GOODS_ALLOWED,
  RUNNER_PAYMENT_PENCE,
  SET_NOTICE_MINUTES_BEFORE,
} from './rules.js';
import {
  FAIR_SHARE_DEFAULTS,
  SPLIT_PART_MODES,
  TRAVEL_MODES,
  type FairShareSettings,
  type MaxGoodsByMode,
  type SplitPartMaxByMode,
} from './dispatch.js';
import {
  DELIVERY_WINDOWS,
  SCHEDULED_DEFAULTS,
  type DeliveryWindow,
  type ScheduledSettings,
  type WindowTimes,
} from './scheduled.js';
import type {
  DeliveryBand,
  DeliveryPrices,
  ItemChargeRule,
  OrderAllowance,
  OrganisationPricing,
  ProcessorModel,
} from './fees.js';
import type { AreaSettings } from './areas.js';
import type { BrowseSettings } from './browse.js';
import { excludedServiceKind, type PartnerPricing } from './partners.js';
import type { AmbassadorSettings, ReferralSettings } from './referrals.js';
import {
  AMBASSADOR_PROTECTION_DEFAULTS,
  type AmbassadorProtectionSettings,
} from './ambassador-protection.js';
import type { RestaurantSettings } from './restaurants.js';

export type CatalogueSourceMode = 'partner_feed' | 'community';

export interface StoreConfig {
  readonly configVersion: number;
  readonly productName: string;
  readonly assistantName: string;
  /**
   * How a phone's speech recognition tends to write the assistant's name ("Ozzy", "Aussie"), so
   * Ozi still knows it is being spoken to (Anthony, 6 October 2026).
   */
  readonly assistantHeardAs: readonly string[];
  readonly tagline: string;
  /** The motto, said by Ozi when it introduces itself and shown on the first screen. */
  readonly motto: string;
  readonly contact: {
    readonly telephonePlaceholder: string;
    readonly telephoneIsPlaceholder: boolean;
    /** The email address Shoppers, Runners and anyone else can write to (E-Commerce Regulations). */
    readonly email: string;
    readonly emailIsPlaceholder: boolean;
    /**
     * The website address as people should type it, such as "www.ozidelivery.co.uk". Empty when
     * not set. Named wherever we warn about other apps with a similar name (Anthony, 30 October
     * 2026).
     */
    readonly website: string;
  };
  readonly store: {
    readonly displayName: string;
    readonly legalEntityName: string;
    readonly legalEntityIsPlaceholder: boolean;
    /**
     * The company that runs the service, as the law asks it to be named on the website and in
     * the legal pages (Companies Act 2006 and the trading disclosure regulations of 2015, the
     * E-Commerce Regulations 2002, and UK GDPR Article 13). Each has its own placeholder flag, so
     * a page can say "to follow" instead of showing a made-up number (docs/LEGAL_REVIEW.md).
     */
    readonly companyNumber: string;
    readonly companyNumberIsPlaceholder: boolean;
    /** Where the company is registered, such as "England and Wales". */
    readonly registeredIn: string;
    readonly registeredOffice: string;
    readonly registeredOfficeIsPlaceholder: boolean;
    /** The data protection fee registration number the Information Commissioner gives. */
    readonly icoRegistrationNumber: string;
    readonly icoRegistrationIsPlaceholder: boolean;
    /**
     * The company's D-U-N-S number from Dun and Bradstreet, which Apple and Google use to check
     * the company (docs/APP_STORES.md). Public, so it is no secret; null when there is none yet.
     */
    readonly dunsNumber: string | null;
    readonly country: string;
    readonly currency: string;
    readonly currencySymbol: string;
    readonly catalogueSource: {
      readonly mode: CatalogueSourceMode;
      readonly allowedModes: readonly CatalogueSourceMode[];
      readonly attribution: string;
    };
  };
  readonly brand: {
    readonly colours: {
      readonly navy: string;
      readonly gold: string;
      readonly white: string;
      /** Ozi's button while it is listening: a bright green, with navy words on it. */
      readonly listening: string;
    };
  };
  readonly fees: {
    readonly currency: string;
    readonly runnerPaymentPence: number;
    /**
     * Delivery by plan and by the value of the shopping, in bands (ruling 58, 9 October 2026;
     * re-banded by ruling 63, 16 October 2026, and ruling 73, 20 October 2026). Pay as you go
     * covers the Runner's five pounds in every band; a plan's price may be below it, its monthly
     * price making up the difference. With the monthly order allowance of each plan (ruling 73).
     */
    readonly delivery: DeliveryPrices & { readonly allowance: OrderAllowance };
    /** The charge on every unit, from its shop price (ruling 58). Never removed by a plan. */
    readonly itemCharge: ItemChargeRule;
    /** No single product may cost more than this in the shop (ruling 58: £60). */
    readonly maximumProductPence: number;
    /**
     * The most shopping, at shop prices, one order carries; above it, two deliveries are
     * offered. £150 until Anthony confirms the figure (ruling 58).
     */
    readonly maximumOrderGoodsPence: number;
    /**
     * Baskets over one order (ruling 61, Anthony, 10 October 2026): the most shopping, at shop
     * prices, one basket may hold when the Shopper keeps everything and it goes as linked
     * orders of up to `maximumOrderGoodsPence` each. £450 (three orders) unless set; adjustable.
     */
    readonly maximumBasketGoodsPence: number;
    /**
     * The delivery for each linked order after the first (ruling 61): £13.50 whatever the
     * Shopper's plan, taken only when that order's Runner collects it.
     */
    readonly extraRunnerDeliveryPence: number;
    /**
     * Big orders pay the Runner more (ruling 60, Anthony, 10 October 2026): an order whose shop
     * prices come to `largeOrderFromPence` (£120) or more, delivered whole, pays its Runner
     * `largeOrderRunnerPaymentPence` (£7) instead of five pounds. A part of a split job still
     * pays `dispatch.splitRunnerPayPence`.
     */
    readonly largeOrderRunnerPaymentPence: number;
    readonly largeOrderFromPence: number;
    readonly processor: ProcessorModel;
    readonly coolBag: {
      readonly depositPence: number;
      /** Taken from each early payout until the deposit is collected. Never all at once:
       *  a Runner must not work a shift for nothing. */
      readonly withholdPerOrderPence: number;
      readonly releaseAfterCompletedDeliveries: number;
    };
  };
  readonly payments: {
    readonly provider: string;
    readonly supportedCardRegions: readonly string[];
  };
  readonly allocation: {
    readonly offerHoldSeconds: number;
    readonly poolingRadiusMiles: number;
    /**
     * A job the office sends straight to a chosen Runner (ruling 80) is held for them alone this
     * many minutes, longer than a queue offer, before it goes back to the queue (or a backup).
     */
    readonly allocatedHoldMinutes: number;
  };
  readonly recurringOrders: {
    readonly noticeMinutesBefore: number;
    readonly skipWord: string;
  };
  readonly accountDeletion: {
    readonly recycleBinDays: number;
  };
  readonly accessibility: {
    readonly targetStandard: string;
    readonly baseFontSizePx: number;
    readonly minimumControlHeightPx: number;
  };
  /** Ordering by voice (docs/BUILD_PROMPT.md, Sections D and E). */
  readonly voice: {
    /**
     * The most a payment confirmed by voice alone may be, in pence. Above it, a touch
     * confirmation is needed: a voice can be copied, so what a copied voice could spend is
     * bounded. Eighty pounds by default, and a setting.
     */
    readonly paymentCeilingPence: number;
  };
  /** Paid extras (6 and 7 October 2026). Every price is agreed before it is taken. */
  readonly extras: {
    /** Ozi Recipes: full recipes, read out and added to the basket in one go. */
    readonly recipePassPence: number;
    readonly recipePassDays: number;
    /**
     * The monthly plans (ruling 58, 9 October 2026), each taken monthly by card only once the
     * Shopper has chosen to join, cancelled with one button or by saying so: Ozi Membership,
     * Ozi Plus, and Ozi Family and Carer.
     */
    readonly membershipPence: number;
    readonly plusPence: number;
    readonly familyPence: number;
    /** Everybody on a Family and Carer plan, the person who pays included. */
    readonly familyMaximum: number;
    /** Every new Shopper's membership is free for their first month (with pay-as-you-go delivery). */
    readonly freeFirstMonth: boolean;
    /** The reminder that the free month is ending goes this many days before. */
    readonly freeMonthReminderDaysBefore: number;
    /** Free Ozi Finds It searches a month on Membership and in the free month. */
    readonly freeFindItsPerMonth: number;
    /** Free Ozi Finds It searches a month on Ozi Plus and Ozi Family and Carer (ruling 73: two). */
    readonly plusFreeFindItsPerMonth: number;
    /** Ozi Plus: a friendly check-in after this many days without an order. */
    readonly checkInAfterDays: number;
    /** What organisations pay for the people they look after (ruling 58). */
    readonly organisations: OrganisationPricing;
    /** Ozi Finds It: a person looks in up to this many shops, for this fee. */
    readonly findItPence: number;
    readonly findItShops: number;
    /** The gift card amounts on offer. */
    readonly giftCardPence: readonly number[];
    /**
     * Shops, cafés, takeaways and services joining as partners (ruling 65): the free listings,
     * Partner Plus, and the kinds of service never listed. A café or takeaway pays no commission
     * (Anthony, 30 October 2026): see `restaurants`.
     */
    readonly partners: PartnerPricing;
    /**
     * Ozi mentions, extras on top of the partner plan, a month at a time: Spotlight and
     * Spotlight Plus, and how many times a week each may be mentioned to the same Shopper.
     */
    readonly spotlightPence: number;
    readonly spotlightPlusPence: number;
    readonly spotlightPerWeek: number;
    readonly spotlightPlusPerWeek: number;
  };
  /** In-app calls (docs/BUILD_PROMPT.md, Sections B and F; rulings of 2 October 2026). */
  readonly calls: {
    /** What each person's minute costs, paid by the Shopper. 5p. A Runner never pays. */
    readonly pencePerMinute: number;
    /** Above this unpaid call balance, nobody more can be added to a call until it is paid. */
    readonly maxOutstandingPence: number;
  };
  /** Problems and refunds (rulings of 2 October 2026). */
  readonly problems: {
    /** A refund asked for at or below this is given straight away, with no investigation. */
    readonly instantRefundUpToPence: number;
    /** Working days a person has to decide a reported problem. */
    readonly decideWithinWorkingDays: number;
    /** The part of each job's pay taken towards a refund a Runner was found at fault for. */
    readonly recoveryPercentOfPay: number;
    /** Owed by a Runner who leaves: written off at or below this, asked for above it. */
    readonly writeOffUpToPence: number;
  };
  /** Runners' safety, pay timing and reminders (Section M; rulings 14, 16). */
  readonly runners: {
    /** How long the private live-location link sent with an SOS keeps working, at most. */
    readonly sosLinkHours: number;
    /**
     * Stripe's fee for an instant payout, shown to the Runner before they choose it, who pays it
     * (ruling 16): a share in basis points (100 is 1%), and never less than the minimum.
     */
    readonly instantPayoutFeeBasisPoints: number;
    readonly instantPayoutFeeMinimumPence: number;
    /** Days before motor insurance runs out that a Runner who drives is reminded (ruling 14). */
    readonly insuranceReminderDays: readonly number[];
  };
  /**
   * Referral reward levels for everybody (Anthony, 30 October 2026), which replaced the Runner
   * reward of £150 at 100 referrals: so many active referrals, with at least
   * `minimumActiveShare` of everyone who joined active.
   */
  readonly referrals: ReferralSettings;
  /** Ozi Ambassadors, who introduce businesses (Anthony, 30 October 2026). */
  readonly ambassador: AmbassadorSettings;
  /**
   * Protections against Ambassadors misusing the name (Anthony, 31 October 2026): the payment
   * warning's words and the paid extras it names, the business's confirmation code, the "Were you
   * promised anything" question, the public check page's limits and words, and the staff links to
   * check a business (packages/core/src/ambassador-protection.ts).
   */
  readonly ambassadorProtection: AmbassadorProtectionSettings;
  /**
   * Restaurant, café and takeaway pricing (Anthony, 30 October 2026): the flat restaurant fee in
   * place of delivery, the smallest restaurant order, and the agreed discount that makes a
   * restaurant an Ozi Preferred Partner. Ozi's share of the fee is the fee less the Runner's pay.
   */
  readonly restaurants: RestaurantSettings;
  /**
   * Checkout insights (Anthony, 30 October 2026): why people do not pay. The bands totals are
   * counted in (under £20, £20 to £40, £40 to £60, over £60), the periods staff may choose, how
   * close together two views of the checkout count as one, how soon after one a payment counts as
   * paying it, and how often "Can we ask what stopped you?" may be asked of one Shopper.
   */
  readonly checkoutInsights: CheckoutInsightSettings;
  readonly versionOneRestrictions: {
    readonly ageRestrictedGoodsAllowed: boolean;
  };
  /**
   * Feedback after a delivery (docs/BUILD_PROMPT.md, Section O). Any feedback at all, good or
   * bad, earns this much delivery credit, once per order. £1 by default: enough to say thank
   * you, small next to the £13.50 delivery, and never conditional on what was said.
   */
  readonly feedback: {
    readonly creditPence: number;
    /**
     * Shop reviews and review points (ruling 70, 16 and 17 October 2026). Every honest review of
     * a Shop Partner earns the same points, one star or five; the points wait `pendingDays` and
     * are lost if the order is refunded; from `spendFromPoints` they become delivery credit at
     * `pencePerPoint`. One rewarded review per shop per month per Shopper.
     */
    readonly reviews: {
      readonly pointsPerReview: number;
      readonly pencePerPoint: number;
      readonly spendFromPoints: number;
      readonly pendingDays: number;
      /** How long after a delivery the Shopper is asked to rate the shop. */
      readonly askWithinDays: number;
      /** Shop of the Month: the fewest reviews in a period, and the weight of the prior. */
      readonly shopOfTheMonthMinimumReviews: number;
      readonly shopOfTheMonthPriorWeight: number;
    };
  };
  /**
   * The photo of the till receipt (STILL_TO_DO item 2). Optional for the Runner, but without
   * one, paying them back more than this waits for a person to look. £30 by default: half of
   * what one delivery carries.
   */
  readonly receipts: {
    readonly photoNeededAbovePence: number;
    /**
     * The till may come to this much over the shopping estimate, or a fifth of the estimate if
     * that is more, and still be taken from the Shopper's card and paid back to the Runner
     * without a person looking first (services/till.ts). £5 by default (Anthony, 30 October 2026).
     */
    readonly tillExtraFloorPence: number;
  };
  /**
   * Who may be offered which job (ruling 59, as changed by ruling 60). Each way of travelling
   * carries up to its own most of shopping at shop prices (`maxGoodsPenceByMode`): on foot and by
   * bicycle £60, by motorbike £70, by car and by van up to the whole-order cap. A motorbike, car
   * or van also needs a licence and in-date insurance accepted. If no Runner who can carry an
   * order takes it, after `splitAfterMinutes` (10, ruling 61) it is split into parts for the
   * fewest Runners possible, motorbike riders first (each part up to
   * `splitPartMaxPenceByMode.motorbike`, £75), then Runners on foot or bicycle (each up to
   * `splitPartMaxPenceByMode.foot`, £60), each paying its Runner `splitRunnerPayPence` (£5,
   * Anthony's figure). The owner is texted when it is split, and once after `waitingAlertMinutes`
   * (15) if a large order or a part is still waiting.
   *
   * The fair queue sharpened (ruling 64, 16 October 2026): the lowest earner today goes first,
   * then the longest wait; nobody jumps the fair order while more than `fairShareMaxLeadPence`
   * (£15) ahead of the lowest earner on shift; a Runner on the final leg may be offered a job
   * whose pickup is within `chainRadiusMiles` (1.5) of their drop-off, held `chainMinutesBeforeDone`
   * (2) minutes; Runners within `nearBandMiles` (1.5) of the pickup are asked first, widening after
   * `bandSeconds` (60).
   */
  readonly dispatch: FairShareSettings & {
    readonly maxGoodsPenceByMode: MaxGoodsByMode;
    readonly waitingAlertMinutes: number;
    readonly splitAfterMinutes: number;
    readonly splitPartMaxPenceByMode: SplitPartMaxByMode;
    /**
     * A linked order after the first with less shopping than this (ruling 61: £5) is a tiny
     * extra: the owner is texted and it is shown in the admin panel, so a person can ask the
     * first Runner to carry it instead.
     */
    readonly tinyExtraBelowPence: number;
    readonly splitRunnerPayPence: number;
    /**
     * A paid order no Runner has accepted this many minutes after it was paid (or after its
     * window starts, for a booked order) is cancelled with a full refund (Anthony, 30 October
     * 2026): 120.
     */
    readonly autoRefundAfterMinutes: number;
  };
  /**
   * The owner (ruling 74): how Ozi speaks to him on the telephone, "Mr. Anthony", always.
   */
  readonly owner: {
    readonly spokenName: string;
  };
  /**
   * Ozi's desk (ruling 74, 22 October 2026): Ozi rings the owner about anything that needs him.
   * Up to `callsInARow` calls `minutesBetweenCalls` apart; unanswered, it waits
   * `hoursBetweenCascades` and starts again, until he answers and every matter is decided or put
   * to later. No calls between `quietFrom` and `quietUntil` (UK time) unless urgent, when
   * `urgentInQuietHours` is true. Matters put to later come back `laterAfterMinutes` later
   * (an hour: Anthony, 22 October 2026), or when quiet hours end. Feedback of `lowRatingAtMost` stars or fewer goes to him; the
   * automatic check approves only at `checkConfidence` or above.
   */
  readonly ownerDesk: OwnerDeskSettings;
  /**
   * The company inbox and staff calls (ruling 77): how long a message code lasts, and how long a
   * staff call's recording is kept before the retention sweep deletes it.
   */
  readonly companyContact: CompanyContactSettings;
  /**
   * Ordering now for a later day (ruling 78): up to `maxDaysAhead` days ahead, offered to
   * Runners `offerLeadMinutes` before the window starts, a chosen-day payment tried again every
   * `retryEveryMinutes` up to `maxChargeTries` tries, and the reminders' times.
   */
  readonly scheduled: ScheduledSettings;
  /**
   * Browsing places by kind (ruling 82): the cuisines a restaurant, café or takeaway chooses
   * from, the specialities of a shop, the categories of a service (never an excluded kind), the
   * categories whose providers must give an Ofsted registration number, and where a business
   * joins, as printed for people.
   */
  readonly browse: BrowseSettings;
  /**
   * Areas (Anthony, 30 October 2026): what each UK postcode area is called, the areas run as one
   * (London), the gentle warning given as a Shopper orders where there is no Runner yet, the text
   * they get when a Runner joins and the hours it is never sent, the staff status words, and how
   * a Runner's position is shared and trusted.
   */
  readonly areas: AreaSettings;
  /** The admin panel (Section Q): who may do what, and how signing in is kept safe. */
  readonly admin: {
    /** A refund above this is the owner's alone to give (Section Q). £25 unless set. */
    readonly ownerOnlyRefundAbovePence: number;
    /**
     * Two-step codes are asked of every staff sign-in (Section Q). Each person has this many
     * days to set them up, counted from the later of `staffTwoStepFrom` and the day their
     * account was made; after that they can do nothing else until they have.
     */
    readonly staffTwoStepGraceDays: number;
    /** The day the grace period starts for accounts that already exist, as YYYY-MM-DD. */
    readonly staffTwoStepFrom: string;
  };
}

/** Ozi's desk (ruling 74): when and how often Ozi rings the owner. Times are "HH:MM", UK time. */
export interface OwnerDeskSettings {
  readonly callsInARow: number;
  readonly minutesBetweenCalls: number;
  readonly hoursBetweenCascades: number;
  readonly quietFrom: string;
  readonly quietUntil: string;
  readonly urgentInQuietHours: boolean;
  readonly laterAfterMinutes: number;
  readonly lowRatingAtMost: number;
  readonly checkConfidence: number;
  /**
   * Ozi rings the owner in the app first (ruling 79): this many seconds unanswered, and the same
   * attempt falls back to the telephone.
   */
  readonly appRingSeconds: number;
}

/** The company inbox and staff calls (ruling 77). */
export interface CompanyContactSettings {
  /** A message code is good for this many minutes, once, for the staff member it was made for. */
  readonly messageCodeMinutes: number;
  /** A staff call's recording is kept this many days, then deleted. */
  readonly callRecordingDays: number;
}

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(`config/store.json is not usable: ${message}`);
    this.name = 'StoreConfigError';
  }
}

type Unknown = Record<string, unknown>;

function object(value: unknown, path: string): Unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreConfigError(`${path} must be an object.`);
  }
  return value as Unknown;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StoreConfigError(`${path} must be a non-empty string.`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new StoreConfigError(`${path} must be true or false.`);
  }
  return value;
}

function emailAddress(value: unknown, path: string): string {
  const address = str(value, path).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new StoreConfigError(`${path} must be an email address, received "${address}".`);
  }
  return address;
}

/** The gift card amounts on offer, each at least a pound. */
function giftCardAmounts(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StoreConfigError('extras.giftCardPence must be a list of amounts in pence.');
  }
  return value.map((entry, index) => wholeNumber(entry, `extras.giftCardPence[${index}]`, 100));
}

function wholeNumber(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new StoreConfigError(`${path} must be a whole number of at least ${minimum}.`);
  }
  return value;
}

/**
 * The most each way of travelling carries (ruling 60). By default: on foot and by bicycle £60,
 * motorbike £70, car and van the whole-order cap. Walking and cycling must carry at least the
 * dearest single product, or a split part could never hold it.
 */
function parseMaxGoodsByMode(
  value: unknown,
  maximumProductPence: number,
  maximumOrderGoodsPence: number,
): MaxGoodsByMode {
  const defaults: Record<string, number> = {
    foot: 6000,
    bicycle: 6000,
    motorbike: 7000,
    car: maximumOrderGoodsPence,
    van: maximumOrderGoodsPence,
  };
  const given = value === undefined ? {} : object(value, 'dispatch.maxGoodsPenceByMode');
  for (const key of Object.keys(given)) {
    if (!(TRAVEL_MODES as readonly string[]).includes(key)) {
      throw new StoreConfigError(
        `dispatch.maxGoodsPenceByMode.${key} is not a way of travelling: use ${TRAVEL_MODES.join(', ')}.`,
      );
    }
  }
  const limits = Object.fromEntries(
    TRAVEL_MODES.map((mode) => [
      mode,
      wholeNumber(given[mode] ?? defaults[mode], `dispatch.maxGoodsPenceByMode.${mode}`, 0),
    ]),
  ) as Record<(typeof TRAVEL_MODES)[number], number>;
  if (Math.min(limits.foot, limits.bicycle) < maximumProductPence) {
    throw new StoreConfigError(
      `dispatch.maxGoodsPenceByMode.foot and .bicycle must each be at least fees.maximumProductPence (${maximumProductPence}p), so a split part can always hold the dearest product.`,
    );
  }
  return limits;
}

/**
 * The most of shopping each kind of split part carries (ruling 61): motorbike £75 and foot or
 * bicycle £60 unless set. Each must hold the dearest product, since products are never split.
 */
function parseSplitPartMax(value: unknown, maximumProductPence: number): SplitPartMaxByMode {
  const defaults: Record<string, number> = { motorbike: 7500, foot: 6000 };
  const given = value === undefined ? {} : object(value, 'dispatch.splitPartMaxPenceByMode');
  for (const key of Object.keys(given)) {
    if (!(SPLIT_PART_MODES as readonly string[]).includes(key)) {
      throw new StoreConfigError(
        `dispatch.splitPartMaxPenceByMode.${key} is not a kind of split part: use ${SPLIT_PART_MODES.join(', ')} (foot covers bicycle too).`,
      );
    }
  }
  const limits = Object.fromEntries(
    SPLIT_PART_MODES.map((mode) => [
      mode,
      wholeNumber(given[mode] ?? defaults[mode], `dispatch.splitPartMaxPenceByMode.${mode}`, 1),
    ]),
  ) as Record<(typeof SPLIT_PART_MODES)[number], number>;
  if (Math.min(limits.motorbike, limits.foot) < maximumProductPence) {
    throw new StoreConfigError(
      `dispatch.splitPartMaxPenceByMode.motorbike and .foot must each be at least fees.maximumProductPence (${maximumProductPence}p), so a split part can always hold the dearest product.`,
    );
  }
  return limits;
}

function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new StoreConfigError(`${path} must be a number greater than zero.`);
  }
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StoreConfigError(`${path} must be a non-empty array.`);
  }
  return value;
}

/**
 * Delivery by plan and by the value of the shopping (ruling 63, 16 October 2026):
 * `fees.delivery.bands`, each band saying what pay as you go, Membership and Plus (with Family
 * and Carer) pay for shopping up to its `upToPence`, the last band with `upToPence` null for
 * everything above the one before it. The bands must rise, so each goods total falls in exactly
 * one; and within each plan a dearer band may not be cheaper than the one below it, so a
 * smaller shop is never dearer to deliver (Rule Four).
 *
 * Rule Two: pay as you go, which has no monthly plan behind it, must cover the Runner's five
 * pounds in every band. A plan's delivery price may be below it (Plus pays £3.99 up to £60);
 * the Runner still gets five pounds, the difference coming from the plan's monthly price and
 * the item charges.
 */
function parseDeliveryBands(value: unknown): DeliveryBand[] {
  const path = 'fees.delivery.bands';
  const bands = array(value, path).map((raw, index): DeliveryBand => {
    const band = object(raw, `${path}[${index}]`);
    const upTo = band['upToPence'];
    return {
      upToPence: upTo === null ? null : wholeNumber(upTo, `${path}[${index}].upToPence`, 1),
      payAsYouGoPence: wholeNumber(band['payAsYouGoPence'], `${path}[${index}].payAsYouGoPence`, 1),
      membershipPence: wholeNumber(band['membershipPence'], `${path}[${index}].membershipPence`, 1),
      plusPence: wholeNumber(band['plusPence'], `${path}[${index}].plusPence`, 1),
    };
  });
  bands.forEach((band, index) => {
    const last = index === bands.length - 1;
    if (last && band.upToPence !== null) {
      throw new StoreConfigError(
        `${path}: the last band must have upToPence null, so every goods total is covered.`,
      );
    }
    if (!last && band.upToPence === null) {
      throw new StoreConfigError(`${path}[${index}].upToPence may only be null on the last band.`);
    }
    const previous = bands[index - 1];
    if (
      previous &&
      band.upToPence !== null &&
      previous.upToPence !== null &&
      band.upToPence <= previous.upToPence
    ) {
      throw new StoreConfigError(
        `${path}[${index}].upToPence must be above the band before it (${previous.upToPence}p).`,
      );
    }
    if (band.payAsYouGoPence <= RUNNER_PAYMENT_PENCE) {
      throw new StoreConfigError(
        `${path}[${index}].payAsYouGoPence is ${band.payAsYouGoPence}p, which does not cover the Runner's ${RUNNER_PAYMENT_PENCE}p. Rule Two: the Runner's five pounds is untouched.`,
      );
    }
    for (const key of ['payAsYouGoPence', 'membershipPence', 'plusPence'] as const) {
      if (previous && band[key] < previous[key]) {
        throw new StoreConfigError(
          `${path}[${index}].${key} is ${band[key]}p, cheaper than the smaller band's ${previous[key]}p. Rule Four: a smaller shop is never dearer to deliver.`,
        );
      }
    }
  });
  return bands;
}

/**
 * The monthly order allowance (ruling 73, 20 October 2026): `fees.delivery.allowance`, how many
 * orders a calendar month Membership, Plus and (for each person) Family and Carer include, and
 * the extra delivery charge on the order after it and every `extraEvery`-th order after that.
 * Every plan includes at least one order, and the extra comes at most on every order past it.
 */
function parseOrderAllowance(value: unknown): OrderAllowance {
  const path = 'fees.delivery.allowance';
  const raw = object(value, path);
  return {
    membershipOrders: wholeNumber(raw['membershipOrders'], `${path}.membershipOrders`, 1),
    plusOrders: wholeNumber(raw['plusOrders'], `${path}.plusOrders`, 1),
    familyOrdersEach: wholeNumber(raw['familyOrdersEach'], `${path}.familyOrdersEach`, 1),
    extraChargePence: wholeNumber(raw['extraChargePence'], `${path}.extraChargePence`, 0),
    extraEvery: wholeNumber(raw['extraEvery'], `${path}.extraEvery`, 1),
  };
}

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

function hexColour(value: unknown, path: string): string {
  const colour = str(value, path);
  if (!HEX_COLOUR.test(colour)) {
    throw new StoreConfigError(
      `${path} must be a six digit hex colour such as #0B1F3A, received "${colour}".`,
    );
  }
  return colour.toUpperCase();
}

function equals(actual: number, expected: number, path: string, rule: string): number {
  if (actual !== expected) {
    throw new StoreConfigError(
      `${path} is ${actual} but ${rule} requires ${expected}. ` +
        `This value is a rule, not a setting; change the rule in RULES.md and in packages/core/src/rules.ts, or leave it alone.`,
    );
  }
  return actual;
}

function parseCatalogueMode(
  value: unknown,
  path: string,
  allowed: readonly string[],
): CatalogueSourceMode {
  const mode = str(value, path);
  if (!allowed.includes(mode)) {
    throw new StoreConfigError(`${path} must be one of ${allowed.join(', ')}, received "${mode}".`);
  }
  return mode as CatalogueSourceMode;
}

/**
 * Validate a raw parsed JSON value and return a typed, trusted `StoreConfig`.
 *
 * Throws `StoreConfigError` with a plain sentence saying what is wrong. Nothing in the
 * application reads store configuration by any other route.
 */
function organisationPricing(raw: Unknown): OrganisationPricing {
  return {
    clientMonthlyPence: wholeNumber(
      raw['clientMonthlyPence'] ?? 1000,
      'extras.organisations.clientMonthlyPence',
      0,
    ),
    discountEveryNthClient: wholeNumber(
      raw['discountEveryNthClient'] ?? 51,
      'extras.organisations.discountEveryNthClient',
      1,
    ),
    discountedClientMonthlyPence: wholeNumber(
      raw['discountedClientMonthlyPence'] ?? 500,
      'extras.organisations.discountedClientMonthlyPence',
      0,
    ),
  };
}

/** The kinds of service that are never listed, each as plain words. */
const DEFAULT_EXCLUDED_SERVICE_KINDS = [
  'credit',
  'loans',
  'mortgages',
  'insurance',
  'financial advice',
  'property sales',
  'lettings',
  'medicines',
];

function partnerPricing(raw: Unknown): PartnerPricing {
  const excluded = raw['excludedServiceKinds'] ?? DEFAULT_EXCLUDED_SERVICE_KINDS;
  if (!Array.isArray(excluded) || excluded.some((kind) => typeof kind !== 'string')) {
    throw new StoreConfigError('extras.partners.excludedServiceKinds must be a list of words.');
  }
  return {
    freeListingCount: wholeNumber(
      raw['freeListingCount'] ?? 100,
      'extras.partners.freeListingCount',
      0,
    ),
    freeProductLimit: wholeNumber(
      raw['freeProductLimit'] ?? 10,
      'extras.partners.freeProductLimit',
      1,
    ),
    plusMonthlyPence: wholeNumber(
      raw['plusMonthlyPence'] ?? 1499,
      'extras.partners.plusMonthlyPence',
      1,
    ),
    plusFirstMonthFree: bool(
      raw['plusFirstMonthFree'] ?? true,
      'extras.partners.plusFirstMonthFree',
    ),
    excludedServiceKinds: (excluded as string[]).map((kind) => kind.trim()).filter(Boolean),
  };
}

/** A list of distinct, non-empty words, such as the cuisines in `browse.cuisines`. */
function wordList(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  const list = array(value, path).map((entry, index) => str(entry, `${path}[${index}]`).trim());
  const seen = new Set<string>();
  for (const entry of list) {
    if (entry === '') throw new StoreConfigError(`${path} has an empty entry.`);
    const key = entry.toLowerCase();
    if (seen.has(key)) throw new StoreConfigError(`${path} has "${entry}" twice.`);
    seen.add(key);
  }
  return list;
}

function parseBrowse(raw: Unknown, excluded: readonly string[]): BrowseSettings {
  const serviceCategories = wordList(raw['serviceCategories'], 'browse.serviceCategories');
  for (const category of serviceCategories) {
    const refused = excludedServiceKind(category, excluded);
    if (refused) {
      throw new StoreConfigError(
        `browse.serviceCategories has "${category}", but ${refused} is never listed (extras.partners.excludedServiceKinds).`,
      );
    }
  }
  const ofstedCategories = wordList(raw['ofstedCategories'], 'browse.ofstedCategories');
  for (const category of ofstedCategories) {
    if (!serviceCategories.some((entry) => entry.toLowerCase() === category.toLowerCase())) {
      throw new StoreConfigError(
        `browse.ofstedCategories has "${category}", which is not in browse.serviceCategories.`,
      );
    }
  }
  return {
    cuisines: wordList(raw['cuisines'], 'browse.cuisines'),
    shopOrigins: wordList(raw['shopOrigins'], 'browse.shopOrigins'),
    serviceCategories,
    ofstedCategories,
    joinAddress: str(raw['joinAddress'] ?? '/business/join', 'browse.joinAddress'),
  };
}

/**
 * Referral levels (Anthony, 30 October 2026): 20, 30 and 40 active referrals for a £10, £15 and
 * £20 voucher unless set, smallest first, with at least 70% of everyone who joined active.
 */
function parseReferrals(raw: Unknown): ReferralSettings {
  const given = raw['levels'] ?? [
    { activeReferrals: 20, rewardPence: 1000, label: '£10 voucher' },
    { activeReferrals: 30, rewardPence: 1500, label: '£15 voucher' },
    { activeReferrals: 40, rewardPence: 2000, label: '£20 voucher' },
  ];
  if (!Array.isArray(given) || given.length === 0) {
    throw new StoreConfigError('referrals.levels must be a list of levels.');
  }
  const levels = given
    .map((entry: unknown, index: number) => {
      const level = object(entry, `referrals.levels[${index}]`);
      return {
        activeReferrals: wholeNumber(
          level['activeReferrals'],
          `referrals.levels[${index}].activeReferrals`,
          1,
        ),
        rewardPence: wholeNumber(level['rewardPence'], `referrals.levels[${index}].rewardPence`, 1),
        label: str(level['label'], `referrals.levels[${index}].label`).trim(),
      };
    })
    .sort((a, b) => a.activeReferrals - b.activeReferrals);
  if (new Set(levels.map((level) => level.activeReferrals)).size !== levels.length) {
    throw new StoreConfigError('referrals.levels has two levels at the same number of referrals.');
  }
  const share = raw['minimumActiveShare'] ?? 0.7;
  if (typeof share !== 'number' || !(share > 0) || share > 1) {
    throw new StoreConfigError('referrals.minimumActiveShare must be a share above 0, up to 1.');
  }
  return {
    levels,
    minimumActiveShare: share,
    givenAs: str(raw['givenAs'] ?? 'Amazon voucher', 'referrals.givenAs').trim(),
    voucherLastsYears: wholeNumber(
      raw['voucherLastsYears'] ?? 10,
      'referrals.voucherLastsYears',
      1,
    ),
    voucherReminderDays: voucherReminderDays(raw['voucherReminderDays'] ?? [0, 7, 14]),
    voucherRingSeconds: wholeNumber(
      raw['voucherRingSeconds'] ?? 90,
      'referrals.voucherRingSeconds',
      10,
    ),
  };
}

/** The days after a voucher is sent that Ozi rings about it, rising, at most three. */
function voucherReminderDays(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 3 ||
    value.some(
      (day, index) => !Number.isInteger(day) || day < 0 || (index > 0 && day <= value[index - 1]),
    )
  ) {
    throw new StoreConfigError(
      'referrals.voucherReminderDays must be up to three whole days, rising, such as [0, 7, 14].',
    );
  }
  return value as number[];
}

/** A share from 0 to 1, such as 0.02 for 2%. */
function share(value: unknown, path: string): number {
  if (typeof value !== 'number' || !(value >= 0) || value > 1) {
    throw new StoreConfigError(`${path} must be a share from 0 to 1, such as 0.02 for 2%.`);
  }
  return value;
}

/**
 * Ozi Ambassadors (Anthony, 30 October 2026, ruled again the same day, and finally: on a
 * restaurant's orders 2% of the mark-up and 2% of the discount Ozi keeps; on a grocery shop
 * partner's 1% of the item charges, the mark-up and the discount) for 12 months from approval, a quarter of that on another branch through the same link,
 * a one-off 5% of the first Partner Plus payment, held for 30 days after delivery before it can
 * be paid, paid once £10 is available, and a month over £500 checked by the owner first.
 */
function parseAmbassador(raw: Unknown): AmbassadorSettings {
  // Replaced by the shares below (Anthony's final ruling, 30 October 2026).
  if (raw['profitShare'] !== undefined) {
    throw new StoreConfigError(
      'ambassador.profitShare is replaced by ambassador.restaurantMarkupShare, restaurantDiscountShare, groceryItemChargeShare, groceryMarkupShare and groceryDiscountShare.',
    );
  }
  return {
    restaurantMarkupShare: share(
      raw['restaurantMarkupShare'] ?? 0.02,
      'ambassador.restaurantMarkupShare',
    ),
    restaurantDiscountShare: share(
      raw['restaurantDiscountShare'] ?? 0.02,
      'ambassador.restaurantDiscountShare',
    ),
    groceryItemChargeShare: share(
      raw['groceryItemChargeShare'] ?? 0.01,
      'ambassador.groceryItemChargeShare',
    ),
    groceryMarkupShare: share(raw['groceryMarkupShare'] ?? 0.01, 'ambassador.groceryMarkupShare'),
    groceryDiscountShare: share(
      raw['groceryDiscountShare'] ?? 0.01,
      'ambassador.groceryDiscountShare',
    ),
    months: wholeNumber(raw['months'] ?? 12, 'ambassador.months', 1),
    planShare: share(raw['planShare'] ?? 0.05, 'ambassador.planShare'),
    branchShareFactor: share(raw['branchShareFactor'] ?? 0.25, 'ambassador.branchShareFactor'),
    holdDays: wholeNumber(raw['holdDays'] ?? 30, 'ambassador.holdDays', 0),
    payoutMinimumPence: wholeNumber(
      raw['payoutMinimumPence'] ?? 1000,
      'ambassador.payoutMinimumPence',
      0,
    ),
    reviewAbovePence: wholeNumber(
      raw['reviewAbovePence'] ?? 50000,
      'ambassador.reviewAbovePence',
      0,
    ),
    // Applying to be an Ambassador (Anthony, 30 October 2026).
    addressWithinMonths: wholeNumber(
      raw['addressWithinMonths'] ?? 3,
      'ambassador.addressWithinMonths',
      1,
    ),
    documentsKeptMonths: wholeNumber(
      raw['documentsKeptMonths'] ?? 12,
      'ambassador.documentsKeptMonths',
      1,
    ),
    // Declined, suspended and removed Ambassadors (Anthony, 31 October 2026).
    reapplyAfterMonths: wholeNumber(
      raw['reapplyAfterMonths'] ?? 6,
      'ambassador.reapplyAfterMonths',
      0,
    ),
    declinedDocumentsDeleteAfterDays: wholeNumber(
      raw['declinedDocumentsDeleteAfterDays'] ?? 30,
      'ambassador.declinedDocumentsDeleteAfterDays',
      0,
    ),
    declinedNoteKeptMonths: wholeNumber(
      raw['declinedNoteKeptMonths'] ?? 12,
      'ambassador.declinedNoteKeptMonths',
      1,
    ),
  };
}

/** A link template for staff: an https address. */
function httpsTemplate(value: unknown, path: string): string {
  const text = str(value, path).trim();
  if (!/^https:\/\/[^\s]+$/.test(text)) {
    throw new StoreConfigError(`${path} must be an https address.`);
  }
  return text;
}

/**
 * Protections against Ambassadors misusing the name (Anthony, 31 October 2026). The payment
 * warning must keep its two promises, whatever words are chosen: that joining is free, and never
 * to pay an Ambassador.
 */
function parseAmbassadorProtection(raw: Unknown): AmbassadorProtectionSettings {
  const d = AMBASSADOR_PROTECTION_DEFAULTS;
  const words = str(raw['freeJoiningWords'] ?? d.freeJoiningWords, 'ambassadorProtection.freeJoiningWords');
  if (!/free/i.test(words) || !/never pay an ambassador/i.test(words)) {
    throw new StoreConfigError(
      'ambassadorProtection.freeJoiningWords must say that joining is free and "Never pay an Ambassador".',
    );
  }
  const paidExtras =
    raw['paidExtras'] === undefined
      ? [...d.paidExtras]
      : wordList(raw['paidExtras'], 'ambassadorProtection.paidExtras');
  if (paidExtras.length === 0) {
    throw new StoreConfigError('ambassadorProtection.paidExtras must name the paid extras.');
  }
  const text = (key: keyof AmbassadorProtectionSettings): string =>
    str(raw[key] ?? d[key], `ambassadorProtection.${key}`);
  const whole = (key: keyof AmbassadorProtectionSettings, minimum: number): number =>
    wholeNumber(raw[key] ?? d[key], `ambassadorProtection.${key}`, minimum);
  return {
    freeJoiningWords: words,
    paidExtras,
    confirmCodeMinutes: whole('confirmCodeMinutes', 5),
    confirmCodeTries: whole('confirmCodeTries', 1),
    promisedAskAfterDays: whole('promisedAskAfterDays', 1),
    promisedQuestion: text('promisedQuestion'),
    checksPerTenMinutes: whole('checksPerTenMinutes', 1),
    reportsPerTenMinutes: whole('reportsPerTenMinutes', 1),
    notActiveWords: text('notActiveWords'),
    unknownCodeWords: text('unknownCodeWords'),
    companiesHouseSearch: httpsTemplate(
      raw['companiesHouseSearch'] ?? d.companiesHouseSearch,
      'ambassadorProtection.companiesHouseSearch',
    ),
    hygieneRatingSearch: httpsTemplate(
      raw['hygieneRatingSearch'] ?? d.hygieneRatingSearch,
      'ambassadorProtection.hygieneRatingSearch',
    ),
  };
}

/**
 * Restaurant pricing (Anthony, 30 October 2026): £10 the smallest order, 20% the discount that
 * makes a Preferred Partner. Changed 30 October 2026 (Anthony, big restaurant orders): Ozi's share
 * of the restaurant fee (`ozisSharePence`, £7) is the one figure configured, and the fee is the
 * Runner's pay plus it: £12 with the standard five pounds, £14 with the large-order £7. So the fee
 * always covers the Runner's pay (Rule Two), and is refused if set on its own.
 */
function parseRestaurants(
  raw: Unknown,
  runnerPay: {
    readonly standardPence: number;
    readonly largeOrderPence: number;
    readonly largeOrderFromPence: number;
  },
): RestaurantSettings {
  const ozisSharePence = wholeNumber(raw['ozisSharePence'] ?? 700, 'restaurants.ozisSharePence', 0);
  const feePence = runnerPay.standardPence + ozisSharePence;
  const largeOrderFeePence = runnerPay.largeOrderPence + ozisSharePence;
  // A parsed configuration read back in carries the worked-out fees; anything else is refused,
  // so the fee can never drift from the Runner's pay plus Ozi's share.
  for (const [key, worked] of [
    ['feePence', feePence],
    ['largeOrderFeePence', largeOrderFeePence],
    ['largeOrderFromPence', runnerPay.largeOrderFromPence],
  ] as const) {
    if (raw[key] !== undefined && raw[key] !== worked) {
      throw new StoreConfigError(
        `restaurants.${key} is not set on its own: the restaurant fee is the Runner's pay plus restaurants.ozisSharePence.`,
      );
    }
  }
  const preferredDiscountPercent = wholeNumber(
    raw['preferredDiscountPercent'] ?? 20,
    'restaurants.preferredDiscountPercent',
    1,
  );
  const maximumDiscountPercent = wholeNumber(
    raw['maximumDiscountPercent'] ?? 50,
    'restaurants.maximumDiscountPercent',
    1,
  );
  // The largest mark-up staff may record on a partner's prices (Anthony, 30 October 2026).
  const maximumMarkupPercent = wholeNumber(
    raw['maximumMarkupPercent'] ?? 100,
    'restaurants.maximumMarkupPercent',
    0,
  );
  if (maximumMarkupPercent > 1000) {
    throw new StoreConfigError('restaurants.maximumMarkupPercent must be at most 1000.');
  }
  if (maximumDiscountPercent > 90 || preferredDiscountPercent > maximumDiscountPercent) {
    throw new StoreConfigError(
      'restaurants.preferredDiscountPercent must be at most restaurants.maximumDiscountPercent, which is at most 90.',
    );
  }
  return {
    ozisSharePence,
    feePence,
    largeOrderFeePence,
    largeOrderFromPence: runnerPay.largeOrderFromPence,
    minimumOrderPence: wholeNumber(
      raw['minimumOrderPence'] ?? 1000,
      'restaurants.minimumOrderPence',
      0,
    ),
    preferredDiscountPercent,
    maximumDiscountPercent,
    maximumMarkupPercent,
  };
}

/** What the checkout insights read from config/store.json. */
export interface CheckoutInsightSettings {
  /** The top of each total band but the last, rising: [2000, 4000, 6000]. */
  readonly totalBandsPence: readonly number[];
  /** The periods, in days, staff may choose between: [7, 30, 90]. */
  readonly periodsDays: readonly number[];
  readonly sameCheckoutMinutes: number;
  readonly paidWithinHours: number;
  readonly askOncePerHours: number;
}

function parseCheckoutInsights(raw: Unknown): CheckoutInsightSettings {
  const list = (value: unknown, fallback: number[], path: string, minimum: number): number[] => {
    const entries = (value === undefined ? fallback : array(value, path)).map((entry, index) =>
      wholeNumber(entry, `${path}[${index}]`, minimum),
    );
    if (
      entries.length === 0 ||
      entries.some((entry, index) => index > 0 && entry <= entries[index - 1]!)
    ) {
      throw new StoreConfigError(`${path} must be a rising list of whole numbers.`);
    }
    return entries;
  };
  return {
    totalBandsPence: list(
      raw['totalBandsPence'],
      [2000, 4000, 6000],
      'checkoutInsights.totalBandsPence',
      1,
    ),
    periodsDays: list(raw['periodsDays'], [7, 30, 90], 'checkoutInsights.periodsDays', 1),
    sameCheckoutMinutes: wholeNumber(
      raw['sameCheckoutMinutes'] ?? 30,
      'checkoutInsights.sameCheckoutMinutes',
      1,
    ),
    paidWithinHours: wholeNumber(
      raw['paidWithinHours'] ?? 2,
      'checkoutInsights.paidWithinHours',
      1,
    ),
    askOncePerHours: wholeNumber(
      raw['askOncePerHours'] ?? 24,
      'checkoutInsights.askOncePerHours',
      24,
    ),
  };
}

function parseAreas(raw: Unknown): AreaSettings {
  const namesRaw = raw['names'] === undefined ? {} : object(raw['names'], 'areas.names');
  const names: Record<string, string> = {};
  for (const [area, name] of Object.entries(namesRaw)) {
    names[area] = str(name, `areas.names.${area}`).trim();
  }
  const groupsRaw = raw['groups'] === undefined ? {} : object(raw['groups'], 'areas.groups');
  const groups: Record<string, string[]> = {};
  const grouped = new Set<string>();
  for (const [group, members] of Object.entries(groupsRaw)) {
    const letters = wordList(members, `areas.groups.${group}`).map((entry) => entry.toUpperCase());
    for (const entry of letters) {
      if (!/^[A-Z]{1,2}$/.test(entry)) {
        throw new StoreConfigError(
          `areas.groups.${group} has "${entry}", which is not the letters of a postcode area.`,
        );
      }
      if (grouped.has(entry)) {
        throw new StoreConfigError(`areas.groups has "${entry}" in more than one group.`);
      }
      grouped.add(entry);
    }
    groups[group] = letters;
  }
  return {
    names,
    groups,
    openWords: str(
      raw['openWords'] ?? 'Yes, we deliver in {area}. You can order now.',
      'areas.openWords',
    ),
    noRunnerWords: str(
      raw['noRunnerWords'] ??
        "There's no Runner (driver) in your area yet, so we may not be able to deliver this order. If you know a driver, send them your referral link so they can sign up and deliver for you.",
      'areas.noRunnerWords',
    ),
    goAheadQuestion: str(
      raw['goAheadQuestion'] ?? 'Would you still like to go ahead?',
      'areas.goAheadQuestion',
    ),
    noRunnerOkButton: str(raw['noRunnerOkButton'] ?? 'OK, I understand', 'areas.noRunnerOkButton'),
    noRunnerShareButton: str(
      raw['noRunnerShareButton'] ?? 'Send my referral link',
      'areas.noRunnerShareButton',
    ),
    inviteDriverWords: str(
      raw['inviteDriverWords'] ??
        "There's no Runner (driver) near me yet. If you drive, you could sign up as a Runner and deliver in our area: {link}",
      'areas.inviteDriverWords',
    ),
    runnerJoinedWords: str(
      raw['runnerJoinedWords'] ?? 'A Runner (driver) has joined in your area. You can order now.',
      'areas.runnerJoinedWords',
    ),
    statusHasRunner: str(
      raw['statusHasRunner'] ?? 'Has a Runner (driver)',
      'areas.statusHasRunner',
    ),
    statusNoRunner: str(raw['statusNoRunner'] ?? 'No Runner (driver) yet', 'areas.statusNoRunner'),
    statusPaused: str(raw['statusPaused'] ?? 'Paused', 'areas.statusPaused'),
    textQuietFrom: clockTime(raw['textQuietFrom'] ?? '21:00', 'areas.textQuietFrom'),
    textQuietUntil: clockTime(raw['textQuietUntil'] ?? '09:00', 'areas.textQuietUntil'),
    livePositionMinutes: wholeNumber(
      raw['livePositionMinutes'] ?? 15,
      'areas.livePositionMinutes',
      1,
    ),
    shareOnShiftSeconds: wholeNumber(
      raw['shareOnShiftSeconds'] ?? 120,
      'areas.shareOnShiftSeconds',
      10,
    ),
    shareOnJobSeconds: wholeNumber(raw['shareOnJobSeconds'] ?? 25, 'areas.shareOnJobSeconds', 5),
  };
}

/** A time of day written "HH:MM", such as "21:00"; refuses anything else. */
function clockTime(value: unknown, path: string): string {
  const text = str(value, path);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(text)) {
    throw new StoreConfigError(`${path} must be a time written as HH:MM, such as 21:00.`);
  }
  return text;
}

function parseOwnerDesk(raw: Unknown): OwnerDeskSettings {
  const confidence = raw['checkConfidence'] ?? 0.9;
  if (typeof confidence !== 'number' || !(confidence > 0 && confidence <= 1)) {
    throw new StoreConfigError('ownerDesk.checkConfidence must be a number above 0, up to 1.');
  }
  return {
    callsInARow: wholeNumber(raw['callsInARow'] ?? 3, 'ownerDesk.callsInARow', 1),
    minutesBetweenCalls: wholeNumber(
      raw['minutesBetweenCalls'] ?? 2,
      'ownerDesk.minutesBetweenCalls',
      1,
    ),
    hoursBetweenCascades: wholeNumber(
      raw['hoursBetweenCascades'] ?? 1,
      'ownerDesk.hoursBetweenCascades',
      1,
    ),
    quietFrom: clockTime(raw['quietFrom'] ?? '21:00', 'ownerDesk.quietFrom'),
    quietUntil: clockTime(raw['quietUntil'] ?? '08:00', 'ownerDesk.quietUntil'),
    urgentInQuietHours: bool(raw['urgentInQuietHours'] ?? true, 'ownerDesk.urgentInQuietHours'),
    laterAfterMinutes: wholeNumber(
      raw['laterAfterMinutes'] ?? 60,
      'ownerDesk.laterAfterMinutes',
      1,
    ),
    lowRatingAtMost: wholeNumber(raw['lowRatingAtMost'] ?? 2, 'ownerDesk.lowRatingAtMost', 1),
    checkConfidence: confidence,
    appRingSeconds: wholeNumber(raw['appRingSeconds'] ?? 30, 'ownerDesk.appRingSeconds', 5),
  };
}

function parseCompanyContact(raw: Unknown): CompanyContactSettings {
  return {
    messageCodeMinutes: wholeNumber(
      raw['messageCodeMinutes'] ?? 120,
      'companyContact.messageCodeMinutes',
      1,
    ),
    callRecordingDays: wholeNumber(
      raw['callRecordingDays'] ?? 90,
      'companyContact.callRecordingDays',
      1,
    ),
  };
}

function parseScheduled(raw: Unknown): ScheduledSettings {
  const defaults = SCHEDULED_DEFAULTS;
  const windowsRaw =
    raw['windows'] === undefined ? {} : object(raw['windows'], 'scheduled.windows');
  const windows = {} as Record<DeliveryWindow, WindowTimes>;
  for (const window of DELIVERY_WINDOWS) {
    const one =
      windowsRaw[window] === undefined
        ? {}
        : object(windowsRaw[window], `scheduled.windows.${window}`);
    const from = clockTime(
      one['from'] ?? defaults.windows[window].from,
      `scheduled.windows.${window}.from`,
    );
    const until = clockTime(
      one['until'] ?? defaults.windows[window].until,
      `scheduled.windows.${window}.until`,
    );
    if (until <= from) {
      throw new StoreConfigError(`scheduled.windows.${window} must end after it starts.`);
    }
    windows[window] = { from, until };
  }
  const reminders =
    raw['reminders'] === undefined ? {} : object(raw['reminders'], 'scheduled.reminders');
  return {
    maxDaysAhead: wholeNumber(
      raw['maxDaysAhead'] ?? defaults.maxDaysAhead,
      'scheduled.maxDaysAhead',
      1,
    ),
    offerLeadMinutes: wholeNumber(
      raw['offerLeadMinutes'] ?? defaults.offerLeadMinutes,
      'scheduled.offerLeadMinutes',
      0,
    ),
    defaultChargeTime: clockTime(
      raw['defaultChargeTime'] ?? defaults.defaultChargeTime,
      'scheduled.defaultChargeTime',
    ),
    retryEveryMinutes: wholeNumber(
      raw['retryEveryMinutes'] ?? defaults.retryEveryMinutes,
      'scheduled.retryEveryMinutes',
      1,
    ),
    maxChargeTries: wholeNumber(
      raw['maxChargeTries'] ?? defaults.maxChargeTries,
      'scheduled.maxChargeTries',
      1,
    ),
    windows,
    reminders: {
      dayBeforeAt: clockTime(
        reminders['dayBeforeAt'] ?? defaults.reminders.dayBeforeAt,
        'scheduled.reminders.dayBeforeAt',
      ),
      morningOfAt: clockTime(
        reminders['morningOfAt'] ?? defaults.reminders.morningOfAt,
        'scheduled.reminders.morningOfAt',
      ),
      ownerSummaryAt: clockTime(
        reminders['ownerSummaryAt'] ?? defaults.reminders.ownerSummaryAt,
        'scheduled.reminders.ownerSummaryAt',
      ),
    },
  };
}

export function parseStoreConfig(input: unknown): StoreConfig {
  const root = object(input, 'the configuration file');

  const contact = object(root['contact'], 'contact');
  const store = object(root['store'], 'store');
  const catalogueSource = object(store['catalogueSource'], 'store.catalogueSource');
  const brand = object(root['brand'], 'brand');
  const colours = object(brand['colours'], 'brand.colours');
  const fees = object(root['fees'], 'fees');
  const processorRaw = object(fees['processor'], 'fees.processor');
  const coolBag = object(fees['coolBag'], 'fees.coolBag');
  const payments = object(root['payments'], 'payments');
  const allocation = object(root['allocation'], 'allocation');
  const recurringOrders = object(root['recurringOrders'], 'recurringOrders');
  const accountDeletion = object(root['accountDeletion'], 'accountDeletion');
  const accessibility = object(root['accessibility'], 'accessibility');
  const versionOneRestrictions = object(root['versionOneRestrictions'], 'versionOneRestrictions');
  const voice = object(root['voice'], 'voice');
  const calls = object(root['calls'], 'calls');
  const extras = root['extras'] === undefined ? {} : object(root['extras'], 'extras');
  const problems = object(root['problems'], 'problems');
  const feedback = root['feedback'] === undefined ? {} : object(root['feedback'], 'feedback');
  const reviews =
    feedback['reviews'] === undefined ? {} : object(feedback['reviews'], 'feedback.reviews');
  const receipts = root['receipts'] === undefined ? {} : object(root['receipts'], 'receipts');
  const runners = root['runners'] === undefined ? {} : object(root['runners'], 'runners');
  const reminderDays = (
    Array.isArray(runners['insuranceReminderDays']) ? runners['insuranceReminderDays'] : [30, 7, 1]
  ).map((entry: unknown, index: number) =>
    wholeNumber(entry, `runners.insuranceReminderDays[${index}]`, 1),
  );
  const admin = root['admin'] === undefined ? {} : object(root['admin'], 'admin');
  const dispatch = root['dispatch'] === undefined ? {} : object(root['dispatch'], 'dispatch');
  const ownerRaw = root['owner'] === undefined ? {} : object(root['owner'], 'owner');
  const ownerDeskRaw =
    root['ownerDesk'] === undefined ? {} : object(root['ownerDesk'], 'ownerDesk');
  const dunsRaw = store['dunsNumber'];
  const dunsNumber =
    dunsRaw === undefined || dunsRaw === null ? null : str(dunsRaw, 'store.dunsNumber');
  if (dunsNumber !== null && !/^\d{9}$/.test(dunsNumber)) {
    throw new StoreConfigError('store.dunsNumber must be nine digits.');
  }
  const staffTwoStepFrom = str(admin['staffTwoStepFrom'] ?? '2026-10-17', 'admin.staffTwoStepFrom');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(staffTwoStepFrom) || Number.isNaN(Date.parse(staffTwoStepFrom))) {
    throw new StoreConfigError(`admin.staffTwoStepFrom must be a date written as YYYY-MM-DD.`);
  }
  const recoveryPercentOfPay = wholeNumber(
    problems['recoveryPercentOfPay'],
    'problems.recoveryPercentOfPay',
    0,
  );
  if (recoveryPercentOfPay > 20) {
    // The law may cap it at 10% (ruling, 2 October 2026); never more than £1 of a £5 job.
    throw new StoreConfigError(
      `problems.recoveryPercentOfPay is ${recoveryPercentOfPay}%. It may not be more than 20%, so a Runner always takes home most of every job.`,
    );
  }

  const allowedModes = array(
    catalogueSource['allowedModes'],
    'store.catalogueSource.allowedModes',
  ).map((entry, index) => str(entry, `store.catalogueSource.allowedModes[${index}]`));
  for (const mode of allowedModes) {
    if (mode !== 'partner_feed' && mode !== 'community') {
      throw new StoreConfigError(
        `store.catalogueSource.allowedModes may only contain partner_feed or community, received "${mode}".`,
      );
    }
  }

  const processor: ProcessorModel = {
    percentageBasisPoints: wholeNumber(
      processorRaw['percentageBasisPoints'],
      'fees.processor.percentageBasisPoints',
    ),
    fixedPence: wholeNumber(processorRaw['fixedPence'], 'fees.processor.fixedPence'),
  };

  const deliveryRaw = object(fees['delivery'], 'fees.delivery');
  const itemChargeRaw = object(fees['itemCharge'], 'fees.itemCharge');
  const delivery: DeliveryPrices & { allowance: OrderAllowance } = {
    bands: parseDeliveryBands(deliveryRaw['bands']),
    allowance: parseOrderAllowance(deliveryRaw['allowance']),
  };
  const itemCharge: ItemChargeRule = {
    basePence: wholeNumber(itemChargeRaw['basePence'], 'fees.itemCharge.basePence', 0),
    stepPence: wholeNumber(itemChargeRaw['stepPence'], 'fees.itemCharge.stepPence', 0),
    everyPence: wholeNumber(itemChargeRaw['everyPence'], 'fees.itemCharge.everyPence', 1),
  };
  const maximumProductPence = wholeNumber(
    fees['maximumProductPence'],
    'fees.maximumProductPence',
    1,
  );
  const maximumOrderGoodsPence = wholeNumber(
    fees['maximumOrderGoodsPence'] ?? 15000,
    'fees.maximumOrderGoodsPence',
    1,
  );
  if (maximumOrderGoodsPence < maximumProductPence) {
    throw new StoreConfigError(
      `fees.maximumOrderGoodsPence (${maximumOrderGoodsPence}p) must be at least fees.maximumProductPence (${maximumProductPence}p), or the dearest product could never be ordered.`,
    );
  }
  const maximumBasketGoodsPence = wholeNumber(
    fees['maximumBasketGoodsPence'] ?? 45000,
    'fees.maximumBasketGoodsPence',
    maximumOrderGoodsPence,
  );
  const extraRunnerDeliveryPence = wholeNumber(
    fees['extraRunnerDeliveryPence'] ?? 1350,
    'fees.extraRunnerDeliveryPence',
    0,
  );
  const largeOrderRunnerPaymentPence = wholeNumber(
    fees['largeOrderRunnerPaymentPence'] ?? 700,
    'fees.largeOrderRunnerPaymentPence',
    RUNNER_PAYMENT_PENCE,
  );
  const largeOrderFromPence = wholeNumber(
    fees['largeOrderFromPence'] ?? 12000,
    'fees.largeOrderFromPence',
    maximumProductPence + 1,
  );

  // Rule Two, Rule Five and Rule Six are checked against the constants, not trusted from the
  // file.
  equals(
    wholeNumber(fees['runnerPaymentPence'], 'fees.runnerPaymentPence'),
    RUNNER_PAYMENT_PENCE,
    'fees.runnerPaymentPence',
    'Rule Two',
  );
  equals(
    wholeNumber(recurringOrders['noticeMinutesBefore'], 'recurringOrders.noticeMinutesBefore'),
    SET_NOTICE_MINUTES_BEFORE,
    'recurringOrders.noticeMinutesBefore',
    'Rule Five',
  );

  const ageRestrictedGoodsAllowed = bool(
    versionOneRestrictions['ageRestrictedGoodsAllowed'],
    'versionOneRestrictions.ageRestrictedGoodsAllowed',
  );
  if (ageRestrictedGoodsAllowed !== AGE_RESTRICTED_GOODS_ALLOWED) {
    throw new StoreConfigError(
      'versionOneRestrictions.ageRestrictedGoodsAllowed must be false. Rule Six: no age restricted goods in version one.',
    );
  }

  const skipWord = str(recurringOrders['skipWord'], 'recurringOrders.skipWord');
  if (/\s/.test(skipWord.trim()) || skipWord.trim() === '') {
    throw new StoreConfigError(
      `recurringOrders.skipWord must be a single word with no spaces, received "${skipWord}". Rule Five: the skip is one word.`,
    );
  }

  const minimumControlHeightPx = wholeNumber(
    accessibility['minimumControlHeightPx'],
    'accessibility.minimumControlHeightPx',
    1,
  );
  if (minimumControlHeightPx < 48) {
    throw new StoreConfigError(
      `accessibility.minimumControlHeightPx is ${minimumControlHeightPx} but every control must be at least 48 pixels tall. Rule Seven.`,
    );
  }

  const baseFontSizePx = wholeNumber(
    accessibility['baseFontSizePx'],
    'accessibility.baseFontSizePx',
    1,
  );
  if (baseFontSizePx < 16) {
    throw new StoreConfigError(
      `accessibility.baseFontSizePx is ${baseFontSizePx} which is too small for the people this product is built for. Rule Seven.`,
    );
  }

  const coolBagDepositPence = wholeNumber(coolBag['depositPence'], 'fees.coolBag.depositPence');
  const coolBagWithholdPerOrderPence = wholeNumber(
    coolBag['withholdPerOrderPence'],
    'fees.coolBag.withholdPerOrderPence',
    1,
  );
  if (coolBagWithholdPerOrderPence >= RUNNER_PAYMENT_PENCE) {
    throw new StoreConfigError(
      `fees.coolBag.withholdPerOrderPence is ${coolBagWithholdPerOrderPence}p, which is not less than the ${RUNNER_PAYMENT_PENCE}p a Runner earns per order. ` +
        `A Runner must never finish a delivery with nothing. Rule Two.`,
    );
  }
  if (coolBagWithholdPerOrderPence > coolBagDepositPence) {
    throw new StoreConfigError(
      `fees.coolBag.withholdPerOrderPence is ${coolBagWithholdPerOrderPence}p, which is more than the whole ${coolBagDepositPence}p deposit.`,
    );
  }

  const partnersParsed = partnerPricing(
    extras['partners'] === undefined ? {} : object(extras['partners'], 'extras.partners'),
  );

  const supportedCardRegions = array(
    payments['supportedCardRegions'],
    'payments.supportedCardRegions',
  ).map((entry, index) => str(entry, `payments.supportedCardRegions[${index}]`));

  return {
    configVersion: wholeNumber(root['configVersion'], 'configVersion', 1),
    productName: str(root['productName'], 'productName'),
    assistantName: str(root['assistantName'], 'assistantName'),
    assistantHeardAs:
      root['assistantHeardAs'] === undefined
        ? []
        : array(root['assistantHeardAs'], 'assistantHeardAs').map((entry, index) =>
            str(entry, `assistantHeardAs[${index}]`),
          ),
    tagline: str(root['tagline'], 'tagline'),
    motto: str(root['motto'], 'motto'),
    contact: {
      telephonePlaceholder: str(contact['telephonePlaceholder'], 'contact.telephonePlaceholder'),
      telephoneIsPlaceholder: bool(
        contact['telephoneIsPlaceholder'],
        'contact.telephoneIsPlaceholder',
      ),
      email: emailAddress(contact['email'], 'contact.email'),
      emailIsPlaceholder: bool(contact['emailIsPlaceholder'], 'contact.emailIsPlaceholder'),
      website: contact['website'] === undefined ? '' : str(contact['website'], 'contact.website'),
    },
    store: {
      displayName: str(store['displayName'], 'store.displayName'),
      legalEntityName: str(store['legalEntityName'], 'store.legalEntityName'),
      legalEntityIsPlaceholder: bool(
        store['legalEntityIsPlaceholder'],
        'store.legalEntityIsPlaceholder',
      ),
      companyNumber: str(store['companyNumber'], 'store.companyNumber'),
      companyNumberIsPlaceholder: bool(
        store['companyNumberIsPlaceholder'],
        'store.companyNumberIsPlaceholder',
      ),
      registeredIn: str(store['registeredIn'], 'store.registeredIn'),
      registeredOffice: str(store['registeredOffice'], 'store.registeredOffice'),
      registeredOfficeIsPlaceholder: bool(
        store['registeredOfficeIsPlaceholder'],
        'store.registeredOfficeIsPlaceholder',
      ),
      icoRegistrationNumber: str(store['icoRegistrationNumber'], 'store.icoRegistrationNumber'),
      icoRegistrationIsPlaceholder: bool(
        store['icoRegistrationIsPlaceholder'],
        'store.icoRegistrationIsPlaceholder',
      ),
      dunsNumber,
      country: str(store['country'], 'store.country'),
      currency: str(store['currency'], 'store.currency'),
      currencySymbol: str(store['currencySymbol'], 'store.currencySymbol'),
      catalogueSource: {
        mode: parseCatalogueMode(
          catalogueSource['mode'],
          'store.catalogueSource.mode',
          allowedModes,
        ),
        allowedModes: allowedModes as readonly CatalogueSourceMode[],
        attribution: str(catalogueSource['attribution'], 'store.catalogueSource.attribution'),
      },
    },
    brand: {
      colours: {
        navy: hexColour(colours['navy'], 'brand.colours.navy'),
        gold: hexColour(colours['gold'], 'brand.colours.gold'),
        white: hexColour(colours['white'], 'brand.colours.white'),
        listening: hexColour(colours['listening'], 'brand.colours.listening'),
      },
    },
    fees: {
      currency: str(fees['currency'], 'fees.currency'),
      runnerPaymentPence: RUNNER_PAYMENT_PENCE,
      delivery,
      itemCharge,
      maximumProductPence,
      maximumOrderGoodsPence,
      maximumBasketGoodsPence,
      extraRunnerDeliveryPence,
      largeOrderRunnerPaymentPence,
      largeOrderFromPence,
      processor,
      coolBag: {
        depositPence: wholeNumber(coolBag['depositPence'], 'fees.coolBag.depositPence'),
        withholdPerOrderPence: coolBagWithholdPerOrderPence,
        releaseAfterCompletedDeliveries: wholeNumber(
          coolBag['releaseAfterCompletedDeliveries'],
          'fees.coolBag.releaseAfterCompletedDeliveries',
          1,
        ),
      },
    },
    payments: {
      provider: str(payments['provider'], 'payments.provider'),
      supportedCardRegions,
    },
    allocation: {
      offerHoldSeconds: wholeNumber(
        allocation['offerHoldSeconds'],
        'allocation.offerHoldSeconds',
        1,
      ),
      poolingRadiusMiles: positiveNumber(
        allocation['poolingRadiusMiles'],
        'allocation.poolingRadiusMiles',
      ),
      allocatedHoldMinutes: wholeNumber(
        allocation['allocatedHoldMinutes'] ?? 10,
        'allocation.allocatedHoldMinutes',
        1,
      ),
    },
    recurringOrders: {
      noticeMinutesBefore: SET_NOTICE_MINUTES_BEFORE,
      skipWord: skipWord.trim().toLowerCase(),
    },
    accountDeletion: {
      recycleBinDays: wholeNumber(
        accountDeletion['recycleBinDays'],
        'accountDeletion.recycleBinDays',
        1,
      ),
    },
    accessibility: {
      targetStandard: str(accessibility['targetStandard'], 'accessibility.targetStandard'),
      baseFontSizePx,
      minimumControlHeightPx,
    },
    problems: {
      instantRefundUpToPence: wholeNumber(
        problems['instantRefundUpToPence'],
        'problems.instantRefundUpToPence',
        0,
      ),
      decideWithinWorkingDays: wholeNumber(
        problems['decideWithinWorkingDays'],
        'problems.decideWithinWorkingDays',
        1,
      ),
      recoveryPercentOfPay,
      writeOffUpToPence: wholeNumber(
        problems['writeOffUpToPence'],
        'problems.writeOffUpToPence',
        0,
      ),
    },
    extras: {
      recipePassPence: wholeNumber(extras['recipePassPence'] ?? 199, 'extras.recipePassPence', 1),
      recipePassDays: wholeNumber(extras['recipePassDays'] ?? 30, 'extras.recipePassDays', 1),
      membershipPence: wholeNumber(extras['membershipPence'] ?? 1000, 'extras.membershipPence', 1),
      plusPence: wholeNumber(extras['plusPence'] ?? 1500, 'extras.plusPence', 1),
      familyPence: wholeNumber(extras['familyPence'] ?? 2000, 'extras.familyPence', 1),
      familyMaximum: wholeNumber(extras['familyMaximum'] ?? 4, 'extras.familyMaximum', 2),
      freeFirstMonth: bool(extras['freeFirstMonth'] ?? true, 'extras.freeFirstMonth'),
      freeMonthReminderDaysBefore: wholeNumber(
        extras['freeMonthReminderDaysBefore'] ?? 3,
        'extras.freeMonthReminderDaysBefore',
        1,
      ),
      freeFindItsPerMonth: wholeNumber(
        extras['freeFindItsPerMonth'] ?? 1,
        'extras.freeFindItsPerMonth',
        0,
      ),
      plusFreeFindItsPerMonth: wholeNumber(
        extras['plusFreeFindItsPerMonth'] ?? extras['freeFindItsPerMonth'] ?? 1,
        'extras.plusFreeFindItsPerMonth',
        0,
      ),
      checkInAfterDays: wholeNumber(extras['checkInAfterDays'] ?? 14, 'extras.checkInAfterDays', 1),
      organisations: organisationPricing(
        extras['organisations'] === undefined
          ? {}
          : object(extras['organisations'], 'extras.organisations'),
      ),
      findItPence: wholeNumber(extras['findItPence'] ?? 200, 'extras.findItPence', 1),
      findItShops: wholeNumber(extras['findItShops'] ?? 3, 'extras.findItShops', 1),
      giftCardPence: giftCardAmounts(extras['giftCardPence'] ?? [1000, 2000, 3000, 5000]),
      partners: partnersParsed,
      spotlightPence: wholeNumber(extras['spotlightPence'] ?? 1999, 'extras.spotlightPence', 1),
      spotlightPlusPence: wholeNumber(
        extras['spotlightPlusPence'] ?? 3999,
        'extras.spotlightPlusPence',
        1,
      ),
      spotlightPerWeek: wholeNumber(extras['spotlightPerWeek'] ?? 1, 'extras.spotlightPerWeek', 1),
      spotlightPlusPerWeek: wholeNumber(
        extras['spotlightPlusPerWeek'] ?? 3,
        'extras.spotlightPlusPerWeek',
        1,
      ),
    },
    calls: {
      pencePerMinute: wholeNumber(calls['pencePerMinute'], 'calls.pencePerMinute', 0),
      maxOutstandingPence: wholeNumber(
        calls['maxOutstandingPence'],
        'calls.maxOutstandingPence',
        0,
      ),
    },
    voice: {
      paymentCeilingPence: wholeNumber(
        voice['paymentCeilingPence'],
        'voice.paymentCeilingPence',
        1,
      ),
    },
    runners: {
      sosLinkHours: wholeNumber(runners['sosLinkHours'] ?? 12, 'runners.sosLinkHours', 1),
      instantPayoutFeeBasisPoints: wholeNumber(
        runners['instantPayoutFeeBasisPoints'] ?? 100,
        'runners.instantPayoutFeeBasisPoints',
        0,
      ),
      instantPayoutFeeMinimumPence: wholeNumber(
        runners['instantPayoutFeeMinimumPence'] ?? 50,
        'runners.instantPayoutFeeMinimumPence',
        0,
      ),
      insuranceReminderDays: [...new Set(reminderDays)].sort((a, b) => b - a),
    },
    referrals: parseReferrals(
      root['referrals'] === undefined ? {} : object(root['referrals'], 'referrals'),
    ),
    ambassador: parseAmbassador(
      root['ambassador'] === undefined ? {} : object(root['ambassador'], 'ambassador'),
    ),
    ambassadorProtection: parseAmbassadorProtection(
      root['ambassadorProtection'] === undefined
        ? {}
        : object(root['ambassadorProtection'], 'ambassadorProtection'),
    ),
    checkoutInsights: parseCheckoutInsights(
      root['checkoutInsights'] === undefined
        ? {}
        : object(root['checkoutInsights'], 'checkoutInsights'),
    ),
    restaurants: parseRestaurants(
      root['restaurants'] === undefined ? {} : object(root['restaurants'], 'restaurants'),
      {
        standardPence: RUNNER_PAYMENT_PENCE,
        largeOrderPence: largeOrderRunnerPaymentPence,
        largeOrderFromPence,
      },
    ),
    versionOneRestrictions: {
      ageRestrictedGoodsAllowed,
    },
    feedback: {
      creditPence: wholeNumber(feedback['creditPence'] ?? 100, 'feedback.creditPence', 0),
      reviews: {
        pointsPerReview: wholeNumber(
          reviews['pointsPerReview'] ?? 10,
          'feedback.reviews.pointsPerReview',
          1,
        ),
        pencePerPoint: wholeNumber(
          reviews['pencePerPoint'] ?? 1,
          'feedback.reviews.pencePerPoint',
          1,
        ),
        spendFromPoints: wholeNumber(
          reviews['spendFromPoints'] ?? 100,
          'feedback.reviews.spendFromPoints',
          1,
        ),
        pendingDays: wholeNumber(reviews['pendingDays'] ?? 7, 'feedback.reviews.pendingDays', 0),
        askWithinDays: wholeNumber(
          reviews['askWithinDays'] ?? 14,
          'feedback.reviews.askWithinDays',
          1,
        ),
        shopOfTheMonthMinimumReviews: wholeNumber(
          reviews['shopOfTheMonthMinimumReviews'] ?? 10,
          'feedback.reviews.shopOfTheMonthMinimumReviews',
          1,
        ),
        shopOfTheMonthPriorWeight: wholeNumber(
          reviews['shopOfTheMonthPriorWeight'] ?? 10,
          'feedback.reviews.shopOfTheMonthPriorWeight',
          0,
        ),
      },
    },
    receipts: {
      photoNeededAbovePence: wholeNumber(
        receipts['photoNeededAbovePence'] ?? 3000,
        'receipts.photoNeededAbovePence',
        0,
      ),
      tillExtraFloorPence: wholeNumber(
        receipts['tillExtraFloorPence'] ?? 500,
        'receipts.tillExtraFloorPence',
        0,
      ),
    },
    dispatch: {
      maxGoodsPenceByMode: parseMaxGoodsByMode(
        dispatch['maxGoodsPenceByMode'],
        maximumProductPence,
        maximumOrderGoodsPence,
      ),
      waitingAlertMinutes: wholeNumber(
        dispatch['waitingAlertMinutes'] ?? 15,
        'dispatch.waitingAlertMinutes',
        1,
      ),
      splitAfterMinutes: wholeNumber(
        dispatch['splitAfterMinutes'] ?? 10,
        'dispatch.splitAfterMinutes',
        1,
      ),
      splitPartMaxPenceByMode: parseSplitPartMax(
        dispatch['splitPartMaxPenceByMode'],
        maximumProductPence,
      ),
      tinyExtraBelowPence: wholeNumber(
        dispatch['tinyExtraBelowPence'] ?? 500,
        'dispatch.tinyExtraBelowPence',
        0,
      ),
      splitRunnerPayPence: wholeNumber(
        dispatch['splitRunnerPayPence'] ?? 500,
        'dispatch.splitRunnerPayPence',
        1,
      ),
      autoRefundAfterMinutes: wholeNumber(
        dispatch['autoRefundAfterMinutes'] ?? 120,
        'dispatch.autoRefundAfterMinutes',
        1,
      ),
      fairShareMaxLeadPence: wholeNumber(
        dispatch['fairShareMaxLeadPence'] ?? FAIR_SHARE_DEFAULTS.fairShareMaxLeadPence,
        'dispatch.fairShareMaxLeadPence',
        0,
      ),
      chainRadiusMiles: positiveNumber(
        dispatch['chainRadiusMiles'] ?? FAIR_SHARE_DEFAULTS.chainRadiusMiles,
        'dispatch.chainRadiusMiles',
      ),
      chainMinutesBeforeDone: wholeNumber(
        dispatch['chainMinutesBeforeDone'] ?? FAIR_SHARE_DEFAULTS.chainMinutesBeforeDone,
        'dispatch.chainMinutesBeforeDone',
        1,
      ),
      nearBandMiles: positiveNumber(
        dispatch['nearBandMiles'] ?? FAIR_SHARE_DEFAULTS.nearBandMiles,
        'dispatch.nearBandMiles',
      ),
      bandSeconds: wholeNumber(
        dispatch['bandSeconds'] ?? FAIR_SHARE_DEFAULTS.bandSeconds,
        'dispatch.bandSeconds',
        1,
      ),
    },
    owner: {
      spokenName: str(ownerRaw['spokenName'] ?? 'Mr. Anthony', 'owner.spokenName'),
    },
    ownerDesk: parseOwnerDesk(ownerDeskRaw),
    companyContact: parseCompanyContact(
      root['companyContact'] === undefined ? {} : object(root['companyContact'], 'companyContact'),
    ),
    scheduled: parseScheduled(
      root['scheduled'] === undefined ? {} : object(root['scheduled'], 'scheduled'),
    ),
    browse: parseBrowse(
      root['browse'] === undefined ? {} : object(root['browse'], 'browse'),
      partnersParsed.excludedServiceKinds,
    ),
    areas: parseAreas(root['areas'] === undefined ? {} : object(root['areas'], 'areas')),
    admin: {
      ownerOnlyRefundAbovePence: wholeNumber(
        admin['ownerOnlyRefundAbovePence'] ?? 2500,
        'admin.ownerOnlyRefundAbovePence',
        0,
      ),
      staffTwoStepGraceDays: wholeNumber(
        admin['staffTwoStepGraceDays'] ?? 14,
        'admin.staffTwoStepGraceDays',
        0,
      ),
      staffTwoStepFrom,
    },
  };
}

export type { ProcessorModel };
