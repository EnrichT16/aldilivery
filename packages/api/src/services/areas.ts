/**
 * Areas (Anthony, 30 October 2026). Ozi runs across the whole UK, area by area, and any area can
 * start first, with no waiting for Medway. An area is a UK postcode area (the letters a postcode
 * starts with; the London postcode areas are one area, London), from `areas` in
 * `config/store.json`.
 *
 * An area runs on its own once it has its triangle: Shoppers, an approved Runner able to work, and
 * a shop. It opens by itself when it has a Runner and a shop, and staff with the Areas tab can
 * pause it. In an area that is not running, people can still sign up; a Shopper is told plainly,
 * before paying, and nothing is taken. They go on the area's waiting list, and are texted once
 * when it starts, never in the quiet hours.
 *
 * Postcodes are turned into places with postcodes.io when they are saved, and kept; never asked
 * on every request, and a failure never stops a sign-up or an order: the area still comes from
 * the postcode's letters, with no place.
 */

import { areaName, areaOf, postcodeIn, tidyPostcode } from '@aldilivery/core';
import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { AreaWaiting, Organisation, PartnerShop, Runner, Shopper } from '../domain.js';
import type { PostcodePoint } from '../lib/postcodes.js';
import { loadShopsSeed, type SeedShop } from '../lib/shops-seed.js';
import { inQuietHours } from './owner-desk.js';
import { hasAgreed } from './runner-agreement.js';

export type AreasContext = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'findPostcode' | 'env' | 'sendText'>>;

/** A postcode postcodes.io did not know, or could not be asked about, is asked again after this. */
const ASK_AGAIN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The area of a postcode or an address, or null when it has no postcode to go by. */
export function areaFor(config: AppContext['config'], text: string): string | null {
  return areaOf(text, config.areas);
}

/** What an area is called, for people: "Manchester", "London", or its letters. */
export function areaCalled(config: AppContext['config'], area: string): string {
  return areaName(area, config.areas);
}

/* ------------------------------------------------------------------ places */

/** The kept place of the postcode in this text, without asking anybody. */
export async function knownPlace(ctx: AreasContext, text: string): Promise<PostcodePoint | null> {
  const postcode = postcodeIn(text);
  if (postcode === '') return null;
  const kept = await ctx.repository.postcodes.find(postcode);
  return kept?.found && kept.latitude !== null && kept.longitude !== null
    ? { latitude: kept.latitude, longitude: kept.longitude }
    : null;
}

/**
 * The place of the postcode in this text: the one kept, or asked of postcodes.io once and kept.
 * Called when a postcode is saved. Never throws: anything that goes wrong is no place.
 */
export async function locatePostcode(
  ctx: AreasContext,
  text: string,
  log?: FastifyBaseLogger,
): Promise<PostcodePoint | null> {
  const postcode = postcodeIn(text);
  if (postcode === '') return null;
  try {
    const kept = await ctx.repository.postcodes.find(postcode);
    const at = ctx.now();
    if (kept && (kept.found || at.getTime() - kept.lookedUpAt.getTime() < ASK_AGAIN_MS)) {
      return kept.found && kept.latitude !== null && kept.longitude !== null
        ? { latitude: kept.latitude, longitude: kept.longitude }
        : null;
    }
    if (!ctx.findPostcode) return null;
    let point: PostcodePoint | null = null;
    try {
      point = await ctx.findPostcode(postcode);
    } catch (failure) {
      log?.warn({ err: failure }, 'A postcode could not be looked up; its area is used alone.');
    }
    await ctx.repository.postcodes.save({
      postcode,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      found: point !== null,
      lookedUpAt: at,
    });
    return point;
  } catch (failure) {
    log?.warn({ err: failure }, 'A postcode place could not be kept.');
    return null;
  }
}

/** Looks the postcode up in the background, so nothing waits for it. */
export function locateLater(ctx: AreasContext, text: string, log?: FastifyBaseLogger): void {
  if (postcodeIn(text) === '') return;
  void locatePostcode(ctx, text, log);
}

/* ------------------------------------------------------------------ Runners and shops */

/**
 * An approved Runner able to work: right to work and DBS verified, the agreement agreed, the face
 * photo accepted, not left, and not the demo Runner.
 */
export function ableToWork(runner: Runner): boolean {
  return (
    runner.rightToWorkVerified &&
    runner.criminalRecordCheckVerified &&
    runner.facePhotoAcceptedAt !== null &&
    hasAgreed(runner) &&
    !runner.leftAt &&
    !runner.isDemo
  );
}

/** A Runner's own area: where they live, from their home postcode. Null until they give one. */
export function runnerArea(config: AppContext['config'], runner: Runner): string | null {
  return runner.homePostcode.trim() === '' ? null : areaFor(config, runner.homePostcode);
}

/** Where the Runner's phone last said they were, if it said so recently enough to trust. */
export function livePosition(
  config: AppContext['config'],
  runner: Pick<Runner, 'latitude' | 'longitude' | 'locationAt'>,
  at: Date,
): PostcodePoint | null {
  if (runner.latitude === null || runner.longitude === null || !runner.locationAt) return null;
  const ageMs = at.getTime() - runner.locationAt.getTime();
  if (ageMs > config.areas.livePositionMinutes * 60_000) return null;
  return { latitude: runner.latitude, longitude: runner.longitude };
}

/**
 * Where each Runner is taken to be, for distance: their live position while it is recent, or
 * else their home postcode's place, or null when neither is known (Anthony, 30 October 2026).
 */
export async function runnerPositions(
  ctx: AreasContext,
  runners: readonly Runner[],
  at: Date,
): Promise<Map<string, PostcodePoint | null>> {
  const homes = new Map(
    (
      await ctx.repository.postcodes.findMany([
        ...new Set(runners.map((runner) => tidyPostcode(runner.homePostcode)).filter(Boolean)),
      ])
    ).map((place) => [place.postcode, place]),
  );
  const positions = new Map<string, PostcodePoint | null>();
  for (const runner of runners) {
    const live = livePosition(ctx.config, runner, at);
    const home = homes.get(tidyPostcode(runner.homePostcode));
    positions.set(
      runner.id,
      live ??
        (home?.found && home.latitude !== null && home.longitude !== null
          ? { latitude: home.latitude, longitude: home.longitude }
          : null),
    );
  }
  return positions;
}

/** A partner that sells things (a shop, café or takeaway; not a service), approved and open. */
function isOpenShop(shop: PartnerShop): boolean {
  return shop.status === 'approved' && shop.active && shop.kind !== 'service';
}

/* ------------------------------------------------------------------ whether an area runs */

export type AreaNeed = 'runner' | 'shop';

export interface AreaState {
  area: string;
  name: string;
  /** It has an approved Runner able to work and a shop. */
  ready: boolean;
  paused: boolean;
  /** Ready and not paused: orders are taken. */
  running: boolean;
  /** What it still needs to be ready. */
  needs: AreaNeed[];
}

/** Everything the area rules look at, read once. */
interface AreaFacts {
  runners: Runner[];
  shops: PartnerShop[];
  seed: SeedShop[];
  paused: Map<string, boolean>;
}

async function readFacts(ctx: AreasContext): Promise<AreaFacts> {
  let seed: SeedShop[] = [];
  try {
    seed = loadShopsSeed(ctx.env?.storeConfigPath);
  } catch {
    seed = [];
  }
  return {
    runners: await ctx.repository.runners.listAll(),
    shops: await ctx.repository.partnerShops.list(),
    seed,
    paused: new Map(
      (await ctx.repository.areas.list()).map((row) => [row.area, row.pausedAt !== null]),
    ),
  };
}

function stateFrom(ctx: AreasContext, facts: AreaFacts, area: string): AreaState {
  const { config } = ctx;
  const runner = facts.runners.some((r) => ableToWork(r) && runnerArea(config, r) === area);
  const listed = new Set(facts.shops.map((shop) => shop.seedKey).filter(Boolean));
  const shop =
    facts.shops.some((s) => isOpenShop(s) && areaFor(config, s.postcode) === area) ||
    facts.seed.some(
      (s) => s.kind !== 'service' && !listed.has(s.key) && areaFor(config, s.postcode) === area,
    );
  const needs: AreaNeed[] = [
    ...(runner ? [] : ['runner' as const]),
    ...(shop ? [] : ['shop' as const]),
  ];
  const paused = facts.paused.get(area) === true;
  return {
    area,
    name: areaCalled(config, area),
    ready: needs.length === 0,
    paused,
    running: needs.length === 0 && !paused,
    needs,
  };
}

/** Whether an area is ready, paused and running, and what it still needs. */
export async function areaState(ctx: AreasContext, area: string): Promise<AreaState> {
  return stateFrom(ctx, await readFacts(ctx), area);
}

/** "Not ready yet (needs: a Runner / a shop)": for staff. */
export function areaStatusWords(state: AreaState): string {
  if (state.paused) return 'Paused';
  if (state.ready) return 'Ready';
  const needs = state.needs.map((need) => (need === 'runner' ? 'a Runner' : 'a shop'));
  return `Not ready yet (needs: ${needs.join(' / ')})`;
}

/** What a Shopper is told about whether we run where they are. */
export function runningWords(config: AppContext['config'], state: AreaState): string {
  return state.running
    ? config.areas.runningWords.replace('{area}', state.name)
    : config.areas.notRunningWords.replace('{area}', state.name);
}

/* ------------------------------------------------------------------ the waiting list */

/**
 * Puts a Shopper on the waiting list of the area of this address, when it is not running. Once
 * per area; returns the area's state, or null when the address has no postcode to go by.
 */
export async function waitIfNotRunning(
  ctx: AreasContext,
  shopper: Pick<Shopper, 'id'>,
  address: string,
): Promise<AreaState | null> {
  const area = areaFor(ctx.config, address);
  if (!area) return null;
  const state = await areaState(ctx, area);
  if (!state.running) {
    await ctx.repository.areaWaiting.add({
      area,
      shopperId: shopper.id,
      postcode: postcodeIn(address),
      createdAt: ctx.now(),
    });
  }
  return state;
}

/**
 * Texts each area's waiting list once when the area is running (Anthony, 30 October 2026), with
 * the existing texts (sendText), never in the quiet hours. Run on a timer by the server. Each
 * person is marked texted whether or not the text went, as the owner's alerts are, so a number
 * that cannot be texted is not tried every minute for ever. Returns how many were texted.
 */
export async function sweepAreas(ctx: AreasContext, log?: FastifyBaseLogger): Promise<number> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const waiting = (await repository.areaWaiting.list()).filter((row) => row.textedAt === null);
  if (waiting.length === 0) return 0;
  const facts = await readFacts(ctx);
  const byArea = new Map<string, AreaWaiting[]>();
  for (const row of waiting) byArea.set(row.area, [...(byArea.get(row.area) ?? []), row]);

  const quiet = inQuietHours(at, config.areas.textQuietFrom, config.areas.textQuietUntil);
  let texted = 0;
  for (const [area, rows] of byArea) {
    const state = stateFrom(ctx, facts, area);
    if (!state.running) continue;
    const record = await repository.areas.find(area);
    if (!record?.startedAt) await repository.areas.save(area, { startedAt: at });
    // Without Twilio nothing can be texted: they wait, rather than being marked as told.
    if (quiet || !ctx.sendText) continue;
    const words = config.areas.startedWords.replace('{area}', state.name);
    for (const row of rows) {
      const shopper = await repository.shoppers.findById(row.shopperId);
      await repository.areaWaiting.markTexted(row.id, at);
      if (!shopper || shopper.erasedAt) continue;
      try {
        await ctx.sendText(shopper.phone, words);
        texted += 1;
      } catch (failure) {
        log?.warn({ err: failure, area }, 'A waiting-list text did not go.');
      }
    }
  }
  return texted;
}

/* ------------------------------------------------------------------ the Areas page */

export interface AreaSummary extends AreaState {
  statusWords: string;
  shoppers: number;
  runnersApproved: number;
  runnersWaiting: number;
  shopsApproved: number;
  shopsWaiting: number;
  organisations: number;
  waitingList: number;
  ordersToday: number;
  ordersThisWeek: number;
  pausedBy: string | null;
  pausedAt: Date | null;
  startedAt: Date | null;
}

/** The area an organisation is in: its own postcode, or else where most of its people live. */
function organisationArea(
  config: AppContext['config'],
  organisation: Organisation,
  shoppers: readonly Shopper[],
): string | null {
  const own = areaFor(config, organisation.postcode);
  if (own) return own;
  const counts = new Map<string, number>();
  for (const shopper of shoppers) {
    if (shopper.organisationId !== organisation.id) continue;
    const area = areaFor(config, shopper.deliveryAddress);
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  );
}

/**
 * Every area anybody is in, with its counts and status, most active first: orders this week,
 * then today, then how many people and shops it has (Anthony, 30 October 2026).
 */
export async function areaSummaries(ctx: AreasContext): Promise<AreaSummary[]> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const facts = await readFacts(ctx);
  const records = new Map((await repository.areas.list()).map((row) => [row.area, row]));
  const shoppers = (await repository.admin.listShoppersCreated({ since: new Date(0) })).filter(
    (shopper) => !shopper.erasedAt && !shopper.isDemo,
  );
  const organisations = await repository.organisations.list();
  const waiting = (await repository.areaWaiting.list()).filter((row) => row.textedAt === null);
  const startOfDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const orders = (
    await repository.admin.listOrders({
      since: new Date(at.getTime() - 7 * DAY_MS),
      limit: 100_000,
    })
  ).filter((order) => order.status !== 'draft' && !order.isDemo && !order.splitParentId);

  const rows = new Map<
    string,
    Omit<AreaSummary, keyof AreaState | 'statusWords' | 'pausedBy' | 'pausedAt' | 'startedAt'>
  >();
  const row = (area: string | null) => {
    if (!area) return null;
    let found = rows.get(area);
    if (!found) {
      found = {
        shoppers: 0,
        runnersApproved: 0,
        runnersWaiting: 0,
        shopsApproved: 0,
        shopsWaiting: 0,
        organisations: 0,
        waitingList: 0,
        ordersToday: 0,
        ordersThisWeek: 0,
      };
      rows.set(area, found);
    }
    return found;
  };

  for (const shopper of shoppers) {
    const counts = row(areaFor(config, shopper.deliveryAddress));
    if (counts) counts.shoppers += 1;
  }
  for (const runner of facts.runners) {
    if (runner.leftAt || runner.isDemo) continue;
    const counts = row(runnerArea(config, runner));
    if (!counts) continue;
    if (ableToWork(runner)) counts.runnersApproved += 1;
    else counts.runnersWaiting += 1;
  }
  const listed = new Set(facts.shops.map((shop) => shop.seedKey).filter(Boolean));
  for (const shop of facts.shops) {
    if (shop.kind === 'service') continue;
    const counts = row(areaFor(config, shop.postcode));
    if (!counts) continue;
    if (isOpenShop(shop)) counts.shopsApproved += 1;
    else if (shop.status === 'pending') counts.shopsWaiting += 1;
  }
  for (const shop of facts.seed) {
    if (shop.kind === 'service' || listed.has(shop.key)) continue;
    const counts = row(areaFor(config, shop.postcode));
    if (counts) counts.shopsApproved += 1;
  }
  for (const organisation of organisations) {
    if (!organisation.active) continue;
    const counts = row(organisationArea(config, organisation, shoppers));
    if (counts) counts.organisations += 1;
  }
  for (const entry of waiting) {
    const counts = row(entry.area);
    if (counts) counts.waitingList += 1;
  }
  for (const order of orders) {
    const counts = row(areaFor(config, order.deliveryAddress));
    if (!counts) continue;
    counts.ordersThisWeek += 1;
    if (order.createdAt >= startOfDay) counts.ordersToday += 1;
  }
  for (const area of records.keys()) row(area);

  const summaries: AreaSummary[] = [...rows.entries()].map(([area, counts]) => {
    const state = stateFrom(ctx, facts, area);
    const record = records.get(area);
    return {
      ...state,
      ...counts,
      statusWords: areaStatusWords(state),
      pausedBy: record?.pausedAt ? (record.pausedBy ?? null) : null,
      pausedAt: record?.pausedAt ?? null,
      startedAt: record?.startedAt ?? null,
    };
  });
  const people = (s: AreaSummary) =>
    s.shoppers + s.runnersApproved + s.runnersWaiting + s.shopsApproved + s.organisations;
  return summaries.sort(
    (a, b) =>
      b.ordersThisWeek - a.ordersThisWeek ||
      b.ordersToday - a.ordersToday ||
      people(b) - people(a) ||
      b.waitingList - a.waitingList ||
      a.name.localeCompare(b.name),
  );
}

/** Pauses an area, or lets it run again, recording who decided. */
export async function setAreaPaused(
  ctx: AreasContext,
  area: string,
  paused: boolean,
  by: string,
): Promise<AreaState> {
  await ctx.repository.areas.save(
    area,
    paused ? { pausedAt: ctx.now(), pausedBy: by } : { pausedAt: null, pausedBy: by },
  );
  return areaState(ctx, area);
}
