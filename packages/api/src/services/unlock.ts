/**
 * Unlocking anybody, and resetting a PIN or a password (ruling 81, Anthony, 24 October 2026;
 * docs/changes/unlock-and-reset.md).
 *
 * The owner, and staff he chooses (`canUnlock` on the staff account, given only by him in Team),
 * can unlock anybody at any time: a Shopper whose PIN locked after three wrong tries, a staff
 * member locked out of message and call codes (ruling 77) or of signing in, and an account whose
 * phone has had as many sign-in codes as the limits allow. They can also reset a Shopper's PIN,
 * so the Shopper chooses a new one the next time it is needed, and give a staff member a
 * temporary password, shown once.
 *
 * Every one is written in the audit log (who, whom, what, when), and the person affected is told
 * in plain words by text, with no secret in it: never a PIN, a password or a code.
 */

import type { FastifyRequest } from 'fastify';

import type { AppContext } from '../app.js';
import type { Runner, Shopper, StaffMember } from '../domain.js';
import { ForbiddenError } from '../errors.js';
import { recordAudit } from '../lib/audit.js';
import { isViewerRole, type StaffActor } from '../lib/staff.js';
import { CODE_LIMITS } from '../routes/auth.js';
import { codeLockouts } from './company-contact.js';

type Ctx = AppContext;

/**
 * Whether this person may unlock people and reset PINs and passwords (ruling 81): the owner
 * always; the staff key, which is the founder without an account; and a staff member the owner
 * lets unlock. Never a family or investor account, which only looks.
 */
export async function mayUnlock(ctx: Pick<Ctx, 'repository'>, actor: StaffActor): Promise<boolean> {
  if (actor.isOwner) return true;
  if (actor.viewOnly) return false;
  if (actor.id === null) return true;
  const member = await ctx.repository.staffMembers.findById(actor.id);
  return Boolean(member?.active && member.canUnlock && !isViewerRole(member.role));
}

/** Refuses anybody the owner has not let unlock. */
export async function requireUnlocker(
  ctx: Pick<Ctx, 'repository'>,
  actor: StaffActor,
): Promise<void> {
  if (!(await mayUnlock(ctx, actor))) {
    throw new ForbiddenError(
      'Unlocking people, and resetting a PIN or a password, is for the owner and the staff he lets unlock in Team.',
    );
  }
}

/** The end of a phone number, as staff may see it: "ending 123". Never the whole number. */
export function phoneEnding(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 3 ? `ending ${digits.slice(-3)}` : '';
}

/** "ring 01634 980059", from config/store.json (Rule Nine), or plain words if it is not set. */
export function ringUs(ctx: Pick<Ctx, 'config'>): string {
  return ctx.config.contact.telephoneIsPlaceholder
    ? 'tell us straight away'
    : `ring ${ctx.config.contact.telephonePlaceholder}`;
}

/** Texts the person affected; true if a text went. Never throws, and never logs the number. */
export async function tellByText(
  ctx: Pick<Ctx, 'sendText'>,
  request: FastifyRequest,
  phone: string | null,
  body: string,
): Promise<boolean> {
  if (!ctx.sendText || !phone) return false;
  try {
    await ctx.sendText(phone, body);
    return true;
  } catch (failure) {
    request.log.warn({ err: failure }, 'Could not text the person who was unlocked.');
    return false;
  }
}

/** What someone is locked out of. */
export type LockKind = 'shopper_pin' | 'staff_codes' | 'staff_sign_in' | 'sign_in_codes';

/** One person locked out of one thing, for the "Locked out" list on Needs you now. */
export interface LockedPerson {
  /** Unique in the list: the kind and the account. */
  key: string;
  kind: LockKind;
  account: 'shopper' | 'runner' | 'staff';
  id: string;
  name: string;
  /** When it would open by itself. */
  until: Date;
  /** "Yvette, a Shopper: her PIN, after three wrong tries", in words. */
  words: string;
}

const KIND_WORDS: Record<LockKind, string> = {
  shopper_pin: 'their PIN, after three wrong tries',
  staff_codes: 'message and call codes, after five wrong codes',
  staff_sign_in: 'signing in to the admin panel, after five wrong tries',
  sign_in_codes: 'sign-in codes by text, after as many as the limits allow',
};

const ACCOUNT_WORDS = { shopper: 'a Shopper', runner: 'a Runner', staff: 'staff' } as const;

function person(
  kind: LockKind,
  account: LockedPerson['account'],
  id: string,
  name: string,
  until: Date,
): LockedPerson {
  return {
    key: `${kind}:${id}`,
    kind,
    account,
    id,
    name,
    until,
    words: `${name}, ${ACCOUNT_WORDS[account]}: ${KIND_WORDS[kind]}`,
  };
}

/**
 * When the limits on sign-in codes for a number open again, if they are reached now: the codes
 * still counting, oldest first. Null when another code may be sent.
 */
export function signInCodesLockedUntil(times: readonly Date[], at: Date): Date | null {
  let until: Date | null = null;
  for (const limit of [CODE_LIMITS.perNumberShort, CODE_LIMITS.perNumberDay]) {
    const windowMs = limit.minutes * 60_000;
    const inside = times
      .filter((time) => time.getTime() > at.getTime() - windowMs)
      .sort((a, b) => a.getTime() - b.getTime());
    if (inside.length < limit.count) continue;
    // It opens when enough of them have aged out to leave one fewer than the limit.
    const opener = inside[inside.length - limit.count] as Date;
    const opens = new Date(opener.getTime() + windowMs);
    if (!until || opens > until) until = opens;
  }
  return until;
}

/** The account a sign-in code was for, by the number it went to. */
async function accountForCode(
  ctx: Pick<Ctx, 'repository'>,
  phone: string,
  role: string,
): Promise<{ account: 'shopper' | 'runner'; row: Shopper | Runner } | null> {
  if (role === 'runner') {
    const runner = await ctx.repository.runners.findByPhone(phone);
    return runner ? { account: 'runner', row: runner } : null;
  }
  if (role === 'shopper') {
    const shopper = await ctx.repository.shoppers.findByPhone(phone);
    return shopper && shopper.erasedAt === null ? { account: 'shopper', row: shopper } : null;
  }
  return null;
}

function nameOf(row: Shopper | Runner): string {
  return 'displayName' in row ? row.displayName : row.name;
}

/**
 * Everyone locked out of anything at this moment (ruling 81): Shoppers' PINs, staff codes,
 * staff sign-in and sign-in codes. Soonest to open by itself last, so the longest waits are
 * heard first. Sign-in codes are listed only for a number on an account.
 */
export async function lockedOut(ctx: Pick<Ctx, 'repository' | 'now'>): Promise<LockedPerson[]> {
  const at = ctx.now();
  const out: LockedPerson[] = [];
  for (const shopper of await ctx.repository.shoppers.listPinLocked(at)) {
    out.push(
      person('shopper_pin', 'shopper', shopper.id, shopper.displayName, shopper.pinLockedUntil!),
    );
  }
  const team = await ctx.repository.staffMembers.list();
  const byId = new Map(team.map((member) => [member.id, member]));
  for (const member of team) {
    if (member.lockedUntil && member.lockedUntil > at) {
      out.push(person('staff_sign_in', 'staff', member.id, member.name, member.lockedUntil));
    }
  }
  for (const lock of codeLockouts(at)) {
    const member = byId.get(lock.staffId);
    if (member) out.push(person('staff_codes', 'staff', member.id, member.name, lock.until));
  }
  const day = CODE_LIMITS.perNumberDay.minutes * 60_000;
  const codes = await ctx.repository.oneTimeCodes.listSince(new Date(at.getTime() - day));
  const byNumber = new Map<string, { role: string; times: Date[] }>();
  for (const code of codes) {
    const key = `${code.role}:${code.phone}`;
    const entry = byNumber.get(key) ?? { role: code.role, times: [] };
    entry.times.push(code.createdAt);
    byNumber.set(key, entry);
  }
  for (const [key, entry] of byNumber) {
    const until = signInCodesLockedUntil(entry.times, at);
    if (!until) continue;
    const found = await accountForCode(ctx, key.slice(entry.role.length + 1), entry.role);
    if (found) {
      out.push(person('sign_in_codes', found.account, found.row.id, nameOf(found.row), until));
    }
  }
  return out.sort((a, b) => b.until.getTime() - a.until.getTime());
}

/** Writes who did what to whom, and when, in the audit log. */
export async function auditUnlock(
  request: FastifyRequest,
  action: string,
  target: string,
  detail: string,
): Promise<void> {
  await recordAudit(request, { action, target, detail });
}

/** Whether a staff member is locked out of signing in right now. */
export function staffSignInLocked(member: StaffMember, at: Date): boolean {
  return member.lockedUntil !== null && member.lockedUntil > at;
}
