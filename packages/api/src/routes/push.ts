/**
 * A Shopper allowing, or no longer allowing, notifications on a device.
 *
 * Only for Shoppers for now: they are the ones who need to hear about a Runner's question when
 * the page is closed. The address must be one of the browsers' push services; see `lib/push.ts`.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { BadRequestError, ConflictError } from '../errors.js';
import { isPushServiceEndpoint } from '../lib/push.js';

const Subscription = z.object({
  endpoint: z.string().min(1).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

export async function registerPushRoutes(app: FastifyInstance): Promise<void> {
  const { repository, now } = app.ctx;

  app.post('/push-subscriptions', async (request, reply) => {
    const session = requireSession(request, 'shopper');
    if (!app.ctx.sendPush) {
      throw new ConflictError('Notifications are not switched on yet.');
    }
    const { endpoint, keys } = Subscription.parse(request.body);
    if (!isPushServiceEndpoint(endpoint)) {
      throw new BadRequestError('That is not a notification address we can use.');
    }
    await repository.pushSubscriptions.save({
      shopperId: session.accountId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      createdAt: now(),
    });
    void reply.status(201);
    return { saved: true, message: 'Notifications are on for this device.' };
  });

  app.delete('/push-subscriptions', async (request) => {
    const session = requireSession(request, 'shopper');
    const { endpoint } = z.object({ endpoint: z.string().min(1).max(2048) }).parse(request.body);
    const mine = await repository.pushSubscriptions.listForShopper(session.accountId);
    if (mine.some((device) => device.endpoint === endpoint)) {
      await repository.pushSubscriptions.deleteByEndpoint(endpoint);
    }
    return { removed: true, message: 'Notifications are off for this device.' };
  });
}
