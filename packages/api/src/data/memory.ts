/**
 * An in-memory implementation of the repository.
 *
 * Two jobs. It lets the whole test suite prove the rules without a database, and it lets
 * the API start on a machine that has no PostgreSQL yet, so the shell can be walked through
 * end to end on day one. It is not a production backend and says so at startup.
 */

import { randomUUID } from 'node:crypto';

import { newReferralCode } from '../lib/referral.js';

import type { OrderStatus } from '@aldilivery/core';

import type {
  AccountRole,
  IncomeRecord,
  LearnedPhrase,
  AnalyticsEvent,
  PartnerPayment,
  SpotlightMention,
  BusinessUser,
  PartnerProduct,
  PartnerShop,
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
  RecurringSet,
  Runner,
  RunnerCheck,
  RunnerPayout,
  SetItem,
  Shopper,
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

export function memoryRepository(): Repository {
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
  const spotlightMentions: SpotlightMention[] = [];
  const analyticsEvents: AnalyticsEvent[] = [];
  const incomeRecords: IncomeRecord[] = [];
  const learned: LearnedPhrase[] = [];

  const now = (): Date => new Date();

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
          plusUntil: null,
          plusFamily: false,
          familyCode: null,
          familyOwnerId: null,
          creditPence: 0,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          deletionScheduledFor: null,
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
      async countJoinedVia(via) {
        return [...shoppers.values()].filter((shopper) => shopper.joinedVia === via).length;
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
        const row: RunnerDocument = { ...input, id: id() };
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
          feePence: input.feePence,
          totalEstimatePence: input.totalEstimatePence,
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
          runnerPaymentPence: 500,
          runnerTransferId: null,
          reimbursementPence: null,
          reimbursementStatus: null,
          reimbursementReason: null,
          reimbursementTransferId: null,
          reimbursedAt: null,
          reimbursementApprovedBy: null,
          createdAt: now(),
          updatedAt: now(),
          acceptedAt: null,
          deliveredAt: null,
          completedAt: null,
          cancelledAt: null,
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
        return [...orders.values()].filter((o) => o.shopperId === shopperId).map(clone);
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
        const row: PartnerPayment = { ...input, id: id() };
        partnerPayments.push(row);
        return clone(row);
      },
      async listForShop(partnerShopId) {
        return partnerPayments
          .filter((row) => row.partnerShopId === partnerShopId)
          .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
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

    async disconnect() {
      // Nothing to disconnect.
    },
  };
}
