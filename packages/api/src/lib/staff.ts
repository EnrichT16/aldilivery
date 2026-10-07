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

import { ForbiddenError } from '../errors.js';

/** What a part of the admin panel is called. Each is one tab. */
export type StaffArea =
  'documents' | 'problems' | 'feedback' | 'owed' | 'finds' | 'enquiries' | 'team';

export type StaffRole =
  | 'founder'
  | 'operations_manager'
  | 'onboarding'
  | 'customer_care'
  | 'finance'
  | 'sourcing'
  | 'partnerships';

export const STAFF_ROLES: Record<StaffRole, { title: string; areas: readonly StaffArea[] }> = {
  founder: {
    title: 'Founder',
    areas: ['documents', 'problems', 'feedback', 'owed', 'finds', 'enquiries', 'team'],
  },
  operations_manager: {
    title: 'Operations manager',
    areas: ['documents', 'problems', 'feedback', 'finds', 'enquiries'],
  },
  onboarding: { title: 'Runner onboarding officer', areas: ['documents'] },
  customer_care: { title: 'Customer care officer', areas: ['problems', 'feedback'] },
  finance: { title: 'Finance officer', areas: ['owed'] },
  sourcing: { title: 'Finds It shopper', areas: ['finds'] },
  partnerships: { title: 'Partnerships officer', areas: ['enquiries'] },
};

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

export function signStaffToken(staffId: string, expiresAt: Date, secret: string): string {
  const body = Buffer.from(JSON.stringify({ id: staffId, exp: expiresAt.getTime() })).toString(
    'base64url',
  );
  const mac = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  return `st1.${body}.${mac}`;
}

export function verifyStaffToken(token: string, secret: string, now: Date): string | null {
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
    };
    if (typeof parsed.id !== 'string' || parsed.exp <= now.getTime()) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const given = request.headers[name];
  return Array.isArray(given) ? given[0] : given;
}

/**
 * The person signed in to the admin panel, if they may use this part of it. With no area,
 * anybody signed in. Throws otherwise, saying which part it is.
 */
export async function staffActor(request: FastifyRequest, area?: StaffArea): Promise<StaffActor> {
  const { env, repository, now } = request.server.ctx;
  const key = header(request, 'x-staff-key');
  if (
    key !== undefined &&
    env.staffKey !== undefined &&
    key.length === env.staffKey.length &&
    timingSafeEqual(Buffer.from(key), Buffer.from(env.staffKey))
  ) {
    return { id: null, name: 'Founder', role: 'founder', areas: STAFF_ROLES.founder.areas };
  }

  const token = header(request, 'x-staff-token');
  const staffId = token ? verifyStaffToken(token, env.authTokenSecret, now()) : null;
  const member = staffId ? await repository.staffMembers.findById(staffId) : null;
  if (!member || !member.active || !isStaffRole(member.role)) {
    throw new ForbiddenError('Please sign in to the admin panel.');
  }
  const { areas } = STAFF_ROLES[member.role];
  if (area && !areas.includes(area)) {
    throw new ForbiddenError('That part of the admin panel is not part of your job.');
  }
  return { id: member.id, name: member.name, role: member.role, areas };
}

/**
 * Whose name goes on a decision. A signed-in account is always recorded as itself, whatever
 * the screen sent; only the staff key, which has no account, says who is using it.
 */
export function decidedBy(actor: StaffActor, given: string): string {
  return actor.id === null ? given : actor.name;
}
