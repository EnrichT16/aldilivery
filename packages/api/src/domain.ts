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
  /** Ozi Recipes is unlocked until then; null when it has never been bought. */
  recipePassUntil: Date | null;
  /** Ozi Plus is on until then, bought or shared from a family plan. */
  plusUntil: Date | null;
  /** Whether the Plus this Shopper bought is the family plan. */
  plusFamily: boolean;
  /** The code others type to join this Shopper's family plan. */
  familyCode: string | null;
  /** The Shopper whose family plan this one joined. */
  familyOwnerId: string | null;
  /** Gift card money waiting to be used, in pence. */
  creditPence: number;
  deletionScheduledFor: Date | null;
  organisationId: string | null;
  /** Which office or team at the organisation looks after this person. */
  organisationOffice: string | null;
  /** Optional, given by the person for analysis only. */
  ageBand: AgeBand | null;
  /** The share link they came by, such as partner:<id> or organisation:<id>. */
  joinedVia: string | null;
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
  /** How the Runner is delivering right now. Walking or cycling can be chosen at any time. */
  vehicleType: VehicleType;
  /** Every way the Runner said they might deliver, so switching later needs nothing new. */
  travelModes: VehicleType[];
  /** Their own ID, shown to them and used in the invitation link they share. */
  referralCode: string;
  /** The ID of whoever invited them, if anyone did. */
  referredBy: string | null;
  /** A person has seen their driving licence and found it valid. */
  drivingLicenceVerified: boolean;
  /** Their motor insurance, seen and accepted by a person, covers them until this day. */
  motorInsuranceUntil: Date | null;
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
  /** When they agreed to the Runner agreement, which version, and how (ruling 55). */
  agreementAcceptedAt: Date | null;
  agreementVersion: string | null;
  agreementChannel: string | null;
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
  /** The code a person types in Settings to let this organisation see their orders. */
  joinCode: string | null;
  monthlyBudgetPence: number | null;
  /** What one of their own staff going to the shops costs them, for the savings figure. */
  staffTripCostPence: number | null;
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
  /** Taken off sale: never in a search, never in a basket. */
  retired: boolean;
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

/**
 * Where paying a Runner back for the shopping has got to: sent, waiting for a person to approve
 * it, or owed because their payout account was not ready (the payout sweep sends it).
 */
export type ReimbursementStatus = 'paid' | 'waiting' | 'owed';

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
  /** Gift card money used on this order, given back to the card once it was paid. */
  creditAppliedPence: number;
  /** How it is paid: a saved card through Stripe, or a bank transfer to the business (ruling 50). */
  paidBy: 'card' | 'bank';
  /** For a bank transfer: the reference the Shopper puts on the payment, such as OZI-7K3Q2M. */
  bankReference: string | null;
  /** When staff saw the transfer arrive in the business account. */
  bankReceivedAt: Date | null;
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
  /** Paying the Runner back for the shopping (ruling 55). See services/reimburse.ts. */
  reimbursementPence: number | null;
  reimbursementStatus: ReimbursementStatus | null;
  reimbursementReason: string | null;
  reimbursementTransferId: string | null;
  reimbursedAt: Date | null;
  reimbursementApprovedBy: string | null;
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
  /** Taken towards a refund a Runner was found at fault for: a small part of each job, never all. */
  recoveryWithheldPence: number;
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
/** `phone`: the Shopper's own telephone, rung through LiveKit and Twilio (ruling 46). */
export type CallRole = 'shopper' | 'runner' | 'guest' | 'phone';
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
  /** The LiveKit identity: `shopper-…`, `runner-…`, `guest-…` or `phone-…`. Never a number. */
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

/** What a Runner photographs or types in when they sign up (ruling, 2 October 2026). */
export type RunnerDocumentKind =
  | 'face_photo'
  | 'right_to_work'
  | 'dbs'
  | 'driving_licence_front'
  | 'driving_licence_back'
  | 'insurance';

export type RunnerDocumentStatus = 'submitted' | 'accepted' | 'rejected';

/**
 * A document a Runner sent in. The photograph is kept only until a person has decided, then
 * removed; what was decided, by whom and when is kept. The face photograph is the exception: it
 * stays, because it is shown to the Shopper at the door.
 */
export interface RunnerDocument {
  id: string;
  runnerId: string;
  kind: RunnerDocumentKind;
  /** The photograph, as sent. Null once it has been reviewed and removed, or for a share code. */
  image: Buffer | null;
  contentType: string | null;
  /** A Home Office or DBS share code, where one was given instead of a photograph. */
  shareCode: string | null;
  /** For insurance: the last day it covers. */
  expiresOn: Date | null;
  status: RunnerDocumentStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** Something a Runner told us, from the Feedback page. Anonymous if they chose. */
export interface RunnerFeedback {
  id: string;
  runnerId: string | null;
  message: string;
  createdAt: Date;
}

/**
 * Something that went wrong with an order, reported by the Runner or the Shopper, with evidence,
 * decided by a person (rulings of 2 October 2026).
 */
export type ProblemDecision =
  'shopper_at_fault' | 'runner_at_fault' | 'platform_at_fault' | 'shop_at_fault' | 'no_fault';

export interface ProblemReport {
  id: string;
  orderId: string;
  reportedBy: 'runner' | 'shopper';
  reporterId: string;
  summary: string;
  /** What the Shopper asked to have back, if they asked. */
  refundRequestedPence: number;
  status: 'open' | 'decided';
  /** The day a decision is due: two working days after it was reported. */
  decideBy: Date;
  decision: ProblemDecision | null;
  refundPence: number;
  refundReference: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface ProblemEvidence {
  id: string;
  reportId: string;
  addedBy: 'runner' | 'shopper';
  kind: 'voice_note' | 'photo' | 'note';
  data: Buffer | null;
  contentType: string | null;
  text: string | null;
  createdAt: Date;
}

/** What a Runner owes after being found at fault, taken back a little from each job. */
export interface RunnerRecovery {
  id: string;
  runnerId: string;
  reportId: string;
  amountPence: number;
  recoveredPence: number;
  writtenOff: boolean;
  writtenOffBy: string | null;
  writtenOffAt: Date | null;
  createdAt: Date;
}

/** Ozi Finds It (7 October 2026): something hard to find, looked for in up to three shops. */
export type FindStatus = 'looking' | 'found' | 'not_found';

export interface FindRequest {
  id: string;
  shopperId: string;
  description: string;
  feePence: number;
  /** The payment the fee was taken by; null when Ozi Plus covered it. */
  chargeId: string | null;
  status: FindStatus;
  foundName: string | null;
  foundShop: string | null;
  foundPricePence: number | null;
  catalogueItemId: string | null;
  refundId: string | null;
  note: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

/** A gift card: bought with a card, given as a code, kept as credit when it is used. */
export interface GiftCard {
  id: string;
  code: string;
  amountPence: number;
  buyerShopperId: string;
  chargeId: string;
  recipientName: string;
  message: string;
  redeemedByShopperId: string | null;
  redeemedAt: Date | null;
  createdAt: Date;
}

/** An organisation asking to work with us. A person rings them back. */
export interface OrganisationEnquiry {
  id: string;
  organisation: string;
  contactName: string;
  telephone: string;
  email: string;
  people: string;
  message: string;
  handled: boolean;
  createdAt: Date;
}

/** Somebody who runs the service, with their own sign-in to the admin panel. */
export interface StaffMember {
  id: string;
  name: string;
  /** What they sign in with: short, lower case, unique. */
  username: string;
  /** scrypt, salted. Never the password. */
  passwordHash: string;
  /** One of STAFF_ROLES in lib/staff.ts. */
  role: string;
  active: boolean;
  /** True until they choose their own password, after the one they were given. */
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastSignInAt: Date | null;
  createdAt: Date;
  /** The founder's own account: the only one that sees the money. */
  isOwner: boolean;
  /** The owner's passcode, hashed. */
  passcodeHash: string | null;
  totpSecret: string | null;
  totpEnabled: boolean;
  /** For family and investor accounts: the parts the owner has switched on. */
  allowedAreas: string;
  /** Raised to sign every session of this account out at once. */
  sessionVersion: number;
}

/** A local shop on the monthly partner plan (7 October 2026). */
export interface PartnerShop {
  id: string;
  name: string;
  address: string;
  telephone: string;
  about: string;
  monthlyPence: number;
  /** The plan is paid up to here. Products show only while it is. */
  paidUntil: Date | null;
  active: boolean;
  /** Ozi mentions, an extra on top of the plan. */
  spotlight: SpotlightLevel;
  spotlightUntil: Date | null;
  createdAt: Date;
}

export type SpotlightLevel = 'none' | 'spotlight' | 'plus';

export type PartnerProductStatus = 'pending' | 'approved' | 'rejected' | 'removed';

/** A product a partner shop sent in. Shoppers see it once a person has approved it. */
export interface PartnerProduct {
  id: string;
  partnerShopId: string;
  name: string;
  pricePence: number;
  tags: string;
  expiresOn: Date | null;
  photo: Uint8Array | null;
  photoType: string | null;
  status: PartnerProductStatus;
  note: string | null;
  catalogueItemId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export type BusinessKind = 'partner' | 'organisation';

/** Somebody signing in for a partner shop or an organisation. */
export interface BusinessUser {
  id: string;
  kind: BusinessKind;
  partnerShopId: string | null;
  organisationId: string | null;
  name: string;
  /** For an organisation: their office or team, shown with what they do. */
  office: string;
  username: string;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastSignInAt: Date | null;
  createdAt: Date;
}

export type AgeBand = 'under_25' | '25_44' | '45_64' | '65_plus';

/** What a Shop Partner has paid us, a month or more at a time. */
export interface PartnerPayment {
  id: string;
  partnerShopId: string;
  kind: 'plan' | 'spotlight' | 'plus';
  amountPence: number;
  months: number;
  coversUntil: Date;
  recordedBy: string;
  paidAt: Date;
}

/** Ozi mentioned a Spotlight shop to a Shopper. */
export interface SpotlightMention {
  id: string;
  partnerShopId: string;
  shopperKey: string;
  query: string;
  at: Date;
}

/**
 * Business analysis: something that happened, with no names, numbers or addresses. People are
 * one-way codes; places are postcode districts such as ME7.
 */
export interface AnalyticsEvent {
  id: string;
  at: Date;
  kind: 'order_paid' | 'order_delivered' | 'search' | 'search_unmet' | 'spotlight_mention';
  shopperKey: string | null;
  runnerKey: string | null;
  shop: string | null;
  area: string | null;
  toArea: string | null;
  ageBand: string | null;
  viaOrganisation: boolean;
  itemCount: number;
  goodsPence: number;
  categories: string;
  query: string | null;
  travelMode: string | null;
}

/** Money in (positive) or out (negative), by gateway. Seen only by the owner. */
export interface IncomeRecord {
  id: string;
  at: Date;
  gateway: string;
  kind: string;
  amountPence: number;
  reference: string;
}

/**
 * Something said to Ozi that it could not answer (ruling 49), kept for a person to approve an
 * answer for. Never anything with a banned word, and never anything that looks like a phone
 * number, a card, a code or an email address. Who said it is not kept.
 */
export interface LearnedPhrase {
  id: string;
  /** Which Ozi was asked: shopper, runner, partner, organisation, staff, family, investor, owner. */
  account: string;
  /** What was said, in lower case, without Ozi's name. */
  text: string;
  timesHeard: number;
  firstHeardAt: Date;
  lastHeardAt: Date;
  status: 'waiting' | 'approved' | 'rejected';
  /** The answer a person approved. */
  reply: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}
