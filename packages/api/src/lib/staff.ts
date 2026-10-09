/**
 * Staff accounts (7 October 2026). Each person who runs the service has their own sign-in,
 * and sees only what their job needs. The founder sees everything and manages the team.
 *
 * The STAFF_API_KEY still works, and signs in as the founder: it is how the first account is
 * made, and what the server's own scheduled calls use.
 *
 * Passwords are stored as scrypt hashes with their own salt, never as the password. A session
 * is a signed token carrying the account and an expiry, checked against the account on every
 * request, so turning an account off takes effect at once.
 */

import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { StoreConfig } from '@aldilivery/core';

import type { StaffMember } from '../domain.js';
import { ApiError, ForbiddenError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Who in the admin panel made this request, once checked: what the audit log records. */
    staffActor?: StaffActor;
  }
}

/** What a part of the admin panel is called. Each is one tab. */
export type StaffArea =
  | 'documents'
  | 'problems'
  | 'feedback'
  | 'owed'
  | 'finds'
  | 'enquiries'
  | 'partners'
  | 'analytics'
  | 'overview'
  | 'money'
  | 'team'
  /** What Ozi was asked and could not answer, for a person to approve an answer (ruling 49). */
  | 'learning'
  /** Bank transfers to the business account, to mark as received (ruling 50). */
  | 'payments'
  /** Live and past orders, each with its timeline (Section Q). */
  | 'orders'
  /** Runners working now, and what each has earned (Section Q). */
  | 'runners'
  /** Signups, cancellations, refunds and price freshness (Section Q). */
  | 'reports'
  /** The owner's alone: opening a Shopper's account, and exporting their data. */
  | 'accounts'
  /** The owner's alone: the audit log of everything done in the admin panel. */
  | 'audit';

export type StaffRole =
  | 'founder'
  | 'operations_manager'
  | 'onboarding'
  | 'customer_care'
  | 'finance'
  | 'sourcing'
  | 'partnerships'
  | 'family'
  | 'investor';

export const STAFF_ROLES: Record<StaffRole, { title: string; areas: readonly StaffArea[] }> = {
  founder: {
    title: 'Founder',
    areas: [
      'documents',
      'problems',
      'feedback',
      'owed',
      'finds',
      'enquiries',
      'partners',
      'analytics',
      'overview',
      'team',
      'learning',
      'payments',
      'orders',
      'runners',
      'reports',
    ],
  },
  operations_manager: {
    title: 'Operations manager',
    areas: [
      'documents',
      'problems',
      'feedback',
      'finds',
      'enquiries',
      'partners',
      'learning',
      'orders',
      'runners',
      'reports',
    ],
  },
  onboarding: { title: 'Runner onboarding officer', areas: ['documents'] },
  // Customer care looks orders up, to answer a Shopper about one.
  customer_care: {
    title: 'Customer care officer',
    areas: ['problems', 'feedback', 'learning', 'orders'],
  },
  // Finance sees refunds and what Runners have earned, but never the owner's money totals.
  finance: { title: 'Finance officer', areas: ['owed', 'payments', 'runners', 'reports'] },
  sourcing: { title: 'Finds It shopper', areas: ['finds'] },
  partnerships: { title: 'Partnerships officer', areas: ['enquiries', 'partners'] },
  // People the owner lets see parts of his own dashboard (Anthony, 7 October 2026), such as
  // his wife, or investors. They only ever see what he has switched on for them, never the
  // money, and they can look but not change anything.
  family: { title: 'Family, seeing the founder’s dashboard', areas: [] },
  investor: { title: 'Investor', areas: [] },
};

/** Parts of the panel only the owner's own account, signed in with the passcode, ever has. */
export const OWNER_ONLY_AREAS: readonly StaffArea[] = ['money', 'accounts', 'audit'];

/** What the owner can switch on for a family or investor account. Never the money. */
export const VIEWER_AREAS: readonly StaffArea[] = [
  'overview',
  'analytics',
  'team',
  'documents',
  'problems',
  'feedback',
  'finds',
  'enquiries',
  'partners',
];

export function isViewerRole(role: string): boolean {
  return role === 'family' || role === 'investor';
}

export function isStaffRole(value: string): value is StaffRole {
  return Object.prototype.hasOwnProperty.call(STAFF_ROLES, value);
}

/** Who is signed in to the admin panel. */
export interface StaffActor {
  /** Null for the staff key, which is the founder without an account. */
  id: string | null;
  name: string;
  role: StaffRole;
  areas: readonly StaffArea[];
  /** The owner's own account, signed in with the passcode: the only one that sees the money. */
  isOwner: boolean;
  /** Family and investors: may look, never change. */
  viewOnly: boolean;
}

/* ------------------------------------------------------------------ passwords */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 32).toString('base64url');
  return `scrypt.${salt}.${hash}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('.');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'base64url');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Easy to read out and type: three short words would be kinder still, but need a list. */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A first password, given once, to be changed at the first sign-in. */
export function temporaryPassword(): string {
  let value = '';
  for (let index = 0; index < 12; index += 1) {
    if (index > 0 && index % 4 === 0) value += '-';
    value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return value;
}

/* ------------------------------------------------------------------ session tokens */

const LABEL = 'staff-session:';
export const STAFF_SESSION_HOURS = 12;

/** What a staff session carries: who, until when, which sign-out generation, and the passcode. */
export interface StaffSession {
  id: string;
  /** The account's session version when it was made: a kill switch raises it. */
  version: number;
  /** Made with the owner's passcode. */
  passcode: boolean;
  /**
   * Only for setting up two-step codes: given to someone whose grace period is over and who
   * has not set them up yet. It opens nothing else.
   */
  setup: boolean;
}

export function signStaffToken(
  staffId: string,
  expiresAt: Date,
  secret: string,
  extra: { version?: number; passcode?: boolean; setup?: boolean } = {},
): string {
  const body = Buffer.from(
    JSON.stringify({
      id: staffId,
      exp: expiresAt.getTime(),
      v: extra.version ?? 0,
      pc: extra.passcode ?? false,
      ...(extra.setup ? { su: true } : {}),
    }),
  ).toString('base64url');
  const mac = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  return `st1.${body}.${mac}`;
}

export function verifyStaffToken(token: string, secret: string, now: Date): StaffSession | null {
  const [version, body, mac] = token.split('.');
  if (version !== 'st1' || !body || !mac) return null;
  const expected = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      id: string;
      exp: number;
      v?: number;
      pc?: boolean;
      su?: boolean;
    };
    if (typeof parsed.id !== 'string' || parsed.exp <= now.getTime()) return null;
    return {
      id: parsed.id,
      version: parsed.v ?? 0,
      passcode: parsed.pc === true,
      setup: parsed.su === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the owner's passcode */

/** Six digits, then one special character of the owner's choosing: "123456#". */
export function isPasscode(value: string): boolean {
  return /^\d{6}[^A-Za-z0-9\s]$/.test(value);
}

/* ------------------------------------------------------------------ two-step codes (TOTP) */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  return Array.from(randomBytes(20), (byte) => BASE32[byte % 32]).join('');
}

function base32Bytes(secret: string): Buffer {
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

/** The 6-digit code an authenticator app shows for this secret at this moment (RFC 6238). */
export function totpCode(secret: string, at: Date, step = 0): string {
  const counter = Math.floor(at.getTime() / 30_000) + step;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', base32Bytes(secret)).update(message).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 0xf;
  const value = (hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

/** A code from now, or thirty seconds either side, for a phone clock a little out. */
export function totpMatches(secret: string, code: string, at: Date): boolean {
  const given = code.replace(/\s/g, '');
  return [-1, 0, 1].some((step) => totpCode(secret, at, step) === given);
}

/* ------------------------------------------------------------------ two-step for everyone */

const DAY = 24 * 60 * 60 * 1000;

/**
 * The moment two-step codes become a must for this person (Section Q): the grace period in
 * config/store.json, counted from the later of the day it started and the day their account
 * was made.
 */
export function twoStepDueAt(member: Pick<StaffMember, 'createdAt'>, config: StoreConfig): Date {
  const from = Date.parse(`${config.admin.staffTwoStepFrom}T00:00:00.000Z`);
  const start = Math.max(from, member.createdAt.getTime());
  return new Date(start + config.admin.staffTwoStepGraceDays * DAY);
}

/** How many recovery codes are given at a time, each good once. */
export const RECOVERY_CODE_COUNT = 8;

/** Easy to read out and type: "k7m2-p9qx". */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    let value = '';
    for (let index = 0; index < 8; index += 1) {
      if (index === 4) value += '-';
      value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    }
    return value;
  });
}

/** Recovery codes as kept: each hashed like a password, never as itself. */
export function hashRecoveryCodes(codes: string[]): string {
  return codes.map((code) => hashPassword(code)).join(',');
}

/**
 * Whether this is one of the account's recovery codes. If it is, gives back what is left once
 * it is used up; null if it is not one of them.
 */
export function useRecoveryCode(stored: string, given: string): string | null {
  const tidy = given.trim().toLowerCase().replace(/\s+/g, '');
  if (!/^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(tidy)) return null;
  const code = tidy.includes('-') ? tidy : `${tidy.slice(0, 4)}-${tidy.slice(4)}`;
  const hashes = stored.split(',').filter(Boolean);
  const index = hashes.findIndex((hash) => passwordMatches(code, hash));
  if (index < 0) return null;
  return hashes.filter((_hash, at) => at !== index).join(',');
}

/** How many recovery codes are left unused. */
export function recoveryCodesLeft(stored: string): number {
  return stored.split(',').filter(Boolean).length;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const given = request.headers[name];
  return Array.isArray(given) ? given[0] : given;
}

/**
 * The person signed in to the admin panel, if they may use this part of it. With no area,
 * anybody signed in. Throws otherwise, saying which part it is.
 */
export async function staffActor(
  request: FastifyRequest,
  area?: StaffArea,
  options: { allowSetup?: boolean } = {},
): Promise<StaffActor> {
  const { env, repository, now } = request.server.ctx;
  const key = header(request, 'x-staff-key');
  if (
    key !== undefined &&
    env.staffKey !== undefined &&
    key.length === env.staffKey.length &&
    timingSafeEqual(Buffer.from(key), Buffer.from(env.staffKey))
  ) {
    // The staff key is everything but the owner's own parts: the money, opening a Shopper's
    // account, and the audit log need the owner's own passcode.
    if (area === 'money') throw new ForbiddenError('Only the owner sees the money.');
    if (area && OWNER_ONLY_AREAS.includes(area)) {
      throw new ForbiddenError('Only the owner can open that.');
    }
    const actor: StaffActor = {
      id: null,
      name: 'Founder',
      role: 'founder',
      areas: STAFF_ROLES.founder.areas,
      isOwner: false,
      viewOnly: false,
    };
    request.staffActor = actor;
    return actor;
  }

  const token = header(request, 'x-staff-token');
  const session = token ? verifyStaffToken(token, env.authTokenSecret, now()) : null;
  const member = session ? await repository.staffMembers.findById(session.id) : null;
  if (
    !session ||
    !member ||
    !member.active ||
    !isStaffRole(member.role) ||
    member.sessionVersion !== session.version
  ) {
    throw new ForbiddenError('Please sign in to the admin panel.');
  }
  // A session made only so two-step codes can be set up opens nothing else.
  if (session.setup && !options.allowSetup) {
    throw new ApiError(
      403,
      'two_step_needed',
      'Please set up two-step codes first. Nothing else opens until you have.',
    );
  }
  const viewOnly = isViewerRole(member.role);
  const isOwner = member.isOwner && session.passcode;
  const areas: StaffArea[] = viewOnly
    ? VIEWER_AREAS.filter((one) => member.allowedAreas.split(',').includes(one))
    : [...STAFF_ROLES[member.role].areas];
  if (isOwner) areas.push(...OWNER_ONLY_AREAS);
  if (area && !areas.includes(area)) {
    throw new ForbiddenError(
      area === 'money'
        ? 'Only the owner sees the money.'
        : OWNER_ONLY_AREAS.includes(area)
          ? 'Only the owner can open that.'
          : viewOnly
            ? 'The owner has not switched that on for you.'
            : 'That part of the admin panel is not part of your job.',
    );
  }
  // Family and investors look; they never change anything.
  if (viewOnly && area && request.method !== 'GET') {
    throw new ForbiddenError('Your account can look, but not change anything.');
  }
  const actor: StaffActor = {
    id: member.id,
    name: member.name,
    role: member.role,
    areas,
    isOwner,
    viewOnly,
  };
  request.staffActor = actor;
  return actor;
}

/**
 * Whose name goes on a decision. A signed-in account is always recorded as itself, whatever
 * the screen sent; only the staff key, which has no account, says who is using it.
 */
export function decidedBy(actor: StaffActor, given: string): string {
  return actor.id === null ? given : actor.name;
}
