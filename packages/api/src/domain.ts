/**
 * The domain types the routes and services work in.
 *
 * These mirror `prisma/schema.prisma` but are hand written and free of any Prisma import,
 * so that the business logic, the tests and the in-memory backend do not depend on a
 * generated client. The Prisma backed repository maps rows onto these types at the edge.
 */

import type {
  AmbassadorAddressType,
  AmbassadorDocumentKind,
  AmbassadorIdType,
  AmbassadorStatus,
  ChargePlan,
  DeliveryWindow,
  PartnerKind,
  PartnerPlan,
  SplitPartMode,
} from '@aldilivery/core';

export type VehicleType = 'on_foot' | 'bicycle' | 'motorbike' | 'car' | 'van';

export type SubstitutionPreference = 'no_substitutes' | 'similar_item' | 'ask_me';

export type SubstitutionOutcome = 'pending' | 'supplied' | 'substituted' | 'unavailable';

export type CatalogueItemSource = 'partner_feed' | 'community';

export type CoolBagDepositStatus = 'not_started' | 'withholding' | 'held' | 'released';

export type JobOfferOutcome = 'pending' | 'accepted' | 'declined' | 'expired' | 'superseded';

export type SetFrequency = 'weekly' | 'fortnightly' | 'monthly';

/** Who a session is for: a Shopper or a Runner. */
export type SessionRole = 'shopper' | 'runner';
/** Who a one-time code is for. A partner has codes (to confirm a mobile), never a session. */
export type AccountRole = SessionRole | 'partner';

/** Where an extra Runner's delivery on a linked order has got to (ruling 61). */
export type ExtraDeliveryStatus =
  'pending' | 'charged' | 'failed' | 'transfer' | 'waived' | 'refunded' | 'credited';

export type { OrderStatus, SplitPartMode } from '@aldilivery/core';
export type { ChargePlan, DeliveryWindow } from '@aldilivery/core';

/**
 * Where a payment taken on a chosen day has got to (ruling 78): waiting for its moment, being
 * tried again after a refusal, waiting for the Shopper to check it is them with their bank,
 * given up after the last try, or paid.
 */
export type ScheduledChargeStatus =
  'waiting' | 'retrying' | 'needs_authentication' | 'failed' | 'paid';

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
  /**
   * The monthly plan the Shopper chose to join (ruling 58): Ozi Membership, Ozi Plus, or Ozi
   * Family and Carer. Null is pay as you go. A family member carries the payer's plan.
   */
  plan: ShopperPlan | null;
  /** The plan is paid up until then, or shared from the Family and Carer plan's payer. */
  planUntil: Date | null;
  /** They chose to have it taken monthly until they cancel. Never set without their yes. */
  planRenews: boolean;
  planStartedAt: Date | null;
  planCancelledAt: Date | null;
  /** Membership is free (with pay-as-you-go delivery) until then: the first month. */
  freeMonthUntil: Date | null;
  freeMonthReminderSentAt: Date | null;
  /** Ozi Plus: the last friendly check-in after a while without an order. */
  checkInSentAt: Date | null;
  /** Family and Carer: members' orders above this total wait for the payer's approval. */
  approvalLimitPence: number | null;
  weeklySummarySentAt: Date | null;
  /** The code others type to join this Shopper's family plan. */
  familyCode: string | null;
  /** The Shopper whose family plan this one joined. */
  familyOwnerId: string | null;
  /** Gift card money waiting to be used, in pence. */
  creditPence: number;
  /**
   * How much of `creditPence` is an "Unused Runner fee credit" (ruling 61): an extra Runner's
   * delivery already paid (by bank transfer) for a Runner who was not needed. Shown in their
   * account; used, like the rest of the credit, on their next order. Never more than creditPence.
   */
  unusedRunnerFeeCreditPence: number;
  deletionScheduledFor: Date | null;
  /** When a closed account was removed: personal details taken off, money records kept. */
  erasedAt: Date | null;
  /** The app store reviewers' demo account (ruling 60): no card charged, no Runner sent. */
  isDemo: boolean;
  organisationId: string | null;
  /** Which office or team at the organisation looks after this person. */
  organisationOffice: string | null;
  /**
   * When the person agreed to link to the organisation (30 October 2026, UK GDPR): it sees
   * only orders placed from this moment on. Null for nobody linked, or linked before then.
   */
  organisationConsentAt: Date | null;
  /** The consent wording they agreed to (ORGANISATION_CONSENT_VERSION in packages/core). */
  organisationConsentVersion: string | null;
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
  /**
   * Who invited them, if anyone did: a Runner's ID, or "shopper:<handle>" for a Shopper who sent
   * their referral link to a driver (30 October 2026).
   */
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
  /**
   * How often Stripe sends what is in the Runner's own Stripe account on to their bank (ruling
   * 16). Their pay and pay-backs still reach their Stripe account straight away.
   */
  payoutSchedule: PayoutSchedule;
  /** When they stopped being a Runner, closed by themselves or removed by staff, and why. */
  leftAt: Date | null;
  leftReason: string | null;
  leftBy: string | null;
  /** When a Runner who left had their personal details removed (ruling 60). */
  erasedAt: Date | null;
  /** The app store reviewers' demo Runner (ruling 60): never offered a real job. */
  isDemo: boolean;
  /** The cool bag deposit paid back on leaving, or the reason it waits for a person. */
  coolBagRefundedPence: number | null;
  coolBagRefundedAt: Date | null;
  coolBagRefundTransferId: string | null;
  coolBagRefundNote: string | null;
  /** Insurance reminders (ruling 14): for which expiry, and the fewest days before it sent. */
  insuranceReminderFor: Date | null;
  insuranceReminderDays: number | null;
  /**
   * How they pay at the till (Anthony, 9 October 2026): the spending card from Stripe Issuing,
   * loaded for each order, or their own card, paid back straight away (ruling 55).
   */
  payMethod: RunnerPayMethod;
  /** Stripe Issuing identifiers and the last four digits. Never the card number (Rule Ten). */
  issuingCardholderId: string | null;
  issuingCardId: string | null;
  cardLast4: string | null;
  /** Active while loaded for an order; inactive (frozen) otherwise. */
  cardStatus: 'active' | 'inactive' | null;
  /** When, and from which internet address, they accepted the cardholder terms. */
  issuingTermsAcceptedAt: Date | null;
  issuingTermsAcceptedIp: string | null;
  /**
   * When the Runner ticked "I agree that … may compare my face photo with the photo on my ID"
   * (ruling 74). Null: the automatic check makes no face comparison, and a person does it.
   */
  faceMatchConsentAt: Date | null;
  /** Where they live (Anthony, 30 October 2026), which gives their area. Empty until given. */
  homePostcode: string;
  /** When their phone last shared `latitude` and `longitude`. Null: it never has. */
  locationAt: Date | null;
  /** When a person accepted their face photo. No job is offered before it (30 October 2026). */
  facePhotoAcceptedAt: Date | null;
  /** When they confirmed at sign-up that they are 18 or over. */
  adultConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The spending card ("card") or their own card, paid back ("own"). */
export type RunnerPayMethod = 'card' | 'own';

/**
 * A use of a Runner's spending card: an authorization the shop asked for, approved or declined
 * and why, or a transaction that followed (spent is positive, a refund negative).
 */
export interface CardAuthorization {
  id: string;
  /** Stripe's identifier, iauth_… or ipi_…, so a repeated webhook changes nothing. */
  stripeId: string;
  kind: 'authorization' | 'transaction';
  orderId: string | null;
  runnerId: string | null;
  amountPence: number;
  approved: boolean;
  reason: string;
  /** For an authorization: pending, closed or reversed. */
  status: string;
  merchant: string;
  at: Date;
}

/** Weekly unless the Runner chooses daily (ruling 16). An instant payout is asked for each time. */
export type PayoutSchedule = 'weekly' | 'daily';

/**
 * A Runner pressing SOS (Section M). Where they are, kept up to date while it is on, and the
 * hash of the code in the private link sent to the owner. Nothing about the Shopper's phone.
 */
export interface RunnerSos {
  id: string;
  runnerId: string;
  orderId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMetres: number | null;
  locationAt: Date | null;
  linkCodeHash: string;
  linkExpiresAt: Date;
  alertSentAt: Date | null;
  alertProblem: string | null;
}

/**
 * The kinds of account with a referral link, who can refer and be referred (Anthony, 30 October
 * 2026): anyone can refer anyone.
 */
export type ReferralKind = 'shopper' | 'runner' | 'partner' | 'organisation';

/** One account opened through somebody's referral link. Whether it is active is never stored. */
export interface Referral {
  id: string;
  referrerKind: ReferralKind;
  referrerId: string;
  joinedKind: ReferralKind;
  joinedId: string;
  /** The link as followed, kind:code. */
  via: string;
  createdAt: Date;
}

/** A referral reward level somebody reached, kept once reached. */
export interface ReferralLevelReached {
  id: string;
  referrerKind: ReferralKind;
  referrerId: string;
  activeReferrals: number;
  rewardPence: number;
  label: string;
  activeAtReach: number;
  joinedAtReach: number;
  reachedAt: Date;
  /** When Ozi told the person in the app, once. */
  toldAt: Date | null;
  givenAt: Date | null;
  givenBy: string | null;
}

/** How one reminder about a sent voucher reached the person (30 October 2026). */
export type VoucherReminderVia =
  'app' | 'app_answered' | 'app_declined' | 'app_then_text' | 'text' | 'none';

/**
 * A referral reward voucher staff sent to the person who reached the level (Anthony, 30 October
 * 2026): the code they pasted (sensitive: shown in full only to the person and to staff who open
 * the record, never written in an application log, removed when the account is erased), the
 * message it went in, who sent it and when, when it was first opened and when the person said
 * they had used it, and Ozi's reminder calls, at most three.
 */
export interface ReferralVoucher {
  id: string;
  /** The level reached it is for: one voucher a level. */
  levelId: string;
  accountKind: ReferralKind;
  accountId: string;
  label: string;
  rewardPence: number;
  /** The voucher code. Empty once the account is erased. */
  code: string;
  /** A link to the voucher, if staff gave one. */
  link: string | null;
  /** The message in the person's inbox it went in. */
  messageId: string | null;
  sentById: string | null;
  sentByName: string;
  sentAt: Date;
  /** The first time the person opened or read the message. */
  openedAt: Date | null;
  /** When the person tapped "I've used it". Amazon cannot tell us, so it is their word. */
  usedAt: Date | null;
  /** When Ozi next rings to remind them; null once opened, or after the third. */
  nextReminderAt: Date | null;
  /** While Ozi is ringing in the app: until when, before a text instead. */
  ringingUntil: Date | null;
  reminder1At: Date | null;
  reminder1Via: VoucherReminderVia | null;
  reminder2At: Date | null;
  reminder2Via: VoucherReminderVia | null;
  reminder3At: Date | null;
  reminder3Via: VoucherReminderVia | null;
  /** When the code was removed with the account. */
  erasedAt: Date | null;
}

/** Somebody who chose to become an Ozi Ambassador, agreeing to the Ambassador terms. */
export interface AmbassadorAgreement {
  id: string;
  accountKind: ReferralKind;
  accountId: string;
  agreedAt: Date;
  termsVersion: string;
  /**
   * Their own Stripe account, for withdrawals to their bank (ruled 30 October 2026). A Runner's
   * own payout account is used when they have one. Stripe collects the bank details on its own
   * form; they never pass through the service.
   */
  stripeConnectedAccountId: string | null;
  /** Flagged by staff: every withdrawal waits for a person to approve it. */
  flaggedAt: Date | null;
  flagReason: string | null;
  /**
   * Their application (Anthony, 30 October 2026): applied, documents sent, documents checked,
   * chat done, approved, declined or suspended. Those who agreed before applications began are
   * "documents needed": their link and earnings carry on, the Toolkit and withdrawals wait.
   */
  status: AmbassadorStatus;
  /** The photo ID they chose to send: a passport, driving licence or residence card. */
  idType: AmbassadorIdType | null;
  /** When every document needed was in. */
  documentsSentAt: Date | null;
  /** When every document needed was accepted, by the automatic check or by staff. */
  documentsCheckedAt: Date | null;
  /** The short chat with the founder, recorded by staff, with their notes. */
  chatDoneAt: Date | null;
  chatDoneBy: string | null;
  chatNotes: string;
  /** Approved, declined or suspended: when, by whom, and the reason the person sees. */
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionReason: string | null;
  approvedAt: Date | null;
  /**
   * When they stopped being an Ambassador, or were declined: their ID and address documents are
   * removed `ambassador.documentsKeptMonths` after this (services/retention.ts).
   */
  stoppedAt: Date | null;
  /**
   * The separate yes or no to comparing their face photo with the photo on their ID (Anthony,
   * 31 October 2026), and when they answered. Null until they answer; a no, or no answer, means a
   * person checks it instead. Nobody is declined for saying no.
   */
  faceCompareConsent: boolean | null;
  faceCompareConsentAt: Date | null;
  /** The status they had when suspended, to go back to if the suspension is lifted. */
  suspendedFrom: AmbassadorStatus | null;
  /** When the retention sweep removed a declined or removed Ambassador's files. */
  documentsRemovedAt: Date | null;
  /**
   * Their code on the public "Check an Ambassador" page and every printed QR code (Anthony, 31
   * October 2026): six letters and numbers, made once they are approved. Null until then.
   */
  checkCode: string | null;
}

/**
 * A short note kept after an Ambassador application is declined, or an Ambassador removed for
 * fraud (Anthony, 31 October 2026): the name, the name read on their ID, the date of birth if
 * held, the date and the reason. Only to enforce the wait before applying again, to bar somebody
 * removed for fraud, and to spot an application under a false identity. A declined note goes
 * after `ambassador.declinedNoteKeptMonths`; a fraud bar stays (`deleteAfter` null).
 */
export interface AmbassadorNote {
  id: string;
  agreementId: string | null;
  accountKind: ReferralKind;
  accountId: string;
  kind: 'declined' | 'fraud';
  name: string;
  nameOnId: string | null;
  /** YYYY-MM-DD, only if staff had it. */
  dateOfBirth: string | null;
  reason: string;
  at: Date;
  deleteAfter: Date | null;
}

/**
 * A document sent with an Ambassador application (Anthony, 30 October 2026): a photo ID, the back
 * of a card, a proof of address, a face photo, or a Home Office share code. Read by the automatic
 * check like a Runner's; kept while they are an Ambassador and for 12 months after they stop.
 */
export interface AmbassadorDocument {
  id: string;
  agreementId: string;
  accountKind: ReferralKind;
  accountId: string;
  kind: AmbassadorDocumentKind;
  /** For a photo ID: which kind. */
  idType: AmbassadorIdType | null;
  /** For a proof of address: which kind. */
  addressType: AmbassadorAddressType | null;
  image: Uint8Array | null;
  contentType: string | null;
  shareCode: string | null;
  status: 'submitted' | 'accepted' | 'rejected';
  /** The automatic check: when it read it, whether it was clearly fine, why not, the name on it. */
  checkedAt: Date | null;
  checkPassed: boolean | null;
  checkNote: string | null;
  checkName: string | null;
  /** The date on a proof of address, as read, YYYY-MM-DD. */
  checkIssuedOn: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** When the file was removed: by the retention rule, or with the account. */
  erasedAt: Date | null;
}

/**
 * One line of an Ozi Ambassador's money (ruled 30 October 2026):
 *
 * - `share`: their share of Ozi's profit on one order from one business, following the order's
 *   final state. Pending until `availableAt`; until then a cancel or refund changes it.
 * - `bonus`: the one-off share of a business's first Partner Plus payment.
 * - `deduction`: a refund that came after a share was already available (a late complaint, a
 *   card chargeback), taken off what is available next, never below zero.
 * - `payment`: what was paid to them, by hand or by a withdrawal to their bank.
 */
export interface AmbassadorEntry {
  id: string;
  ambassadorKind: ReferralKind;
  ambassadorId: string;
  kind: 'share' | 'bonus' | 'deduction' | 'payment';
  partnerShopId: string | null;
  orderId: string | null;
  profitPence: number;
  /** Always zero or more: a deduction or a payment is taken off. */
  amountPence: number;
  /** When a share or bonus stops being pending and can be paid; null for the others. */
  availableAt: Date | null;
  /** A card chargeback on its order: the share is worth nothing (from the Stripe webhook). */
  disputedAt: Date | null;
  /** Each one once only. */
  reference: string;
  recordedBy: string | null;
  at: Date;
  /**
   * Removed for fraud (Anthony, 31 October 2026): when the unpaid part of a share or bonus was
   * cancelled, how much (what is left is `amountPence`), and why.
   */
  cancelledAt: Date | null;
  cancelledPence: number;
  cancelReason: string | null;
  /**
   * Held for a person to check (Anthony, 31 October 2026): the order's Shopper matched the
   * Ambassador or the business owner. It counts for nothing until staff release it.
   */
  heldAt: Date | null;
  heldReason: string | null;
}

/**
 * A device an account was seen using (Anthony, 31 October 2026): a random id the app makes and
 * keeps on the device. Only to spot an order from an Ambassador's own device or the owner's.
 */
export interface DeviceSighting {
  id: string;
  deviceId: string;
  accountKind: 'shopper' | 'runner' | 'partner';
  accountId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * An Ambassador's claim to have brought a business in (Anthony, 31 October 2026): waiting for the
 * business to confirm with the code sent to its own phone, confirmed, or refused. Only a keyed
 * hash of the code is kept. The first confirmed claim wins.
 */
export interface AmbassadorClaim {
  id: string;
  partnerShopId: string;
  ambassadorKind: ReferralKind;
  ambassadorId: string;
  status: 'waiting' | 'confirmed' | 'refused';
  codeHash: string | null;
  codeExpiresAt: Date | null;
  codeSentAt: Date | null;
  attempts: number;
  refusedReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

/**
 * An Ambassador asking for their available money to go to their bank (ruled 30 October 2026).
 * Sent at once by a Stripe transfer to their own Stripe account, unless it is over the monthly
 * review figure or they are flagged: then it waits for staff to approve it.
 */
export interface AmbassadorWithdrawal {
  id: string;
  ambassadorKind: ReferralKind;
  ambassadorId: string;
  amountPence: number;
  status: 'waiting_approval' | 'sent' | 'refused' | 'failed';
  /** Why it waits for a person, in plain words, or null. */
  waitingReason: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  stripeTransferId: string | null;
  /** What went wrong, for staff, when Stripe refused it. */
  failure: string | null;
}

/**
 * The private referral reward (rulings 12 and 16), given by the owner. Replaced by the referral
 * levels on 30 October 2026; the rows already given are kept, for the record.
 */
export interface ReferralReward {
  id: string;
  /** shopper:<handle> or runner:<Runner ID>. */
  referrer: string;
  qualifyingCount: number;
  amountPence: number;
  method: 'credit' | 'transfer' | 'by_hand';
  reference: string | null;
  decidedBy: string;
  createdAt: Date;
}

/**
 * A device a Shopper has allowed to show notifications: the browser's own push address and the
 * keys it gave for encrypting what is sent there. Holds no message and nothing about the person.
 */
export interface PushSubscription {
  id: string;
  /** The Shopper who allowed notifications on this device, if one did. */
  shopperId: string | null;
  /**
   * The staff account that allowed them, if one did: the owner letting Ozi ring him in the app
   * (ruling 79). One device can be both.
   */
  staffId: string | null;
  /** The Runner who allowed them, for a job the office sends (ruling 80). */
  runnerId: string | null;
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
  /** Where it is, which gives its area (Anthony, 30 October 2026). Empty until given. */
  postcode: string;
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
  /**
   * A Shop Partner's thing (Anthony, 30 October 2026): the partner's own shop price for one, and
   * what the Runner pays for one at the counter (the shop price less any agreed discount), kept
   * as they were when the order was placed. `estimatedPricePence` is what the Shopper pays for
   * one, with any agreed mark-up. Null for everything else.
   */
  shopPricePence: number | null;
  counterPricePence: number | null;
  createdAt: Date;
}

/**
 * Where paying a Runner back for the shopping has got to: sent, waiting for a person to approve
 * it, or owed because their payout account was not ready (the payout sweep sends it).
 */
export type ReimbursementStatus = 'paid' | 'waiting' | 'owed';

/** A till total waiting for a person to settle with the Shopper, and once they have. */
export type TillStatus = 'needs_person' | 'settled';

/** The monthly plans (ruling 58). */
export type ShopperPlan = 'membership' | 'plus' | 'family';

export interface Order {
  id: string;
  shopperId: string;
  status: import('@aldilivery/core').OrderStatus;
  runnerId: string | null;
  setId: string | null;
  /** The shopping at shop prices: what the till is expected to say. */
  goodsEstimatePence: number;
  /** The item charges on every unit (ruling 58). They go to the business, never to the shop. */
  itemChargesPence: number;
  feePence: number;
  /**
   * The extra delivery charge for an order past the plan's monthly allowance (ruling 73), or 0.
   * In `totalEstimatePence` and the final total; not shop goods, so the till never sees it; it
   * goes to the business, never to the Runner.
   */
  allowanceExtraPence: number;
  totalEstimatePence: number;
  /**
   * A restaurant, café or takeaway order (Anthony, 30 October 2026): the partner it is from, or
   * null for groceries. `feePence` is then the flat restaurant fee, in place of delivery.
   */
  restaurantShopId: string | null;
  /**
   * The discount that restaurant agreed for Ozi when the order was placed, a whole percentage (0
   * for none, and on every grocery order). The Shopper pays shop prices; the Runner pays the
   * restaurant the shop prices less this at the counter; Ozi keeps the difference.
   */
  restaurantDiscountPercent: number;
  /** Which delivery price applied. */
  deliveryPlan: import('@aldilivery/core').DeliveryPlan;
  /** Family and Carer: the payer whose card pays, and their approval above their limit. */
  payerShopperId: string | null;
  approvalStatus: 'waiting' | 'approved' | 'declined' | null;
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
  /** A till total a person must settle with the Shopper, and how it ended. See routes/till-cases.ts. */
  tillStatus: TillStatus | null;
  tillReason: string | null;
  tillSettledBy: string | null;
  tillSettledAt: Date | null;
  /**
   * How the Runner paid at the till: the spending card, or their own card (paid back). With the
   * card: what it was loaded with for this order, what it spent, and at which shop.
   */
  payMethodUsed: RunnerPayMethod | null;
  cardLimitPence: number | null;
  cardSpentPence: number | null;
  cardMerchant: string | null;
  /** The door safe word (T6): two easy words the Runner says at the door. */
  doorWord: string | null;
  /** For an order a Set placed: which occurrence, so each is placed once only. */
  setFireAt: Date | null;
  /** When the address and doorstep words were taken off, seven years on. */
  anonymisedAt: Date | null;
  /**
   * When the owner was texted that this large order is still waiting for a Runner with a car
   * (ruling 59), so it is texted once only.
   */
  waitingAlertSentAt: Date | null;
  /**
   * Split jobs (ruling 60). On the whole order: when it was split into parts. On a part: the
   * whole order, which part this is, and of how many.
   */
  splitAt: Date | null;
  splitParentId: string | null;
  splitPart: number | null;
  splitOf: number | null;
  /**
   * On a part (ruling 61): who it is for, a motorbike rider ('motorbike', which a car or van
   * Runner may also take) or a Runner on foot or bicycle ('foot'). Null on a whole order, and on
   * parts split before ruling 61, which went to everyone.
   */
  splitMode: SplitPartMode | null;
  /**
   * On a part (ruling 61): when it was planned, at the split or when the rest was planned again,
   * so another `dispatch.splitAfterMinutes` is waited before it is planned again.
   */
  splitPlannedAt: Date | null;
  /**
   * A basket over one order kept whole (ruling 61): the linked orders share `basketGroupId` (the
   * first order's id), and each is order `basketPart` of `basketOf`. Null on an ordinary order.
   */
  basketGroupId: string | null;
  basketPart: number | null;
  basketOf: number | null;
  /**
   * On a linked order after the first: where its extra-Runner delivery (`feePence`, £13.50) has
   * got to. 'pending' until its Runner collects it (then taken from the card, 'charged', or
   * 'failed' when the card would not pay); 'transfer' when it came in a bank transfer; 'waived'
   * when the Runner was never needed and nothing was taken; 'refunded' to the card, or
   * 'credited' to the Shopper's account as "Unused Runner fee credit" when it had been taken.
   */
  extraDeliveryStatus: ExtraDeliveryStatus | null;
  /** The card payment that took the extra-Runner delivery, so it can be given back. */
  extraDeliveryPaymentId: string | null;
  /** A demo order (ruling 60): no card is charged and no Runner is sent. */
  isDemo: boolean;
  /**
   * Ordering now for a later day (ruling 78). The UK day it comes (YYYY-MM-DD) and its window,
   * or null for as soon as possible; when it is offered to Runners (the window's start less the
   * lead time); and when the money is taken: now, at a chosen moment (`chargeAt`, tried
   * `chargeTries` times so far, next at `chargeNextTryAt`), or by bank transfer before the day.
   */
  deliveryDay: string | null;
  deliveryWindow: DeliveryWindow | null;
  offerAt: Date | null;
  chargePlan: ChargePlan | null;
  chargeAt: Date | null;
  chargeTries: number;
  chargeNextTryAt: Date | null;
  chargeStatus: ScheduledChargeStatus | null;
  /** When the Shopper was sent a link to pay because their bank asked to check it was them. */
  chargeLinkSentAt: Date | null;
  /** When it was held, unpaid at its offer time, and not sent to a Runner. */
  scheduledHeldAt: Date | null;
  /** The Shopper's reminders: the day before, and the morning of delivery. */
  reminderDayBeforeAt: Date | null;
  reminderMorningAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** Why it was cancelled, in plain words, for the admin panel. Null when nobody said. */
  cancelReason?: string | null;
  /**
   * Goodwill refunds staff have given on this order (16 October 2026), added up, so that with
   * any complaint refunds they never come to more than the order cost.
   */
  goodwillRefundedPence: number;
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
  /**
   * Offered to a Runner on the final leg of another job, for a pickup near their drop-off
   * (ruling 64), before the general queue. Declining one counts against nobody.
   */
  chained: boolean;
  /**
   * Sent straight to this Runner by the office (ruling 80): a priority offer held only for them,
   * for `allocation.allocatedHoldMinutes`. Still theirs to accept or decline.
   */
  allocated: boolean;
}

/**
 * Where a job the office sent straight to a Runner has got to (ruling 80): waiting for their
 * hands to be free (or for a booked order's offer time), offered to them, taken, said no to,
 * run out, or withdrawn (sent to someone else, given back to the queue, or the order ended).
 */
export type JobAllocationStatus =
  'queued' | 'offered' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

/** A job the office sent straight to a chosen Runner, outside the queue (ruling 80). */
export interface JobAllocation {
  id: string;
  orderId: string;
  runnerId: string;
  /** Who has it next if this Runner says no or the time runs out, if the office chose one. */
  backupRunnerId: string | null;
  /** A booked order (ruling 78) sent before its offer time, on purpose. */
  allowEarly: boolean;
  status: JobAllocationStatus;
  /** The staff member who sent it; null for the staff key. */
  allocatedById: string | null;
  allocatedByName: string;
  allocatedAt: Date;
  /** The priority offer, once the Runner's hands were free. */
  offerId: string | null;
  offeredAt: Date | null;
  settledAt: Date | null;
  /** Where the order went when this Runner did not take it. */
  returnedTo: 'backup' | 'queue' | null;
  /** The allocation this one is the backup of. */
  backupOfId: string | null;
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
  /**
   * When the Shopper agreed that each occurrence is sent and paid for by itself after the
   * notice, and the words they agreed to. Null: a reminder only, and nothing is ever paid.
   */
  autoSendAgreedAt: Date | null;
  autoSendStatement: string | null;
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
  /** When the limits on codes to this number were cleared by staff (ruling 81); null if not. */
  limitClearedAt?: Date | null;
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
  /**
   * The automatic check (ruling 74): when it read the document, whether every check was clearly
   * fine (true) or not (false, the reason in `checkNote`), and the name it read on it. A passed
   * document may still wait for the rest of the application to be compared.
   */
  checkedAt: Date | null;
  checkPassed: boolean | null;
  checkNote: string | null;
  checkName: string | null;
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
  /** An organisation, or a shop asking from /organisations?shop=1 (30 October 2026). */
  kind: 'organisation' | 'shop';
  /** When an organisation agreed to the Organisation terms, and which version. */
  termsAgreedAt: Date | null;
  termsVersion: string | null;
  /** The referral link the person asking came by, kind:code (Anthony, 30 October 2026). */
  joinedVia: string | null;
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
  /** Two-step recovery codes, each hashed, comma separated; one is used up each time. */
  recoveryCodes: string;
  /**
   * May issue message and call codes, and send and call without one (ruling 77). Only the owner
   * grants it, in Team. The owner himself always may.
   */
  canAuthorise: boolean;
  /**
   * May send orders straight to a chosen Runner, outside the queue (ruling 80). Only the owner
   * grants it, in Team. The owner himself always may.
   */
  canAllocate: boolean;
  /**
   * May unlock anybody locked out, and reset a Shopper's PIN or a staff member's password
   * (ruling 81). Only the owner grants it, in Team. The owner himself always may.
   */
  canUnlock: boolean;
}

export type PartnerShopStatus = 'pending' | 'approved' | 'removed';
/** How a shop came to be here: joined itself, added by staff from a paper form, listed by Ozi, or claimed. */
export type PartnerShopSource = 'self' | 'staff' | 'ozi' | 'claimed';

/** A local shop, café, takeaway or service listed here (7 October 2026; ruling 65). */
export interface PartnerShop {
  id: string;
  name: string;
  address: string;
  telephone: string;
  about: string;
  /** What Partner Plus costs them a month; 0 on a free listing, a café, a takeaway or a service. */
  monthlyPence: number;
  /** Partner Plus is paid up to here. The full catalogue shows only while it is. */
  paidUntil: Date | null;
  /** False when paused by staff. */
  active: boolean;
  /** Ozi mentions, an extra on top of the plan. */
  spotlight: SpotlightLevel;
  spotlightUntil: Date | null;
  createdAt: Date;
  kind: PartnerKind;
  /** Pending until a person approves the page; its page is public once approved. */
  status: PartnerShopStatus;
  plan: PartnerPlan;
  /** One of the first free-for-ever listings (ruling 65). */
  freeForever: boolean;
  /** The free first month of Partner Plus has been taken. */
  plusTrialUsed: boolean;
  /** When the shop agreed to the Shop Partner terms, and which version (30 October 2026). */
  termsAgreedAt: Date | null;
  termsVersion: string | null;
  source: PartnerShopSource;
  /** The entry in config/shops-seed.json this came from, if Ozi listed it. */
  seedKey: string | null;
  postcode: string;
  hours: string;
  contactName: string;
  /** Private: for codes and for us to ring. Never shown to anybody. */
  mobile: string;
  email: string;
  approvedAt: Date | null;
  /** A restaurant, café or takeaway's cuisines, from `browse.cuisines` (ruling 82). */
  cuisines: string[];
  /** A shop's specialities, from `browse.shopOrigins` (ruling 82). */
  specialities: string[];
  /** A service's categories, from `browse.serviceCategories` (ruling 82). */
  categories: string[];
  /** A shop that is a corner shop, convenience store or mini-market: listed under Convenience stores. */
  convenience: boolean;
  /** As the provider gave it, for a childminder (ruling 82). Shown, never checked by us. */
  ofstedNumber: string;
  /** The Ozi Ambassador who introduced it, if any (Anthony, 30 October 2026). */
  ambassadorKind: ReferralKind | null;
  ambassadorId: string | null;
  /** Another listing of the same business, marked by staff: each branch is its own venture. */
  branchOfShopId: string | null;
  /**
   * Signed up by an Ozi Ambassador with the owner present ("Sign up this business now", Anthony,
   * 30 October 2026): the reference on the printed Shop Partner agreement sheet, checked by staff
   * when they approve, the mark-up and discount agreed, proposed until staff confirm them, and the
   * name the owner typed when they agreed to the terms.
   */
  agreementReference: string | null;
  proposedMarkupPercent: number | null;
  proposedDiscountPercent: number | null;
  ownerAgreedName: string | null;
  /**
   * A restaurant's agreed discount for Ozi, a whole percentage, set by staff (Anthony, 30
   * October 2026): it sells to Ozi at its shop price less this. 0 for none, and for every shop
   * and service. At `restaurants.preferredDiscountPercent` or more it is an Ozi Preferred
   * Partner. Restaurants pay no commission. Since Anthony's final ruling (30 October 2026) a
   * grocery shop partner may have one too; never a service.
   */
  agreedDiscountPercent: number;
  /**
   * An agreed mark-up on the partner's prices, a whole percentage, set by staff (Anthony, 30
   * October 2026): Shoppers see and pay the shop price with this on it (50% makes £10 into £15).
   * 0 for none, at most `restaurants.maximumMarkupPercent`; never for a service.
   */
  agreedMarkupPercent: number;
  /**
   * Protections against Ambassadors misusing the name (Anthony, 31 October 2026): a business an
   * Ambassador signed up confirms with a code sent to its own phone before the Ambassador earns
   * anything from it; when the Ambassador's introduction was confirmed (the first confirmed claim
   * wins).
   */
  ambassadorConfirmNeeded: boolean;
  ambassadorConfirmedAt: Date | null;
  /**
   * "Were you promised anything that isn't in your agreement?", asked once about a week after a
   * business joins through an Ambassador: when the text went, the answer (yes, no, or not_asked
   * for a business that joined before the question) and the note, and when.
   */
  promiseTextSentAt: Date | null;
  promiseAnswer: 'yes' | 'no' | 'not_asked' | null;
  promiseNote: string | null;
  promiseAnsweredAt: Date | null;
  /** The welcome text with the payment warning, sent once to the business's own number. */
  welcomeTextSentAt: Date | null;
}

export type ServiceEnquiryKind = 'quote' | 'call_back';
export type ServiceEnquiryStatus = 'open' | 'answered' | 'closed';

/** A Shopper asking a service for a quote or a call back (ruling 65). No money moves through us. */
export interface ServiceEnquiry {
  id: string;
  partnerShopId: string;
  shopperId: string;
  productId: string | null;
  kind: ServiceEnquiryKind;
  message: string;
  /** How the Shopper chose to be reached, in their own words. Shown to the service only. */
  contact: string;
  status: ServiceEnquiryStatus;
  reply: string | null;
  createdAt: Date;
  answeredAt: Date | null;
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
  /** A service: how long it takes, in minutes. Its price is "from". */
  durationMinutes: number | null;
  /** The barcode, when the shop scanned one (ruling 75). */
  barcode: string | null;
  /**
   * The price was not on the label, so it is an estimate: shown to the shop and the owner as
   * "estimate, please check" until somebody sets it (ruling 75).
   */
  priceEstimated: boolean;
  /** The automatic check (ruling 74): when it last looked, and what it found when unsure. */
  checkedAt: Date | null;
  checkNote: string | null;
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
  /** The Stripe Checkout session that paid it, so it is recorded once only. */
  reference: string | null;
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
  kind:
    | 'order_paid'
    | 'order_delivered'
    | 'search'
    | 'search_unmet'
    | 'spotlight_mention'
    | 'checkout_viewed'
    | 'checkout_paid'
    | 'checkout_reason';
  shopperKey: string | null;
  runnerKey: string | null;
  shop: string | null;
  /** The Shop Partner's id, from 30 October 2026; older rows have only the shop's name. */
  partnerShopId?: string | null;
  area: string | null;
  toArea: string | null;
  ageBand: string | null;
  viaOrganisation: boolean;
  itemCount: number;
  goodsPence: number;
  categories: string;
  query: string | null;
  travelMode: string | null;
  /**
   * Checkout insights (Anthony, 30 October 2026), on checkout rows only: the breakdown shown
   * (goods in `goodsPence`, then these), a restaurant order or groceries, whether the no-Runner
   * warning was shown, a returning Shopper (one with an order before) or a new one, how they
   * ordered, and on a checkout_reason row the answer tapped. Never a card detail.
   */
  itemChargesPence?: number | null;
  feePence?: number | null;
  totalPence?: number | null;
  restaurant?: boolean | null;
  noRunnerWarning?: boolean | null;
  returning?: boolean | null;
  channel?: CheckoutChannel | null;
  answer?: CheckoutReason | null;
}

/** How a Shopper reached the checkout: the screen, Ozi by voice, or the telephone. */
export type CheckoutChannel = 'web' | 'voice' | 'phone';

/** The answers to "Can we ask what stopped you?" (Anthony, 30 October 2026). */
export const CHECKOUT_REASONS = ['price', 'looking', 'no_runner', 'other'] as const;
export type CheckoutReason = (typeof CHECKOUT_REASONS)[number];

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

/** A photo of the till receipt, kept with the order (STILL_TO_DO item 2). */
export interface ReceiptPhoto {
  id: string;
  orderId: string;
  data: Buffer;
  contentType: string;
  createdAt: Date;
}

/**
 * One price seen for one thing (20 October 2026, ruling 72): read off a till receipt, from the
 * open price database, or found by a web lookup. The catalogue's estimate follows the best of
 * these; the Shopper still pays the till price.
 */
export interface PriceSighting {
  id: string;
  catalogueItemId: string | null;
  /** The name as the source gave it. */
  name: string;
  /** For one of the thing, in pence. */
  pricePence: number;
  /** The shop it was seen at, when the source says. */
  shop: string | null;
  source: 'receipt' | 'open_prices' | 'web';
  orderId: string | null;
  barcode: string | null;
  seenAt: Date;
}

/** What a Shopper said after a delivery (Section O), and the credit it earned. */
export interface ShopperFeedback {
  id: string;
  orderId: string;
  rating: number | null;
  /** The themes picked, comma separated. */
  themes: string;
  message: string;
  creditPence: number;
  createdAt: Date;
}
/**
 * One line of the admin panel's audit log (Section Q): who did what, to what, when, and from
 * which internet address. Only ever added to; never changed, never removed.
 */
export interface AuditEntry {
  id: string;
  at: Date;
  /** The staff account, or null for the staff key. */
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

/**
 * One exchange with Ozi (17 October 2026, ruling 68): what was heard, what Ozi said back, which
 * part of Ozi answered, how it went, and a person's verdict. Ozi's memory, on every channel, is
 * what people judge in the admin panel and what a language model learns from later.
 */
export interface OziExchange {
  id: string;
  at: Date;
  /** The app or website, the telephone line, or a text message. */
  channel: 'app' | 'phone' | 'text';
  /** Whose Ozi: shopper, runner, partner, organisation, staff, family, investor, owner. */
  account: string;
  /** A one-way code for the conversation (one call, one visit), never a number or a name. */
  conversationKey: string;
  turn: number;
  /** What the person said, with numbers, emails, postcodes and codes blanked. Empty when Ozi spoke first. */
  heard: string;
  /** What Ozi said back. */
  said: string;
  /** Which part answered: phrases, learned, small-talk, shops, shopping, flow, or none. */
  brain: string;
  /** How it went: answered, unanswered, added, not-found, asked, sent, stopped, refused, ended. */
  outcome: string;
  verdict: 'unrated' | 'right' | 'wrong';
  /** What Ozi should have said, written by a person. */
  betterReply: string | null;
  ratedBy: string | null;
  ratedAt: Date | null;
}

/**
 * A Shopper's review of a Shop Partner after a delivered order (ruling 70). One per order per
 * shop. The points wait seven days, then are earned, or are void if the order was refunded.
 * Shops and the public only ever see counts and averages, never who said what.
 */
export interface ShopReview {
  id: string;
  orderId: string;
  shopperId: string;
  partnerShopId: string;
  /** 1 to 5. */
  stars: number;
  message: string;
  /** The same for one star as for five. */
  points: number;
  status: 'pending' | 'earned' | 'void';
  earnedAt: Date | null;
  createdAt: Date;
}

/** Review points turned into delivery credit, whole hundreds at a time (ruling 70). */
export interface ReviewPointsSpend {
  id: string;
  shopperId: string;
  points: number;
  pence: number;
  createdAt: Date;
}

/**
 * Something that needs the owner (ruling 74, Ozi's desk): Ozi rings him about it and he decides
 * with the keypad, or in the admin panel. One sentence or two, said aloud: never a card number,
 * never a customer's telephone number.
 */
export type OwnerMatterKind =
  | 'sos'
  | 'runner_document'
  | 'runner_application'
  | 'partner_product'
  | 'partner_shop'
  | 'organisation_enquiry'
  | 'problem'
  | 'shopper_feedback'
  | 'pay_back'
  | 'till_case'
  | 'bank_transfer'
  | 'waiting_order'
  | 'find_it'
  | 'email'
  /** An account replied to a message from the company (ruling 77): to hear. */
  | 'account_message'
  /** A staff member asks to send a message without a code (ruling 77): to approve or decline. */
  | 'message_approval'
  /** The day's booked orders, in one summary each morning (ruling 78): to hear. */
  | 'scheduled_today'
  /** A booked order's payment on its chosen day could not be taken (ruling 78): to hear. */
  | 'scheduled_payment'
  /** A job the office sent to a Runner came back: declined or run out (ruling 80): to hear. */
  | 'allocation_returned'
  /** Somebody reached a referral reward level (Anthony, 30 October 2026): to hear, once. */
  | 'referral_level'
  /** An Ambassador's month is over the review figure: to check before paying, once a month. */
  | 'ambassador_review'
  /** An Ambassador applicant's document the automatic check could not approve: to decide. */
  | 'ambassador_document'
  /** Somebody's Ambassador application has its documents in (30 October 2026): to hear. */
  | 'ambassador_application'
  /** Somebody reported an Ambassador (31 October 2026): from the check page or a business. */
  | 'ambassador_report'
  /** A business said it was promised something not in its agreement (31 October 2026). */
  | 'ambassador_promise'
  /** An Ambassador's share was held: the Shopper matched the Ambassador or the owner. */
  | 'ambassador_share_held';

/** Approve, decline or later; or only "I have heard it", or later. */
export type OwnerMatterOptions = 'decide' | 'acknowledge';
export type OwnerMatterStatus = 'open' | 'later' | 'decided' | 'handled';
export type OwnerMatterDecision = 'approve' | 'decline' | 'acknowledge' | 'settled';
/** By the keypad on Ozi's call, in the admin panel, or by itself (dealt with elsewhere). */
/** How a matter was decided: on the phone's keypad, in the admin panel, on Ozi's call in the app (ruling 79), or by itself. */
export type OwnerMatterVia = 'phone' | 'panel' | 'app' | 'automatic';

export interface OwnerMatter {
  id: string;
  kind: OwnerMatterKind;
  /** The thing it is about: a document, a product, a shop, a report, an order, a Runner. */
  subjectId: string;
  summary: string;
  options: OwnerMatterOptions;
  /** An SOS or another safety matter: rung about even in quiet hours. */
  urgent: boolean;
  status: OwnerMatterStatus;
  decision: OwnerMatterDecision | null;
  decidedVia: OwnerMatterVia | null;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  /** Put to later: when it comes back (the next day's first call). */
  laterUntil: Date | null;
  /** How many calls it has been part of, the last one, and when it was last read out. */
  callAttempts: number;
  lastCalledAt: Date | null;
  lastReadAt: Date | null;
  /**
   * For an email (ruling 76): who it is from and its subject, shown on the "Needs you now" page.
   * Never read aloud as they are: the summary says who it is from without the address.
   */
  emailFrom: string | null;
  emailSubject: string | null;
}

/** What an email to the business mailbox was sorted as (ruling 76). */
export type EmailCategory =
  | 'important_decision'
  | 'complaint'
  | 'partner_or_organisation'
  | 'runner'
  | 'customer_question'
  | 'invoice_or_bill'
  | 'legal_or_official'
  | 'spam_or_marketing'
  | 'newsletter'
  | 'automated_notification'
  | 'other';

/**
 * One email read from the business mailbox (ruling 76), kept so nothing is read twice. Only the
 * sender's domain is kept, never the address, the subject or the words.
 */
export interface EmailRecord {
  id: string;
  /** The email's Message-ID, or, for one without, a fingerprint of its sender, subject and date. */
  messageId: string;
  fromDomain: string;
  category: EmailCategory;
  important: boolean;
  /** The matter on Ozi's desk it became, if any. */
  matterId: string | null;
  /** Whether it was answered automatically. */
  replied: boolean;
  processedAt: Date;
}

/** One call Ozi placed to the owner: which cascade, which call of it, and how it went. */
export interface OwnerCall {
  id: string;
  cascade: number;
  attempt: number;
  placedAt: Date;
  /**
   * app_ringing (ringing in the app first, ruling 79), placed (the phone ringing), answered (a
   * person, in the app or on the phone), unanswered, voicemail or failed.
   */
  status: 'app_ringing' | 'placed' | 'answered' | 'unanswered' | 'voicemail' | 'failed';
  answeredAt: Date | null;
  endedAt: Date | null;
  matterCount: number;
  /** Until when it rings in the app before the phone (ruling 79); null when it went straight to the phone. */
  appRingUntil: Date | null;
  /** When the phone was rung for this attempt; null while it rings only in the app. */
  phonePlacedAt: Date | null;
  /** Where he answered: in the app or on the phone. */
  answeredVia: 'app' | 'phone' | null;
  /** A test call from My settings ("Test Ozi's call"): never counted in the rounds of calls. */
  test: boolean;
}

/* ------------------------------------------------------------------ the company inbox (ruling 77) */

/** Who the company talks to: every kind of account, never one account to another. */
export type InboxAccountKind = 'shopper' | 'runner' | 'partner' | 'organisation';

/** One conversation between the company and one account. */
export interface InboxThread {
  id: string;
  accountKind: InboxAccountKind;
  /** The Shopper, the Runner, the partner shop or the organisation. */
  accountId: string;
  createdAt: Date;
  lastMessageAt: Date;
}

/** Sent; held waiting for the owner's approval on Ozi's desk; or declined there. */
export type InboxMessageStatus = 'sent' | 'held' | 'declined';

/**
 * What let a staff message be sent, or a staff call be made: the sender is the owner or an
 * authoriser (`self`), a code issued for them (`code`), or the owner's approval on Ozi's desk.
 */
export type ContactAuthorisation = 'self' | 'code' | 'desk';

export interface InboxMessage {
  id: string;
  threadId: string;
  /** From the company (a staff member) or from the account. */
  fromStaff: boolean;
  /** The staff member who wrote it; null for the account's own replies. */
  staffId: string | null;
  /** The staff member's name, or the name of the person on the account who wrote it. */
  senderName: string;
  text: string;
  createdAt: Date;
  /** When it reached the other side; null while held. */
  sentAt: Date | null;
  /** When the other side read it. */
  readAt: Date | null;
  status: InboxMessageStatus;
  /** For a staff message: what authorised it, and whose code or approval it was. */
  authorisedBy: ContactAuthorisation | null;
  authorisedByName: string | null;
}

/** A message code (single use, two hours) or a daily call code (until midnight, UK time). */
export type StaffCodeKind = 'message' | 'call';

/** A code issued to one staff member. Only its hash is kept, never the code. */
export interface StaffCode {
  id: string;
  kind: StaffCodeKind;
  staffId: string;
  codeHash: string;
  issuedById: string | null;
  issuedByName: string;
  createdAt: Date;
  expiresAt: Date;
  /** A message code: when it was used up. A call code: when it was entered, for the day. */
  usedAt: Date | null;
}

export type StaffCallStatus = 'ringing' | 'live' | 'ended';

/**
 * What became of a staff call's recording: none yet, recording, saved, not recorded (no storage,
 * or not answered), failed, or deleted after the days the privacy page says.
 */
export type RecordingStatus =
  'none' | 'recording' | 'saved' | 'not_recorded' | 'failed' | 'deleted';

/** A call from the company to an account, in the app or to their phone (ruling 77). */
export interface StaffCall {
  id: string;
  roomName: string;
  staffId: string | null;
  staffName: string;
  accountKind: InboxAccountKind;
  accountId: string;
  /** The account's name, as staff already see it. Never a number. */
  accountName: string;
  authorisedBy: ContactAuthorisation;
  authorisedByName: string | null;
  status: StaffCallStatus;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
  /** Rung on their phone through LiveKit SIP, from the company's number. */
  phoneRung: boolean;
  recordingStatus: RecordingStatus;
  /** Where the recording is in storage. Never shown; played through a short-lived link. */
  recordingKey: string | null;
  egressId: string | null;
  /** Why there is no recording, in words: "not recorded: recording storage not set up". */
  recordingNote: string | null;
}

/**
 * A postcode's place, looked up once with postcodes.io and kept (Anthony, 30 October 2026).
 * `found` false: it was not known, or postcodes.io could not be reached, and the place is unknown.
 */
export interface PostcodePlace {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  found: boolean;
  lookedUpAt: Date;
}

/** An area's own record: paused by staff, and when it first started (30 October 2026). */
export interface AreaRecord {
  area: string;
  pausedAt: Date | null;
  pausedBy: string | null;
  /**
   * When it first had an approved Runner, which is when the Shoppers warned there was none were
   * texted (30 October 2026; every area is open, so it no longer means it began taking orders).
   */
  startedAt: Date | null;
}

/**
 * A Shopper warned, as they ordered, that their area had no Runner yet (30 October 2026), texted
 * once when one joins. The table kept its first name, the waiting list.
 */
export interface AreaWaiting {
  id: string;
  area: string;
  shopperId: string;
  postcode: string;
  createdAt: Date;
  textedAt: Date | null;
}
