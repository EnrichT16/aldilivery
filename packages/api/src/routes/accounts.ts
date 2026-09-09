/**
 * Registration, the account itself, and deletion.
 *
 * Deletion never deletes. It sets a date, seven days out, and the account sits in a recycle
 * bin until then. People change their minds, people press the wrong thing, and people are
 * sometimes talked into pressing it by someone else. A week is cheap insurance.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { hashCode, signSession, suggestHandle } from '../lib/tokens.js';

const phoneSchema = z.string().trim().min(7).max(20);

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
  preferredLanguage: z.string().trim().min(2).max(20).optional(),
  doorstepProtocol: z.string().trim().max(500).optional(),
  substitutionDefault: z.enum(['no_substitutes', 'similar_item', 'ask_me']).optional(),
  budgetCapPence: z.number().int().positive().optional(),
});

const runnerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  vehicleType: z.enum(['on_foot', 'bicycle', 'motorbike', 'car', 'van']).optional(),
  stripeConnectedAccountId: z.string().trim().max(120).optional(),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  preferredLanguage: z.string().trim().min(2).max(20).optional(),
  doorstepProtocol: z.string().trim().max(500).optional(),
  substitutionDefault: z.enum(['no_substitutes', 'similar_item', 'ask_me']).optional(),
  budgetCapPence: z.number().int().positive().nullable().optional(),
});

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, env, now } = app.ctx;

  app.post('/shoppers', async (request, reply) => {
    const input = shopperSchema.parse(request.body);

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
      substitutionDefault: input.substitutionDefault ?? 'ask_me',
      budgetCapPence: input.budgetCapPence ?? null,
    });

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

    const runner = await repository.runners.create({
      name: input.name,
      phone: input.phone,
      vehicleType: input.vehicleType ?? 'on_foot',
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
        'We need to check your right to work in the United Kingdom.',
        'We need a criminal record check.',
        `You will be paid £${(500 / 100).toFixed(2)} for every order you complete.`,
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
    const shopper = await repository.shoppers.update(session.accountId, patch);
    return { shopper: publicShopper(shopper) };
  });

  /** Runners say when they are on shift, and where they are. */
  app.post('/runners/me/availability', async (request) => {
    const session = requireSession(request, 'runner');
    const body = z
      .object({
        available: z.boolean(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      })
      .parse(request.body);

    const runner = await repository.runners.update(session.accountId, {
      available: body.available,
      ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
      ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
    });
    return { runner: publicRunner(runner) };
  });

  /**
   * Rule: deletion is a date, not a deletion. The account and its history stay for the
   * configured recycle bin window so it can be brought back.
   */
  app.post('/account/delete', async (request) => {
    const session = requireSession(request);
    if (session.role !== 'shopper') {
      throw new BadRequestError('Runner accounts are closed by talking to us, so we can settle your pay.');
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
  const { spokenCodeHash: _omitted, ...rest } = shopper;
  return rest;
}

function publicRunner(runner: import('../domain.js').Runner) {
  return runner;
}
