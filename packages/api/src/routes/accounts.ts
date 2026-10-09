/**
 * Registration, the account itself, and deletion.
 *
 * Deletion never deletes. It sets a date, seven days out, and the account sits in a recycle
 * bin until then. People change their minds, people press the wrong thing, and people are
 * sometimes talked into pressing it by someone else. A week is cheap insurance.
 */

import type { FastifyInstance } from 'fastify';
import { formatPence, RUNNER_PAYMENT_PENCE } from '@aldilivery/core';
import { z } from 'zod';

import { phoneConfirmedAtSignUp, requireSession } from '../app.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { NOT_A_UK_NUMBER, ukPhone } from '../lib/phone.js';
import { newReferralCode } from '../lib/referral.js';
import { hashCode, signSession, suggestHandle, verifyPhoneProof } from '../lib/tokens.js';
import { sweepOffers } from '../services/dispatch.js';
import { agreementRecord, agreementSchema, hasAgreed } from '../services/runner-agreement.js';
import { MOTOR_MODES, canDrive, documentsNeeded } from './runner-account.js';

/** Checked, and turned into `+44…`, so the same number always finds the same account. */
const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .transform((value, context) => {
    const phone = ukPhone(value);
    if (!phone) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: NOT_A_UK_NUMBER });
      return z.NEVER;
    }
    return phone;
  });

const shopperSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'A handle can have small letters, numbers and dashes.')
    .optional(),
  phone: phoneSchema,
  spokenCode: z.string().trim().min(4).max(20).optional(),
  /** From /auth/verify-code: proof the number was confirmed with a code. */
  phoneProof: z.string().trim().max(500).optional(),
  preferredLanguage: z.string().trim().min(2).max(20).optional(),
  doorstepProtocol: z.string().trim().max(500).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  substitutionDefault: z.enum(['no_substitutes', 'similar_item', 'ask_me']).optional(),
  budgetCapPence: z.number().int().positive().optional(),
  /** The share link they came by: a Shop Partner, an organisation, staff or a Shopper. */
  joinedVia: z
    .string()
    .trim()
    .regex(/^(partner|organisation|staff|shopper):[A-Za-z0-9_-]{1,40}$/)
    .optional(),
});

const runnerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  vehicleType: z.enum(['on_foot', 'bicycle', 'motorbike', 'car', 'van']).optional(),
  /** Every way they might deliver (ruling, 2 October 2026): tick all, so switching needs nothing new. */
  travelModes: z
    .array(z.enum(['on_foot', 'bicycle', 'motorbike', 'car', 'van']))
    .min(1, 'Please choose at least one way you will deliver.')
    .max(5)
    .optional(),
  /** The ID of whoever invited them, from the link they followed. */
  referredBy: z.string().trim().max(20).optional(),
  stripeConnectedAccountId: z.string().trim().max(120).optional(),
  /** Agreeing to the Runner agreement as they sign up (ruling 55). Or later, before a job. */
  agreement: agreementSchema.optional(),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  preferredLanguage: z.string().trim().min(2).max(20).optional(),
  doorstepProtocol: z.string().trim().max(500).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  substitutionDefault: z.enum(['no_substitutes', 'similar_item', 'ask_me']).optional(),
  budgetCapPence: z.number().int().positive().nullable().optional(),
  /** Optional, for analysis only, and can be taken away again (null). */
  ageBand: z.enum(['under_25', '25_44', '45_64', '65_plus']).nullable().optional(),
});

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, env, now } = app.ctx;

  app.post('/shoppers', async (request, reply) => {
    const input = shopperSchema.parse(request.body);

    // Once codes really go out, a new account's number is confirmed with one first (ruling
    // 33), so nobody can open an account on somebody else's phone.
    if (phoneConfirmedAtSignUp(app.ctx)) {
      const proof = input.phoneProof
        ? verifyPhoneProof(input.phoneProof, env.authTokenSecret, now())
        : null;
      if (!proof || proof.role !== 'shopper' || proof.phone !== ukPhone(input.phone)) {
        throw new BadRequestError(
          'Please confirm your phone number with the code we send it, then try again.',
        );
      }
    }

    if (await repository.shoppers.findByPhone(input.phone)) {
      throw new ConflictError('There is already an account on that phone number.');
    }

    let handle = input.handle ?? suggestHandle(input.displayName, 1);
    for (let attempt = 2; await repository.shoppers.findByHandle(handle); attempt += 1) {
      if (input.handle) {
        throw new ConflictError('Somebody already has that name. Please pick another.');
      }
      handle = suggestHandle(input.displayName, attempt);
    }

    const shopper = await repository.shoppers.create({
      displayName: input.displayName,
      handle,
      phone: input.phone,
      spokenCodeHash: input.spokenCode ? hashCode(input.spokenCode, env.authTokenSecret) : null,
      preferredLanguage: input.preferredLanguage ?? 'en-GB',
      doorstepProtocol: input.doorstepProtocol ?? '',
      deliveryAddress: input.deliveryAddress ?? '',
      substitutionDefault: input.substitutionDefault ?? 'ask_me',
      budgetCapPence: input.budgetCapPence ?? null,
    });
    if (input.joinedVia) {
      await repository.shoppers.update(shopper.id, { joinedVia: input.joinedVia });
    }

    const expiresAt = Math.floor(now().getTime() / 1000) + env.authTokenTtlHours * 3600;
    const token = signSession(
      { accountId: shopper.id, role: 'shopper', expiresAt },
      env.authTokenSecret,
    );

    void reply.status(201);
    return { shopper: publicShopper(shopper), token };
  });

  app.post('/runners', async (request, reply) => {
    const input = runnerSchema.parse(request.body);

    if (await repository.runners.findByPhone(input.phone)) {
      throw new ConflictError('There is already a Runner on that phone number.');
    }

    const travelModes = [...new Set(input.travelModes ?? [input.vehicleType ?? 'on_foot'])];
    // They start walking or cycling if they can; a car or motorbike waits for the licence and
    // insurance to be checked.
    const firstMode =
      input.vehicleType ??
      travelModes.find((mode) => !MOTOR_MODES.includes(mode)) ??
      (travelModes[0] as (typeof travelModes)[number]);
    const referrer = input.referredBy
      ? ((await repository.runners.findByReferralCode(input.referredBy.toUpperCase()))
          ?.referralCode ?? null)
      : null;

    const agreed = input.agreement ? agreementRecord(input.agreement, now()) : {};
    const runner = await repository.runners.create({
      ...agreed,
      name: input.name,
      phone: input.phone,
      vehicleType: firstMode,
      travelModes,
      referralCode: newReferralCode('R'),
      referredBy: referrer,
      stripeConnectedAccountId: input.stripeConnectedAccountId ?? null,
      // Both checks start false. No Runner is offered a job until a person has verified
      // their right to work and their criminal record check.
      rightToWorkVerified: false,
      criminalRecordCheckVerified: false,
      available: false,
    });

    const expiresAt = Math.floor(now().getTime() / 1000) + env.authTokenTtlHours * 3600;
    const token = signSession(
      { accountId: runner.id, role: 'runner', expiresAt },
      env.authTokenSecret,
    );

    void reply.status(201);
    return {
      runner: publicRunner(runner),
      token,
      nextSteps: [
        ...documentsNeeded(travelModes).map((kind) =>
          kind === 'face_photo'
            ? 'A photo of your face, for Shoppers to know you at the door.'
            : kind === 'right_to_work'
              ? 'Your right to work in the UK: a share code, or a photo of your passport.'
              : kind === 'dbs'
                ? 'A basic DBS certificate, or its share code.'
                : kind === 'insurance'
                  ? 'Your motor insurance certificate, covering delivery work.'
                  : kind === 'driving_licence_front'
                    ? 'The front of your driving licence.'
                    : 'The back of your driving licence.',
        ),
        // Rule Two, from the constant. The figure a Runner is told is the figure the
        // payout route transfers, because both read the same number.
        `You will be paid ${formatPence(RUNNER_PAYMENT_PENCE, config.store.currencySymbol)} for every order you complete.`,
      ],
    };
  });

  app.get('/me', async (request) => {
    const session = requireSession(request);
    if (session.role === 'runner') {
      const runner = await repository.runners.findById(session.accountId);
      if (!runner) throw new NotFoundError('account');
      return { role: 'runner', runner: publicRunner(runner) };
    }
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    return { role: 'shopper', shopper: publicShopper(shopper) };
  });

  app.patch('/me', async (request) => {
    const session = requireSession(request, 'shopper');
    const patch = profileSchema.parse(request.body);
    const current = await repository.shoppers.findById(session.accountId);
    if (!current) throw new NotFoundError('account');
    // Changing the registered home address needs the PIN (Section D): PUT /me/home-address.
    // Giving one for the first time, when there is none, is part of setting the account up.
    if (
      patch.deliveryAddress !== undefined &&
      current.deliveryAddress.trim() !== '' &&
      patch.deliveryAddress.trim() !== current.deliveryAddress.trim()
    ) {
      throw new ForbiddenError(
        'Changing your home address needs your PIN. You can change it in Your addresses.',
      );
    }
    const shopper = await repository.shoppers.update(session.accountId, patch);
    return { shopper: publicShopper(shopper) };
  });

  /** Runners say when they are on shift, and where they are. */
  /**
   * Agreeing to the Runner agreement, for a Runner who did not at sign-up, or when it has
   * changed (ruling 55). Kept with the date, the version and how they agreed.
   */
  app.post('/runners/me/agreement', async (request) => {
    const session = requireSession(request, 'runner');
    const input = agreementSchema.parse(request.body ?? {});
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    const updated = await repository.runners.update(runner.id, agreementRecord(input, now()));
    return {
      runner: publicRunner(updated),
      message: 'Thank you. You have agreed to the Runner agreement, and you can take jobs.',
    };
  });

  app.post('/runners/me/availability', async (request) => {
    const session = requireSession(request, 'runner');
    const body = z
      .object({
        available: z.boolean(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      })
      .parse(request.body);

    const current = await repository.runners.findById(session.accountId);
    if (!current) throw new NotFoundError('account');
    if (body.available && MOTOR_MODES.includes(current.vehicleType) && !canDrive(current, now())) {
      throw new ConflictError(
        'Before you can deliver by car or motorbike, we need your driving licence and insurance checked and in date. Switch to walking or bicycle to start now.',
        { needs: 'licence_and_insurance' },
      );
    }
    const runner = await repository.runners.update(session.accountId, {
      available: body.available,
      ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
      ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
    });
    // Somebody may have been waiting for a Runner. Look now rather than at the next sweep.
    if (body.available && app.ctx.autoOffer) {
      await sweepOffers(app.ctx, (orderId, failure) => {
        request.log.warn({ orderId, err: failure }, 'Could not offer a waiting order');
      });
    }
    return { runner: publicRunner(runner) };
  });

  /**
   * Rule: deletion is a date, not a deletion. The account and its history stay for the
   * configured recycle bin window so it can be brought back.
   */
  app.post('/account/delete', async (request) => {
    const session = requireSession(request);
    if (session.role !== 'shopper') {
      throw new BadRequestError(
        'Runner accounts are closed by talking to us, so we can settle your pay.',
      );
    }

    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');

    const days = config.accountDeletion.recycleBinDays;
    const scheduledFor = new Date(now().getTime() + days * 24 * 3600 * 1000);
    await repository.shoppers.update(shopper.id, { deletionScheduledFor: scheduledFor });

    return {
      deletionScheduledFor: scheduledFor.toISOString(),
      recycleBinDays: days,
      message: `Your account will be deleted in ${days} days. Until then you can change your mind and we will put everything back.`,
    };
  });

  app.post('/account/restore', async (request) => {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    if (shopper.deletionScheduledFor === null) {
      return { restored: false, message: 'Your account was not going to be deleted.' };
    }
    await repository.shoppers.update(shopper.id, { deletionScheduledFor: null });
    return { restored: true, message: 'Your account is staying. Nothing was lost.' };
  });
}

function publicShopper(shopper: import('../domain.js').Shopper) {
  const {
    spokenCodeHash: _code,
    pinHash,
    pinFailedAttempts: _attempts,
    pinLockedUntil: _locked,
    stripeCustomerId: _customer,
    ...rest
  } = shopper;
  return { ...rest, hasPin: pinHash !== null };
}

function publicRunner(runner: import('../domain.js').Runner) {
  // Whether they have agreed to the Runner agreement as it stands today (ruling 55).
  return { ...runner, agreementCurrent: hasAgreed(runner) };
}
