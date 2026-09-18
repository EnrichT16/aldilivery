/**
 * The data access contract.
 *
 * Routes and services never touch Prisma directly. They talk to this interface, which has
 * two implementations: `prismaRepository` over PostgreSQL, and `memoryRepository` for
 * tests and for running the API on a machine with no database yet.
 *
 * The point is not abstraction for its own sake. It is that the rules — a confirmation
 * before payment, five pounds to the Runner, no age restricted goods — can be proved by
 * tests that run anywhere, in a second, with no Docker and no network.
 */

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
import type { OrderStatus } from '@aldilivery/core';

export type CreateShopper = Pick<Shopper, 'displayName' | 'handle' | 'phone'> &
  Partial<
    Pick<
      Shopper,
      | 'spokenCodeHash'
      | 'preferredLanguage'
      | 'doorstepProtocol'
      | 'deliveryAddress'
      | 'substitutionDefault'
      | 'budgetCapPence'
      | 'organisationId'
    >
  >;

export type CreateRunner = Pick<Runner, 'name' | 'phone'> &
  Partial<
    Pick<
      Runner,
      | 'vehicleType'
      | 'rightToWorkVerified'
      | 'criminalRecordCheckVerified'
      | 'stripeConnectedAccountId'
      | 'available'
      | 'latitude'
      | 'longitude'
    >
  >;

export type CreateOrganisation = Pick<Organisation, 'name' | 'contactName' | 'contactEmail'> &
  Partial<Pick<Organisation, 'contactPhone' | 'invoiceTerms'>>;

export type CreateCatalogueItem = Pick<
  CatalogueItem,
  'name' | 'category' | 'estimatedPricePence' | 'source'
> &
  Partial<Pick<CatalogueItem, 'ageRestricted' | 'externalRef' | 'lastSeenAt'>>;

export type CreatePaymentMethod = Pick<
  PaymentMethod,
  'shopperId' | 'stripePaymentMethodId' | 'lastFour'
> &
  Partial<Pick<PaymentMethod, 'brand' | 'region' | 'isDefault'>>;

export type CreateOrderItem = Pick<OrderItem, 'name' | 'quantity' | 'estimatedPricePence'> &
  Partial<Pick<OrderItem, 'catalogueItemId' | 'note'>>;

export type CreateOrder = Pick<
  Order,
  'shopperId' | 'goodsEstimatePence' | 'feePence' | 'totalEstimatePence' | 'deliveryAddress'
> &
  Partial<
    Pick<
      Order,
      | 'status'
      | 'setId'
      | 'paymentMethodId'
      | 'latitude'
      | 'longitude'
      | 'doorstepProtocolSnapshot'
      | 'spokenConfirmationAt'
      | 'confirmationChannel'
      | 'confirmationStatement'
    >
  > & { items: CreateOrderItem[] };

export type CreateSetItem = Pick<SetItem, 'name' | 'quantity' | 'estimatedPricePence'> &
  Partial<Pick<SetItem, 'catalogueItemId'>>;

export type CreateRecurringSet = Pick<
  RecurringSet,
  'shopperId' | 'name' | 'deliveryAddress' | 'frequency' | 'dayOfWeek' | 'timeOfDay' | 'nextFireAt'
> &
  Partial<
    Pick<RecurringSet, 'paymentMethodId' | 'timezone' | 'active' | 'latitude' | 'longitude'>
  > & { items: CreateSetItem[] };

export type CreateJobOffer = Pick<
  JobOffer,
  'orderId' | 'runnerId' | 'expiresAt' | 'queuePosition'
> &
  Partial<Pick<JobOffer, 'distanceMiles'>>;

export type CreateRunnerPayout = Pick<
  RunnerPayout,
  'orderId' | 'runnerId' | 'earnedPence' | 'coolBagWithheldPence' | 'transferredPence'
> &
  Partial<Pick<RunnerPayout, 'stripeTransferId'>>;

export type CreateOneTimeCode = Pick<OneTimeCode, 'phone' | 'codeHash' | 'expiresAt'> &
  Partial<Pick<OneTimeCode, 'role'>>;

export interface CatalogueSearchOptions {
  /** Rule Six. Defaults to false and no route may set it to true in version one. */
  includeAgeRestricted?: boolean;
  category?: string;
  limit?: number;
}

export interface Repository {
  shoppers: {
    create(input: CreateShopper): Promise<Shopper>;
    findById(id: string): Promise<Shopper | null>;
    findByPhone(phone: string): Promise<Shopper | null>;
    findByHandle(handle: string): Promise<Shopper | null>;
    update(id: string, patch: Partial<Shopper>): Promise<Shopper>;
  };

  runners: {
    create(input: CreateRunner): Promise<Runner>;
    findById(id: string): Promise<Runner | null>;
    findByPhone(phone: string): Promise<Runner | null>;
    update(id: string, patch: Partial<Runner>): Promise<Runner>;
    /** Every Runner who is on shift, verified, and not already holding an offer. */
    listAvailable(): Promise<Runner[]>;
  };

  organisations: {
    create(input: CreateOrganisation): Promise<Organisation>;
    findById(id: string): Promise<Organisation | null>;
    listServiceUsers(organisationId: string): Promise<Shopper[]>;
  };

  circles: {
    create(name: string): Promise<HouseholdCircle>;
    addMember(
      circleId: string,
      shopperId: string,
      consent: {
        consentGivenAt: Date | null;
        consentMethod: string | null;
        consentRecordedBy: string | null;
        canOrderForOthers: boolean;
      },
    ): Promise<HouseholdCircleMember>;
    listMembers(circleId: string): Promise<HouseholdCircleMember[]>;
  };

  catalogue: {
    create(input: CreateCatalogueItem): Promise<CatalogueItem>;
    findById(id: string): Promise<CatalogueItem | null>;
    findManyByIds(ids: string[]): Promise<CatalogueItem[]>;
    search(query: string, options?: CatalogueSearchOptions): Promise<CatalogueItem[]>;
  };

  paymentMethods: {
    create(input: CreatePaymentMethod): Promise<PaymentMethod>;
    findById(id: string): Promise<PaymentMethod | null>;
    listForShopper(shopperId: string): Promise<PaymentMethod[]>;
  };

  orders: {
    create(input: CreateOrder): Promise<Order>;
    findById(id: string): Promise<Order | null>;
    update(id: string, patch: Partial<Omit<Order, 'items'>>): Promise<Order>;
    updateItem(itemId: string, patch: Partial<OrderItem>): Promise<OrderItem>;
    listForShopper(shopperId: string): Promise<Order[]>;
    listByStatus(status: OrderStatus): Promise<Order[]>;
    listByPool(poolId: string): Promise<Order[]>;
  };

  offers: {
    create(input: CreateJobOffer): Promise<JobOffer>;
    findById(id: string): Promise<JobOffer | null>;
    update(id: string, patch: Partial<JobOffer>): Promise<JobOffer>;
    listForOrder(orderId: string): Promise<JobOffer[]>;
    listByOutcome(outcome: JobOfferOutcome): Promise<JobOffer[]>;
  };

  payouts: {
    create(input: CreateRunnerPayout): Promise<RunnerPayout>;
    findByOrderId(orderId: string): Promise<RunnerPayout | null>;
    listForRunner(runnerId: string): Promise<RunnerPayout[]>;
  };

  sets: {
    create(input: CreateRecurringSet): Promise<RecurringSet>;
    findById(id: string): Promise<RecurringSet | null>;
    update(id: string, patch: Partial<Omit<RecurringSet, 'items'>>): Promise<RecurringSet>;
    listForShopper(shopperId: string): Promise<RecurringSet[]>;
    listActive(): Promise<RecurringSet[]>;
  };

  oneTimeCodes: {
    create(input: CreateOneTimeCode): Promise<OneTimeCode>;
    findLatestUnconsumed(phone: string, role: AccountRole): Promise<OneTimeCode | null>;
    update(id: string, patch: Partial<OneTimeCode>): Promise<OneTimeCode>;
  };

  /** Close any underlying connection. */
  disconnect(): Promise<void>;
}
