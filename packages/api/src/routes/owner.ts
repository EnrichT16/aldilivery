/**
 * The owner's money, and the overview (7 October 2026, ruling 43).
 *
 * The money is for the owner's own account alone, signed in with the passcode: not the staff
 * key, not staff, not family, not investors. The overview is counts of people and work, with
 * no money in it, for the founder and anyone the owner switches it on for.
 */

import type { FastifyInstance } from 'fastify';

import type { IncomeRecord } from '../domain.js';
import { staffActor } from '../lib/staff.js';

const DAY = 24 * 60 * 60 * 1000;

function totals(rows: IncomeRecord[]) {
  const by = (key: (row: IncomeRecord) => string) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + row.amountPence);
    return [...map.entries()]
      .map(([name, pence]) => ({ name, pence }))
      .sort((a, b) => b.pence - a.pence);
  };
  return {
    inPence: rows
      .filter((row) => row.amountPence > 0)
      .reduce((sum, row) => sum + row.amountPence, 0),
    outPence: -rows
      .filter((row) => row.amountPence < 0)
      .reduce((sum, row) => sum + row.amountPence, 0),
    netPence: rows.reduce((sum, row) => sum + row.amountPence, 0),
    byGateway: by((row) => row.gateway),
    byKind: by((row) => row.kind),
  };
}

export async function registerOwnerRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now, payments } = app.ctx;

  app.get('/staff/money', async (request) => {
    await staffActor(request, 'money');
    const at = now();
    const startOfDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    const all = await repository.income.list({ since: new Date(0) });
    const since = (from: Date) => all.filter((row) => row.at >= from);
    return {
      // Which gateways are connected now. Flutterwave and Paystack join when they are.
      gateways: [
        {
          name: payments.mode === 'stripe' ? 'Stripe' : 'Stripe (rehearsal, no real money)',
          connected: payments.mode === 'stripe',
        },
      ],
      today: totals(since(startOfDay)),
      week: totals(since(new Date(at.getTime() - 7 * DAY))),
      month: totals(since(new Date(at.getTime() - 30 * DAY))),
      year: totals(since(new Date(at.getTime() - 365 * DAY))),
      allTime: totals(all),
      recent: all
        .slice(-50)
        .reverse()
        .map((row) => ({
          at: row.at,
          gateway: row.gateway,
          kind: row.kind,
          amountPence: row.amountPence,
          reference: row.reference,
        })),
    };
  });

  app.get('/staff/overview', async (request) => {
    await staffActor(request, 'overview');
    const at = now();
    const runners = await repository.runners.listAll();
    const available = await repository.runners.listAvailable();
    const shops = await repository.partnerShops.list();
    const organisations = await repository.organisations.list();
    const team = await repository.staffMembers.list();
    const paidToday = await repository.analytics.list({
      since: new Date(at.getTime() - DAY),
      kind: 'order_paid',
    });
    const paidWeek = await repository.analytics.list({
      since: new Date(at.getTime() - 7 * DAY),
      kind: 'order_paid',
    });
    const staffByJob = new Map<string, number>();
    for (const member of team) {
      if (!member.active) continue;
      staffByJob.set(member.role, (staffByJob.get(member.role) ?? 0) + 1);
    }
    return {
      people: {
        shoppers: await repository.shoppers.count(),
        runners: runners.length,
        runnersOnShiftNow: available.length,
        shopPartners: shops.filter((shop) => shop.active).length,
        organisations: organisations.filter((row) => row.active).length,
        staff: team.filter((member) => member.active).length,
      },
      staffByJob: [...staffByJob.entries()].map(([job, count]) => ({ job, count })),
      work: {
        ordersLastDay: new Set(paidToday.map((event) => event.shopperKey + event.at.toISOString()))
          .size,
        ordersLastWeek: new Set(paidWeek.map((event) => event.shopperKey + event.at.toISOString()))
          .size,
        problemsWaiting: (await repository.problems.listOpen()).length,
        documentsWaiting: (await repository.runnerDocuments.listSubmitted()).length,
        shopProductsWaiting: (await repository.partnerProducts.listPending()).length,
        findItWaiting: (await repository.findRequests.listLooking()).length,
      },
    };
  });
}
