/**
 * The PostgreSQL implementation of the repository, over Prisma.
 *
 * Every method here is a thin mapping. The rules live in the services and the routes, not
 * in the database layer, so that they are proved by tests that run without a database.
 */

import { PrismaClient } from '@prisma/client';

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
  return new PrismaClient(
    databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined,
  );
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
      async update(id, patch) {
        return (await prisma.shopper.update({
          where: { id },
          data: patch as any,
        })) as unknown as Shopper;
      },
    },

    runners: {
      async create(input) {
        return (await prisma.runner.create({ data: { ...input } as any })) as unknown as Runner;
      },
      async findById(id) {
        return (await prisma.runner.findUnique({ where: { id } })) as unknown as Runner | null;
      },
      async findByPhone(phone) {
        return (await prisma.runner.findUnique({ where: { phone } })) as unknown as Runner | null;
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
    },

    organisations: {
      async create(input) {
        return (await prisma.organisation.create({ data: { ...input } })) as any;
      },
      async findById(id) {
        return (await prisma.organisation.findUnique({ where: { id } })) as any;
      },
      async listServiceUsers(organisationId) {
        return (await prisma.shopper.findMany({ where: { organisationId } })) as unknown as Shopper[];
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
        const rows = await prisma.set.findMany({ where: { active: true }, include: { items: true } });
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

    async disconnect() {
      await prisma.$disconnect();
    },
  };
}
