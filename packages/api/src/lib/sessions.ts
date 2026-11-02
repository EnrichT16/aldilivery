/**
 * How long a sign-in lasts, and when it is quietly renewed (ruling 88, 2 November 2026,
 * Anthony: no Runner, Shopper, staff, organisation or owner is ever signed out while using
 * the app).
 *
 * A Runner was signed out on his phone within minutes of signing in. Two things did it: the
 * app forgot its token on any refusal whose words mentioned signing in, so a passing 401 was
 * taken for the end of the sign-in; and a token's life was fixed at sign-in, so a short
 * `AUTH_TOKEN_TTL_HOURS` in the environment ended every sign-in on the dot, however busy the
 * person was. Both are put right here and in the app:
 *
 * - a Shopper's or Runner's token lives at least `MINIMUM_SESSION_HOURS` (30 days), whatever
 *   the environment says, unless `ALLOW_SHORT_SESSIONS=on` is set on purpose;
 * - every "me" route hands back a fresh token once the current one is past half its life, so
 *   anyone using the app is never timed out: the Runner page asks every five seconds, the
 *   others on opening and when they come back to the screen.
 */

import type { Env } from '../env.js';
import type { SessionClaims } from './tokens.js';

/** The least a Shopper's or Runner's sign-in may last: thirty days. */
export const MINIMUM_SESSION_HOURS = 720;

/**
 * The lifetime a Shopper's or Runner's token is signed for. The environment's figure, raised
 * to thirty days when it is shorter and short sessions were not asked for in so many words.
 */
export function sessionTtlHours(
  env: Pick<Env, 'authTokenTtlHours' | 'allowShortSessions'>,
): number {
  if (env.authTokenTtlHours >= MINIMUM_SESSION_HOURS || env.allowShortSessions) {
    return env.authTokenTtlHours;
  }
  return MINIMUM_SESSION_HOURS;
}

/** Whether the environment's figure was raised: said once in the log at start, never a secret. */
export function sessionTtlRaised(
  env: Pick<Env, 'authTokenTtlHours' | 'allowShortSessions'>,
): boolean {
  return sessionTtlHours(env) !== env.authTokenTtlHours;
}

/**
 * Whether a token is past half its life, so a fresh one should go back with the reply.
 * `lifetimeMs` is what the token was signed for when it does not say itself.
 */
export function pastHalfLife(
  token: { expiresAtMs: number; issuedAtMs: number | null },
  lifetimeMs: number,
  now: Date,
): boolean {
  const life =
    token.issuedAtMs !== null && token.issuedAtMs < token.expiresAtMs
      ? token.expiresAtMs - token.issuedAtMs
      : lifetimeMs;
  const left = token.expiresAtMs - now.getTime();
  return left < life / 2;
}

/** The claims for a Shopper's or Runner's token signed now, for the full lifetime. */
export function sessionClaimsNow(
  accountId: string,
  role: SessionClaims['role'],
  env: Pick<Env, 'authTokenTtlHours' | 'allowShortSessions'>,
  now: Date,
): SessionClaims {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return { accountId, role, issuedAt, expiresAt: issuedAt + sessionTtlHours(env) * 3600 };
}
