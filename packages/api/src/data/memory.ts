/**
 * An in-memory implementation of the repository.
 *
 * Two jobs. It lets the whole test suite prove the rules without a database, and it lets
 * the API start on a machine that has no PostgreSQL yet, so the shell can be walked through
 * end to end on day one. It is not a production backend and says so at startup.
 */

import { randomUUID } from 'node:crypto';

import { newReferralCode } from '../lib/referral.js';
import { erasedOrderPatch, erasedRunnerPatch, erasedShopperPatch } from './erasure.js';

import type { OrderStatus } from '@aldilivery/core';

import type {
  CardAuthorization,
  AccountRole,
  AuditEntry,
  IncomeRecord,
  LearnedPhrase,
  AnalyticsEvent,
  PartnerPayment,
  SpotlightMention,
  BusinessUser,
  PartnerProduct,
  PartnerShop,
  ServiceEnquiry,
  StaffMember,
  FindRequest,
  GiftCard,
  OrganisationEnquiry,
  CatalogueItem,
  HouseholdCircle,
  HouseholdCircleMember,
  ItemQuestion,
  JobOffer,
  JobOfferOutcome,
  OneTimeCode,
  Order,
  OrderItem,
  Organisation,
  PaymentMethod,
  PushSubscription,
  SavedAddress,
  Call,
  CallLeg,
  RunnerDocument,
  RunnerFeedback,
  ProblemReport,
  ProblemEvidence,
  RunnerRecovery,
  ReceiptPhoto,
  RecurringSet,
  Runner,
  RunnerCheck,
  RunnerPayout,
  RunnerSos,
  ReferralReward,
  SetItem,
  Shopper,
  ShopperFeedback,
  OziExchange,
  EmailRecord,
  OwnerCall,
  OwnerMatter,
  PriceSighting,
  ReviewPointsSpend,
  ShopReview,
  InboxMessage,
  InboxThread,
  StaffCall,
  StaffCode,
} from '../domain.js';
import type {
  CatalogueSearchOptions,
  CreateCatalogueItem,
  CreateJobOffer,
  CreateOneTimeCode,
  CreateOrder,
  CreateOrganisation,
  CreatePaymentMethod,
  CreateRecurringSet,
  CreateRunner,
  CreateRunnerPayout,
  CreateShopper,
  Repository,
} from './repository.js';

const id = (): string => randomUUID();

function clone<T>(value: T): T {
  return structuredClone(value);
}

class NotFoundError extends Error {
  constructor(what: string, key: string) {
    super(`${what} ${key} was not found.`);
    this.name = 'NotFoundError';
  }
}

/**
 * Everything in memory, for the tests and for a server with no database. The clock is the
 * application's own (`options.now`), so a test that moves time forward sees orders made "then",
 * not stamped with the wall clock while the rest of the application believes another day.
 */
export function memoryRepository(options: { now?: () => Date } = {}): Repository {
  const shoppers = new Map<string, Shopper>();
  const runners = new Map<string, Runner>();
  const organisations = new Map<string, Organisation>();
  const circles = new Map<string, HouseholdCircle>();
  const circleMembers = new Map<string, HouseholdCircleMember>();
  const catalogue = new Map<string, CatalogueItem>();
  const paymentMethods = new Map<string, PaymentMethod>();
  const orders = new Map<string, Order>();
  const offers = new Map<string, JobOffer>();
  const payouts = new Map<string, RunnerPayout>();
  const sets = new Map<string, RecurringSet>();
  const oneTimeCodes = new Map<string, OneTimeCode>();
  const runnerChecks: RunnerCheck[] = [];
  const itemQuestions = new Map<string, ItemQuestion>();
  const pushSubscriptions = new Map<string, PushSubscription>();
  const savedAddresses = new Map<string, SavedAddress>();
  const calls = new Map<string, Call>();
  const runnerDocuments = new Map<string, RunnerDocument>();
  const runnerFeedback: RunnerFeedback[] = [];
  const problems = new Map<string, ProblemReport>();
  const problemEvidence = new Map<string, ProblemEvidence>();
  const recoveries = new Map<string, RunnerRecovery>();
  const callLegs = new Map<string, CallLeg>();
  const findRequests = new Map<string, FindRequest>();
  const giftCards = new Map<string, GiftCard>();
  const enquiries = new Map<string, OrganisationEnquiry>();
  const staffMembers = new Map<string, StaffMember>();
  const partnerShops = new Map<string, PartnerShop>();
  const partnerProducts = new Map<string, PartnerProduct>();
  const businessUsers = new Map<string, BusinessUser>();
  const partnerPayments: PartnerPayment[] = [];
  const serviceEnquiries = new Map<string, ServiceEnquiry>();
  const spotlightMentions: SpotlightMention[] = [];
  const analyticsEvents: AnalyticsEvent[] = [];
  const incomeRecords: IncomeRecord[] = [];
  const learned: LearnedPhrase[] = [];
  const exchanges: OziExchange[] = [];
  const receiptPhotos = new Map<string, ReceiptPhoto>();
  const sightings: PriceSighting[] = [];
  const shopperFeedback = new Map<string, ShopperFeedback>();
  const shopReviews: ShopReview[] = [];
  const reviewPointsSpends: ReviewPointsSpend[] = [];
  const sosAlerts = new Map<string, RunnerSos>();
  const referralRewards: ReferralReward[] = [];
  const auditEntries: AuditEntry[] = [];
  const cardAuthorizations = new Map<string, CardAuthorization>();
  const ownerMatters = new Map<string, OwnerMatter>();
  const ownerCalls = new Map<string, OwnerCall>();
  const emailRecords = new Map<string, EmailRecord>();
  const inboxThreads = new Map<string, InboxThread>();
  const inboxMessages = new Map<string, InboxMessage>();
  const staffCodes = new Map<string, StaffCode>();
  const staffCalls = new Map<string, StaffCall>();

  /** The account's thread and its messages go with the account (ruling 77). */
  const dropThread = (accountKind: InboxThread['accountKind'], accountId: string): number => {
    let removed = 0;
    for (const [key, thread] of inboxThreads) {
      if (thread.accountKind !== accountKind || thread.accountId !== accountId) continue;
      for (const [messageKey, message] of inboxMessages) {
        if (message.threadId === key) {
          inboxMessages.delete(messageKey);
          removed += 1;
        }
      }
      inboxThreads.delete(key);
    }
    return removed;
  };
  /** A closed account's calls stay in the log, without its name. */
  const forgetCallNames = (accountKind: InboxThread['accountKind'], accountId: string): void => {
    for (const [key, call] of staffCalls) {
      if (call.accountKind === accountKind && call.accountId === accountId) {
        staffCalls.set(key, { ...call, accountName: 'Closed account' });
      }
    }
  };

  const now = (): Date => options.now?.() ?? new Date();

  return {
    shoppers: {
      async create(input: CreateShopper): Promise<Shopper> {
        const shopper: Shopper = {
          id: id(),
          displayName: input.displayName,
          handle: input.handle,
          phone: input.phone,
          spokenCodeHash: input.spokenCodeHash ?? null,
          preferredLanguage: input.preferredLanguage ?? 'en-GB',
          doorstepProtocol: input.doorstepProtocol ?? '',
          deliveryAddress: input.deliveryAddress ?? '',
          substitutionDefault: input.substitutionDefault ?? 'ask_me',
          budgetCapPence: input.budgetCapPence ?? null,
          pinHash: null,
          stripeCustomerId: null,
          recipePassUntil: null,
          plan: null,
          planUntil: null,
          planRenews: false,
          planStartedAt: null,
          planCancelledAt: null,
          freeMonthUntil: input.freeMonthUntil ?? null,
          freeMonthReminderSentAt: null,
          checkInSentAt: null,
          approvalLimitPence: null,
          weeklySummarySentAt: null,
          familyCode: null,
          familyOwnerId: null,
          creditPence: 0,
          unusedRunnerFeeCreditPence: 0,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          deletionScheduledFor: null,
          erasedAt: null,
          isDemo: input.isDemo ?? false,
          organisationId: input.organisationId ?? null,
          organisationOffice: null,
          ageBand: null,
          joinedVia: null,
          createdAt: now(),
          updatedAt: now(),
        };
        shoppers.set(shopper.id, shopper);
        return clone(shopper);
      },
      async findById(key) {
        const found = shoppers.get(key);
        return found ? clone(found) : null;
      },
      async findByFamilyCode(code) {
        for (const shopper of shoppers.values()) {
          if (shopper.familyCode === code) return clone(shopper);
        }
        return null;
      },
      async count() {
        return shoppers.size;
      },
      async listReferred() {
        return [...shoppers.values()]
          .filter((shopper) => /^(shopper|runner):/.test(shopper.joinedVia ?? ''))
          .map(clone);
      },
      async countJoinedVia(via) {
        return [...shoppers.values()].filter((shopper) => shopper.joinedVia === via).length;
      },
      async listPlansDue(at) {
        return [...shoppers.values()]
          .filter(
            (shopper) =>
              shopper.erasedAt === null &&
              shopper.plan !== null &&
              shopper.planRenews &&
              shopper.familyOwnerId === null &&
              shopper.planUntil !== null &&
              shopper.planUntil.getTime() <= at.getTime(),
          )
          .map(clone);
      },
      async listFreeMonthEnding(from, to) {
        return [...shoppers.values()]
          .filter(
            (shopper) =>
              shopper.erasedAt === null &&
              shopper.freeMonthReminderSentAt === null &&
              shopper.freeMonthUntil !== null &&
              shopper.freeMonthUntil.getTime() > from.getTime() &&
              shopper.freeMonthUntil.getTime() <= to.getTime(),
          )
          .map(clone);
      },
      async listOnPlan(at) {
        return [...shoppers.values()]
          .filter(
            (shopper) =>
              shopper.erasedAt === null &&
              shopper.plan !== null &&
              shopper.planUntil !== null &&
              shopper.planUntil.getTime() > at.getTime(),
          )
          .map(clone);
      },
      async listFamily(ownerId) {
        return [...shoppers.values()]
          .filter((shopper) => shopper.familyOwnerId === ownerId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async findByPhone(phone) {
        for (const shopper of shoppers.values()) {
          if (shopper.phone === phone) return clone(shopper);
        }
        return null;
      },
      async listDueForErasure(at) {
        return [...shoppers.values()]
          .filter(
            (shopper) =>
              shopper.erasedAt === null &&
              shopper.deletionScheduledFor !== null &&
              shopper.deletionScheduledFor.getTime() <= at.getTime(),
          )
          .map(clone);
      },
      async findByHandle(handle) {
        for (const shopper of shoppers.values()) {
          if (shopper.handle.toLowerCase() === handle.toLowerCase()) return clone(shopper);
        }
        return null;
      },
      async update(key, patch) {
        const existing = shoppers.get(key);
        if (!existing) throw new NotFoundError('Shopper', key);
        const updated = { ...existing, ...patch, id: existing.id, updatedAt: now() };
        shoppers.set(key, updated);
        return clone(updated);
      },
    },

    runners: {
      async create(input: CreateRunner): Promise<Runner> {
        const runner: Runner = {
          id: id(),
          name: input.name,
          phone: input.phone,
          vehicleType: input.vehicleType ?? 'on_foot',
          travelModes: input.travelModes ?? [input.vehicleType ?? 'on_foot'],
          referralCode: input.referralCode ?? newReferralCode('R'),
          referredBy: input.referredBy ?? null,
          drivingLicenceVerified: false,
          motorInsuranceUntil: null,
          rightToWorkVerified: input.rightToWorkVerified ?? false,
          criminalRecordCheckVerified: input.criminalRecordCheckVerified ?? false,
          stripeConnectedAccountId: input.stripeConnectedAccountId ?? null,
          coolBagDepositStatus: 'not_started',
          coolBagWithheldPence: 0,
          completedDeliveryCount: 0,
          available: input.available ?? false,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          lastJobCompletedAt: null,
          agreementAcceptedAt: input.agreementAcceptedAt ?? null,
          agreementVersion: input.agreementVersion ?? null,
          agreementChannel: input.agreementChannel ?? null,
          payoutSchedule: 'weekly',
          leftAt: null,
          leftReason: null,
          leftBy: null,
          erasedAt: null,
          isDemo: input.isDemo ?? false,
          coolBagRefundedPence: null,
          coolBagRefundedAt: null,
          coolBagRefundTransferId: null,
          coolBagRefundNote: null,
          insuranceReminderFor: null,
          insuranceReminderDays: null,
          payMethod: 'own',
          issuingCardholderId: null,
          issuingCardId: null,
          cardLast4: null,
          cardStatus: null,
          issuingTermsAcceptedAt: null,
          issuingTermsAcceptedIp: null,
          faceMatchConsentAt: null,
          createdAt: now(),
          updatedAt: now(),
        };
        runners.set(runner.id, runner);
        return clone(runner);
      },
      async findById(key) {
        const found = runners.get(key);
        return found ? clone(found) : null;
      },
      async findByPhone(phone) {
        for (const runner of runners.values()) {
          if (runner.phone === phone) return clone(runner);
        }
        return null;
      },
      async findByReferralCode(code) {
        for (const runner of runners.values()) {
          if (runner.referralCode === code) return clone(runner);
        }
        return null;
      },
      async update(key, patch) {
        const existing = runners.get(key);
        if (!existing) throw new NotFoundError('Runner', key);
        const updated = { ...existing, ...patch, id: existing.id, updatedAt: now() };
        runners.set(key, updated);
        return clone(updated);
      },
      async listAvailable() {
        return [...runners.values()].filter((r) => r.available).map(clone);
      },
      async delete(key) {
        runners.delete(key);
        for (const [offerId, offer] of offers) if (offer.runnerId === key) offers.delete(offerId);
        for (let i = runnerChecks.length - 1; i >= 0; i -= 1) {
          if (runnerChecks[i]!.runnerId === key) runnerChecks.splice(i, 1);
        }
      },
      async listAll() {
        return [...runners.values()]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async findByIssuingCardId(cardId) {
        for (const runner of runners.values()) {
          if (runner.issuingCardId === cardId) return clone(runner);
        }
        return null;
      },
      async listWithCards() {
        return [...runners.values()]
          .filter((runner) => runner.issuingCardId !== null)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    cardAuthorizations: {
      async upsert(input) {
        const existing = cardAuthorizations.get(input.stripeId);
        const row: CardAuthorization = { ...input, id: existing?.id ?? id() };
        cardAuthorizations.set(input.stripeId, row);
        return clone(row);
      },
      async findByStripeId(stripeId) {
        const found = cardAuthorizations.get(stripeId);
        return found ? clone(found) : null;
      },
      async listForOrder(orderId) {
        return [...cardAuthorizations.values()]
          .filter((row) => row.orderId === orderId)
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map(clone);
      },
      async listRecent(where) {
        return [...cardAuthorizations.values()]
          .filter((row) => !where.declinedOnly || !row.approved)
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, where.limit)
          .map(clone);
      },
    },

    savedAddresses: {
      async create(input) {
        const row: SavedAddress = { ...input, id: id() };
        savedAddresses.set(row.id, row);
        return clone(row);
      },
      async listForShopper(shopperId) {
        return [...savedAddresses.values()]
          .filter((row) => row.shopperId === shopperId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async findById(key) {
        const found = savedAddresses.get(key);
        return found ? clone(found) : null;
      },
      async delete(key) {
        savedAddresses.delete(key);
      },
    },

    runnerDocuments: {
      async create(input) {
        const row: RunnerDocument = {
          checkedAt: null,
          checkPassed: null,
          checkNote: null,
          checkName: null,
          ...input,
          id: id(),
        };
        runnerDocuments.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = runnerDocuments.get(key);
        return found ? clone(found) : null;
      },
      async listForRunner(runnerId) {
        return [...runnerDocuments.values()]
          .filter((row) => row.runnerId === runnerId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listSubmitted() {
        return [...runnerDocuments.values()]
          .filter((row) => row.status === 'submitted')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const found = runnerDocuments.get(key);
        if (!found) throw new Error(`No document ${key}`);
        const row = { ...found, ...patch };
        runnerDocuments.set(key, row);
        return clone(row);
      },
    },

    sos: {
      async create(input) {
        const row: RunnerSos = { ...input, id: id() };
        sosAlerts.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = sosAlerts.get(key);
        return found ? clone(found) : null;
      },
      async findByLinkCodeHash(hash) {
        for (const row of sosAlerts.values()) if (row.linkCodeHash === hash) return clone(row);
        return null;
      },
      async findActiveForRunner(runnerId) {
        const active = [...sosAlerts.values()]
          .filter((row) => row.runnerId === runnerId && row.endedAt === null)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return active[0] ? clone(active[0]) : null;
      },
      async listSince(since) {
        return [...sosAlerts.values()]
          .filter((row) => row.endedAt === null || row.startedAt >= since)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = sosAlerts.get(key);
        if (!existing) throw new NotFoundError('SOS', key);
        const updated = { ...existing, ...patch, id: existing.id };
        sosAlerts.set(key, updated);
        return clone(updated);
      },
    },

    referralRewards: {
      async create(input) {
        const row: ReferralReward = { ...input, id: id() };
        referralRewards.push(row);
        return clone(row);
      },
      async list() {
        return referralRewards.map(clone);
      },
    },

    runnerFeedback: {
      async create(input) {
        const row: RunnerFeedback = { ...input, id: id() };
        runnerFeedback.push(row);
        return clone(row);
      },
      async list() {
        return [...runnerFeedback].reverse().map(clone);
      },
    },

    problems: {
      async create(input) {
        const row: ProblemReport = { ...input, id: id() };
        problems.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = problems.get(key);
        return found ? clone(found) : null;
      },
      async listForOrder(orderId) {
        return [...problems.values()]
          .filter((row) => row.orderId === orderId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listOpen() {
        return [...problems.values()]
          .filter((row) => row.status === 'open')
          .sort((a, b) => a.decideBy.getTime() - b.decideBy.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const found = problems.get(key);
        if (!found) throw new Error(`No problem report ${key}`);
        const row = { ...found, ...patch };
        problems.set(key, row);
        return clone(row);
      },
    },

    problemEvidence: {
      async create(input) {
        const row: ProblemEvidence = { ...input, id: id() };
        problemEvidence.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = problemEvidence.get(key);
        return found ? clone(found) : null;
      },
      async listForReport(reportId) {
        return [...problemEvidence.values()]
          .filter((row) => row.reportId === reportId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    recoveries: {
      async create(input) {
        const row: RunnerRecovery = { ...input, id: id() };
        recoveries.set(row.id, row);
        return clone(row);
      },
      async listOutstanding(runnerId) {
        return [...recoveries.values()]
          .filter(
            (row) =>
              row.runnerId === runnerId && !row.writtenOff && row.recoveredPence < row.amountPence,
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async listAllOutstanding() {
        return [...recoveries.values()]
          .filter((row) => !row.writtenOff && row.recoveredPence < row.amountPence)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const found = recoveries.get(key);
        if (!found) throw new Error(`No recovery ${key}`);
        const row = { ...found, ...patch };
        recoveries.set(key, row);
        return clone(row);
      },
    },

    calls: {
      async create(input) {
        const row: Call = { ...input, id: id() };
        calls.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = calls.get(key);
        return found ? clone(found) : null;
      },
      async findByRoomName(roomName) {
        const found = [...calls.values()].find((row) => row.roomName === roomName);
        return found ? clone(found) : null;
      },
      async findOpenForOrder(orderId) {
        const found = [...calls.values()].find(
          (row) => row.orderId === orderId && row.status !== 'ended',
        );
        return found ? clone(found) : null;
      },
      async listChargesDue(shopperId) {
        return [...calls.values()]
          .filter(
            (row) =>
              row.shopperId === shopperId &&
              (row.chargeStatus === 'outstanding' || row.chargeStatus === 'pending') &&
              row.status === 'ended',
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const found = calls.get(key);
        if (!found) throw new Error(`No call ${key}`);
        const row = { ...found, ...patch };
        calls.set(key, row);
        return clone(row);
      },
    },

    callLegs: {
      async create(input) {
        const row: CallLeg = { ...input, id: id() };
        callLegs.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = callLegs.get(key);
        return found ? clone(found) : null;
      },
      async listForCall(callId) {
        return [...callLegs.values()]
          .filter((row) => row.callId === callId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async findByInviteCodeHash(hash) {
        const found = [...callLegs.values()].find((row) => row.inviteCodeHash === hash);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const found = callLegs.get(key);
        if (!found) throw new Error(`No call leg ${key}`);
        const row = { ...found, ...patch };
        callLegs.set(key, row);
        return clone(row);
      },
    },

    pushSubscriptions: {
      async save(input) {
        const existing = pushSubscriptions.get(input.endpoint);
        const row: PushSubscription = { ...input, id: existing?.id ?? id() };
        pushSubscriptions.set(input.endpoint, row);
        return clone(row);
      },
      async listForShopper(shopperId) {
        return [...pushSubscriptions.values()]
          .filter((row) => row.shopperId === shopperId)
          .map(clone);
      },
      async deleteByEndpoint(endpoint) {
        pushSubscriptions.delete(endpoint);
      },
    },

    itemQuestions: {
      async create(input) {
        const question: ItemQuestion = {
          ...input,
          id: id(),
          answer: null,
          answeredBy: null,
          answeredAt: null,
        };
        itemQuestions.set(question.id, question);
        return clone(question);
      },
      async findById(key) {
        const found = itemQuestions.get(key);
        return found ? clone(found) : null;
      },
      async listForOrder(orderId) {
        return [...itemQuestions.values()]
          .filter((q) => q.orderId === orderId)
          .sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = itemQuestions.get(key);
        if (!existing) throw new NotFoundError('Question', key);
        const updated = { ...existing, ...patch, id: existing.id };
        itemQuestions.set(key, updated);
        return clone(updated);
      },
    },

    runnerChecks: {
      async create(input) {
        const check: RunnerCheck = { ...input, id: id() };
        runnerChecks.push(check);
        return clone(check);
      },
      async listForRunner(runnerId) {
        return runnerChecks.filter((c) => c.runnerId === runnerId).map(clone);
      },
    },

    organisations: {
      async create(input: CreateOrganisation): Promise<Organisation> {
        const organisation: Organisation = {
          id: id(),
          name: input.name,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone ?? null,
          invoiceTerms: input.invoiceTerms ?? '',
          active: true,
          joinCode: null,
          monthlyBudgetPence: null,
          staffTripCostPence: null,
          createdAt: now(),
          updatedAt: now(),
        };
        organisations.set(organisation.id, organisation);
        return clone(organisation);
      },
      async findById(key) {
        const found = organisations.get(key);
        return found ? clone(found) : null;
      },
      async listServiceUsers(organisationId) {
        return [...shoppers.values()].filter((s) => s.organisationId === organisationId).map(clone);
      },
      async findByJoinCode(code) {
        for (const row of organisations.values()) {
          if (row.joinCode === code) return clone(row);
        }
        return null;
      },
      async list() {
        return [...organisations.values()]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = organisations.get(key);
        if (!existing) throw new NotFoundError('Organisation', key);
        const updated = { ...existing, ...patch, id: existing.id, updatedAt: now() };
        organisations.set(key, updated);
        return clone(updated);
      },
    },

    circles: {
      async create(name) {
        const circle: HouseholdCircle = { id: id(), name, createdAt: now(), updatedAt: now() };
        circles.set(circle.id, circle);
        return clone(circle);
      },
      async addMember(circleId, shopperId, consent) {
        const member: HouseholdCircleMember = {
          id: id(),
          circleId,
          shopperId,
          consentGivenAt: consent.consentGivenAt,
          consentMethod: consent.consentMethod,
          consentRecordedBy: consent.consentRecordedBy,
          canOrderForOthers: consent.canOrderForOthers,
          createdAt: now(),
        };
        circleMembers.set(member.id, member);
        return clone(member);
      },
      async listMembers(circleId) {
        return [...circleMembers.values()].filter((m) => m.circleId === circleId).map(clone);
      },
    },

    catalogue: {
      async create(input: CreateCatalogueItem): Promise<CatalogueItem> {
        const item: CatalogueItem = {
          id: id(),
          name: input.name,
          category: input.category,
          estimatedPricePence: input.estimatedPricePence,
          ageRestricted: input.ageRestricted ?? false,
          source: input.source,
          externalRef: input.externalRef ?? null,
          lastSeenAt: input.lastSeenAt ?? now(),
          retired: false,
          createdAt: now(),
          updatedAt: now(),
        };
        catalogue.set(item.id, item);
        return clone(item);
      },
      async findById(key) {
        const found = catalogue.get(key);
        return found ? clone(found) : null;
      },
      async findManyByIds(ids) {
        return ids
          .map((key) => catalogue.get(key))
          .filter((item): item is CatalogueItem => item !== undefined)
          .map(clone);
      },
      async search(query, options: CatalogueSearchOptions = {}) {
        const needle = query.trim().toLowerCase();
        return [...catalogue.values()]
          .filter((item) => {
            if (!options.includeAgeRestricted && item.ageRestricted) return false;
            if (item.retired) return false;
            if (options.category && item.category !== options.category) return false;
            if (needle === '') return true;
            return (
              item.name.toLowerCase().includes(needle) ||
              item.category.toLowerCase().includes(needle)
            );
          })
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, options.limit ?? 50)
          .map(clone);
      },
      async update(key, patch) {
        const existing = catalogue.get(key);
        if (!existing) throw new NotFoundError('Catalogue item', key);
        const updated = { ...existing, ...patch, id: existing.id, updatedAt: now() };
        catalogue.set(key, updated);
        return clone(updated);
      },
    },

    paymentMethods: {
      async create(input: CreatePaymentMethod): Promise<PaymentMethod> {
        const method: PaymentMethod = {
          id: id(),
          shopperId: input.shopperId,
          stripePaymentMethodId: input.stripePaymentMethodId,
          lastFour: input.lastFour,
          brand: input.brand ?? null,
          region: input.region ?? null,
          isDefault: input.isDefault ?? false,
          createdAt: now(),
          updatedAt: now(),
        };
        paymentMethods.set(method.id, method);
        return clone(method);
      },
      async findById(key) {
        const found = paymentMethods.get(key);
        return found ? clone(found) : null;
      },
      async listForShopper(shopperId) {
        return [...paymentMethods.values()].filter((m) => m.shopperId === shopperId).map(clone);
      },
    },

    orders: {
      async create(input: CreateOrder): Promise<Order> {
        const orderId = id();
        const items: OrderItem[] = input.items.map((item) => ({
          id: id(),
          orderId,
          catalogueItemId: item.catalogueItemId ?? null,
          name: item.name,
          quantity: item.quantity,
          estimatedPricePence: item.estimatedPricePence,
          substitutionOutcome: 'pending',
          substitutedForName: null,
          actualPricePence: null,
          note: item.note ?? null,
          createdAt: now(),
        }));

        const order: Order = {
          id: orderId,
          shopperId: input.shopperId,
          status: input.status ?? 'draft',
          runnerId: null,
          setId: input.setId ?? null,
          goodsEstimatePence: input.goodsEstimatePence,
          itemChargesPence: input.itemChargesPence ?? 0,
          feePence: input.feePence,
          allowanceExtraPence: input.allowanceExtraPence ?? 0,
          totalEstimatePence: input.totalEstimatePence,
          deliveryPlan: input.deliveryPlan ?? 'payg',
          payerShopperId: input.payerShopperId ?? null,
          approvalStatus: input.approvalStatus ?? null,
          receiptTotalPence: null,
          receiptFeePence: null,
          finalTotalPence: null,
          creditAppliedPence: 0,
          paidBy: input.paidBy ?? 'card',
          bankReference: input.bankReference ?? null,
          bankReceivedAt: null,
          spokenConfirmationAt: input.spokenConfirmationAt ?? null,
          confirmationChannel: input.confirmationChannel ?? null,
          confirmationStatement: input.confirmationStatement ?? null,
          doorstepProtocolSnapshot: input.doorstepProtocolSnapshot ?? '',
          stripePaymentIntentId: null,
          paymentMethodId: input.paymentMethodId ?? null,
          deliveryAddress: input.deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          poolId: null,
          runnerPaymentPence: input.runnerPaymentPence ?? 500,
          runnerTransferId: null,
          reimbursementPence: null,
          reimbursementStatus: null,
          reimbursementReason: null,
          reimbursementTransferId: null,
          reimbursedAt: null,
          reimbursementApprovedBy: null,
          tillStatus: null,
          tillReason: null,
          tillSettledBy: null,
          tillSettledAt: null,
          payMethodUsed: null,
          cardLimitPence: null,
          cardSpentPence: null,
          cardMerchant: null,
          doorWord: input.doorWord ?? null,
          setFireAt: input.setFireAt ?? null,
          anonymisedAt: null,
          waitingAlertSentAt: null,
          splitAt: null,
          splitParentId: input.splitParentId ?? null,
          splitPart: input.splitPart ?? null,
          splitOf: input.splitOf ?? null,
          splitMode: input.splitMode ?? null,
          splitPlannedAt: input.splitPlannedAt ?? null,
          basketGroupId: input.basketGroupId ?? null,
          basketPart: input.basketPart ?? null,
          basketOf: input.basketOf ?? null,
          extraDeliveryStatus: input.extraDeliveryStatus ?? null,
          extraDeliveryPaymentId: null,
          isDemo: input.isDemo ?? false,
          createdAt: now(),
          updatedAt: now(),
          acceptedAt: null,
          deliveredAt: null,
          completedAt: null,
          cancelledAt: null,
          cancelReason: null,
          goodwillRefundedPence: 0,
          items,
        };
        orders.set(order.id, order);
        return clone(order);
      },
      async findById(key) {
        const found = orders.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = orders.get(key);
        if (!existing) throw new NotFoundError('Order', key);
        const updated: Order = {
          ...existing,
          ...patch,
          id: existing.id,
          items: existing.items,
          updatedAt: now(),
        };
        orders.set(key, updated);
        return clone(updated);
      },
      async addItem(orderId, item) {
        const order = orders.get(orderId);
        if (!order) throw new NotFoundError('Order', orderId);
        const added: OrderItem = {
          id: id(),
          orderId,
          catalogueItemId: item.catalogueItemId ?? null,
          name: item.name,
          quantity: item.quantity,
          estimatedPricePence: item.estimatedPricePence,
          substitutionOutcome: 'pending',
          substitutedForName: null,
          actualPricePence: null,
          note: item.note ?? null,
          createdAt: now(),
        };
        order.items.push(added);
        return clone(added);
      },
      async updateItem(itemId, patch) {
        for (const order of orders.values()) {
          const index = order.items.findIndex((item) => item.id === itemId);
          if (index >= 0) {
            const updated = { ...(order.items[index] as OrderItem), ...patch, id: itemId };
            order.items[index] = updated;
            return clone(updated);
          }
        }
        throw new NotFoundError('Order item', itemId);
      },
      async listForShopper(shopperId) {
        return [...orders.values()]
          .filter((o) => o.shopperId === shopperId && o.splitParentId === null)
          .map(clone);
      },
      async listParts(parentId) {
        return (
          [...orders.values()]
            // A part replaced when the rest was planned again (ruling 61) is cancelled, not a part.
            .filter((o) => o.splitParentId === parentId && o.status !== 'cancelled')
            .sort((a, b) => (a.splitPart ?? 0) - (b.splitPart ?? 0))
            .map(clone)
        );
      },
      async listByStatus(status: OrderStatus) {
        return [...orders.values()].filter((o) => o.status === status).map(clone);
      },
      async listByPool(poolId) {
        return [...orders.values()].filter((o) => o.poolId === poolId).map(clone);
      },
      async listByReimbursementStatus(status) {
        return [...orders.values()].filter((o) => o.reimbursementStatus === status).map(clone);
      },
      async countForRunner(runnerId) {
        return [...orders.values()].filter((o) => o.runnerId === runnerId).length;
      },
      async listForRunner(runnerId) {
        return [...orders.values()]
          .filter((o) => o.runnerId === runnerId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listByTillStatus(status) {
        return [...orders.values()]
          .filter((o) => o.tillStatus === status)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map(clone);
      },
      async findBySetOccurrence(setId, fireAt) {
        for (const order of orders.values()) {
          if (order.setId === setId && order.setFireAt?.getTime() === fireAt.getTime()) {
            return clone(order);
          }
        }
        return null;
      },
    },

    offers: {
      async create(input: CreateJobOffer): Promise<JobOffer> {
        const offer: JobOffer = {
          id: id(),
          orderId: input.orderId,
          runnerId: input.runnerId,
          offeredAt: now(),
          expiresAt: input.expiresAt,
          respondedAt: null,
          outcome: 'pending',
          queuePosition: input.queuePosition,
          distanceMiles: input.distanceMiles ?? null,
          chained: input.chained ?? false,
        };
        offers.set(offer.id, offer);
        return clone(offer);
      },
      async findById(key) {
        const found = offers.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = offers.get(key);
        if (!existing) throw new NotFoundError('Job offer', key);
        const updated = { ...existing, ...patch, id: existing.id };
        offers.set(key, updated);
        return clone(updated);
      },
      async listForOrder(orderId) {
        return [...offers.values()]
          .filter((o) => o.orderId === orderId)
          .sort((a, b) => a.offeredAt.getTime() - b.offeredAt.getTime())
          .map(clone);
      },
      async listByOutcome(outcome: JobOfferOutcome) {
        return [...offers.values()].filter((o) => o.outcome === outcome).map(clone);
      },
    },

    payouts: {
      async create(input: CreateRunnerPayout): Promise<RunnerPayout> {
        const payout: RunnerPayout = {
          id: id(),
          orderId: input.orderId,
          runnerId: input.runnerId,
          earnedPence: input.earnedPence,
          coolBagWithheldPence: input.coolBagWithheldPence,
          recoveryWithheldPence: input.recoveryWithheldPence ?? 0,
          transferredPence: input.transferredPence,
          stripeTransferId: input.stripeTransferId ?? null,
          createdAt: now(),
        };
        payouts.set(payout.id, payout);
        return clone(payout);
      },
      async findByOrderId(orderId) {
        for (const payout of payouts.values()) {
          if (payout.orderId === orderId) return clone(payout);
        }
        return null;
      },
      async listForRunner(runnerId) {
        return [...payouts.values()].filter((p) => p.runnerId === runnerId).map(clone);
      },
    },

    sets: {
      async create(input: CreateRecurringSet): Promise<RecurringSet> {
        const setId = id();
        const items: SetItem[] = input.items.map((item) => ({
          id: id(),
          setId,
          catalogueItemId: item.catalogueItemId ?? null,
          name: item.name,
          quantity: item.quantity,
          estimatedPricePence: item.estimatedPricePence,
          createdAt: now(),
        }));

        const recurringSet: RecurringSet = {
          id: setId,
          shopperId: input.shopperId,
          name: input.name,
          deliveryAddress: input.deliveryAddress,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          paymentMethodId: input.paymentMethodId ?? null,
          frequency: input.frequency,
          dayOfWeek: input.dayOfWeek,
          timeOfDay: input.timeOfDay,
          timezone: input.timezone ?? 'Europe/London',
          active: input.active ?? true,
          nextFireAt: input.nextFireAt,
          noticeSentAt: null,
          skipRequestedForFireAt: null,
          lastFiredAt: null,
          autoSendAgreedAt: input.autoSendAgreedAt ?? null,
          autoSendStatement: input.autoSendStatement ?? null,
          createdAt: now(),
          updatedAt: now(),
          items,
        };
        sets.set(recurringSet.id, recurringSet);
        return clone(recurringSet);
      },
      async findById(key) {
        const found = sets.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = sets.get(key);
        if (!existing) throw new NotFoundError('Set', key);
        const updated: RecurringSet = {
          ...existing,
          ...patch,
          id: existing.id,
          items: existing.items,
          updatedAt: now(),
        };
        sets.set(key, updated);
        return clone(updated);
      },
      async listForShopper(shopperId) {
        return [...sets.values()].filter((s) => s.shopperId === shopperId).map(clone);
      },
      async listActive() {
        return [...sets.values()].filter((s) => s.active).map(clone);
      },
    },

    oneTimeCodes: {
      async create(input: CreateOneTimeCode): Promise<OneTimeCode> {
        const code: OneTimeCode = {
          id: id(),
          phone: input.phone,
          codeHash: input.codeHash,
          role: input.role ?? 'shopper',
          expiresAt: input.expiresAt,
          consumedAt: null,
          attempts: 0,
          createdAt: input.createdAt ?? now(),
        };
        oneTimeCodes.set(code.id, code);
        return clone(code);
      },
      async findLatestUnconsumed(phone: string, role: AccountRole) {
        const candidates = [...oneTimeCodes.values()]
          .filter((c) => c.phone === phone && c.role === role && c.consumedAt === null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return candidates.length > 0 ? clone(candidates[0] as OneTimeCode) : null;
      },
      async countSince(phone: string, since: Date) {
        return [...oneTimeCodes.values()].filter(
          (c) => c.phone === phone && c.createdAt.getTime() >= since.getTime(),
        ).length;
      },
      async update(key, patch) {
        const existing = oneTimeCodes.get(key);
        if (!existing) throw new NotFoundError('One time code', key);
        const updated = { ...existing, ...patch, id: existing.id };
        oneTimeCodes.set(key, updated);
        return clone(updated);
      },
    },

    findRequests: {
      async create(input) {
        const row: FindRequest = {
          ...input,
          id: id(),
          status: 'looking',
          foundName: null,
          foundShop: null,
          foundPricePence: null,
          catalogueItemId: null,
          refundId: null,
          note: null,
          createdAt: now(),
          decidedAt: null,
        };
        findRequests.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = findRequests.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = findRequests.get(key);
        if (!existing) throw new NotFoundError('Find request', key);
        const updated = { ...existing, ...patch, id: existing.id };
        findRequests.set(key, updated);
        return clone(updated);
      },
      async listForShopper(shopperId) {
        return [...findRequests.values()]
          .filter((row) => row.shopperId === shopperId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listLooking() {
        return [...findRequests.values()]
          .filter((row) => row.status === 'looking')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    giftCards: {
      async create(input) {
        const row: GiftCard = {
          ...input,
          id: id(),
          redeemedByShopperId: null,
          redeemedAt: null,
          createdAt: now(),
        };
        giftCards.set(row.id, row);
        return clone(row);
      },
      async findByCode(code) {
        for (const card of giftCards.values()) {
          if (card.code === code) return clone(card);
        }
        return null;
      },
      async redeem(key, shopperId, at) {
        const existing = giftCards.get(key);
        if (!existing || existing.redeemedByShopperId !== null) return null;
        const updated = { ...existing, redeemedByShopperId: shopperId, redeemedAt: at };
        giftCards.set(key, updated);
        return clone(updated);
      },
      async listBoughtBy(shopperId) {
        return [...giftCards.values()]
          .filter((card) => card.buyerShopperId === shopperId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
    },

    organisationEnquiries: {
      async create(input) {
        const row: OrganisationEnquiry = { ...input, id: id(), handled: false, createdAt: now() };
        enquiries.set(row.id, row);
        return clone(row);
      },
      async list() {
        return [...enquiries.values()]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = enquiries.get(key);
        if (!existing) throw new NotFoundError('Enquiry', key);
        const updated = { ...existing, ...patch };
        enquiries.set(key, updated);
        return clone(updated);
      },
    },

    staffMembers: {
      async create(input) {
        const row: StaffMember = {
          isOwner: false,
          passcodeHash: null,
          mustChangePassword: true,
          ...input,
          id: id(),
          active: true,
          failedAttempts: 0,
          lockedUntil: null,
          lastSignInAt: null,
          createdAt: now(),
          totpSecret: null,
          totpEnabled: false,
          allowedAreas: '',
          sessionVersion: 0,
          recoveryCodes: '',
          canAuthorise: false,
        };
        staffMembers.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = staffMembers.get(key);
        return found ? clone(found) : null;
      },
      async findByUsername(username) {
        for (const member of staffMembers.values()) {
          if (member.username === username) return clone(member);
        }
        return null;
      },
      async list() {
        return [...staffMembers.values()]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = staffMembers.get(key);
        if (!existing) throw new NotFoundError('Staff member', key);
        const updated = { ...existing, ...patch, id: existing.id };
        staffMembers.set(key, updated);
        return clone(updated);
      },
    },

    partnerShops: {
      async create(input) {
        const row: PartnerShop = {
          kind: 'shop',
          status: 'approved',
          plan: 'plus',
          freeForever: false,
          plusTrialUsed: false,
          source: 'staff',
          seedKey: null,
          postcode: '',
          hours: '',
          contactName: '',
          mobile: '',
          email: '',
          approvedAt: null,
          ...input,
          id: id(),
          paidUntil: null,
          active: true,
          spotlight: 'none',
          spotlightUntil: null,
          createdAt: now(),
        };
        partnerShops.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = partnerShops.get(key);
        return found ? clone(found) : null;
      },
      async findBySeedKey(seedKey) {
        const found = [...partnerShops.values()].find((row) => row.seedKey === seedKey);
        return found ? clone(found) : null;
      },
      async list() {
        return [...partnerShops.values()]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(key, patch) {
        const existing = partnerShops.get(key);
        if (!existing) throw new NotFoundError('Partner shop', key);
        const updated = { ...existing, ...patch, id: existing.id };
        partnerShops.set(key, updated);
        return clone(updated);
      },
    },

    partnerProducts: {
      async create(input) {
        const row: PartnerProduct = {
          durationMinutes: null,
          barcode: null,
          priceEstimated: false,
          checkedAt: null,
          checkNote: null,
          ...input,
          id: id(),
          status: 'pending',
          note: null,
          catalogueItemId: null,
          createdAt: now(),
          decidedAt: null,
        };
        partnerProducts.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = partnerProducts.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = partnerProducts.get(key);
        if (!existing) throw new NotFoundError('Partner product', key);
        const updated = { ...existing, ...patch, id: existing.id };
        partnerProducts.set(key, updated);
        return clone(updated);
      },
      async listForShop(partnerShopId) {
        return [...partnerProducts.values()]
          .filter((row) => row.partnerShopId === partnerShopId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listPending() {
        return [...partnerProducts.values()]
          .filter((row) => row.status === 'pending')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    businessUsers: {
      async create(input) {
        const row: BusinessUser = {
          ...input,
          id: id(),
          active: true,
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: null,
          lastSignInAt: null,
          createdAt: now(),
        };
        businessUsers.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = businessUsers.get(key);
        return found ? clone(found) : null;
      },
      async findByUsername(username) {
        for (const row of businessUsers.values()) {
          if (row.username === username) return clone(row);
        }
        return null;
      },
      async update(key, patch) {
        const existing = businessUsers.get(key);
        if (!existing) throw new NotFoundError('Business user', key);
        const updated = { ...existing, ...patch, id: existing.id };
        businessUsers.set(key, updated);
        return clone(updated);
      },
      async listFor(where) {
        return [...businessUsers.values()]
          .filter(
            (row) =>
              (where.partnerShopId === undefined || row.partnerShopId === where.partnerShopId) &&
              (where.organisationId === undefined || row.organisationId === where.organisationId),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    partnerPayments: {
      async create(input) {
        const row: PartnerPayment = { reference: null, ...input, id: id() };
        partnerPayments.push(row);
        return clone(row);
      },
      async listForShop(partnerShopId) {
        return partnerPayments
          .filter((row) => row.partnerShopId === partnerShopId)
          .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
          .map(clone);
      },
      async findByReference(reference) {
        const found = partnerPayments.find((row) => row.reference === reference);
        return found ? clone(found) : null;
      },
    },

    serviceEnquiries: {
      async create(input) {
        const row: ServiceEnquiry = {
          ...input,
          id: id(),
          status: 'open',
          reply: null,
          createdAt: now(),
          answeredAt: null,
        };
        serviceEnquiries.set(row.id, row);
        return clone(row);
      },
      async findById(key) {
        const found = serviceEnquiries.get(key);
        return found ? clone(found) : null;
      },
      async update(key, patch) {
        const existing = serviceEnquiries.get(key);
        if (!existing) throw new NotFoundError('Enquiry', key);
        const updated = { ...existing, ...patch, id: existing.id };
        serviceEnquiries.set(key, updated);
        return clone(updated);
      },
      async listForShop(partnerShopId) {
        return [...serviceEnquiries.values()]
          .filter((row) => row.partnerShopId === partnerShopId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listForShopper(shopperId) {
        return [...serviceEnquiries.values()]
          .filter((row) => row.shopperId === shopperId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
    },

    spotlightMentions: {
      async create(input) {
        const row: SpotlightMention = { ...input, id: id() };
        spotlightMentions.push(row);
        return clone(row);
      },
      async listForShopperSince(shopperKey, since) {
        return spotlightMentions
          .filter((row) => row.shopperKey === shopperKey && row.at >= since)
          .map(clone);
      },
      async countForShopSince(partnerShopId, since) {
        return spotlightMentions.filter(
          (row) => row.partnerShopId === partnerShopId && row.at >= since,
        ).length;
      },
    },

    analytics: {
      async record(input) {
        analyticsEvents.push({ ...input, id: id() });
      },
      async list(where) {
        return analyticsEvents
          .filter(
            (row) =>
              row.at >= where.since &&
              (where.until === undefined || row.at < where.until) &&
              (where.kind === undefined || row.kind === where.kind),
          )
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map(clone);
      },
    },

    memory: {
      async remember(input) {
        const row: OziExchange = { ...input, id: id() };
        exchanges.push(row);
        return clone(row);
      },
      async list(where) {
        // Newest first; among rows written in the same instant, the last written first.
        return [...exchanges]
          .reverse()
          .filter(
            (row) =>
              (where.verdict === undefined || row.verdict === where.verdict) &&
              (where.channel === undefined || row.channel === where.channel),
          )
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, where.limit)
          .map(clone);
      },
      async findById(exchangeId) {
        const row = exchanges.find((one) => one.id === exchangeId);
        return row ? clone(row) : null;
      },
      async judge(exchangeId, patch) {
        const row = exchanges.find((one) => one.id === exchangeId);
        if (!row) throw new NotFoundError('exchange', exchangeId);
        Object.assign(row, patch);
        return clone(row);
      },
      async listSince(since, limit) {
        return exchanges
          .filter((row) => row.at >= since)
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async counts() {
        const count = (verdict: OziExchange['verdict']): number =>
          exchanges.filter((row) => row.verdict === verdict).length;
        return {
          total: exchanges.length,
          unrated: count('unrated'),
          right: count('right'),
          wrong: count('wrong'),
        };
      },
    },

    learned: {
      async heard({ account, text, at }) {
        const known = learned.find((row) => row.account === account && row.text === text);
        if (known) {
          known.timesHeard += 1;
          known.lastHeardAt = at;
          return;
        }
        learned.push({
          id: id(),
          account,
          text,
          timesHeard: 1,
          firstHeardAt: at,
          lastHeardAt: at,
          status: 'waiting',
          reply: null,
          decidedBy: null,
          decidedAt: null,
        });
      },
      async list(status) {
        return learned
          .filter((row) => row.status === status)
          .sort(
            (a, b) =>
              b.timesHeard - a.timesHeard || b.lastHeardAt.getTime() - a.lastHeardAt.getTime(),
          )
          .map(clone);
      },
      async findById(key) {
        const row = learned.find((candidate) => candidate.id === key);
        return row ? clone(row) : null;
      },
      async findByText(account, text) {
        const row = learned.find((one) => one.account === account && one.text === text);
        return row ? clone(row) : null;
      },
      async decide(key, patch) {
        const row = learned.find((candidate) => candidate.id === key);
        if (!row) throw new NotFoundError('Learned phrase', key);
        Object.assign(row, patch);
        return clone(row);
      },
    },

    income: {
      async record(input) {
        incomeRecords.push({ ...input, id: id() });
      },
      async list(where) {
        return incomeRecords
          .filter(
            (row) => row.at >= where.since && (where.until === undefined || row.at < where.until),
          )
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map(clone);
      },
    },

    prices: {
      async record(input) {
        const row: PriceSighting = { ...input, id: id() };
        sightings.push(row);
        return clone(row);
      },
      async listForItem(catalogueItemId, limit) {
        return [...sightings]
          .reverse()
          .filter((row) => row.catalogueItemId === catalogueItemId)
          .sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async latest(limit) {
        return [...sightings]
          .reverse()
          .sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async countSince(source, since) {
        return sightings.filter((row) => row.source === source && row.seenAt >= since).length;
      },
    },

    receiptPhotos: {
      async save(input) {
        const existing = receiptPhotos.get(input.orderId);
        const row: ReceiptPhoto = { ...input, id: existing?.id ?? id() };
        receiptPhotos.set(input.orderId, row);
        return clone(row);
      },
      async findByOrderId(orderId) {
        const found = receiptPhotos.get(orderId);
        return found ? clone(found) : null;
      },
      async ordersWithPhotos(orderIds) {
        return new Set(orderIds.filter((orderId) => receiptPhotos.has(orderId)));
      },
    },

    shopperFeedback: {
      async create(input) {
        if (shopperFeedback.has(input.orderId)) {
          throw new Error(`Feedback for order ${input.orderId} is already in.`);
        }
        const row: ShopperFeedback = { ...input, id: id() };
        shopperFeedback.set(input.orderId, row);
        return clone(row);
      },
      async findByOrderId(orderId) {
        const found = shopperFeedback.get(orderId);
        return found ? clone(found) : null;
      },
      async listSince(since) {
        return [...shopperFeedback.values()]
          .filter((row) => row.createdAt.getTime() >= since.getTime())
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    },

    shopReviews: {
      async create(input) {
        if (
          shopReviews.some(
            (row) => row.orderId === input.orderId && row.partnerShopId === input.partnerShopId,
          )
        ) {
          throw new Error(
            `A review of shop ${input.partnerShopId} for order ${input.orderId} is already in.`,
          );
        }
        const row: ShopReview = { ...input, id: id() };
        shopReviews.push(row);
        return clone(row);
      },
      async findByOrderAndShop(orderId, partnerShopId) {
        const found = shopReviews.find(
          (row) => row.orderId === orderId && row.partnerShopId === partnerShopId,
        );
        return found ? clone(found) : null;
      },
      async listForShopper(shopperId) {
        return shopReviews
          .filter((row) => row.shopperId === shopperId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async listByStatus(status) {
        return shopReviews
          .filter((row) => row.status === status)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async listBetween(since, until) {
        return shopReviews
          .filter(
            (row) =>
              row.createdAt.getTime() >= since.getTime() &&
              row.createdAt.getTime() < until.getTime(),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async update(reviewId, patch) {
        const row = shopReviews.find((one) => one.id === reviewId);
        if (!row) throw new NotFoundError('shop review', reviewId);
        Object.assign(row, patch);
        return clone(row);
      },
      async spend(input) {
        const row: ReviewPointsSpend = { ...input, id: id() };
        reviewPointsSpends.push(row);
        return clone(row);
      },
      async spentPoints(shopperId) {
        return reviewPointsSpends
          .filter((row) => row.shopperId === shopperId)
          .reduce((sum, row) => sum + row.points, 0);
      },
    },
    audit: {
      async record(input) {
        // Frozen, so not even code in this process can change an entry once it is written.
        const row: AuditEntry = Object.freeze({ ...input, id: id() });
        auditEntries.push(row);
        return clone(row);
      },
      async list(where) {
        const needle = where.search?.trim().toLowerCase() ?? '';
        // Newest first; of two at the same moment, the one written later first.
        return [...auditEntries]
          .reverse()
          .filter(
            (row) =>
              (where.since === undefined || row.at >= where.since) &&
              (where.until === undefined || row.at < where.until) &&
              (where.actorId === undefined || row.actorId === where.actorId) &&
              (where.target === undefined || row.target === where.target) &&
              (needle === '' ||
                [row.actorName, row.actorRole, row.action, row.target, row.detail, row.ip].some(
                  (field) => field.toLowerCase().includes(needle),
                )),
          )
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, where.limit ?? 200)
          .map(clone);
      },
    },

    ownerDesk: {
      async createMatter(input) {
        const row: OwnerMatter = {
          ...input,
          emailFrom: input.emailFrom ?? null,
          emailSubject: input.emailSubject ?? null,
          id: id(),
          status: 'open',
          decision: null,
          decidedVia: null,
          decidedBy: null,
          createdAt: now(),
          decidedAt: null,
          laterUntil: null,
          callAttempts: 0,
          lastCalledAt: null,
          lastReadAt: null,
        };
        ownerMatters.set(row.id, row);
        return clone(row);
      },
      async findMatter(key) {
        const found = ownerMatters.get(key);
        return found ? clone(found) : null;
      },
      async findMattersFor(kind, subjectId) {
        return [...ownerMatters.values()]
          .filter((row) => row.kind === kind && row.subjectId === subjectId)
          .reverse()
          .map(clone);
      },
      async listUnsettled() {
        return [...ownerMatters.values()]
          .filter((row) => row.status === 'open' || row.status === 'later')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async listSettledSince(since) {
        return [...ownerMatters.values()]
          .filter(
            (row) =>
              (row.status === 'decided' || row.status === 'handled') &&
              (row.decidedAt ?? row.createdAt) >= since,
          )
          .reverse()
          .map(clone);
      },
      async updateMatter(key, patch) {
        const found = ownerMatters.get(key);
        if (!found) throw new NotFoundError('Owner matter', key);
        const row = { ...found, ...patch, id: found.id };
        ownerMatters.set(key, row);
        return clone(row);
      },
      async createCall(input) {
        const row: OwnerCall = { ...input, id: id() };
        ownerCalls.set(row.id, row);
        return clone(row);
      },
      async findCall(key) {
        const found = ownerCalls.get(key);
        return found ? clone(found) : null;
      },
      async latestCalls(limit) {
        return [...ownerCalls.values()]
          .reverse()
          .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async updateCall(key, patch) {
        const found = ownerCalls.get(key);
        if (!found) throw new NotFoundError('Owner call', key);
        const row = { ...found, ...patch, id: found.id };
        ownerCalls.set(key, row);
        return clone(row);
      },
    },

    companyContact: {
      async findThread(accountKind, accountId) {
        for (const thread of inboxThreads.values()) {
          if (thread.accountKind === accountKind && thread.accountId === accountId) {
            return clone(thread);
          }
        }
        return null;
      },
      async findThreadById(key) {
        const found = inboxThreads.get(key);
        return found ? clone(found) : null;
      },
      async openThread(accountKind, accountId) {
        for (const thread of inboxThreads.values()) {
          if (thread.accountKind === accountKind && thread.accountId === accountId) {
            return clone(thread);
          }
        }
        const at = now();
        const row: InboxThread = {
          id: id(),
          accountKind,
          accountId,
          createdAt: at,
          lastMessageAt: at,
        };
        inboxThreads.set(row.id, row);
        return clone(row);
      },
      async listThreads() {
        return [...inboxThreads.values()]
          .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
          .map(clone);
      },
      async updateThread(key, patch) {
        const found = inboxThreads.get(key);
        if (!found) throw new NotFoundError('Inbox thread', key);
        const row = { ...found, ...patch, id: found.id };
        inboxThreads.set(key, row);
        return clone(row);
      },
      async addMessage(input) {
        if (!inboxThreads.has(input.threadId))
          throw new NotFoundError('Inbox thread', input.threadId);
        const row: InboxMessage = { ...input, id: id() };
        inboxMessages.set(row.id, row);
        return clone(row);
      },
      async findMessage(key) {
        const found = inboxMessages.get(key);
        return found ? clone(found) : null;
      },
      async updateMessage(key, patch) {
        const found = inboxMessages.get(key);
        if (!found) throw new NotFoundError('Inbox message', key);
        const row = { ...found, ...patch, id: found.id, threadId: found.threadId };
        inboxMessages.set(key, row);
        return clone(row);
      },
      async listMessages(threadId) {
        return [...inboxMessages.values()]
          .filter((row) => row.threadId === threadId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async listStaffMessages(limit) {
        return [...inboxMessages.values()]
          .filter((row) => row.fromStaff)
          .reverse()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async deleteThreadFor(accountKind, accountId) {
        return dropThread(accountKind, accountId);
      },
      async createCode(input) {
        const row: StaffCode = { ...input, id: id() };
        staffCodes.set(row.id, row);
        return clone(row);
      },
      async listCodesFor(staffId, kind) {
        return [...staffCodes.values()]
          .filter((row) => row.staffId === staffId && row.kind === kind)
          .reverse()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      async updateCode(key, patch) {
        const found = staffCodes.get(key);
        if (!found) throw new NotFoundError('Staff code', key);
        const row = { ...found, ...patch, id: found.id };
        staffCodes.set(key, row);
        return clone(row);
      },
      async createCall(input) {
        const row: StaffCall = { ...input, id: id() };
        staffCalls.set(row.id, row);
        return clone(row);
      },
      async findCall(key) {
        const found = staffCalls.get(key);
        return found ? clone(found) : null;
      },
      async findCallByRoomName(roomName) {
        for (const call of staffCalls.values()) {
          if (call.roomName === roomName) return clone(call);
        }
        return null;
      },
      async updateCall(key, patch) {
        const found = staffCalls.get(key);
        if (!found) throw new NotFoundError('Staff call', key);
        const row = { ...found, ...patch, id: found.id };
        staffCalls.set(key, row);
        return clone(row);
      },
      async listCalls(limit) {
        return [...staffCalls.values()]
          .reverse()
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      async listCallsFor(accountKind, accountId) {
        return [...staffCalls.values()]
          .filter((row) => row.accountKind === accountKind && row.accountId === accountId)
          .reverse()
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .map(clone);
      },
      async listRecordingsStartedBefore(before) {
        return [...staffCalls.values()]
          .filter((row) => row.recordingKey !== null && row.startedAt < before)
          .map(clone);
      },
    },

    emails: {
      async findByMessageId(messageId) {
        const found = emailRecords.get(messageId);
        return found ? clone(found) : null;
      },
      async record(input) {
        const found = emailRecords.get(input.messageId);
        if (found) return clone(found);
        const row: EmailRecord = { ...input, id: id() };
        emailRecords.set(row.messageId, row);
        return clone(row);
      },
    },

    retention: {
      async eraseShopper(shopperId, at) {
        const shopper = shoppers.get(shopperId);
        if (!shopper) throw new NotFoundError('Shopper', shopperId);
        shoppers.set(shopperId, {
          ...shopper,
          ...erasedShopperPatch(shopperId, at),
          updatedAt: at,
        });
        for (const [key, method] of paymentMethods) {
          if (method.shopperId === shopperId) paymentMethods.delete(key);
        }
        for (const [key, device] of pushSubscriptions) {
          if (device.shopperId === shopperId) pushSubscriptions.delete(key);
        }
        for (const [key, saved] of savedAddresses) {
          if (saved.shopperId === shopperId) savedAddresses.delete(key);
        }
        for (const [key, member] of circleMembers) {
          if (member.shopperId === shopperId) circleMembers.delete(key);
        }
        for (const [key, set] of sets) {
          if (set.shopperId === shopperId) sets.delete(key);
        }
        dropThread('shopper', shopperId);
        forgetCallNames('shopper', shopperId);
        for (const [key, order] of orders) {
          if (order.shopperId !== shopperId) continue;
          orders.set(key, {
            ...order,
            ...erasedOrderPatch(at),
            paymentMethodId: null,
            setId: null,
            updatedAt: at,
          });
        }
      },
      async eraseRunner(runnerId, at) {
        const runner = runners.get(runnerId);
        if (!runner) throw new NotFoundError('Runner', runnerId);
        runners.set(runnerId, { ...runner, ...erasedRunnerPatch(runnerId, at), updatedAt: at });
        for (const [key, document] of runnerDocuments) {
          if (document.runnerId === runnerId) runnerDocuments.delete(key);
        }
        dropThread('runner', runnerId);
        forgetCallNames('runner', runnerId);
      },
      async deleteRunnerChecksLeftBefore(before) {
        const gone = new Set(
          [...runners.values()]
            .filter((runner) => runner.leftAt !== null && runner.leftAt < before)
            .map((runner) => runner.id),
        );
        let removed = 0;
        for (let i = runnerChecks.length - 1; i >= 0; i -= 1) {
          if (gone.has(runnerChecks[i]!.runnerId)) {
            runnerChecks.splice(i, 1);
            removed += 1;
          }
        }
        return removed;
      },
      async deleteProblemEvidenceDecidedBefore(before) {
        const old = new Set(
          [...problems.values()]
            .filter((report) => report.decidedAt !== null && report.decidedAt < before)
            .map((report) => report.id),
        );
        let removed = 0;
        for (const [key, row] of problemEvidence) {
          if (old.has(row.reportId)) {
            problemEvidence.delete(key);
            removed += 1;
          }
        }
        return removed;
      },
      async deleteAnalyticsBefore(before) {
        const keep = analyticsEvents.filter((row) => row.at >= before);
        const removed = analyticsEvents.length - keep.length;
        analyticsEvents.splice(0, analyticsEvents.length, ...keep);
        return removed;
      },
      async deleteExchangesBefore(before, only) {
        const keep = exchanges.filter(
          (row) => row.at >= before || (only === 'unrated' && row.verdict !== 'unrated'),
        );
        const removed = exchanges.length - keep.length;
        exchanges.splice(0, exchanges.length, ...keep);
        return removed;
      },
      async deleteSignInCodesBefore(before) {
        let removed = 0;
        for (const [key, row] of oneTimeCodes) {
          if (row.createdAt < before) {
            oneTimeCodes.delete(key);
            removed += 1;
          }
        }
        return removed;
      },
      async anonymiseOrdersBefore(before, at) {
        let changed = 0;
        for (const [key, order] of orders) {
          if (order.createdAt >= before || order.anonymisedAt !== null) continue;
          orders.set(key, { ...order, ...erasedOrderPatch(at), updatedAt: at });
          changed += 1;
        }
        return changed;
      },
      async deleteReceiptPhotosBefore(before) {
        let removed = 0;
        for (const [key, photo] of receiptPhotos) {
          const order = orders.get(photo.orderId);
          if (!order || order.createdAt < before) {
            receiptPhotos.delete(key);
            removed += 1;
          }
        }
        return removed;
      },
    },
    admin: {
      async listOrders(where) {
        return [...orders.values()]
          .filter(
            (row) =>
              (where.since === undefined || row.createdAt >= where.since) &&
              (where.until === undefined || row.createdAt < where.until) &&
              (where.statuses === undefined || where.statuses.includes(row.status)),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, where.limit ?? 200)
          .map(clone);
      },
      async listShoppersCreated(where) {
        return [...shoppers.values()]
          .filter(
            (row) =>
              row.createdAt >= where.since &&
              (where.until === undefined || row.createdAt < where.until),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      async searchShoppers(text, limit = 20) {
        const needle = text.trim().toLowerCase();
        if (needle === '') return [];
        return [...shoppers.values()]
          .filter((row) =>
            [row.displayName, row.handle, row.phone].some((field) =>
              field.toLowerCase().includes(needle),
            ),
          )
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .slice(0, limit)
          .map(clone);
      },
      async listProblemsDecided(where) {
        return [...problems.values()]
          .filter(
            (row) =>
              row.decidedAt !== null &&
              row.decidedAt >= where.since &&
              (where.until === undefined || row.decidedAt < where.until),
          )
          .sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0))
          .map(clone);
      },
    },

    async disconnect() {
      // Nothing to disconnect.
    },
  };
}
