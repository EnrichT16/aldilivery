/**
 * Signing in: a phone number and a one time code.
 *
 * There are no passwords in Aldilivery. A password is a poor fit for someone who cannot see
 * the screen, and a barrier for someone who finds reading hard. A code read out over the
 * phone, or shown large, is kinder and no less safe when it expires in ten minutes.
 *
 * The code itself is never stored: only a keyed hash of it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { BadRequestError, UnauthorisedError } from '../errors.js';
import { codesMatch, generateCode, hashCode, signSession } from '../lib/tokens.js';

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Please give a full phone number.')
  .max(20)
  .regex(/^[+0-9 ()-]+$/, 'A phone number can only have digits, spaces, brackets and a plus.');

const roleSchema = z.enum(['shopper', 'runner']).default('shopper');

const requestCodeSchema = z.object({ phone: phoneSchema, role: roleSchema });

const verifyCodeSchema = z.object({
  phone: phoneSchema,
  role: roleSchema,
  code: z.string().trim().min(4).max(10),
});

/** Attempts allowed against a single code before it is burned. */
const MAX_ATTEMPTS = 5;

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, now, deliverCode } = app.ctx;

  app.post('/auth/request-code', async (request) => {
    const { phone, role } = requestCodeSchema.parse(request.body);

    const code = generateCode(env.otpLength);
    const expiresAt = new Date(now().getTime() + env.otpTtlSeconds * 1000);

    await repository.oneTimeCodes.create({
      phone,
      role,
      codeHash: hashCode(code, env.authTokenSecret),
      expiresAt,
    });

    await deliverCode(phone, code);

    // The same answer whether or not an account exists, so this cannot be used to find out
    // who is registered.
    return {
      sent: true,
      expiresInSeconds: env.otpTtlSeconds,
      message: 'We have sent you a code. It lasts ten minutes.',
    };
  });

  app.post('/auth/verify-code', async (request) => {
    const { phone, role, code } = verifyCodeSchema.parse(request.body);

    const stored = await repository.oneTimeCodes.findLatestUnconsumed(phone, role);
    if (!stored) {
      throw new UnauthorisedError('That code has expired. Ask for a new one.');
    }
    if (stored.expiresAt.getTime() <= now().getTime()) {
      throw new UnauthorisedError('That code has expired. Ask for a new one.');
    }
    if (stored.attempts >= MAX_ATTEMPTS) {
      await repository.oneTimeCodes.update(stored.id, { consumedAt: now() });
      throw new UnauthorisedError('Too many tries. Ask for a new code.');
    }

    if (!codesMatch(code, stored.codeHash, env.authTokenSecret)) {
      await repository.oneTimeCodes.update(stored.id, { attempts: stored.attempts + 1 });
      throw new UnauthorisedError('That code was not right. Try again.');
    }

    await repository.oneTimeCodes.update(stored.id, { consumedAt: now() });

    const account =
      role === 'runner'
        ? await repository.runners.findByPhone(phone)
        : await repository.shoppers.findByPhone(phone);

    if (!account) {
      return {
        registrationRequired: true,
        role,
        message:
          role === 'runner'
            ? 'We do not know you yet. Let us set you up as a Runner.'
            : 'We do not know you yet. Let us set you up.',
      };
    }

    const expiresAt = Math.floor(now().getTime() / 1000) + env.authTokenTtlHours * 3600;
    const token = signSession({ accountId: account.id, role, expiresAt }, env.authTokenSecret);

    return { registrationRequired: false, role, token, accountId: account.id };
  });

  app.post('/auth/sign-out', async () => {
    // Tokens are stateless and short lived. Signing out is the client forgetting the token.
    return { signedOut: true };
  });

  app.get('/auth/whoami', async (request) => {
    if (!request.session) {
      throw new BadRequestError('You are not signed in.');
    }
    return { accountId: request.session.accountId, role: request.session.role };
  });
}
