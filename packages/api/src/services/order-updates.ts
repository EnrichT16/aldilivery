/**
 * Telling the Shopper how their order is going (Section G; rulings 28 and 45): when it is paid,
 * when a Runner takes it, when it is on its way, and when it has arrived.
 *
 * A notification goes to every device the Shopper allowed. Somebody with no such device, such
 * as a person who orders by telephone, gets a text instead, if their number is a mobile. Never
 * allowed to break what caused it: a failure goes to the log, and the order page still says it.
 * No text ever carries a Runner's number, or anybody's.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order } from '../domain.js';
import { isUkMobile } from '../lib/phone.js';
import { notifyShopper } from './notify.js';

export type OrderStage = 'paid' | 'accepted' | 'delivering' | 'delivered';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export async function tellShopper(
  ctx: AppContext,
  order: Order,
  stage: OrderStage,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    const { repository, config } = ctx;
    const shopper = await repository.shoppers.findById(order.shopperId);
    if (!shopper) return;
    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    const who = runner ? firstName(runner.name) : 'Your Runner';
    const body = {
      paid: 'We have your order and are finding a Runner now.',
      accepted: `${who} has your order and will do your shopping.`,
      delivering: `${who} has your shopping and is on the way to you.`,
      delivered: `${who} has delivered your shopping. ${config.motto}`,
    }[stage];
    const devices = await repository.pushSubscriptions.listForShopper(shopper.id);
    if (devices.length > 0 && ctx.sendPush) {
      await notifyShopper({ repository, sendPush: ctx.sendPush, log }, shopper.id, {
        title: config.productName,
        body,
        url: '/my-order',
        tag: `order-${order.id}`,
      });
      return;
    }
    if (ctx.sendText && isUkMobile(shopper.phone)) {
      await ctx.sendText(shopper.phone, `${config.productName}: ${body}`);
    }
  } catch (failure) {
    log.warn({ err: failure, orderId: order.id, stage }, 'The Shopper could not be told.');
  }
}
