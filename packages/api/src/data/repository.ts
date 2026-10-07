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
      | 'travelModes'
      | 'referralCode'
      | 'referredBy'
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
      | 'paidBy'
      | 'bankReference'
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
  Partial<Pick<RunnerPayout, 'stripeTransferId' | 'recoveryWithheldPence'>>;

export type CreateOneTimeCode = Pick<OneTimeCode, 'phone' | 'codeHash' | 'expiresAt'> &
  /** `createdAt` from the route's clock, so the limits count on the same clock they check. */
  Partial<Pick<OneTimeCode, 'role' | 'createdAt'>>;

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
    /** The owner of the family plan with this code. */
    findByFamilyCode(code: string): Promise<Shopper | null>;
    /** Everybody who has joined this Shopper's family plan, oldest first. */
    listFamily(ownerId: string): Promise<Shopper[]>;
    /** How many accounts were opened through this share link. */
    countJoinedVia(via: string): Promise<number>;
    /** How many Shopper accounts there are. */
    count(): Promise<number>;
  };

  runners: {
    create(input: CreateRunner): Promise<Runner>;
    findById(id: string): Promise<Runner | null>;
    findByPhone(phone: string): Promise<Runner | null>;
    findByReferralCode(code: string): Promise<Runner | null>;
    update(id: string, patch: Partial<Runner>): Promise<Runner>;
    /** Every Runner who is on shift, verified, and not already holding an offer. */
    listAvailable(): Promise<Runner[]>;
    /** Every Runner, oldest first. For the approval tool, not for offering jobs. */
    listAll(): Promise<Runner[]>;
    /** Removes a Runner and their checks and offers. Only for one who has never had an order. */
    delete(id: string): Promise<void>;
  };

  /** Addresses Shoppers have saved, beyond their home address. */
  savedAddresses: {
    create(input: Omit<SavedAddress, 'id'>): Promise<SavedAddress>;
    /** Oldest first, the order they were saved in. */
    listForShopper(shopperId: string): Promise<SavedAddress[]>;
    findById(id: string): Promise<SavedAddress | null>;
    delete(id: string): Promise<void>;
  };

  /** What Runners send in at sign-up, and what a person decided about each. */
  runnerDocuments: {
    create(input: Omit<RunnerDocument, 'id'>): Promise<RunnerDocument>;
    findById(id: string): Promise<RunnerDocument | null>;
    /** Newest first. */
    listForRunner(runnerId: string): Promise<RunnerDocument[]>;
    /** Waiting for a person, oldest first. */
    listSubmitted(): Promise<RunnerDocument[]>;
    update(id: string, patch: Partial<Omit<RunnerDocument, 'id'>>): Promise<RunnerDocument>;
  };
  runnerFeedback: {
    create(input: Omit<RunnerFeedback, 'id'>): Promise<RunnerFeedback>;
    /** Newest first. */
    list(): Promise<RunnerFeedback[]>;
  };

  /** Problems with orders, their evidence, and what Runners found at fault repay. */
  problems: {
    create(input: Omit<ProblemReport, 'id'>): Promise<ProblemReport>;
    findById(id: string): Promise<ProblemReport | null>;
    listForOrder(orderId: string): Promise<ProblemReport[]>;
    /** Open ones, the soonest due first. */
    listOpen(): Promise<ProblemReport[]>;
    update(id: string, patch: Partial<Omit<ProblemReport, 'id'>>): Promise<ProblemReport>;
  };
  problemEvidence: {
    create(input: Omit<ProblemEvidence, 'id'>): Promise<ProblemEvidence>;
    findById(id: string): Promise<ProblemEvidence | null>;
    listForReport(reportId: string): Promise<ProblemEvidence[]>;
  };
  recoveries: {
    create(input: Omit<RunnerRecovery, 'id'>): Promise<RunnerRecovery>;
    /** Still owed (not fully recovered, not written off), oldest first. */
    listOutstanding(runnerId: string): Promise<RunnerRecovery[]>;
    /** Still owed, by every Runner, oldest first. */
    listAllOutstanding(): Promise<RunnerRecovery[]>;
    update(id: string, patch: Partial<Omit<RunnerRecovery, 'id'>>): Promise<RunnerRecovery>;
  };

  /** In-app calls (Section F) and each person's part in them. */
  calls: {
    create(input: Omit<Call, 'id'>): Promise<Call>;
    findById(id: string): Promise<Call | null>;
    findByRoomName(roomName: string): Promise<Call | null>;
    /** The call about this order that has not ended, if there is one. */
    findOpenForOrder(orderId: string): Promise<Call | null>;
    /** Calls whose charge is still to be taken (pending or outstanding), oldest first. */
    listChargesDue(shopperId: string): Promise<Call[]>;
    update(id: string, patch: Partial<Omit<Call, 'id'>>): Promise<Call>;
  };
  callLegs: {
    create(input: Omit<CallLeg, 'id'>): Promise<CallLeg>;
    findById(id: string): Promise<CallLeg | null>;
    listForCall(callId: string): Promise<CallLeg[]>;
    findByInviteCodeHash(hash: string): Promise<CallLeg | null>;
    update(id: string, patch: Partial<Omit<CallLeg, 'id'>>): Promise<CallLeg>;
  };

  /** The devices a Shopper has allowed to show notifications. */
  pushSubscriptions: {
    /** One row per device address: saving an address again moves it to this Shopper. */
    save(input: Omit<PushSubscription, 'id'>): Promise<PushSubscription>;
    listForShopper(shopperId: string): Promise<PushSubscription[]>;
    deleteByEndpoint(endpoint: string): Promise<void>;
  };

  /** A Runner's questions to a Shopper about things they cannot find. */
  itemQuestions: {
    create(input: Pick<ItemQuestion, 'orderId' | 'orderItemId' | 'askedAt'>): Promise<ItemQuestion>;
    findById(id: string): Promise<ItemQuestion | null>;
    /** Oldest first. */
    listForOrder(orderId: string): Promise<ItemQuestion[]>;
    update(id: string, patch: Partial<ItemQuestion>): Promise<ItemQuestion>;
  };

  /** The record of checks made on Runners. Only ever added to. */
  runnerChecks: {
    create(input: Omit<RunnerCheck, 'id'>): Promise<RunnerCheck>;
    /** Oldest first. */
    listForRunner(runnerId: string): Promise<RunnerCheck[]>;
  };

  organisations: {
    create(input: CreateOrganisation): Promise<Organisation>;
    findById(id: string): Promise<Organisation | null>;
    listServiceUsers(organisationId: string): Promise<Shopper[]>;
    findByJoinCode(code: string): Promise<Organisation | null>;
    /** Oldest first. */
    list(): Promise<Organisation[]>;
    update(id: string, patch: Partial<Omit<Organisation, 'id'>>): Promise<Organisation>;
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
    update(id: string, patch: Partial<Omit<CatalogueItem, 'id'>>): Promise<CatalogueItem>;
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
    /** How many orders a Runner has ever been given, of any status. */
    countForRunner(runnerId: string): Promise<number>;
    /** Every order a Runner has been given, newest first. */
    listForRunner(runnerId: string): Promise<Order[]>;
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
    /** How many codes were made for this number since a moment. Limits what a text costs. */
    countSince(phone: string, since: Date): Promise<number>;
    update(id: string, patch: Partial<OneTimeCode>): Promise<OneTimeCode>;
  };

  /** Ozi Finds It. */
  findRequests: {
    create(
      input: Pick<FindRequest, 'shopperId' | 'description' | 'feePence' | 'chargeId'>,
    ): Promise<FindRequest>;
    findById(id: string): Promise<FindRequest | null>;
    update(id: string, patch: Partial<Omit<FindRequest, 'id'>>): Promise<FindRequest>;
    /** Newest first. */
    listForShopper(shopperId: string): Promise<FindRequest[]>;
    /** Still being looked for, oldest first. */
    listLooking(): Promise<FindRequest[]>;
  };

  giftCards: {
    create(
      input: Pick<
        GiftCard,
        'code' | 'amountPence' | 'buyerShopperId' | 'chargeId' | 'recipientName' | 'message'
      >,
    ): Promise<GiftCard>;
    findByCode(code: string): Promise<GiftCard | null>;
    /** Marks it used, only if nobody has used it yet. Null when somebody already had. */
    redeem(id: string, shopperId: string, at: Date): Promise<GiftCard | null>;
    /** Newest first. */
    listBoughtBy(shopperId: string): Promise<GiftCard[]>;
  };

  organisationEnquiries: {
    create(
      input: Omit<OrganisationEnquiry, 'id' | 'handled' | 'createdAt'>,
    ): Promise<OrganisationEnquiry>;
    /** Newest first. */
    list(): Promise<OrganisationEnquiry[]>;
    update(id: string, patch: { handled: boolean }): Promise<OrganisationEnquiry>;
  };

  /** The people who run the service, each with their own admin sign-in. */
  staffMembers: {
    create(
      input: Pick<StaffMember, 'name' | 'username' | 'passwordHash' | 'role'> &
        Partial<Pick<StaffMember, 'isOwner' | 'passcodeHash' | 'mustChangePassword'>>,
    ): Promise<StaffMember>;
    findById(id: string): Promise<StaffMember | null>;
    findByUsername(username: string): Promise<StaffMember | null>;
    /** Oldest first. */
    list(): Promise<StaffMember[]>;
    update(id: string, patch: Partial<Omit<StaffMember, 'id'>>): Promise<StaffMember>;
  };

  partnerShops: {
    create(
      input: Pick<PartnerShop, 'name' | 'address' | 'telephone' | 'about' | 'monthlyPence'>,
    ): Promise<PartnerShop>;
    findById(id: string): Promise<PartnerShop | null>;
    /** Oldest first. */
    list(): Promise<PartnerShop[]>;
    update(id: string, patch: Partial<Omit<PartnerShop, 'id'>>): Promise<PartnerShop>;
  };

  partnerProducts: {
    create(
      input: Pick<
        PartnerProduct,
        'partnerShopId' | 'name' | 'pricePence' | 'tags' | 'expiresOn' | 'photo' | 'photoType'
      >,
    ): Promise<PartnerProduct>;
    findById(id: string): Promise<PartnerProduct | null>;
    update(id: string, patch: Partial<Omit<PartnerProduct, 'id'>>): Promise<PartnerProduct>;
    /** Newest first. */
    listForShop(partnerShopId: string): Promise<PartnerProduct[]>;
    /** Waiting for a person, oldest first. */
    listPending(): Promise<PartnerProduct[]>;
  };

  businessUsers: {
    create(
      input: Pick<
        BusinessUser,
        | 'kind'
        | 'partnerShopId'
        | 'organisationId'
        | 'name'
        | 'office'
        | 'username'
        | 'passwordHash'
      >,
    ): Promise<BusinessUser>;
    findById(id: string): Promise<BusinessUser | null>;
    findByUsername(username: string): Promise<BusinessUser | null>;
    update(id: string, patch: Partial<Omit<BusinessUser, 'id'>>): Promise<BusinessUser>;
    listFor(where: { partnerShopId?: string; organisationId?: string }): Promise<BusinessUser[]>;
  };

  partnerPayments: {
    create(input: Omit<PartnerPayment, 'id'>): Promise<PartnerPayment>;
    /** Newest first. */
    listForShop(partnerShopId: string): Promise<PartnerPayment[]>;
  };

  spotlightMentions: {
    create(input: Omit<SpotlightMention, 'id'>): Promise<SpotlightMention>;
    /** Mentions to one Shopper since a moment, of any shop. */
    listForShopperSince(shopperKey: string, since: Date): Promise<SpotlightMention[]>;
    countForShopSince(partnerShopId: string, since: Date): Promise<number>;
  };

  /** Business analysis: written once, never changed. */
  analytics: {
    record(input: Omit<AnalyticsEvent, 'id'>): Promise<void>;
    /** Oldest first, between two moments, optionally of one kind. */
    list(where: {
      since: Date;
      until?: Date;
      kind?: AnalyticsEvent['kind'];
    }): Promise<AnalyticsEvent[]>;
  };

  /** Money in and out, by gateway. */
  /** What Ozi could not answer, waiting for a person (ruling 49). */
  learned: {
    /** Counts it once more, or keeps it for the first time, whatever was decided before. */
    heard(input: { account: string; text: string; at: Date }): Promise<void>;
    list(status: LearnedPhrase['status']): Promise<LearnedPhrase[]>;
    findById(id: string): Promise<LearnedPhrase | null>;
    decide(
      id: string,
      patch: Pick<LearnedPhrase, 'status' | 'reply' | 'decidedBy' | 'decidedAt'>,
    ): Promise<LearnedPhrase>;
  };

  income: {
    record(input: Omit<IncomeRecord, 'id'>): Promise<void>;
    /** Oldest first. */
    list(where: { since: Date; until?: Date }): Promise<IncomeRecord[]>;
  };

  /** Close any underlying connection. */
  disconnect(): Promise<void>;
}
