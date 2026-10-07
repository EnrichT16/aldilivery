/**
 * Two quick protections from the security proposal (ruling 44, docs/SECURITY_PROPOSAL.md).
 *
 * Headers on every reply that tell a browser not to guess file types, not to show the API
 * inside another site's page, and not to pass our addresses on to other sites.
 *
 * And a limit on how often one internet address may try to sign in, on top of the lock each
 * account already has after five wrong passwords: someone guessing many accounts' passwords
 * from one place is slowed to a crawl. Generous, so a family on one home connection never
 * notices it. The address is the one DigitalOcean's front door saw (`do-connecting-ip`).
 * The same limit keeps one address from asking for voice passes without end (ruling 53).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

export function addSecurityHeaders(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!reply.hasHeader(name)) void reply.header(name, value);
  }
}

/** Paths, without the /api prefix, and how many tries one address gets in the window. */
export const LIMITED: Record<string, number> = {
  '/staff/sign-in': 30,
  '/business/sign-in': 30,
  '/auth/verify-code': 60,
  '/ozi/reply': 600,
  // A voice pass (ruling 53) lasts five minutes and the app keeps it, so sixty in ten minutes
  // is far more than a household needs. Each one costs a call to the voice engine.
  '/voice/session': 60,
};

export const WINDOW_MS = 10 * 60 * 1000;

export interface Limiter {
  /** True when this try is allowed; false when the address has had its share. */
  allow(path: string, request: FastifyRequest, at: Date): boolean;
}

export function limiter(): Limiter {
  const seen = new Map<string, { count: number; since: number }>();
  return {
    allow(path, request, at) {
      const most = LIMITED[path];
      if (most === undefined) return true;
      const given = request.headers['do-connecting-ip'];
      const address = (Array.isArray(given) ? given[0] : given) ?? request.ip;
      const key = `${path} ${address}`;
      const now = at.getTime();
      const entry = seen.get(key);
      if (!entry || now - entry.since >= WINDOW_MS) {
        seen.set(key, { count: 1, since: now });
        // Old entries are dropped now and then, so the map cannot grow without end.
        if (seen.size > 50_000) {
          for (const [k, v] of seen) if (now - v.since >= WINDOW_MS) seen.delete(k);
        }
        return true;
      }
      entry.count += 1;
      return entry.count <= most;
    },
  };
}
