/**
 * The PostgreSQL implementation of the repository, over Prisma.
 *
 * Every method here is a thin mapping. The rules live in the services and the routes, not
 * in the database layer, so that they are proved by tests that run without a database.
 */

import { PrismaClient } from '@prisma/client';

import { newReferralCode } from '../lib/referral.js';

import type { OrderStatus } from '@aldilivery/core';

import type {
  AccountRole,
  CatalogueItem,
  JobOffer,
  JobOfferOutcome,
  Order,
  OrderItem,
  RecurringSet,
  Runner,
  Shopper,
} from '../domain.js';
import type { CatalogueSearchOptions, Repository } from './repository.js';

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);
}

function toOrder(row: any): Order {
  return {
    ...row,
    items: (row.items ?? []).map((item: any) => ({ ...item })) as OrderItem[],
  } as Order;
}

function toSet(row: any): RecurringSet {
  return { ...row, items: (row.items ?? []).map((item: any) => ({ ...item })) } as RecurringSet;
}

export function prismaRepository(prisma: PrismaClient): Repository {
  return {
    shoppers: {
      async create(input) {
        return (await prisma.shopper.create({ data: { ...input } })) as unknown as Shopper;
      },
      async findById(id) {
        return (await prisma.shopper.findUnique({ where: { id } })) as unknown as Shopper | null;
      },
      async findByPhone(phone) {
        return (await prisma.shopper.findUnique({ where: { phone } })) as unknown as Shopper | null;
      },
      async findByHandle(handle) {
        return (await prisma.shopper.findUnique({
          where: { handle },
        })) as unknown as Shopper | null;
      },
      async findByFamilyCode(code) {
        return (await prisma.shopper.findUnique({
          where: { familyCode: code },
        })) as unknown as Shopper | null;
      },
      async count() {
        return prisma.shopper.count();
      },
      async listReferred() {
        return (await prisma.shopper.findMany({
          where: {
            OR: [
              { joinedVia: { startsWith: 'shopper:' } },
              { joinedVia: { startsWith: 'runner:' } },
            ],
          },
          orderBy: { createdAt: 'asc' },
        })) as unknown as Shopper[];
      },
      async countJoinedVia(via) {
        return prisma.shopper.count({ where: { joinedVia: via } });
      },
      async listFamily(ownerId) {
        return (await prisma.shopper.findMany({
          where: { familyOwnerId: ownerId },
          orderBy: { createdAt: 'asc' },
        })) as unknown as Shopper[];
      },
      async update(id, patch) {
        return (await prisma.shopper.update({
          where: { id },
          data: patch as any,
        })) as unknown as Shopper;
      },
    },

    runners: {
      async create(input) {
        return (await prisma.runner.create({
          data: {
            ...input,
            referralCode: input.referralCode ?? newReferralCode('R'),
            travelModes: input.travelModes ?? [input.vehicleType ?? 'on_foot'],
          } as any,
        })) as unknown as Runner;
      },
      async findById(id) {
        return (await prisma.runner.findUnique({ where: { id } })) as unknown as Runner | null;
      },
      async findByPhone(phone) {
        return (await prisma.runner.findUnique({ where: { phone } })) as unknown as Runner | null;
      },
      async findByReferralCode(referralCode) {
        return (await prisma.runner.findUnique({
          where: { referralCode },
        })) as unknown as Runner | null;
      },
      async update(id, patch) {
        return (await prisma.runner.update({
          where: { id },
          data: patch as any,
        })) as unknown as Runner;
      },
      async listAvailable() {
        return (await prisma.runner.findMany({
          where: { available: true },
          orderBy: [{ lastJobCompletedAt: 'asc' }, { createdAt: 'asc' }],
        })) as unknown as Runner[];
      },
      async delete(id) {
        // Checks, offers and payouts go with the Runner, by cascade in the schema.
        await prisma.runner.delete({ where: { id } });
      },
      async listAll() {
        return (await prisma.runner.findMany({
          orderBy: { createdAt: 'asc' },
        })) as unknown as Runner[];
      },
    },

    runnerDocuments: {
      async create(input) {
        return (await prisma.runnerDocument.create({ data: input as any })) as any;
      },
      async findById(id) {
        return (await prisma.runnerDocument.findUnique({ where: { id } })) as any;
      },
      async listForRunner(runnerId) {
        return (await prisma.runnerDocument.findMany({
          where: { runnerId },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async listSubmitted() {
        return (await prisma.runnerDocument.findMany({
          where: { status: 'submitted' },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.runnerDocument.update({ where: { id }, data: patch as any })) as any;
      },
    },

    sos: {
      async create(input) {
        return (await prisma.runnerSos.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.runnerSos.findUnique({ where: { id } })) as any;
      },
      async findByLinkCodeHash(linkCodeHash) {
        return (await prisma.runnerSos.findUnique({ where: { linkCodeHash } })) as any;
      },
      async findActiveForRunner(runnerId) {
        return (await prisma.runnerSos.findFirst({
          where: { runnerId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        })) as any;
      },
      async listSince(since) {
        return (await prisma.runnerSos.findMany({
          where: { OR: [{ endedAt: null }, { startedAt: { gte: since } }] },
          orderBy: { startedAt: 'desc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.runnerSos.update({ where: { id }, data: patch })) as any;
      },
    },

    referralRewards: {
      async create(input) {
        return (await prisma.referralReward.create({ data: input })) as any;
      },
      async list() {
        return (await prisma.referralReward.findMany({ orderBy: { createdAt: 'asc' } })) as any;
      },
    },

    runnerFeedback: {
      async create(input) {
        return (await prisma.runnerFeedback.create({ data: input })) as any;
      },
      async list() {
        return (await prisma.runnerFeedback.findMany({ orderBy: { createdAt: 'desc' } })) as any;
      },
    },

    problems: {
      async create(input) {
        return (await prisma.problemReport.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.problemReport.findUnique({ where: { id } })) as any;
      },
      async listForOrder(orderId) {
        return (await prisma.problemReport.findMany({
          where: { orderId },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async listOpen() {
        return (await prisma.problemReport.findMany({
          where: { status: 'open' },
          orderBy: { decideBy: 'asc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.problemReport.update({ where: { id }, data: patch as any })) as any;
      },
    },

    problemEvidence: {
      async create(input) {
        return (await prisma.problemEvidence.create({ data: input as any })) as any;
      },
      async findById(id) {
        return (await prisma.problemEvidence.findUnique({ where: { id } })) as any;
      },
      async listForReport(reportId) {
        return (await prisma.problemEvidence.findMany({
          where: { reportId },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
    },

    recoveries: {
      async create(input) {
        return (await prisma.runnerRecovery.create({ data: input })) as any;
      },
      async listOutstanding(runnerId) {
        const rows = await prisma.runnerRecovery.findMany({
          where: { runnerId, writtenOff: false },
          orderBy: { createdAt: 'asc' },
        });
        return rows.filter((row) => row.recoveredPence < row.amountPence) as any;
      },
      async listAllOutstanding() {
        const rows = await prisma.runnerRecovery.findMany({
          where: { writtenOff: false },
          orderBy: { createdAt: 'asc' },
        });
        return rows.filter((row) => row.recoveredPence < row.amountPence) as any;
      },
      async update(id, patch) {
        return (await prisma.runnerRecovery.update({ where: { id }, data: patch })) as any;
      },
    },

    calls: {
      async create(input) {
        return (await prisma.call.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.call.findUnique({ where: { id } })) as any;
      },
      async findByRoomName(roomName) {
        return (await prisma.call.findUnique({ where: { roomName } })) as any;
      },
      async findOpenForOrder(orderId) {
        return (await prisma.call.findFirst({
          where: { orderId, status: { not: 'ended' } },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async listChargesDue(shopperId) {
        return (await prisma.call.findMany({
          where: { shopperId, status: 'ended', chargeStatus: { in: ['pending', 'outstanding'] } },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.call.update({ where: { id }, data: patch })) as any;
      },
    },

    callLegs: {
      async create(input) {
        return (await prisma.callLeg.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.callLeg.findUnique({ where: { id } })) as any;
      },
      async listForCall(callId) {
        return (await prisma.callLeg.findMany({
          where: { callId },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
      async findByInviteCodeHash(inviteCodeHash) {
        return (await prisma.callLeg.findUnique({ where: { inviteCodeHash } })) as any;
      },
      async update(id, patch) {
        return (await prisma.callLeg.update({ where: { id }, data: patch })) as any;
      },
    },

    savedAddresses: {
      async create(input) {
        return (await prisma.savedAddress.create({ data: input })) as any;
      },
      async listForShopper(shopperId) {
        return (await prisma.savedAddress.findMany({
          where: { shopperId },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
      async findById(id) {
        return (await prisma.savedAddress.findUnique({ where: { id } })) as any;
      },
      async delete(id) {
        await prisma.savedAddress.deleteMany({ where: { id } });
      },
    },

    pushSubscriptions: {
      async save(input) {
        return (await prisma.pushSubscription.upsert({
          where: { endpoint: input.endpoint },
          create: input,
          update: { shopperId: input.shopperId, p256dh: input.p256dh, auth: input.auth },
        })) as any;
      },
      async listForShopper(shopperId) {
        return (await prisma.pushSubscription.findMany({ where: { shopperId } })) as any;
      },
      async deleteByEndpoint(endpoint) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint } });
      },
    },

    itemQuestions: {
      async create(input) {
        return (await prisma.itemQuestion.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.itemQuestion.findUnique({ where: { id } })) as any;
      },
      async listForOrder(orderId) {
        return (await prisma.itemQuestion.findMany({
          where: { orderId },
          orderBy: { askedAt: 'asc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.itemQuestion.update({ where: { id }, data: patch as any })) as any;
      },
    },

    runnerChecks: {
      async create(input) {
        return (await prisma.runnerCheck.create({ data: input as any })) as any;
      },
      async listForRunner(runnerId) {
        return (await prisma.runnerCheck.findMany({
          where: { runnerId },
          orderBy: { checkedAt: 'asc' },
        })) as any;
      },
    },

    organisations: {
      async create(input) {
        return (await prisma.organisation.create({ data: { ...input } })) as any;
      },
      async findById(id) {
        return (await prisma.organisation.findUnique({ where: { id } })) as any;
      },
      async listServiceUsers(organisationId) {
        return (await prisma.shopper.findMany({
          where: { organisationId },
        })) as unknown as Shopper[];
      },
      async findByJoinCode(code) {
        return (await prisma.organisation.findUnique({ where: { joinCode: code } })) as any;
      },
      async list() {
        return (await prisma.organisation.findMany({ orderBy: { createdAt: 'asc' } })) as any;
      },
      async update(id, patch) {
        return (await prisma.organisation.update({ where: { id }, data: patch })) as any;
      },
    },

    circles: {
      async create(name) {
        return (await prisma.householdCircle.create({ data: { name } })) as any;
      },
      async addMember(circleId, shopperId, consent) {
        return (await prisma.householdCircleMember.create({
          data: { circleId, shopperId, ...consent },
        })) as any;
      },
      async listMembers(circleId) {
        return (await prisma.householdCircleMember.findMany({ where: { circleId } })) as any;
      },
    },

    catalogue: {
      async create(input) {
        return (await prisma.catalogueItem.create({
          data: { ...input } as any,
        })) as unknown as CatalogueItem;
      },
      async findById(id) {
        return (await prisma.catalogueItem.findUnique({
          where: { id },
        })) as unknown as CatalogueItem | null;
      },
      async findManyByIds(ids) {
        return (await prisma.catalogueItem.findMany({
          where: { id: { in: ids } },
        })) as unknown as CatalogueItem[];
      },
      async search(query, options: CatalogueSearchOptions = {}) {
        return (await prisma.catalogueItem.findMany({
          where: {
            ...(options.includeAgeRestricted ? {} : { ageRestricted: false }),
            retired: false,
            ...(options.category ? { category: options.category } : {}),
            ...(query.trim()
              ? {
                  OR: [
                    { name: { contains: query.trim(), mode: 'insensitive' as const } },
                    { category: { contains: query.trim(), mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          take: options.limit ?? 50,
        })) as unknown as CatalogueItem[];
      },
      async update(id, patch) {
        return (await prisma.catalogueItem.update({ where: { id }, data: patch })) as any;
      },
    },

    paymentMethods: {
      async create(input) {
        return (await prisma.paymentMethod.create({ data: { ...input } as any })) as any;
      },
      async findById(id) {
        return (await prisma.paymentMethod.findUnique({ where: { id } })) as any;
      },
      async listForShopper(shopperId) {
        return (await prisma.paymentMethod.findMany({ where: { shopperId } })) as any;
      },
    },

    orders: {
      async create(input) {
        const { items, ...rest } = input;
        const row = await prisma.order.create({
          data: {
            ...(rest as any),
            items: { create: items.map((item) => ({ ...item })) },
          },
          include: { items: true },
        });
        return toOrder(row);
      },
      async findById(id) {
        const row = await prisma.order.findUnique({ where: { id }, include: { items: true } });
        return row ? toOrder(row) : null;
      },
      async update(id, patch) {
        const row = await prisma.order.update({
          where: { id },
          data: patch as any,
          include: { items: true },
        });
        return toOrder(row);
      },
      async updateItem(itemId, patch) {
        return (await prisma.orderItem.update({
          where: { id: itemId },
          data: patch as any,
        })) as unknown as OrderItem;
      },
      async listForShopper(shopperId) {
        const rows = await prisma.order.findMany({
          where: { shopperId },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map(toOrder);
      },
      async listByStatus(status: OrderStatus) {
        const rows = await prisma.order.findMany({
          where: { status: status as any },
          include: { items: true },
        });
        return rows.map(toOrder);
      },
      async listByPool(poolId) {
        const rows = await prisma.order.findMany({ where: { poolId }, include: { items: true } });
        return rows.map(toOrder);
      },
      async listByReimbursementStatus(status) {
        const rows = await prisma.order.findMany({
          where: { reimbursementStatus: status },
          include: { items: true },
          orderBy: { updatedAt: 'desc' },
        });
        return rows.map(toOrder);
      },
      async countForRunner(runnerId) {
        return prisma.order.count({ where: { runnerId } });
      },
      async listForRunner(runnerId) {
        const rows = await prisma.order.findMany({
          where: { runnerId },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map(toOrder);
      },
    },

    offers: {
      async create(input) {
        return (await prisma.jobOffer.create({ data: { ...input } as any })) as unknown as JobOffer;
      },
      async findById(id) {
        return (await prisma.jobOffer.findUnique({ where: { id } })) as unknown as JobOffer | null;
      },
      async update(id, patch) {
        return (await prisma.jobOffer.update({
          where: { id },
          data: patch as any,
        })) as unknown as JobOffer;
      },
      async listForOrder(orderId) {
        return (await prisma.jobOffer.findMany({
          where: { orderId },
          orderBy: { offeredAt: 'asc' },
        })) as unknown as JobOffer[];
      },
      async listByOutcome(outcome: JobOfferOutcome) {
        return (await prisma.jobOffer.findMany({
          where: { outcome: outcome as any },
        })) as unknown as JobOffer[];
      },
    },

    payouts: {
      async create(input) {
        return (await prisma.runnerPayout.create({ data: { ...input } as any })) as any;
      },
      async findByOrderId(orderId) {
        return (await prisma.runnerPayout.findUnique({ where: { orderId } })) as any;
      },
      async listForRunner(runnerId) {
        return (await prisma.runnerPayout.findMany({ where: { runnerId } })) as any;
      },
    },

    sets: {
      async create(input) {
        const { items, ...rest } = input;
        const row = await prisma.set.create({
          data: { ...(rest as any), items: { create: items.map((item) => ({ ...item })) } },
          include: { items: true },
        });
        return toSet(row);
      },
      async findById(id) {
        const row = await prisma.set.findUnique({ where: { id }, include: { items: true } });
        return row ? toSet(row) : null;
      },
      async update(id, patch) {
        const row = await prisma.set.update({
          where: { id },
          data: patch as any,
          include: { items: true },
        });
        return toSet(row);
      },
      async listForShopper(shopperId) {
        const rows = await prisma.set.findMany({ where: { shopperId }, include: { items: true } });
        return rows.map(toSet);
      },
      async listActive() {
        const rows = await prisma.set.findMany({
          where: { active: true },
          include: { items: true },
        });
        return rows.map(toSet);
      },
    },

    oneTimeCodes: {
      async create(input) {
        return (await prisma.oneTimeCode.create({ data: { ...input } as any })) as any;
      },
      async findLatestUnconsumed(phone: string, role: AccountRole) {
        return (await prisma.oneTimeCode.findFirst({
          where: { phone, role: role as any, consumedAt: null },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async countSince(phone: string, since: Date) {
        return prisma.oneTimeCode.count({ where: { phone, createdAt: { gte: since } } });
      },
      async update(id, patch) {
        return (await prisma.oneTimeCode.update({ where: { id }, data: patch as any })) as any;
      },
    },

    findRequests: {
      async create(input) {
        return (await prisma.findRequest.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.findRequest.findUnique({ where: { id } })) as any;
      },
      async update(id, patch) {
        return (await prisma.findRequest.update({ where: { id }, data: patch })) as any;
      },
      async listForShopper(shopperId) {
        return (await prisma.findRequest.findMany({
          where: { shopperId },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async listLooking() {
        return (await prisma.findRequest.findMany({
          where: { status: 'looking' },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
    },

    giftCards: {
      async create(input) {
        return (await prisma.giftCard.create({ data: input })) as any;
      },
      async findByCode(code) {
        return (await prisma.giftCard.findUnique({ where: { code } })) as any;
      },
      async redeem(id, shopperId, at) {
        // Only one person can ever use a card: the update only matches an unused one.
        const { count } = await prisma.giftCard.updateMany({
          where: { id, redeemedByShopperId: null },
          data: { redeemedByShopperId: shopperId, redeemedAt: at },
        });
        if (count === 0) return null;
        return (await prisma.giftCard.findUnique({ where: { id } })) as any;
      },
      async listBoughtBy(shopperId) {
        return (await prisma.giftCard.findMany({
          where: { buyerShopperId: shopperId },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
    },

    organisationEnquiries: {
      async create(input) {
        return (await prisma.organisationEnquiry.create({ data: input })) as any;
      },
      async list() {
        return (await prisma.organisationEnquiry.findMany({
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async update(id, patch) {
        return (await prisma.organisationEnquiry.update({ where: { id }, data: patch })) as any;
      },
    },

    staffMembers: {
      async create(input) {
        return (await prisma.staffMember.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.staffMember.findUnique({ where: { id } })) as any;
      },
      async findByUsername(username) {
        return (await prisma.staffMember.findUnique({ where: { username } })) as any;
      },
      async list() {
        return (await prisma.staffMember.findMany({ orderBy: { createdAt: 'asc' } })) as any;
      },
      async update(id, patch) {
        return (await prisma.staffMember.update({ where: { id }, data: patch })) as any;
      },
    },

    partnerShops: {
      async create(input) {
        return (await prisma.partnerShop.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.partnerShop.findUnique({ where: { id } })) as any;
      },
      async list() {
        return (await prisma.partnerShop.findMany({ orderBy: { createdAt: 'asc' } })) as any;
      },
      async update(id, patch) {
        return (await prisma.partnerShop.update({ where: { id }, data: patch })) as any;
      },
    },

    partnerProducts: {
      async create(input) {
        const { photo, ...rest } = input;
        return (await prisma.partnerProduct.create({
          data: { ...rest, photo: photo ? Buffer.from(photo) : null },
        })) as any;
      },
      async findById(id) {
        return (await prisma.partnerProduct.findUnique({ where: { id } })) as any;
      },
      async update(id, patch) {
        const { photo, ...rest } = patch;
        return (await prisma.partnerProduct.update({
          where: { id },
          data: {
            ...rest,
            ...(photo !== undefined ? { photo: photo ? Buffer.from(photo) : null } : {}),
          },
        })) as any;
      },
      async listForShop(partnerShopId) {
        return (await prisma.partnerProduct.findMany({
          where: { partnerShopId },
          orderBy: { createdAt: 'desc' },
        })) as any;
      },
      async listPending() {
        return (await prisma.partnerProduct.findMany({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
    },

    businessUsers: {
      async create(input) {
        return (await prisma.businessUser.create({ data: input })) as any;
      },
      async findById(id) {
        return (await prisma.businessUser.findUnique({ where: { id } })) as any;
      },
      async findByUsername(username) {
        return (await prisma.businessUser.findUnique({ where: { username } })) as any;
      },
      async update(id, patch) {
        return (await prisma.businessUser.update({ where: { id }, data: patch })) as any;
      },
      async listFor(where) {
        return (await prisma.businessUser.findMany({
          where: {
            ...(where.partnerShopId !== undefined ? { partnerShopId: where.partnerShopId } : {}),
            ...(where.organisationId !== undefined ? { organisationId: where.organisationId } : {}),
          },
          orderBy: { createdAt: 'asc' },
        })) as any;
      },
    },

    partnerPayments: {
      async create(input) {
        return (await prisma.partnerPayment.create({ data: input })) as any;
      },
      async listForShop(partnerShopId) {
        return (await prisma.partnerPayment.findMany({
          where: { partnerShopId },
          orderBy: { paidAt: 'desc' },
        })) as any;
      },
    },

    spotlightMentions: {
      async create(input) {
        return (await prisma.spotlightMention.create({ data: input })) as any;
      },
      async listForShopperSince(shopperKey, since) {
        return (await prisma.spotlightMention.findMany({
          where: { shopperKey, at: { gte: since } },
        })) as any;
      },
      async countForShopSince(partnerShopId, since) {
        return prisma.spotlightMention.count({ where: { partnerShopId, at: { gte: since } } });
      },
    },

    analytics: {
      async record(input) {
        await prisma.analyticsEvent.create({ data: input });
      },
      async list(where) {
        return (await prisma.analyticsEvent.findMany({
          where: {
            at: { gte: where.since, ...(where.until ? { lt: where.until } : {}) },
            ...(where.kind ? { kind: where.kind } : {}),
          },
          orderBy: { at: 'asc' },
        })) as any;
      },
    },

    learned: {
      async heard({ account, text, at }) {
        await prisma.learnedPhrase.upsert({
          where: { account_text: { account, text } },
          create: { account, text, firstHeardAt: at, lastHeardAt: at },
          update: { timesHeard: { increment: 1 }, lastHeardAt: at },
        });
      },
      async list(status) {
        return (await prisma.learnedPhrase.findMany({
          where: { status },
          orderBy: [{ timesHeard: 'desc' }, { lastHeardAt: 'desc' }],
          take: 500,
        })) as any;
      },
      async findById(id) {
        return (await prisma.learnedPhrase.findUnique({ where: { id } })) as any;
      },
      async decide(id, patch) {
        return (await prisma.learnedPhrase.update({ where: { id }, data: patch })) as any;
      },
    },

    income: {
      async record(input) {
        await prisma.incomeRecord.create({ data: input });
      },
      async list(where) {
        return (await prisma.incomeRecord.findMany({
          where: { at: { gte: where.since, ...(where.until ? { lt: where.until } : {}) } },
          orderBy: { at: 'asc' },
        })) as any;
      },
    },

    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
