/**
 * The domain types the routes and services work in.
 *
 * These mirror `prisma/schema.prisma` but are hand written and free of any Prisma import,
 * so that the business logic, the tests and the in-memory backend do not depend on a
 * generated client. The Prisma backed repository maps rows onto these types at the edge.
 */

export type VehicleType = 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van';

export type SubstitutionPreference = 'no_substitutes' | 'similar_item' | 'ask_me';

export type SubstitutionOutcome = 'pending' | 'supplied' | 'substituted' | 'unavailable';

export type CatalogueItemSource = 'partner_feed' | 'community';

export type CoolBagDepositStatus = 'not_started' | 'withholding' | 'held' | 'released';

export type JobOfferOutcome = 'pending' | 'accepted' | 'declined' | 'expired' | 'superseded';

export type SetFrequency = 'weekly' | 'fortnightly' | 'monthly';

export type AccountRole = 'shopper' | 'runner';

export type { OrderStatus } from '@aldilivery/core';

export interface Shopper {
  id: string;
  displayName: string;
  handle: string;
  phone: string;
  spokenCodeHash: string | null;
  preferredLanguage: string;
  doorstepProtocol: string;
  /** Where the shopping goes. Empty until the Shopper gives one. */
  deliveryAddress: string;
  substitutionDefault: SubstitutionPreference;
  budgetCapPence: number | null;
  /** The PIN, hashed with a salt and a server secret; never the PIN itself. */
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  /**
   * The Shopper's customer at Stripe. A saved card is attached to it, which is what lets the
   * same card be charged again; a card on its own is spent after one payment.
   */
  stripeCustomerId: string | null;
  deletionScheduledFor: Date | null;
  organisationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** An address saved for orders sent somewhere other than home (Section D). */
export interface SavedAddress {
  id: string;
  shopperId: string;
  label: string;
  address: string;
  createdAt: Date;
}

export interface Runner {
  id: string;
  name: string;
  phone: string;
  vehicleType: VehicleType;
  rightToWorkVerified: boolean;
  criminalRecordCheckVerified: boolean;
  stripeConnectedAccountId: string | null;
  coolBagDepositStatus: CoolBagDepositStatus;
  coolBagWithheldPence: number;
  completedDeliveryCount: number;
  available: boolean;
  latitude: number | null;
  longitude: number | null;
  lastJobCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A device a Shopper has allowed to show notifications: the browser's own push address and the
 * keys it gave for encrypting what is sent there. Holds no message and nothing about the person.
 */
export interface PushSubscription {
  id: string;
  shopperId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

export type ItemAnswer = 'similar' | 'leave_out';

/** A Runner telling the Shopper they cannot find one thing, and what the Shopper wants instead. */
export interface ItemQuestion {
  id: string;
  orderId: string;
  orderItemId: string;
  askedAt: Date;
  answer: ItemAnswer | null;
  answeredBy: 'shopper' | 'no_answer' | null;
  answeredAt: Date | null;
}

export type RunnerCheckKind = 'right_to_work' | 'criminal_record';

/** One time a person checked a Runner's documents, or took an approval back. */
export interface RunnerCheck {
  id: string;
  runnerId: string;
  kind: RunnerCheckKind;
  outcome: 'verified' | 'withdrawn';
  evidence: string;
  checkedBy: string;
  note: string;
  checkedAt: Date;
}

export interface Organisation {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  invoiceTerms: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HouseholdCircle {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HouseholdCircleMember {
  id: string;
  circleId: string;
  shopperId: string;
  consentGivenAt: Date | null;
  consentMethod: string | null;
  consentRecordedBy: string | null;
  canOrderForOthers: boolean;
  createdAt: Date;
}

export interface CatalogueItem {
  id: string;
  name: string;
  category: string;
  estimatedPricePence: number;
  ageRestricted: boolean;
  source: CatalogueItemSource;
  externalRef: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethod {
  id: string;
  shopperId: string;
  stripePaymentMethodId: string;
  lastFour: string;
  brand: string | null;
  region: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  catalogueItemId: string | null;
  name: string;
  quantity: number;
  estimatedPricePence: number;
  substitutionOutcome: SubstitutionOutcome;
  substitutedForName: string | null;
  actualPricePence: number | null;
  note: string | null;
  createdAt: Date;
}

export interface Order {
  id: string;
  shopperId: string;
  status: import('@aldilivery/core').OrderStatus;
  runnerId: string | null;
  setId: string | null;
  goodsEstimatePence: number;
  feePence: number;
  totalEstimatePence: number;
  receiptTotalPence: number | null;
  receiptFeePence: number | null;
  finalTotalPence: number | null;
  spokenConfirmationAt: Date | null;
  confirmationChannel: string | null;
  confirmationStatement: string | null;
  doorstepProtocolSnapshot: string;
  stripePaymentIntentId: string | null;
  paymentMethodId: string | null;
  deliveryAddress: string;
  latitude: number | null;
  longitude: number | null;
  poolId: string | null;
  runnerPaymentPence: number;
  runnerTransferId: string | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  items: OrderItem[];
}

export interface JobOffer {
  id: string;
  orderId: string;
  runnerId: string;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  outcome: JobOfferOutcome;
  queuePosition: number;
  distanceMiles: number | null;
}

export interface RunnerPayout {
  id: string;
  orderId: string;
  runnerId: string;
  earnedPence: number;
  coolBagWithheldPence: number;
  transferredPence: number;
  stripeTransferId: string | null;
  createdAt: Date;
}

export interface SetItem {
  id: string;
  setId: string;
  catalogueItemId: string | null;
  name: string;
  quantity: number;
  estimatedPricePence: number;
  createdAt: Date;
}

/** A recurring order. Named "Set" in the product; `RecurringSet` in code to avoid the DOM
 *  `Set` and the JavaScript built-in of the same name. */
export interface RecurringSet {
  id: string;
  shopperId: string;
  name: string;
  deliveryAddress: string;
  latitude: number | null;
  longitude: number | null;
  paymentMethodId: string | null;
  frequency: SetFrequency;
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  active: boolean;
  nextFireAt: Date;
  noticeSentAt: Date | null;
  skipRequestedForFireAt: Date | null;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: SetItem[];
}

export interface OneTimeCode {
  id: string;
  phone: string;
  codeHash: string;
  role: AccountRole;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

/** A basket line as it arrives from the web app or, later, from Ozi. */
export interface BasketLine {
  catalogueItemId: string;
  quantity: number;
}

/**
 * An in-app call about an order (docs/BUILD_PROMPT.md, Section F), carried by LiveKit. Nobody's
 * telephone number is part of it: people join a room by an identity of ours, never a number.
 */
export type CallStatus = 'ringing' | 'live' | 'ended';
export type CallRole = 'shopper' | 'runner' | 'guest';
/**
 * `not_due`: nothing to pay. `paid`: taken from the Shopper's card. `outstanding`: the card could
 * not be charged, so it waits and is taken the next time a charge succeeds (ruling, 2 Oct 2026).
 */
export type CallChargeStatus = 'pending' | 'not_due' | 'paid' | 'outstanding';

export interface Call {
  id: string;
  orderId: string;
  shopperId: string;
  runnerId: string;
  /** The LiveKit room. Unguessable, and different for every call. */
  roomName: string;
  startedBy: 'shopper' | 'runner';
  status: CallStatus;
  createdAt: Date;
  endedAt: Date | null;
  /** What the Shopper said yes to, in the words they were shown or told (Rule One). */
  priceStatement: string | null;
  priceAcceptedAt: Date | null;
  pencePerMinute: number;
  billedMinutes: number;
  chargePence: number;
  chargeStatus: CallChargeStatus;
  paymentReference: string | null;
  chargedAt: Date | null;
}

/** One person's part in a call: when they were connected, and who added them. */
export interface CallLeg {
  id: string;
  callId: string;
  role: CallRole;
  /** The LiveKit identity: `shopper-…`, `runner-…` or `guest-…`. Never a number. */
  identity: string;
  /** The name others hear and see: a first name, or what the Shopper called their guest. */
  name: string;
  /** When they last connected, while they are connected. */
  connectedSince: Date | null;
  secondsConnected: number;
  /** For a guest: the hash of the code in their invitation link. */
  inviteCodeHash: string | null;
  /** For a guest: what the Shopper said yes to before adding them. */
  priceStatement: string | null;
  createdAt: Date;
}
