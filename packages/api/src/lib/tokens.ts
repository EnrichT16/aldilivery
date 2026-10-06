/**
 * One time codes and session tokens.
 *
 * A one time code is never stored. Only a keyed hash of it is, so a leaked database does
 * not hand anyone a working code. Comparison is timing safe.
 *
 * Session tokens are signed, not encrypted: they carry an account id and a role and nothing
 * private. There are no passwords in this product at all — a Shopper signs in with their
 * phone and a code, which is far kinder to someone who cannot see a keyboard.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import type { AccountRole } from '../domain.js';

export function hashCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code.trim()).digest('hex');
}

export function codesMatch(candidate: string, storedHash: string, secret: string): boolean {
  const candidateHash = Buffer.from(hashCode(candidate, secret), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (candidateHash.length !== stored.length) return false;
  return timingSafeEqual(candidateHash, stored);
}

/**
 * Proof that somebody has just shown they hold a phone number, by giving the code sent to it.
 * Handed out by /auth/verify-code when there is no account yet, and required to open one, so
 * nobody can open an account on somebody else's number. Signed like a session token, but
 * with its own label, so it can never be mistaken for one.
 */
export function signPhoneProof(
  proof: { phone: string; role: AccountRole; expiresAt: number },
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(proof)).toString('base64url');
  const mac = createHmac('sha256', `phone-proof:${secret}`).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyPhoneProof(
  token: string,
  secret: string,
  now = new Date(),
): { phone: string; role: AccountRole } | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', `phone-proof:${secret}`).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const proof = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      phone: string;
      role: AccountRole;
      expiresAt: number;
    };
    if (proof.expiresAt * 1000 <= now.getTime()) return null;
    return { phone: proof.phone, role: proof.role };
  } catch {
    return null;
  }
}

/** A numeric code, because it has to be readable aloud and typeable on a phone keypad. */
export function generateCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

export interface SessionClaims {
  accountId: string;
  role: AccountRole;
  /** Seconds since the epoch. */
  expiresAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signSession(claims: SessionClaims, secret: string): string {
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(
  token: string,
  secret: string,
  now = new Date(),
): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];

  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    return null;
  }

  if (typeof claims.expiresAt !== 'number' || claims.expiresAt * 1000 <= now.getTime()) {
    return null;
  }
  return claims;
}

/** A short, speakable handle, for a Shopper who does not want to invent one. */
export function suggestHandle(displayName: string, suffix: number): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return `${base || 'shopper'}-${suffix}`;
}
