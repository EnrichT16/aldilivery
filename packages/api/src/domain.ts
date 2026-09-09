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
  substitutionDefault: SubstitutionPreference;
  budgetCapPence: number | null;
  deletionScheduledFor: Date | null;
  organisationId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
