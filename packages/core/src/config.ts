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
import type {
  DeliveryPrices,
  ItemChargeRule,
  OrganisationPricing,
  ProcessorModel,
} from './fees.js';

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
    /** Delivery by plan (ruling 58, 9 October 2026). Every one covers the Runner's five pounds. */
    readonly delivery: DeliveryPrices;
    /** The charge on every unit, from its shop price (ruling 58). Never removed by a plan. */
    readonly itemCharge: ItemChargeRule;
    /** No single product may cost more than this in the shop (ruling 58: £60). */
    readonly maximumProductPence: number;
    /**
     * The most shopping, at shop prices, one order carries; above it, two deliveries are
     * offered. £150 until Anthony confirms the figure (ruling 58).
     */
    readonly maximumOrderGoodsPence: number;
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
    /** Free Ozi Finds It searches a month on any plan. */
    readonly freeFindItsPerMonth: number;
    /** Ozi Plus: a friendly check-in after this many days without an order. */
    readonly checkInAfterDays: number;
    /** What organisations pay for the people they look after (ruling 58). */
    readonly organisations: OrganisationPricing;
    /** Ozi Finds It: a person looks in up to this many shops, for this fee. */
    readonly findItPence: number;
    readonly findItShops: number;
    /** The gift card amounts on offer. */
    readonly giftCardPence: readonly number[];
    /** What a partner shop pays a month for its own dashboard, products and promotion. */
    readonly partnerMonthlyPence: number;
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
  /** Runners' safety, pay timing, reminders and the private referral reward (Section M; rulings 12, 14, 16). */
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
    /** The private referral reward (rulings 12 and 16), never announced in the app. */
    readonly referralRewardPence: number;
    readonly referralsForReward: number;
  };
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
  };
  /**
   * The photo of the till receipt (STILL_TO_DO item 2). Optional for the Runner, but without
   * one, paying them back more than this waits for a person to look. £30 by default: half of
   * what one delivery carries.
   */
  readonly receipts: {
    readonly photoNeededAbovePence: number;
  };
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

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

function hexColour(value: unknown, path: string): string {
  const colour = str(value, path);
  if (!HEX_COLOUR.test(colour)) {
    throw new StoreConfigError(`${path} must be a six digit hex colour such as #0B1F3A, received "${colour}".`);
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

function parseCatalogueMode(value: unknown, path: string, allowed: readonly string[]): CatalogueSourceMode {
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
  const receipts = root['receipts'] === undefined ? {} : object(root['receipts'], 'receipts');
  const runners = root['runners'] === undefined ? {} : object(root['runners'], 'runners');
  const reminderDays = (
    Array.isArray(runners['insuranceReminderDays']) ? runners['insuranceReminderDays'] : [30, 7, 1]
  ).map((entry: unknown, index: number) =>
    wholeNumber(entry, `runners.insuranceReminderDays[${index}]`, 1),
  );
  const admin = root['admin'] === undefined ? {} : object(root['admin'], 'admin');
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

  const allowedModes = array(catalogueSource['allowedModes'], 'store.catalogueSource.allowedModes').map(
    (entry, index) => str(entry, `store.catalogueSource.allowedModes[${index}]`),
  );
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
  const delivery: DeliveryPrices = {
    payAsYouGoSmallOrderPence: wholeNumber(
      deliveryRaw['payAsYouGoSmallOrderPence'],
      'fees.delivery.payAsYouGoSmallOrderPence',
      1,
    ),
    payAsYouGoSmallOrderUpToPence: wholeNumber(
      deliveryRaw['payAsYouGoSmallOrderUpToPence'],
      'fees.delivery.payAsYouGoSmallOrderUpToPence',
      0,
    ),
    payAsYouGoPence: wholeNumber(deliveryRaw['payAsYouGoPence'], 'fees.delivery.payAsYouGoPence', 1),
    membershipPence: wholeNumber(deliveryRaw['membershipPence'], 'fees.delivery.membershipPence', 1),
    plusPence: wholeNumber(deliveryRaw['plusPence'], 'fees.delivery.plusPence', 1),
  };
  // Rule Two: every delivery price, on every plan, must cover the Runner's five pounds.
  for (const key of [
    'payAsYouGoSmallOrderPence',
    'payAsYouGoPence',
    'membershipPence',
    'plusPence',
  ] as const) {
    if (delivery[key] <= RUNNER_PAYMENT_PENCE) {
      throw new StoreConfigError(
        `fees.delivery.${key} is ${delivery[key]}p, which does not cover the Runner's ${RUNNER_PAYMENT_PENCE}p. Rule Two: the Runner's five pounds is untouched.`,
      );
    }
  }
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

  const baseFontSizePx = wholeNumber(accessibility['baseFontSizePx'], 'accessibility.baseFontSizePx', 1);
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
      telephoneIsPlaceholder: bool(contact['telephoneIsPlaceholder'], 'contact.telephoneIsPlaceholder'),
      email: emailAddress(contact['email'], 'contact.email'),
      emailIsPlaceholder: bool(contact['emailIsPlaceholder'], 'contact.emailIsPlaceholder'),
    },
    store: {
      displayName: str(store['displayName'], 'store.displayName'),
      legalEntityName: str(store['legalEntityName'], 'store.legalEntityName'),
      legalEntityIsPlaceholder: bool(store['legalEntityIsPlaceholder'], 'store.legalEntityIsPlaceholder'),
      companyNumber: str(store['companyNumber'], 'store.companyNumber'),
      companyNumberIsPlaceholder: bool(store['companyNumberIsPlaceholder'], 'store.companyNumberIsPlaceholder'),
      registeredIn: str(store['registeredIn'], 'store.registeredIn'),
      registeredOffice: str(store['registeredOffice'], 'store.registeredOffice'),
      registeredOfficeIsPlaceholder: bool(store['registeredOfficeIsPlaceholder'], 'store.registeredOfficeIsPlaceholder'),
      icoRegistrationNumber: str(store['icoRegistrationNumber'], 'store.icoRegistrationNumber'),
      icoRegistrationIsPlaceholder: bool(store['icoRegistrationIsPlaceholder'], 'store.icoRegistrationIsPlaceholder'),
      country: str(store['country'], 'store.country'),
      currency: str(store['currency'], 'store.currency'),
      currencySymbol: str(store['currencySymbol'], 'store.currencySymbol'),
      catalogueSource: {
        mode: parseCatalogueMode(catalogueSource['mode'], 'store.catalogueSource.mode', allowedModes),
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
      offerHoldSeconds: wholeNumber(allocation['offerHoldSeconds'], 'allocation.offerHoldSeconds', 1),
      poolingRadiusMiles: positiveNumber(allocation['poolingRadiusMiles'], 'allocation.poolingRadiusMiles'),
    },
    recurringOrders: {
      noticeMinutesBefore: SET_NOTICE_MINUTES_BEFORE,
      skipWord: skipWord.trim().toLowerCase(),
    },
    accountDeletion: {
      recycleBinDays: wholeNumber(accountDeletion['recycleBinDays'], 'accountDeletion.recycleBinDays', 1),
    },
    accessibility: {
      targetStandard: str(accessibility['targetStandard'], 'accessibility.targetStandard'),
      baseFontSizePx,
      minimumControlHeightPx,
    },
    problems: {
      instantRefundUpToPence: wholeNumber(problems['instantRefundUpToPence'], 'problems.instantRefundUpToPence', 0),
      decideWithinWorkingDays: wholeNumber(problems['decideWithinWorkingDays'], 'problems.decideWithinWorkingDays', 1),
      recoveryPercentOfPay,
      writeOffUpToPence: wholeNumber(problems['writeOffUpToPence'], 'problems.writeOffUpToPence', 0),
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
      checkInAfterDays: wholeNumber(extras['checkInAfterDays'] ?? 14, 'extras.checkInAfterDays', 1),
      organisations: organisationPricing(
        extras['organisations'] === undefined
          ? {}
          : object(extras['organisations'], 'extras.organisations'),
      ),
      findItPence: wholeNumber(extras['findItPence'] ?? 200, 'extras.findItPence', 1),
      findItShops: wholeNumber(extras['findItShops'] ?? 3, 'extras.findItShops', 1),
      giftCardPence: giftCardAmounts(extras['giftCardPence'] ?? [1000, 2000, 3000, 5000]),
      partnerMonthlyPence: wholeNumber(extras['partnerMonthlyPence'] ?? 2999, 'extras.partnerMonthlyPence', 1),
      spotlightPence: wholeNumber(extras['spotlightPence'] ?? 1999, 'extras.spotlightPence', 1),
      spotlightPlusPence: wholeNumber(extras['spotlightPlusPence'] ?? 3999, 'extras.spotlightPlusPence', 1),
      spotlightPerWeek: wholeNumber(extras['spotlightPerWeek'] ?? 1, 'extras.spotlightPerWeek', 1),
      spotlightPlusPerWeek: wholeNumber(extras['spotlightPlusPerWeek'] ?? 3, 'extras.spotlightPlusPerWeek', 1),
    },
    calls: {
      pencePerMinute: wholeNumber(calls['pencePerMinute'], 'calls.pencePerMinute', 0),
      maxOutstandingPence: wholeNumber(calls['maxOutstandingPence'], 'calls.maxOutstandingPence', 0),
    },
    voice: {
      paymentCeilingPence: wholeNumber(voice['paymentCeilingPence'], 'voice.paymentCeilingPence', 1),
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
      referralRewardPence: wholeNumber(runners['referralRewardPence'] ?? 15000, 'runners.referralRewardPence', 1),
      referralsForReward: wholeNumber(runners['referralsForReward'] ?? 100, 'runners.referralsForReward', 1),
    },
    versionOneRestrictions: {
      ageRestrictedGoodsAllowed,
    },
    feedback: {
      creditPence: wholeNumber(feedback['creditPence'] ?? 100, 'feedback.creditPence', 0),
    },
    receipts: {
      photoNeededAbovePence: wholeNumber(
        receipts['photoNeededAbovePence'] ?? 3000,
        'receipts.photoNeededAbovePence',
        0,
      ),
    },
    admin: {
      ownerOnlyRefundAbovePence: wholeNumber(admin['ownerOnlyRefundAbovePence'] ?? 2500, 'admin.ownerOnlyRefundAbovePence', 0),
      staffTwoStepGraceDays: wholeNumber(admin['staffTwoStepGraceDays'] ?? 14, 'admin.staffTwoStepGraceDays', 0),
      staffTwoStepFrom,
    },
  };
}

export type { ProcessorModel };
