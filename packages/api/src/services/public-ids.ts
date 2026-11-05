/**
 * Speakable IDs for everyone (ruling 97, 5 November 2026).
 *
 * Shoppers (S-), Shop Partners (P-), organisations (G-) and staff (T-) each get a short public
 * ID, six characters without the confusable ones, made once and kept. Runners keep the Runner ID
 * they already have (`referralCode`, "R…"), which is never changed here.
 *
 * An ID is made the first time it is read (lazily), so nothing has to run before the people who
 * already have accounts see theirs; a sweep fills in the businesses and the team in one go. An
 * ID is checked against every kind before it is kept, so no two people ever share one, whatever
 * the letter in front.
 */

import { randomInt } from 'node:crypto';

import { PUBLIC_ID_WORDS, newPublicId, spellId, type PublicIdKind } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Runner } from '../domain.js';

type Ctx = Pick<AppContext, 'repository' | 'config'>;

/** How many fresh IDs are tried before giving up: with 31^6 to choose from, one is almost always enough. */
const TRIES = 20;

interface WithPublicId {
  id: string;
  publicId: string | null;
}

async function keep(ctx: Ctx, kind: PublicIdKind, id: string, publicId: string): Promise<void> {
  const { repository } = ctx;
  if (kind === 'shopper') await repository.shoppers.update(id, { publicId });
  else if (kind === 'partner') await repository.partnerShops.update(id, { publicId });
  else if (kind === 'organisation') await repository.organisations.update(id, { publicId });
  else await repository.staffMembers.update(id, { publicId });
}

/**
 * The record's public ID, made and kept now if it has none. Never throws for a clash: a fresh one
 * is tried, and the database's unique index is the last word.
 */
export async function ensurePublicId(
  ctx: Ctx,
  kind: PublicIdKind,
  record: WithPublicId,
): Promise<string> {
  if (record.publicId) return record.publicId;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const candidate = newPublicId(kind, ctx.config.publicIds, (below) => randomInt(below));
    if (await ctx.repository.publicIds.inUse(candidate)) continue;
    try {
      await keep(ctx, kind, record.id, candidate);
      record.publicId = candidate;
      return candidate;
    } catch {
      // Somebody else took it between the check and the write: try another.
    }
  }
  throw new Error(`No free ${PUBLIC_ID_WORDS[kind]} could be made.`);
}

/**
 * Fills in every Shop Partner, organisation and staff member without an ID. Shoppers get theirs
 * the first time their account is read, so nobody's sign-in waits on a sweep. Returns how many
 * were made.
 */
export async function backfillPublicIds(ctx: Ctx): Promise<number> {
  const { repository } = ctx;
  let made = 0;
  for (const shop of await repository.partnerShops.list()) {
    if (shop.publicId) continue;
    await ensurePublicId(ctx, 'partner', shop);
    made += 1;
  }
  for (const organisation of await repository.organisations.list()) {
    if (organisation.publicId) continue;
    await ensurePublicId(ctx, 'organisation', organisation);
    made += 1;
  }
  for (const member of await repository.staffMembers.list()) {
    if (member.publicId) continue;
    await ensurePublicId(ctx, 'staff', member);
    made += 1;
  }
  return made;
}

/** "Ada Lovelace" gives "Ada": a Runner is named to others by first name only. */
export function firstNameOf(name: string | null | undefined): string {
  return name ? (name.trim().split(/\s+/)[0] ?? name) : 'Your Runner';
}

/**
 * How a Runner is shown to a Shopper or a Shop Partner (ruling 97): their first name and their
 * Runner ID. Never their surname, and never their phone.
 */
export function runnerInPublic(runner: Pick<Runner, 'name' | 'referralCode'> | null) {
  if (!runner) return null;
  return { firstName: firstNameOf(runner.name), runnerId: runner.referralCode };
}

/** What Ozi says when asked to read an ID out, spelt in groups. */
export function idSpoken(kind: PublicIdKind | 'runner', id: string): string {
  const words = kind === 'runner' ? 'Runner ID' : PUBLIC_ID_WORDS[kind];
  return `Your ${words} is ${spellId(id)}.`;
}
