/**
 * A Shopper's addresses and PIN (docs/BUILD_PROMPT.md, Section D).
 *
 * - The registered home address is the fallback for everything, and the only address a voice
 *   order ever goes to. Changing it needs the PIN, and the owner is told every time it changes,
 *   because a spoken PIN can be overheard.
 * - Saved addresses are unlimited. Saving one needs the PIN. Removing one does not: removing an
 *   address can only ever send less somewhere.
 * - A one-off address for a single order needs no PIN at all, only a touch confirmation; that is
 *   on the order itself, not here.
 * - The PIN is chosen the first time it is needed, never at sign-up, so sign-up stays short.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Shopper } from '../domain.js';
import {
  ApiError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../errors.js';
import { PIN_ATTEMPTS, PIN_LOCK_MINUTES, hashPin, pinMatches, pinProblem } from '../lib/pin.js';
import { notifyShopper } from '../services/notify.js';

const address = z
  .string()
  .trim()
  .min(1, 'Please give the address.')
  .max(300, 'That address is too long to be right. Please check it.');
const pin = z.string().trim();

export async function registerAddressRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, now, config } = app.ctx;

  async function me(request: Parameters<typeof requireSession>[0]): Promise<Shopper> {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    return shopper;
  }

  /** Check the PIN, counting wrong tries and locking after three. */
  async function checkPin(shopper: Shopper, given: string): Promise<void> {
    if (!shopper.pinHash) {
      throw new ConflictError('Please choose a PIN first. You only need to do this once.', {
        pin: 'needed',
      });
    }
    const at = now();
    if (shopper.pinLockedUntil && shopper.pinLockedUntil > at) {
      const minutes = Math.ceil((shopper.pinLockedUntil.getTime() - at.getTime()) / 60_000);
      throw new ApiError(
        429,
        'pin_locked',
        `Your PIN is locked for ${minutes === 1 ? 'one more minute' : `${minutes} more minutes`}, after three wrong tries. This keeps your account safe.`,
      );
    }
    if (pinMatches(given, shopper.pinHash, env.authTokenSecret)) {
      if (shopper.pinFailedAttempts !== 0 || shopper.pinLockedUntil) {
        await repository.shoppers.update(shopper.id, {
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        });
      }
      return;
    }
    const failed = shopper.pinFailedAttempts + 1;
    if (failed >= PIN_ATTEMPTS) {
      await repository.shoppers.update(shopper.id, {
        pinFailedAttempts: 0,
        pinLockedUntil: new Date(at.getTime() + PIN_LOCK_MINUTES * 60_000),
      });
      throw new ApiError(
        429,
        'pin_locked',
        `That PIN was wrong three times, so it is locked for ${PIN_LOCK_MINUTES} minutes. This keeps your account safe.`,
      );
    }
    await repository.shoppers.update(shopper.id, { pinFailedAttempts: failed });
    const left = PIN_ATTEMPTS - failed;
    throw new ForbiddenError(
      `That PIN is not right. You can try ${left === 1 ? 'once more' : `${left} more times`}.`,
    );
  }

  app.get('/me/addresses', async (request) => {
    const shopper = await me(request);
    return {
      home: shopper.deliveryAddress,
      saved: (await repository.savedAddresses.listForShopper(shopper.id)).map(
        ({ id, label, address: where }) => ({ id, label, address: where }),
      ),
      hasPin: shopper.pinHash !== null,
    };
  });

  /** Choose a PIN, the first time one is needed. Changing it is a separate, later step. */
  app.post('/me/pin', async (request, reply) => {
    const shopper = await me(request);
    const body = z.object({ pin }).parse(request.body);
    if (shopper.pinHash) {
      throw new ConflictError('You already have a PIN.');
    }
    const problem = pinProblem(body.pin);
    if (problem) throw new BadRequestError(problem);
    await repository.shoppers.update(shopper.id, {
      pinHash: hashPin(body.pin, env.authTokenSecret),
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    });
    void reply.status(201);
    return {
      message:
        'Your PIN is set. You will need it to save an address or change your home address. Keep it to yourself.',
    };
  });

  app.post('/me/addresses', async (request, reply) => {
    const shopper = await me(request);
    const body = z
      .object({ address, label: z.string().trim().max(60).default(''), pin })
      .parse(request.body);
    await checkPin(shopper, body.pin);
    const saved = await repository.savedAddresses.create({
      shopperId: shopper.id,
      label: body.label,
      address: body.address,
      createdAt: now(),
    });
    void reply.status(201);
    return {
      address: { id: saved.id, label: saved.label, address: saved.address },
      message: 'Saved. You can choose it when you send an order.',
    };
  });

  app.delete('/me/addresses/:id', async (request) => {
    const shopper = await me(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const found = await repository.savedAddresses.findById(id);
    if (!found || found.shopperId !== shopper.id) throw new NotFoundError('address');
    await repository.savedAddresses.delete(id);
    return { removed: true, message: 'That address has been removed.' };
  });

  /** Change the registered home address: the PIN, and the owner is always told. */
  app.put('/me/home-address', async (request) => {
    const shopper = await me(request);
    const body = z.object({ address, pin }).parse(request.body);
    await checkPin(shopper, body.pin);
    await repository.shoppers.update(shopper.id, { deliveryAddress: body.address });

    // Told every time, on every way we have, because a spoken PIN can be overheard.
    const notice = `${config.productName}: the home address on your account was changed just now. If that was not you, ring us straight away.`;
    void notifyShopper({ repository, sendPush: app.ctx.sendPush, log: request.log }, shopper.id, {
      title: 'Your home address was changed',
      body: notice,
      url: '/addresses',
      tag: 'home-address-changed',
    });
    if (app.ctx.sendText) {
      app.ctx.sendText(shopper.phone, notice).catch((failure: unknown) => {
        request.log.warn({ err: failure }, 'Could not text the home address notice.');
      });
    }
    return {
      home: body.address,
      message: 'Your home address is changed. We have let you know on your phone as well.',
    };
  });
}
