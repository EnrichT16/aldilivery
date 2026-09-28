/**
 * Telling a Shopper something on every device they have allowed to show notifications.
 *
 * Never allowed to break what caused it: a question is asked whether or not a notification gets
 * through, and it is still on the Your order page either way. Failures go to the log. A device
 * the push service says has gone is forgotten.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { Repository } from '../data/repository.js';
import type { PushMessage, SendPush } from '../lib/push.js';

export async function notifyShopper(
  deps: { repository: Repository; sendPush: SendPush | null; log: FastifyBaseLogger },
  shopperId: string,
  message: PushMessage,
): Promise<void> {
  const { repository, sendPush, log } = deps;
  if (!sendPush) return;
  try {
    const devices = await repository.pushSubscriptions.listForShopper(shopperId);
    await Promise.all(
      devices.map(async (device) => {
        try {
          if ((await sendPush(device, message)) === 'gone') {
            await repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
          }
        } catch (failure) {
          log.warn({ err: failure, shopperId }, 'A notification could not be sent.');
        }
      }),
    );
  } catch (failure) {
    log.warn({ err: failure, shopperId }, 'Notifications could not be sent.');
  }
}
