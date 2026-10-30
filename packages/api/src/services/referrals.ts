/**
 * Referral links for everybody, the referral log and reward levels (Anthony, 30 October 2026).
 *
 * Every Shopper, Runner, shop partner and organisation has a personal link, and anyone can refer
 * anyone: a Shopper can bring a driver to sign up as a Runner, a Runner a Shopper, anybody a shop.
 * The link records who referred the new account, whatever kind it is (one `Referral` row each).
 * The link formats that already worked keep working, so links already shared, and the checkout's
 * "no Runner in your area" invitation, are never broken:
 *
 * - a Shopper's: `/join?via=shopper-<handle>`
 * - a Runner's: `/join?ref=<Runner ID>` (and `via=runner-<Runner ID>`)
 * - a shop partner's: `/join?via=partner-<shop id>`, and its shop page `/shops/<id>`
 * - an organisation's: `/join?via=organisation-<code>`, and its join page
 *   `/join/organisation/<code>`
 *
 * The same `via` on any page (`/runner/sign-up?via=shopper-margaret`, `/business/join?via=…`)
 * is kept on the device until sign-up completes, whichever kind of account is opened.
 *
 * ACTIVE, the real-person check (`activeStatus`), is worked out from what each account has done,
 * never stored:
 *
 * - a referred Shopper has had at least one order delivered;
 * - a referred Runner is approved and has completed at least one delivery;
 * - a referred shop partner is approved and has had at least one order;
 * - a referred organisation has at least one person linked.
 *
 * Reward levels (config `referrals`) replaced the Runner reward of £150 at 100 referrals: 20, 30
 * and 40 active referrals for a £10, £15 and £20 voucher, each counting only when at least 70% of
 * everyone who joined through the link is active. A level reached is kept; the owner is told once
 * on Ozi's desk; the person sees it on their dashboard and Ozi says it once; staff give the
 * voucher by hand and mark it given. Referred people are never shown to the referrer: they see
 * only their own counts. Only staff see the log.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  earnedWords,
  levelsReached,
  meetsActiveShare,
  nextLevel,
  ownerLevelWords,
  percentWords,
  progressWords,
  rewardWords,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  Organisation,
  PartnerShop,
  Referral,
  ReferralKind,
  ReferralLevelReached,
  Runner,
  Shopper,
} from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { ukPhone } from '../lib/phone.js';
import { areaCalled, areaFor, runnerArea } from './areas.js';
import { askOwner } from './owner-desk.js';
import { isApproved } from './runner-checks.js';

export type ReferralContext = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'env'>>;

export const REFERRAL_KINDS: readonly ReferralKind[] = [
  'shopper',
  'runner',
  'partner',
  'organisation',
];

export const KIND_WORDS: Record<ReferralKind, string> = {
  shopper: 'Shopper',
  runner: 'Runner',
  partner: 'Shop partner',
  organisation: 'Organisation',
};

/** A link's code as kept: kind:code, for example shopper:margaret or runner:R4K7Q2AB. */
export const VIA_PATTERN = /^(shopper|runner|partner|organisation|staff):([A-Za-z0-9_-]{1,40})$/;

export function isReferralKind(value: string): value is ReferralKind {
  return (REFERRAL_KINDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ who they are */

/** An account with a referral link, as much as the log needs. */
export interface ReferralAccount {
  kind: ReferralKind;
  id: string;
  name: string;
  /** Where it is, for staff: the UK area, or "Not known". */
  area: string;
  /** The code in its link. */
  code: string;
  /** Its phone numbers and email addresses, made comparable: no referring yourself. */
  phones: string[];
  emails: string[];
  /** A closed account: never active, and not in the log as a referrer. */
  closed: boolean;
}

function samePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  return ukPhone(value) ?? (value.replace(/\D/g, '') || null);
}

function sameEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase();
  return email === '' ? null : email;
}

function compact(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function areaWords(ctx: ReferralContext, area: string | null): string {
  return area ? areaCalled(ctx.config, area) : 'Not known';
}

function fromShopper(ctx: ReferralContext, shopper: Shopper): ReferralAccount {
  return {
    kind: 'shopper',
    id: shopper.id,
    name: shopper.displayName,
    area: areaWords(ctx, areaFor(ctx.config, shopper.deliveryAddress)),
    code: shopper.handle,
    phones: compact([samePhone(shopper.phone)]),
    emails: [],
    closed: Boolean(shopper.erasedAt),
  };
}

function fromRunner(ctx: ReferralContext, runner: Runner): ReferralAccount {
  return {
    kind: 'runner',
    id: runner.id,
    name: runner.name,
    area: areaWords(ctx, runnerArea(ctx.config, runner)),
    code: runner.referralCode,
    phones: compact([samePhone(runner.phone)]),
    emails: [],
    closed: Boolean(runner.leftAt),
  };
}

/** A shop's phone numbers and email, made comparable, for the no-introducing-yourself check. */
export function shopAsAccount(
  shop: PartnerShop,
): Pick<ReferralAccount, 'kind' | 'id' | 'phones' | 'emails'> {
  return {
    kind: 'partner',
    id: shop.id,
    phones: compact([samePhone(shop.mobile), samePhone(shop.telephone)]),
    emails: compact([sameEmail(shop.email)]),
  };
}

function fromShop(ctx: ReferralContext, shop: PartnerShop): ReferralAccount {
  return {
    kind: 'partner',
    id: shop.id,
    name: shop.name,
    area: areaWords(ctx, areaFor(ctx.config, shop.postcode || shop.address)),
    code: shop.id,
    phones: compact([samePhone(shop.mobile), samePhone(shop.telephone)]),
    emails: compact([sameEmail(shop.email)]),
    closed: shop.status === 'removed',
  };
}

function fromOrganisation(ctx: ReferralContext, organisation: Organisation): ReferralAccount {
  return {
    kind: 'organisation',
    id: organisation.id,
    name: organisation.name,
    area: areaWords(ctx, areaFor(ctx.config, organisation.postcode)),
    code: organisation.joinCode ?? organisation.id,
    phones: compact([samePhone(organisation.contactPhone)]),
    emails: compact([sameEmail(organisation.contactEmail)]),
    closed: !organisation.active,
  };
}

/** The account of this kind and id, or null when there is none. */
export async function findAccount(
  ctx: ReferralContext,
  kind: ReferralKind,
  id: string,
): Promise<ReferralAccount | null> {
  const { repository } = ctx;
  switch (kind) {
    case 'shopper': {
      const found = await repository.shoppers.findById(id);
      return found ? fromShopper(ctx, found) : null;
    }
    case 'runner': {
      const found = await repository.runners.findById(id);
      return found ? fromRunner(ctx, found) : null;
    }
    case 'partner': {
      const found = await repository.partnerShops.findById(id);
      return found ? fromShop(ctx, found) : null;
    }
    case 'organisation': {
      const found = await repository.organisations.findById(id);
      return found ? fromOrganisation(ctx, found) : null;
    }
  }
}

/**
 * Whose link this is, from its kind:code. Staff links are counted on the Shopper as before, but
 * staff are not in the referral reward levels, so they give null here.
 */
export async function resolveVia(
  ctx: ReferralContext,
  via: string | null | undefined,
): Promise<ReferralAccount | null> {
  const match = VIA_PATTERN.exec(via ?? '');
  if (!match) return null;
  const [, kind, code] = match as unknown as [string, string, string];
  const { repository } = ctx;
  switch (kind) {
    case 'shopper': {
      const found = await repository.shoppers.findByHandle(code);
      return found ? fromShopper(ctx, found) : null;
    }
    case 'runner': {
      const found = await repository.runners.findByReferralCode(code.toUpperCase());
      return found ? fromRunner(ctx, found) : null;
    }
    case 'partner': {
      const found = await repository.partnerShops.findById(code);
      return found ? fromShop(ctx, found) : null;
    }
    case 'organisation': {
      const found =
        (await repository.organisations.findByJoinCode(code.toUpperCase())) ??
        (await repository.organisations.findById(code));
      return found ? fromOrganisation(ctx, found) : null;
    }
    default:
      return null;
  }
}

/** Whether two accounts are the same person: the same account, phone number or email. */
export function samePerson(
  one: Pick<ReferralAccount, 'kind' | 'id' | 'phones' | 'emails'>,
  other: Pick<ReferralAccount, 'kind' | 'id' | 'phones' | 'emails'>,
): boolean {
  if (one.kind === other.kind && one.id === other.id) return true;
  if (one.phones.some((phone) => other.phones.includes(phone))) return true;
  return one.emails.some((email) => other.emails.includes(email));
}

/**
 * "Did someone introduce you? Their code (optional)" (Anthony, 30 October 2026): the code a
 * person typed at sign-up, as the kind:code a link carries, or null when it is nobody's. Takes a
 * link's own code ("shopper-margaret"), a Runner ID ("R4K7Q2AB"), a Shopper's name in their link
 * ("margaret"), an organisation's join code, or a shop's id, and even a whole link pasted in.
 */
export async function viaFromCode(
  ctx: ReferralContext,
  typed: string | null | undefined,
): Promise<string | null> {
  let code = (typed ?? '').trim();
  if (code === '') return null;
  // A whole link pasted in: its ref, via or ambassador.
  const inLink = /[?&](?:ref|via|ambassador)=([A-Za-z0-9_:-]{1,60})/.exec(code);
  if (inLink) code = inLink[1] ?? code;
  const kinded = /^(shopper|runner|partner|organisation)[:-]([A-Za-z0-9_-]{1,40})$/i.exec(code);
  if (kinded) {
    const via = `${(kinded[1] ?? '').toLowerCase()}:${kinded[2] ?? ''}`;
    return (await resolveVia(ctx, via)) ? via : null;
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) return null;
  const { repository } = ctx;
  const runner = await repository.runners.findByReferralCode(code.toUpperCase());
  if (runner) return `runner:${runner.referralCode}`;
  const shopper = await repository.shoppers.findByHandle(code.toLowerCase());
  if (shopper && !shopper.erasedAt) return `shopper:${shopper.handle}`;
  const organisation = await repository.organisations.findByJoinCode(code.toUpperCase());
  if (organisation) return `organisation:${organisation.joinCode ?? organisation.id}`;
  const shop = await repository.partnerShops.findById(code);
  if (shop) return `partner:${shop.id}`;
  return null;
}

/* ------------------------------------------------------------------ links */

/** The kind:code a person's own link carries. */
export function viaFor(account: Pick<ReferralAccount, 'kind' | 'code'>): string {
  return `${account.kind}:${account.code}`;
}

/**
 * A person's own referral link. A Runner's keeps its old shape (`/join?ref=R…`), every other the
 * shape Shoppers' links have had since ruling 44 (`/join?via=kind-code`).
 */
export function referralLink(origin: string, account: Pick<ReferralAccount, 'kind' | 'code'>) {
  if (account.kind === 'runner') return `${origin}/join?ref=${account.code}`;
  return `${origin}/join?via=${account.kind}-${encodeURIComponent(account.code)}`;
}

/* ------------------------------------------------------------------ recording */

/**
 * Records that a new account came by somebody's link. Nothing happens when the link is nobody's,
 * is the person's own (the same account, phone number or email), or the account already has a
 * referrer. Never throws: a sign-up never fails over a referral.
 */
export async function recordReferral(
  ctx: ReferralContext,
  input: { via: string | null | undefined; joined: ReferralAccount },
  log?: FastifyBaseLogger,
): Promise<Referral | null> {
  try {
    const referrer = await resolveVia(ctx, input.via);
    if (!referrer || samePerson(referrer, input.joined)) return null;
    return await ctx.repository.referrals.record({
      referrerKind: referrer.kind,
      referrerId: referrer.id,
      joinedKind: input.joined.kind,
      joinedId: input.joined.id,
      via: viaFor(referrer),
      createdAt: ctx.now(),
    });
  } catch (failure) {
    log?.warn({ err: failure }, 'A referral could not be recorded');
    return null;
  }
}

/** Records the referral of an account by its kind and id, after it has been made. */
export async function recordReferralFor(
  ctx: ReferralContext,
  via: string | null | undefined,
  joinedKind: ReferralKind,
  joinedId: string,
  log?: FastifyBaseLogger,
): Promise<Referral | null> {
  if (!via) return null;
  const joined = await findAccount(ctx, joinedKind, joinedId);
  if (!joined) return null;
  return recordReferral(ctx, { via, joined }, log);
}

/* ------------------------------------------------------------------ active */

/** What decides whether a referred account is active: facts about it, read from the data. */
export type ActiveFacts =
  | { kind: 'shopper'; closed: boolean; ordersDelivered: number }
  | { kind: 'runner'; closed: boolean; approved: boolean; deliveriesCompleted: number }
  | { kind: 'partner'; closed: boolean; approved: boolean; orders: number }
  | { kind: 'organisation'; closed: boolean; peopleLinked: number }
  | { kind: ReferralKind; missing: true };

export interface ActiveStatus {
  active: boolean;
  /** Why, in plain words, for staff. */
  reason: string;
}

/**
 * Whether a referred account is ACTIVE, and why (Anthony, 30 October 2026): the real-person check.
 */
export function activeStatus(facts: ActiveFacts): ActiveStatus {
  if ('missing' in facts) return { active: false, reason: 'The account is no longer there.' };
  if (facts.closed) return { active: false, reason: 'The account is closed.' };
  switch (facts.kind) {
    case 'shopper':
      return facts.ordersDelivered > 0
        ? { active: true, reason: 'Has had an order delivered.' }
        : { active: false, reason: 'No order delivered yet.' };
    case 'runner':
      if (!facts.approved) return { active: false, reason: 'Not approved yet.' };
      return facts.deliveriesCompleted > 0
        ? { active: true, reason: 'Approved, and has completed a delivery.' }
        : { active: false, reason: 'Approved, but no delivery completed yet.' };
    case 'partner':
      if (!facts.approved) return { active: false, reason: 'Not approved yet.' };
      return facts.orders > 0
        ? { active: true, reason: 'Approved, and has had an order.' }
        : { active: false, reason: 'Approved, but no order yet.' };
    case 'organisation':
      return facts.peopleLinked > 0
        ? { active: true, reason: 'Has people linked.' }
        : { active: false, reason: 'Nobody linked yet.' };
  }
}

const DONE = new Set(['delivered', 'completed']);

/**
 * Reads the facts about accounts as needed, once each. Shop orders come from the business
 * analysis rows (one per shop an order was bought from), read once for everybody.
 */
export class ActiveReader {
  private shopOrders: Map<string, number> | null = null;
  private readonly cache = new Map<string, ActiveFacts>();

  constructor(private readonly ctx: ReferralContext) {}

  private async ordersByShop(): Promise<Map<string, number>> {
    if (this.shopOrders) return this.shopOrders;
    const counts = new Map<string, number>();
    const shops = await this.ctx.repository.partnerShops.list();
    const byName = new Map(shops.map((shop) => [shop.name, shop.id]));
    for (const event of await this.ctx.repository.analytics.list({
      since: new Date(0),
      kind: 'order_paid',
    })) {
      // Older rows have only the shop's name.
      const shopId = event.partnerShopId ?? (event.shop ? byName.get(event.shop) : undefined);
      if (shopId) counts.set(shopId, (counts.get(shopId) ?? 0) + 1);
    }
    this.shopOrders = counts;
    return counts;
  }

  async facts(kind: ReferralKind, id: string): Promise<ActiveFacts> {
    const key = `${kind}:${id}`;
    const known = this.cache.get(key);
    if (known) return known;
    const found = await this.read(kind, id);
    this.cache.set(key, found);
    return found;
  }

  private async read(kind: ReferralKind, id: string): Promise<ActiveFacts> {
    const { repository } = this.ctx;
    switch (kind) {
      case 'shopper': {
        const shopper = await repository.shoppers.findById(id);
        if (!shopper) return { kind, missing: true };
        const orders = await repository.orders.listForShopper(id);
        return {
          kind,
          closed: Boolean(shopper.erasedAt),
          ordersDelivered: orders.filter((order) => DONE.has(order.status)).length,
        };
      }
      case 'runner': {
        const runner = await repository.runners.findById(id);
        if (!runner) return { kind, missing: true };
        const orders = await repository.orders.listForRunner(id);
        return {
          kind,
          closed: Boolean(runner.leftAt),
          approved: isApproved(runner),
          deliveriesCompleted: orders.filter((order) => DONE.has(order.status)).length,
        };
      }
      case 'partner': {
        const shop = await repository.partnerShops.findById(id);
        if (!shop) return { kind, missing: true };
        return {
          kind,
          closed: shop.status === 'removed',
          approved: shop.status === 'approved',
          orders: (await this.ordersByShop()).get(id) ?? 0,
        };
      }
      case 'organisation': {
        const organisation = await repository.organisations.findById(id);
        if (!organisation) return { kind, missing: true };
        return {
          kind,
          closed: !organisation.active,
          peopleLinked: (await repository.organisations.listServiceUsers(id)).length,
        };
      }
    }
  }
}

/* ------------------------------------------------------------------ the tally */

export interface ReferralTally {
  joined: number;
  active: number;
  /** "71%". */
  percent: string;
  /** Enough of everyone who joined is active for a level to count. */
  meetsShare: boolean;
}

async function tallyOf(reader: ActiveReader, referrals: readonly Referral[]) {
  let active = 0;
  const people: Array<{ referral: Referral; status: ActiveStatus }> = [];
  for (const referral of referrals) {
    const status = activeStatus(await reader.facts(referral.joinedKind, referral.joinedId));
    if (status.active) active += 1;
    people.push({ referral, status });
  }
  return { active, people };
}

function tally(ctx: ReferralContext, active: number, joined: number): ReferralTally {
  return {
    joined,
    active,
    percent: percentWords(active, joined),
    meetsShare: meetsActiveShare(active, joined, ctx.config.referrals),
  };
}

/**
 * Keeps every level the person has newly reached, and tells the owner, once each, on Ozi's desk:
 * "Ada has reached the £10 voucher level with 20 active referrals." Gives the levels newly kept.
 */
export async function checkLevels(
  ctx: ReferralContext,
  account: Pick<ReferralAccount, 'kind' | 'id' | 'name'>,
  counts: { active: number; joined: number },
  log?: FastifyBaseLogger,
): Promise<ReferralLevelReached[]> {
  const kept: ReferralLevelReached[] = [];
  for (const level of levelsReached(counts.active, counts.joined, ctx.config.referrals)) {
    const row = await ctx.repository.referrals.reachLevel({
      referrerKind: account.kind,
      referrerId: account.id,
      activeReferrals: level.activeReferrals,
      rewardPence: level.rewardPence,
      label: level.label,
      activeAtReach: counts.active,
      joinedAtReach: counts.joined,
      reachedAt: ctx.now(),
    });
    if (!row) continue;
    kept.push(row);
    await askOwner(
      ctx,
      {
        kind: 'referral_level',
        subjectId: `${account.kind}:${account.id}:${level.activeReferrals}`,
        summary: ownerLevelWords(account.name, level, counts.active),
        options: 'acknowledge',
      },
      log,
    );
  }
  return kept;
}

/** One person's referrals, counted, with any new level kept. */
export async function referrerTally(
  ctx: ReferralContext,
  account: ReferralAccount,
  reader = new ActiveReader(ctx),
  log?: FastifyBaseLogger,
) {
  const referrals = await ctx.repository.referrals.listForReferrer(account.kind, account.id);
  const { active, people } = await tallyOf(reader, referrals);
  if (!account.closed) {
    await checkLevels(ctx, account, { active, joined: referrals.length }, log);
  }
  return { ...tally(ctx, active, referrals.length), people };
}

/** A level as shown: what it is, whether it is reached, and whether it has been given. */
export interface LevelView {
  activeReferrals: number;
  rewardPence: number;
  label: string;
  reached: boolean;
  reachedAt: Date | null;
  given: boolean;
}

function levelViews(ctx: ReferralContext, reached: readonly ReferralLevelReached[]): LevelView[] {
  return ctx.config.referrals.levels.map((level) => {
    const row = reached.find((one) => one.activeReferrals === level.activeReferrals);
    return {
      ...level,
      reached: Boolean(row),
      reachedAt: row?.reachedAt ?? null,
      given: Boolean(row?.givenAt),
    };
  });
}

/**
 * What a person sees of their own referrals, on their dashboard: their link, how many joined and
 * how many are active, their progress, the levels, and what they have earned. Never who joined.
 */
export async function myReferrals(
  ctx: ReferralContext,
  kind: ReferralKind,
  id: string,
  log?: FastifyBaseLogger,
) {
  const account = await findAccount(ctx, kind, id);
  if (!account) throw new NotFoundError('account');
  const counted = await referrerTally(ctx, account, new ActiveReader(ctx), log);
  const reached = await ctx.repository.referrals.listLevelsFor(kind, id);
  const symbol = ctx.config.store.currencySymbol;
  const settings = ctx.config.referrals;
  const earned = reached.map((row) => row.activeReferrals);
  const next = nextLevel(settings, earned);
  return {
    link: referralLink(ctx.env?.primaryOrigin ?? '', account),
    joined: counted.joined,
    active: counted.active,
    progress: progressWords(counted.active, counted.joined, settings, earned),
    next: next ? { ...next, words: rewardWords(next.rewardPence, symbol) } : null,
    minimumActivePercent: Math.round(settings.minimumActiveShare * 100),
    levels: levelViews(ctx, reached),
    earned: reached.map((row) => ({
      id: row.id,
      label: row.label,
      words: earnedWords(row, symbol),
      given: Boolean(row.givenAt),
    })),
    /** A level reached that Ozi has not yet told them about: said once, then marked heard. */
    news: reached
      .filter((row) => !row.toldAt)
      .map((row) => earnedWords(row, symbol))
      .join(' '),
  };
}

/** Ozi has said the news: it is not said again. */
export async function markTold(
  ctx: ReferralContext,
  kind: ReferralKind,
  id: string,
): Promise<number> {
  let told = 0;
  for (const row of await ctx.repository.referrals.listLevelsFor(kind, id)) {
    if (row.toldAt) continue;
    await ctx.repository.referrals.updateLevel(row.id, { toldAt: ctx.now() });
    told += 1;
  }
  return told;
}

/* ------------------------------------------------------------------ for staff */

export interface ReferrerRow {
  kind: ReferralKind;
  id: string;
  name: string;
  kindWords: string;
  area: string;
  joined: number;
  active: number;
  percent: string;
  meetsShare: boolean;
  /** The highest level reached, or null. */
  level: { id: string; label: string; rewardPence: number; given: boolean } | null;
  /** Every level reached, for the "Mark reward given" buttons. */
  levels: Array<{
    id: string;
    label: string;
    activeReferrals: number;
    rewardPence: number;
    reachedAt: Date;
    givenAt: Date | null;
    givenBy: string | null;
  }>;
}

function levelRows(rows: readonly ReferralLevelReached[]): ReferrerRow['levels'] {
  return [...rows]
    .sort((a, b) => a.activeReferrals - b.activeReferrals)
    .map((row) => ({
      id: row.id,
      label: row.label,
      activeReferrals: row.activeReferrals,
      rewardPence: row.rewardPence,
      reachedAt: row.reachedAt,
      givenAt: row.givenAt,
      givenBy: row.givenBy,
    }));
}

/**
 * The referral log, for staff only: everybody who has referred anybody, the most referrals first,
 * optionally only those whose name, kind or area has `search` in it. New levels are kept on the
 * way, as the sweep does.
 */
export async function referralLog(
  ctx: ReferralContext,
  search = '',
  log?: FastifyBaseLogger,
): Promise<ReferrerRow[]> {
  const byReferrer = new Map<string, Referral[]>();
  for (const referral of await ctx.repository.referrals.list()) {
    const key = `${referral.referrerKind}:${referral.referrerId}`;
    byReferrer.set(key, [...(byReferrer.get(key) ?? []), referral]);
  }
  const reader = new ActiveReader(ctx);
  const rows: ReferrerRow[] = [];
  const wanted = search.trim().toLowerCase();
  for (const referrals of byReferrer.values()) {
    const first = referrals[0]!;
    const account = await findAccount(ctx, first.referrerKind, first.referrerId);
    if (!account) continue;
    if (
      wanted !== '' &&
      ![account.name, KIND_WORDS[account.kind], account.area].some((text) =>
        text.toLowerCase().includes(wanted),
      )
    ) {
      continue;
    }
    const { active } = await tallyOf(reader, referrals);
    const counts = { active, joined: referrals.length };
    if (!account.closed) await checkLevels(ctx, account, counts, log);
    const shown = levelRows(await ctx.repository.referrals.listLevelsFor(account.kind, account.id));
    const top = shown.at(-1) ?? null;
    rows.push({
      kind: account.kind,
      id: account.id,
      name: account.name,
      kindWords: KIND_WORDS[account.kind],
      area: account.area,
      ...tally(ctx, active, referrals.length),
      level: top
        ? {
            id: top.id,
            label: top.label,
            rewardPence: top.rewardPence,
            given: top.givenAt !== null,
          }
        : null,
      levels: shown,
    });
  }
  return rows.sort(
    (a, b) => b.joined - a.joined || b.active - a.active || a.name.localeCompare(b.name),
  );
}

/** One person's referrals, for staff: each person who joined, when, and whether active, and why. */
export async function referrerDetail(ctx: ReferralContext, kind: ReferralKind, id: string) {
  const account = await findAccount(ctx, kind, id);
  if (!account) throw new NotFoundError('referrer');
  const reader = new ActiveReader(ctx);
  const referrals = await ctx.repository.referrals.listForReferrer(kind, id);
  const { active, people } = await tallyOf(reader, referrals);
  const shown = [];
  for (const { referral, status } of people) {
    const joined = await findAccount(ctx, referral.joinedKind, referral.joinedId);
    shown.push({
      name: joined?.name ?? 'Closed account',
      kind: referral.joinedKind,
      kindWords: KIND_WORDS[referral.joinedKind],
      joinedAt: referral.createdAt,
      active: status.active,
      reason: status.reason,
    });
  }
  return {
    referrer: {
      kind,
      id,
      name: account.name,
      kindWords: KIND_WORDS[kind],
      area: account.area,
      ...tally(ctx, active, referrals.length),
    },
    people: shown,
    levels: levelRows(await ctx.repository.referrals.listLevelsFor(kind, id)),
  };
}

/** Staff gave the voucher, by hand: who marked it, and when, is kept. Once only. */
export async function markRewardGiven(
  ctx: ReferralContext,
  levelId: string,
  by: string,
): Promise<{ message: string }> {
  const row = await ctx.repository.referrals.findLevel(levelId);
  if (!row) throw new NotFoundError('reward level');
  if (row.givenAt) {
    throw new ConflictError(`That reward was already marked given, by ${row.givenBy ?? 'staff'}.`);
  }
  await ctx.repository.referrals.updateLevel(row.id, { givenAt: ctx.now(), givenBy: by });
  const account = await findAccount(ctx, row.referrerKind, row.referrerId);
  return {
    message: `The ${row.label} for ${account?.name ?? 'them'} is marked given, by ${by}.`,
  };
}

/**
 * The people whose referrer may have moved on: when one of them becomes active, their referrer's
 * levels are checked at once, not only at the next sweep. Never throws.
 */
export async function referralsMoved(
  ctx: ReferralContext,
  joined: ReadonlyArray<{ kind: ReferralKind; id: string | null }>,
  log?: FastifyBaseLogger,
): Promise<void> {
  try {
    const reader = new ActiveReader(ctx);
    const seen = new Set<string>();
    for (const one of joined) {
      if (!one.id) continue;
      const referral = await ctx.repository.referrals.findFor(one.kind, one.id);
      if (!referral) continue;
      const key = `${referral.referrerKind}:${referral.referrerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const account = await findAccount(ctx, referral.referrerKind, referral.referrerId);
      if (account) await referrerTally(ctx, account, reader, log);
    }
  } catch (failure) {
    log?.warn({ err: failure }, 'Referral levels could not be checked');
  }
}

/** Every hour: anybody who has reached a new level is kept, and the owner told, once. */
export async function sweepReferralLevels(
  ctx: ReferralContext,
  log?: FastifyBaseLogger,
): Promise<number> {
  const before = (await ctx.repository.referrals.listLevels()).length;
  await referralLog(ctx, '', log);
  return (await ctx.repository.referrals.listLevels()).length - before;
}
