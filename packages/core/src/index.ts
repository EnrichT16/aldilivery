/**
 * @aldilivery/core — the shared truth.
 *
 * The fee engine, the inviolable rule constants and the store configuration contract. This
 * entry point contains no file system access and no Node built-ins, so the web app can
 * import it directly. Disk loading lives in `@aldilivery/core/node`.
 */

export {
  INVIOLABLE_RULES,
  RUNNER_PAYMENT_PENCE,
  MINIMUM_NET_PENCE,
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
  aldiliveryNetPence,
  priceBasket,
  orderEconomics,
  worstCaseNetPenceForBand,
  findNetFloorBreaches,
  assertBandsHonourNetFloor,
  GoodsTotalOutOfRangeError,
  type FeeBand,
  type ProcessorModel,
  type BasketPricing,
  type OrderEconomics,
  type NetFloorBreach,
} from './fees.js';

export {
  parseStoreConfig,
  StoreConfigError,
  type StoreConfig,
  type CatalogueSourceMode,
} from './config.js';

export { formatPence, poundsToPence } from './money.js';
