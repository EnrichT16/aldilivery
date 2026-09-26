/**
 * An in-memory implementation of the repository.
 *
 * Two jobs. It lets the whole test suite prove the rules without a database, and it lets
 * the API start on a machine that has no PostgreSQL yet, so the shell can be walked through
 * end to end on day one. It is not a production backend and says so at startup.
 */

import { randomUUID } from 'node:crypto';

import type { OrderStatus } from '@aldilivery/core';

import type {
  AccountRole,
  CatalogueItem,
  HouseholdCircle,
  HouseholdCircleMember,
  JobOffer,
  JobOfferOutcome,
  OneTimeCode,
  Order,
  OrderItem,
  Organisation,
  PaymentMethod,
  RecurringSet,
  Runner,
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
          deletionScheduledFor: null,
          organisationId: input.organisationId ?? null,
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

    async disconnect() {
      // Nothing to disconnect.
    },
  };
}
