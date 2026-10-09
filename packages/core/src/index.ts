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
  feeForGoodsPence,
  processorCostPence,
  platformNetPence,
  priceBasket,
  orderEconomics,
  BasketOverMaximumError,
  type DeliveryFees,
  type ProcessorModel,
  type BasketPricing,
  type OrderEconomics,
} from './fees.js';

export {
  parseStoreConfig,
  StoreConfigError,
  type StoreConfig,
  type CatalogueSourceMode,
} from './config.js';

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
