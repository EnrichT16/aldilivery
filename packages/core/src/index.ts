/**
 * @aldilivery/core — the shared truth.
 *
 * The fee engine, the inviolable rule constants and the store configuration contract. This
 * entry point contains no file system access and no Node built-ins, so the web app can
 * import it directly. Disk loading lives in `@aldilivery/core/node`.
 */

export {
  inviolableRules,
  RUNNER_PAYMENT_PENCE,
  MINIMUM_SPEND_PENCE,
  SET_NOTICE_MINUTES_BEFORE,
  AGE_RESTRICTED_GOODS_ALLOWED,
  ACCESSIBILITY_STANDARD,
  ORDER_STATUSES,
  ALLOWED_ORDER_TRANSITIONS,
  canTransition,
  type OrderStatus,
} from './rules.js';

export {
  DELIVERY_PLANS,
  deliveryFeePence,
  deliveryBandFor,
  bandPrice,
  deliverySteps,
  deliveryPriceRange,
  deliveryStepsWords,
  itemChargePence,
  itemChargesForLines,
  displayPricePence,
  productAllowed,
  assertProductAllowed,
  processorCostPence,
  priceBasket,
  priceBasketInParts,
  orderAllowanceFor,
  allowanceExtraPence,
  allowanceWords,
  allowancePlanWords,
  ordinalWord,
  overOneRunnerWords,
  orderEconomics,
  runnerPaymentFor,
  organisationMonthlyPence,
  BasketOverMaximumError,
  ProductOverMaximumError,
  type DeliveryPlan,
  type DeliveryBand,
  type DeliveryPrices,
  type OrderAllowance,
  type AllowancePlan,
  type DeliveryStep,
  type DeliveryFees,
  type ItemChargeRule,
  type PricedUnitLine,
  type ProcessorModel,
  type BasketPricing,
  type OrderEconomics,
  type OrganisationPricing,
  type BasketInParts,
  type BasketPartFees,
  type BasketPartLine,
  type BasketPartPricing,
} from './fees.js';

export {
  parseStoreConfig,
  StoreConfigError,
  type StoreConfig,
  type CheckoutInsightSettings,
  type CatalogueSourceMode,
  type OwnerDeskSettings,
  type CompanyContactSettings,
} from './config.js';

export {
  bandOf,
  chainHoldSeconds,
  compareFairShare,
  FAIR_SHARE_DEFAULTS,
  fairQueue,
  firstBandOnly,
  isMotorMode,
  largeOrderShopperWords,
  lowestEarnedToday,
  mayChain,
  queuePositionWords,
  tooFarAhead,
  waitedMsSince,
  maxGoodsFor,
  modeCarries,
  MOTOR_TRAVEL_MODES,
  modeTakesPart,
  needsVehicle,
  packFirstFit,
  planSplit,
  SPLIT_PART_MODES,
  splitPartLimitPence,
  splitPartWho,
  TRAVEL_MODES,
  travelModeOf,
  vehiclesWords,
  type DistanceBand,
  type FairPlace,
  type FairRunner,
  type FairShareSettings,
  type MaxGoodsByMode,
  type NotInLine,
  type PlannedPart,
  type SplitPartMaxByMode,
  type SplitPartMode,
  type SplitLine,
  type SplitPart,
  type TravelMode,
} from './dispatch.js';

export { formatPence, poundsToPence } from './money.js';

export { parseChoice, parseQuantity, parseYesNo, splitItems, wantsToStop } from './spoken-order.js';

export {
  normalisePhrase,
  phraseFingerprint,
  phraseWithoutName,
  type PhraseNames,
} from './phrase-text.js';

export { RUNNER_AGREEMENT_VERSION } from './runner-agreement.js';

export {
  FEEDBACK_THEMES,
  FEEDBACK_PATTERN_MINIMUM,
  isFeedbackTheme,
  type FeedbackTheme,
} from './feedback.js';

export {
  BROWSE_SECTIONS,
  browseWords,
  chosenFrom,
  heardBrowse,
  matchesBrowseSearch,
  postcodeLetters,
  postcodeNearness,
  searchWords,
  sectionOf,
  type BrowseSection,
  type BrowseSettings,
  type HeardBrowse,
} from './browse.js';

export { areaName, areaOf, postcodeIn, tidyPostcode, type AreaSettings } from './areas.js';

export {
  PARTNER_KINDS,
  PARTNER_KIND_WORDS,
  basisPointsWords,
  excludedServiceKind,
  excludedServiceWords,
  freeListingAvailable,
  postcodeArea,
  productLimit,
  type PartnerKind,
  type PartnerPlan,
  type PartnerPricing,
} from './partners.js';

export {
  RESTAURANT_MIXED_WORDS,
  RestaurantBelowMinimumError,
  counterPricePence,
  isPreferredPartner,
  isRestaurantKind,
  preferredRankingWords,
  priceRestaurantBasket,
  restaurantDiscountPence,
  restaurantFeeShares,
  restaurantFeeWords,
  restaurantMinimumWords,
  restaurantProfitPence,
  shopPriceFromCounterPence,
  type RestaurantSettings,
} from './restaurants.js';

export {
  ORGANISATION_AUTHORITY_WORDS,
  ORGANISATION_CONSENT_VERSION,
  ORGANISATION_SHARED_THINGS,
  ORGANISATION_TERMS_VERSION,
  SHOP_PARTNER_TERMS_VERSION,
  organisationConsentWords,
  type OrganisationConsentWords,
} from './organisations.js';

export {
  activeShare,
  AMBASSADOR_TERMS_VERSION,
  ambassadorAvailableAt,
  ambassadorEarningAfterRefunds,
  ambassadorNeedsReview,
  ambassadorPayable,
  ambassadorPlanSharePence,
  ambassadorShareEnds,
  ambassadorSharePence,
  earnedWords,
  highestLevel,
  levelsReached,
  meetsActiveShare,
  nextLevel,
  ownerLevelWords,
  percentWords,
  progressWords,
  rewardWords,
  shareWords,
  withinAmbassadorMonths,
  type AmbassadorSettings,
  type ReferralLevel,
  type ReferralSettings,
} from './referrals.js';

export {
  DELIVERY_WINDOWS,
  SCHEDULED_DEFAULTS,
  addDays,
  bookableDays,
  chargeMomentWords,
  checkSchedule,
  dayWords,
  daysBetween,
  isClock,
  isDay,
  nextChargeTry,
  offerAtFor,
  parseSpokenDay,
  parseSpokenSchedule,
  parseSpokenTime,
  parseSpokenWindow,
  payByDayFor,
  scheduleAgreementWords,
  ukClock,
  ukDay,
  ukMoment,
  weekdayOf,
  windowWords,
  type ChargePlan,
  type DeliveryWindow,
  type HeardSchedule,
  type ScheduleCheck,
  type ScheduleChoice,
  type ScheduledSettings,
  type WindowTimes,
} from './scheduled.js';
