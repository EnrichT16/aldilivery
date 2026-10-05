/**
 * Signing in: a phone number and a one time code.
 *
 * There are no passwords in the service. A password is a poor fit for someone who cannot see
 * the screen, and a barrier for someone who finds reading hard. A code read out over the
 * phone, or shown large, is kinder and no less safe when it expires in ten minutes.
 *
 * The code itself is never stored: only a keyed hash of it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountRole } from '../domain.js';
import {
  BadRequestError,
  TooManyRequestsError,
  UnauthorisedError,
  UnavailableError,
} from '../errors.js';
import { isUkMobile, NOT_A_UK_NUMBER, ukPhone } from '../lib/phone.js';
import { codesMatch, generateCode, hashCode, signPhoneProof, signSession } from '../lib/tokens.js';

/** How long the proof of holding a number lasts, between the code and opening the account. */
const PHONE_PROOF_MINUTES = 30;

const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Please give a full phone number.')
  .max(20)
  .regex(/^[+0-9 ()-]+$/, 'A phone number can only have digits, spaces, brackets and a plus.');

const roleSchema = z.enum(['shopper', 'runner']).default('shopper');

const requestCodeSchema = z.object({
  phone: phoneSchema,
  role: roleSchema,
  /** A text to a mobile, or an automatic phone call that speaks it, for a landline. */
  channel: z.enum(['text', 'call']).default('text'),
  /** Signing in to an account, or confirming the number of a new one. */
  purpose: z.enum(['sign-in', 'sign-up']).default('sign-in'),
});

const verifyCodeSchema = z.object({
  phone: phoneSchema,
  role: roleSchema,
  code: z.string().trim().min(4).max(10),
});

/** Attempts allowed against a single code before it is burned. */
const MAX_ATTEMPTS = 5;

/**
 * Every code is a text, and every text costs money. The sign-in screen is open to anybody,
 * so without these somebody could have it send thousands of texts — to annoy one person, or
 * to run up the bill, which is a known fraud with a name ("SMS pumping"). The limits are
 * generous for a person who mistyped and tight for a script.
 */
export const CODE_LIMITS = {
  /** Codes to one number in a quarter of an hour. */
  perNumberShort: { count: 3, minutes: 15 },
  /** Codes to one number in a day. */
  perNumberDay: { count: 8, minutes: 24 * 60 },
  /** Codes asked for from one internet address in an hour, across every number. */
  perAddressHour: { count: 10, minutes: 60 },
  /** Codes sent by this server in a day, altogether. A ceiling on the bill. */
  perServerDay: { count: 500, minutes: 24 * 60 },
} as const;

const TOO_MANY =
  'You have asked for a lot of codes. Please wait a few minutes and try again. If you keep having trouble, phone us.';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, now, deliverCode, codeDelivery, callCode, callDelivery } = app.ctx;

  // Kept in memory: one server, and a restart forgetting who asked is harmless. The
  // per-number limits are in the database, so they survive a restart.
  const byAddress = new Map<string, number[]>();
  const byServer: number[] = [];

  function withinWindow(times: number[], minutes: number): number[] {
    const since = now().getTime() - minutes * 60_000;
    return times.filter((t) => t > since);
  }

  /** The number as stored now, or as it was typed, for accounts made before 26 Sep 2026. */
  async function findAccount(phone: string, typed: string, role: AccountRole) {
    const find =
      role === 'runner'
        ? (p: string) => repository.runners.findByPhone(p)
        : (p: string) => repository.shoppers.findByPhone(p);
    return (await find(phone)) ?? (typed.trim() !== phone ? await find(typed.trim()) : null);
  }

  app.post('/auth/request-code', async (request) => {
    const input = requestCodeSchema.parse(request.body);
    const role = input.role;
    const phone = ukPhone(input.phone);
    if (!phone) throw new BadRequestError(NOT_A_UK_NUMBER);
    const byCall = input.channel === 'call';
    if (!byCall && !isUkMobile(phone)) {
      throw new BadRequestError(
        callDelivery === 'off'
          ? 'We can only send a code to a mobile phone. Please give a mobile number, starting 07.'
          : 'A landline cannot get a text. Choose "Call me with the code" instead, and we will phone you and say it.',
      );
    }

    if (!byCall && codeDelivery === 'off') {
      throw new UnavailableError(
        'Signing in by text message is not switched on yet. Please set up your account on this device for now.',
      );
    }
    if (byCall && callDelivery === 'off') {
      throw new UnavailableError(
        'Codes by phone call are not switched on yet. Please use a mobile number for now.',
      );
    }

    // DigitalOcean's edge puts the visitor's own address here. Without it every request
    // would seem to come from the load balancer, and one limit would be shared by everybody.
    const header = request.headers['do-connecting-ip'];
    const address = (Array.isArray(header) ? header[0] : header) ?? request.ip;
    const fromAddress = withinWindow(
      byAddress.get(address) ?? [],
      CODE_LIMITS.perAddressHour.minutes,
    );
    const fromServer = withinWindow(byServer, CODE_LIMITS.perServerDay.minutes);

    const [shortCount, dayCount] = await Promise.all([
      repository.oneTimeCodes.countSince(
        phone,
        new Date(now().getTime() - CODE_LIMITS.perNumberShort.minutes * 60_000),
      ),
      repository.oneTimeCodes.countSince(
        phone,
        new Date(now().getTime() - CODE_LIMITS.perNumberDay.minutes * 60_000),
      ),
    ]);

    if (
      shortCount >= CODE_LIMITS.perNumberShort.count ||
      dayCount >= CODE_LIMITS.perNumberDay.count ||
      fromAddress.length >= CODE_LIMITS.perAddressHour.count
    ) {
      throw new TooManyRequestsError(TOO_MANY);
    }
    if (fromServer.length >= CODE_LIMITS.perServerDay.count) {
      request.log.error(
        'The daily ceiling on sign-in texts was reached. No more will be sent today.',
      );
      throw new TooManyRequestsError(TOO_MANY);
    }

    byAddress.set(address, [...fromAddress, now().getTime()]);
    byServer.splice(0, byServer.length, ...fromServer, now().getTime());

    const code = generateCode(env.otpLength);
    const expiresAt = new Date(now().getTime() + env.otpTtlSeconds * 1000);

    await repository.oneTimeCodes.create({
      phone,
      role,
      codeHash: hashCode(code, env.authTokenSecret),
      expiresAt,
      createdAt: now(),
    });

    // A phone call to sign in only goes to a number already on an account (ruling 27): nobody
    // can use this to have strangers' phones rung. The answer is the same either way, so it
    // cannot be used to find out who is registered.
    const callAllowed =
      !byCall || input.purpose === 'sign-up' || (await findAccount(phone, input.phone, role));
    try {
      if (byCall) {
        if (callAllowed) await callCode(phone, code);
      } else {
        await deliverCode(phone, code);
      }
    } catch (failure) {
      request.log.error({ err: failure }, 'A sign-in code could not be sent');
      throw new UnavailableError(
        byCall
          ? 'We could not phone you just now. Please try again in a minute.'
          : 'We could not send a text just now. Please try again in a minute.',
      );
    }

    return {
      sent: true,
      channel: input.channel,
      expiresInSeconds: env.otpTtlSeconds,
      message: byCall
        ? 'We are phoning you now. Answer, and a voice will read your code, three times. It lasts ten minutes.'
        : 'We have sent you a code. It lasts ten minutes.',
    };
  });

  app.post('/auth/verify-code', async (request) => {
    const input = verifyCodeSchema.parse(request.body);
    const { role, code } = input;
    const phone = ukPhone(input.phone);
    if (!phone) throw new BadRequestError(NOT_A_UK_NUMBER);

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

    const account = await findAccount(phone, input.phone, role);

    if (!account) {
      return {
        registrationRequired: true,
        role,
        phone,
        // Shown to open the account on this number, and to nothing else.
        phoneProof: signPhoneProof(
          {
            phone,
            role,
            expiresAt: Math.floor(now().getTime() / 1000) + PHONE_PROOF_MINUTES * 60,
          },
          env.authTokenSecret,
        ),
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
