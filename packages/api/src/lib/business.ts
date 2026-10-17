/**
 * Business sign-ins (7 October 2026): people signing in for a partner shop or an organisation.
 * Each has their own username and a password they choose themselves, like staff, but with a
 * session of a different kind, so a business can never reach the admin panel, and a partner
 * shop never sees an organisation's dashboard, nor the other way round.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { BusinessKind, BusinessUser } from '../domain.js';
import { ForbiddenError } from '../errors.js';

const LABEL = 'business-session:';
export const BUSINESS_SESSION_HOURS = 12;

export function signBusinessToken(userId: string, expiresAt: Date, secret: string): string {
  const body = Buffer.from(JSON.stringify({ id: userId, exp: expiresAt.getTime() })).toString(
    'base64url',
  );
  const mac = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  return `bz1.${body}.${mac}`;
}

export function verifyBusinessToken(token: string, secret: string, now: Date): string | null {
  const [version, body, mac] = token.split('.');
  if (version !== 'bz1' || !body || !mac) return null;
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

/**
 * What a partner is paying for through Stripe Checkout (ruling 65): Partner Plus, Spotlight or
 * Spotlight Plus, for so many months. Signed into the address Stripe sends them back to, so the
 * dashboard can record exactly what was paid without keeping anything on the server meanwhile,
 * and the Checkout session's id keeps it from ever being recorded twice.
 */
export interface PartnerCheckout {
  sessionId: string;
  partnerShopId: string;
  kind: 'plan' | 'spotlight' | 'plus';
  months: number;
  amountPence: number;
}

const CHECKOUT_LABEL = 'partner-checkout:';

export function signPartnerCheckout(checkout: PartnerCheckout, secret: string): string {
  const body = Buffer.from(JSON.stringify(checkout)).toString('base64url');
  const mac = createHmac('sha256', `${CHECKOUT_LABEL}${secret}`).update(body).digest('base64url');
  return `pc1.${body}.${mac}`;
}

export function verifyPartnerCheckout(token: string, secret: string): PartnerCheckout | null {
  const [version, body, mac] = token.split('.');
  if (version !== 'pc1' || !body || !mac) return null;
  const expected = createHmac('sha256', `${CHECKOUT_LABEL}${secret}`)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PartnerCheckout;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.partnerShopId !== 'string' ||
      !['plan', 'spotlight', 'plus'].includes(parsed.kind) ||
      !Number.isInteger(parsed.months) ||
      !Number.isInteger(parsed.amountPence)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** The person signed in for a business, if they are of this kind and still allowed in. */
export async function businessActor(
  request: FastifyRequest,
  kind?: BusinessKind,
): Promise<BusinessUser> {
  const { env, repository, now } = request.server.ctx;
  const given = request.headers['x-business-token'];
  const token = Array.isArray(given) ? given[0] : given;
  const userId = token ? verifyBusinessToken(token, env.authTokenSecret, now()) : null;
  const user = userId ? await repository.businessUsers.findById(userId) : null;
  if (!user || !user.active) throw new ForbiddenError('Please sign in.');
  if (kind && user.kind !== kind) {
    throw new ForbiddenError(
      kind === 'partner' ? 'That is for partner shops.' : 'That is for organisations.',
    );
  }
  return user;
}
