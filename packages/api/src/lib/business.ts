/**
 * Business sign-ins (7 October 2026): people signing in for a partner shop or an organisation.
 * Each has their own username and a password they choose themselves, like staff, but with a
 * session of a different kind, so a business can never reach the admin panel, and a partner
 * shop never sees an organisation's dashboard, nor the other way round.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { BusinessKind, BusinessUser } from '../domain.js';
import { ForbiddenError, SessionInvalidError } from '../errors.js';
import type { TokenRefusal } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The business session token this request carried, once checked (ruling 88). */
    businessSession?: BusinessSession;
  }
}

const LABEL = 'business-session:';
export const BUSINESS_SESSION_HOURS = 12;

/** What a business token carries: who, and until when. */
export interface BusinessSession {
  userId: string;
  /** When the session ends, in milliseconds since 1970. */
  expiresAtMs: number;
  /** When it was signed, or null for a token from before 2 November 2026. */
  issuedAtMs: number | null;
}

export function signBusinessToken(
  userId: string,
  expiresAt: Date,
  secret: string,
  issuedAt?: Date,
): string {
  const body = Buffer.from(
    JSON.stringify({
      id: userId,
      exp: expiresAt.getTime(),
      ...(issuedAt ? { ia: issuedAt.getTime() } : {}),
    }),
  ).toString('base64url');
  const mac = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  return `bz1.${body}.${mac}`;
}

export function verifyBusinessToken(token: string, secret: string, now: Date): string | null {
  const outcome = inspectBusinessToken(token, secret, now);
  return 'session' in outcome ? outcome.session.userId : null;
}

/** Like `verifyBusinessToken`, but says why a token was refused (ruling 88). */
export function inspectBusinessToken(
  token: string,
  secret: string,
  now: Date,
): { session: BusinessSession } | { refused: TokenRefusal } {
  const [version, body, mac] = token.split('.');
  if (version !== 'bz1' || !body || !mac) return { refused: 'invalid' };
  const expected = createHmac('sha256', `${LABEL}${secret}`).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { refused: 'invalid' };
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      id: string;
      exp: number;
      ia?: number;
    };
    if (typeof parsed.id !== 'string' || typeof parsed.exp !== 'number') {
      return { refused: 'invalid' };
    }
    if (parsed.exp <= now.getTime()) return { refused: 'expired' };
    return {
      session: {
        userId: parsed.id,
        expiresAtMs: parsed.exp,
        issuedAtMs: typeof parsed.ia === 'number' ? parsed.ia : null,
      },
    };
  } catch {
    return { refused: 'invalid' };
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
  /** Shop Partner Plus (`plan`), Shop Partner Pro (`pro`, ruling 96), Spotlight or Spotlight Plus. */
  kind: 'plan' | 'pro' | 'spotlight' | 'plus';
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
      !['plan', 'pro', 'spotlight', 'plus'].includes(parsed.kind) ||
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
  // Nothing sent is not a refusal of a sign-in: it is simply not signed in (ruling 88).
  if (!token) throw new ForbiddenError('Please sign in.', { code: 'no_session' });
  const inspected = inspectBusinessToken(token, env.authTokenSecret, now());
  // A bad or ended token, or an account switched off, is the one answer that may make the
  // dashboard forget its sign-in.
  if ('refused' in inspected) throw new SessionInvalidError(inspected.refused);
  const user = await repository.businessUsers.findById(inspected.session.userId);
  if (!user || !user.active) throw new SessionInvalidError('invalid', 'Please sign in.');
  request.businessSession = inspected.session;
  if (kind && user.kind !== kind) {
    throw new ForbiddenError(
      kind === 'partner' ? 'That is for partner shops.' : 'That is for organisations.',
    );
  }
  return user;
}
