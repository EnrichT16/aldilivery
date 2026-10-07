/**
 * Business analysis for staff (ruling 42): what is bought, where, when and by which groups,
 * with no names, numbers or addresses. Shown only to the founder and the business analyst.
 *
 * Every figure about people covers at least ten different people (rulings 13, 14 and 16):
 * a smaller group is shown as "fewer than 10" instead of its numbers, so nobody can be picked
 * out. Shops are businesses, so their totals are shown whatever their size.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AnalyticsEvent } from '../domain.js';
import { staffActor } from '../lib/staff.js';

export const MINIMUM_GROUP = 10;

const PERIODS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
} as const;

const WINDOWS: Array<[string, number]> = [
  ['second', 1000],
  ['minute', 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['4 hours', 4 * 60 * 60 * 1000],
  ['day', PERIODS.day],
  ['week', PERIODS.week],
  ['month', PERIODS.month],
  ['year', PERIODS.year],
];

interface Group {
  key: string;
  purchases: number;
  items: number;
  goodsPence: number;
  people: Set<string>;
}

function grouped(
  events: AnalyticsEvent[],
  keyOf: (event: AnalyticsEvent) => string[],
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const event of events) {
    for (const key of keyOf(event)) {
      const group = groups.get(key) ?? {
        key,
        purchases: 0,
        items: 0,
        goodsPence: 0,
        people: new Set(),
      };
      group.purchases += 1;
      group.items += event.itemCount;
      group.goodsPence += event.goodsPence;
      if (event.shopperKey) group.people.add(event.shopperKey);
      groups.set(key, group);
    }
  }
  return groups;
}

/** A group about people, or nothing at all if it is too small to keep anyone hidden. */
function aboutPeople(groups: Map<string, Group>) {
  const shown = [];
  let hidden = 0;
  for (const group of groups.values()) {
    if (group.people.size < MINIMUM_GROUP) {
      hidden += 1;
      continue;
    }
    shown.push({
      key: group.key,
      purchases: group.purchases,
      items: group.items,
      goodsPence: group.goodsPence,
      people: group.people.size,
    });
  }
  shown.sort((a, b) => b.purchases - a.purchases);
  return { rows: shown, hiddenGroups: hidden };
}

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now } = app.ctx;

  app.get('/staff/analytics', async (request) => {
    await staffActor(request, 'analytics');
    const { period } = z
      .object({ period: z.enum(['day', 'week', 'month', 'year']).default('month') })
      .parse(request.query);
    const at = now();
    const yearAgo = new Date(at.getTime() - PERIODS.year);
    const purchasesThisYear = await repository.analytics.list({
      since: yearAgo,
      kind: 'order_paid',
    });
    const since = new Date(at.getTime() - PERIODS[period]);
    const purchases = purchasesThisYear.filter((event) => event.at >= since);

    const windows = WINDOWS.map(([name, ms]) => {
      const inWindow = purchasesThisYear.filter((event) => event.at.getTime() > at.getTime() - ms);
      return {
        window: name,
        purchases: inWindow.length,
        goodsPence: inWindow.reduce((sum, event) => sum + event.goodsPence, 0),
      };
    });

    // Shops are businesses: their totals are shown whatever their size, but not their people
    // when there are fewer than ten.
    const shops = [...grouped(purchases, (event) => [event.shop ?? 'Unknown']).values()]
      .map((group) => ({
        shop: group.key,
        purchases: group.purchases,
        items: group.items,
        goodsPence: group.goodsPence,
        people: group.people.size >= MINIMUM_GROUP ? group.people.size : null,
      }))
      .sort((a, b) => b.purchases - a.purchases);

    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      purchases: purchases.filter((event) => event.at.getUTCHours() === hour).length,
    }));
    const weekdays = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ].map((day, index) => ({
      day,
      purchases: purchases.filter((event) => event.at.getUTCDay() === index).length,
    }));

    const runnersSeen = new Set(purchases.map((event) => event.runnerKey).filter(Boolean));
    const delivered = await repository.analytics.list({ since, kind: 'order_delivered' });
    const routes = [
      ...grouped(delivered, (event) => [
        `${event.shop ?? 'Unknown'} to ${event.toArea ?? 'unknown area'}`,
      ]).values(),
    ]
      .map((group) => ({ route: group.key, deliveries: group.purchases }))
      .sort((a, b) => b.deliveries - a.deliveries)
      .slice(0, 20);
    const travel = [
      ...grouped(delivered, (event) => [event.travelMode ?? 'not known']).values(),
    ].map((group) => ({ mode: group.key, deliveries: group.purchases }));

    const searches = await repository.analytics.list({ since });
    const termCounts = (kind: AnalyticsEvent['kind']) => {
      const counts = new Map<string, number>();
      for (const event of searches) {
        if (event.kind === kind && event.query)
          counts.set(event.query, (counts.get(event.query) ?? 0) + 1);
      }
      // A term typed only once could be anything, even a name: shown from twice up.
      return [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([term, count]) => ({ term, count }));
    };

    const organisationPurchases = purchases.filter((event) => event.viaOrganisation).length;

    return {
      period,
      minimumGroup: MINIMUM_GROUP,
      totals: {
        purchases: purchases.length,
        goodsPence: purchases.reduce((sum, event) => sum + event.goodsPence, 0),
        shoppers:
          new Set(purchases.map((event) => event.shopperKey)).size >= MINIMUM_GROUP
            ? new Set(purchases.map((event) => event.shopperKey)).size
            : null,
        runners: runnersSeen.size,
        throughOrganisations: organisationPurchases,
      },
      windows,
      shops,
      hours,
      weekdays,
      ageBands: aboutPeople(grouped(purchases, (event) => [event.ageBand ?? 'not given'])),
      areas: aboutPeople(grouped(purchases, (event) => [event.toArea ?? 'unknown'])),
      categories: [
        ...grouped(purchases, (event) => event.categories.split('|').filter(Boolean)).values(),
      ]
        .map((group) => ({ category: group.key, purchases: group.purchases, items: group.items }))
        .sort((a, b) => b.purchases - a.purchases)
        .slice(0, 30),
      routes,
      travel,
      topSearches: termCounts('search'),
      unmetSearches: termCounts('search_unmet'),
    };
  });
}
