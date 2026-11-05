/**
 * Shop Partners seeing their orders and reaching their Runner (ruling 97, 5 November 2026).
 *
 * - A partner sees only the orders that carry its own lines (or, for a restaurant, café or
 *   takeaway, its own orders), and of each order only its own lines, the order's reference and
 *   where it has got to, and the Runner's first name and Runner ID. Never the Shopper's name,
 *   address or number; never the Runner's surname or phone.
 * - "Ready for pickup" is recorded once (`Order.readyAt`) and told to the Runner in Ozi's words.
 * - The short set messages come from `partnerOrders.messages` in config/store.json. There is no
 *   free text: a partner picks one, and the Runner hears exactly those words.
 * - Messages are open while the order is under way and for `partnerOrders.messageMinutesAfterDelivery`
 *   after delivery; then they are closed.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { Order, OrderItem, PartnerOrderMessage, PartnerShop, Runner } from '../domain.js';
import { plusPaid } from '../lib/partner-standing.js';
import { orderReference } from '../routes/runner-account.js';
import { runnerInPublic } from './public-ids.js';

type Ctx = Pick<AppContext, 'repository' | 'config' | 'now'>;

/** Orders a partner may still act on: a Runner has it and it is not yet delivered. */
export const PARTNER_ACTIVE: readonly Order['status'][] = [
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
];

/** Orders that are still to come: paid for, waiting for a Runner. */
const WAITING: readonly Order['status'][] = ['paid', 'offered'];

/** "Ready for pickup" may be said while the Runner is on the way to the shop or in it. */
export const READY_STATUSES: readonly Order['status'][] = ['accepted', 'shopping'];

/** Where an order has got to, in the partner's words. */
export const PARTNER_STATUS_WORDS: Record<Order['status'], string> = {
  draft: 'Not sent yet',
  confirmed: 'Waiting for payment',
  paid: 'Paid, waiting for a Runner',
  offered: 'Being offered to a Runner',
  accepted: 'A Runner is on the way to you',
  shopping: 'The Runner is in your shop',
  receipt_submitted: 'Paid at your till, about to set off',
  delivering: 'On the way to the Shopper',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

/**
 * Whether the partner is on a paid plan (ruling 97): Partner Plus paid up, or any plan that is
 * not the free listing and is paid for. A future plan name counts as paid as long as it is not
 * "free" and the month is paid.
 */
export function partnerOnPaidPlan(shop: PartnerShop, ctx: Pick<Ctx, 'config' | 'now'>): boolean {
  return (shop.plan as string) !== 'free' && plusPaid(shop, ctx.now(), ctx.config);
}

/** Said beside a disabled call button on the free listing. */
export const CALLS_NEED_PLUS_WORDS = 'Calls to your Runner come with Shop Partner Plus.';

/**
 * Which Shop Partner each line of an order is from, by line id: a partner's product is in the
 * catalogue as "partner:<product id>", and a restaurant order's lines are all its restaurant's.
 * Lines from the shops on the list are not in the map.
 */
export async function partnerOfItems(
  ctx: Pick<Ctx, 'repository'>,
  order: Order,
): Promise<Map<string, PartnerShop>> {
  const { repository } = ctx;
  const found = new Map<string, PartnerShop>();
  const shops = new Map<string, PartnerShop | null>();
  const shopById = async (id: string): Promise<PartnerShop | null> => {
    if (!shops.has(id)) shops.set(id, await repository.partnerShops.findById(id));
    return shops.get(id) ?? null;
  };
  const restaurant = order.restaurantShopId ? await shopById(order.restaurantShopId) : null;
  const catalogue = await repository.catalogue.findManyByIds(
    order.items.map((item) => item.catalogueItemId ?? '').filter(Boolean),
  );
  for (const item of order.items) {
    if (restaurant) {
      found.set(item.id, restaurant);
      continue;
    }
    const entry = catalogue.find((row) => row.id === item.catalogueItemId);
    const productId = entry?.externalRef?.startsWith('partner:')
      ? entry.externalRef.slice('partner:'.length)
      : null;
    if (!productId) continue;
    const product = await repository.partnerProducts.findById(productId);
    const shop = product ? await shopById(product.partnerShopId) : null;
    if (shop) found.set(item.id, shop);
  }
  return found;
}

/** The catalogue entries that are this shop's own products, live or not. */
export async function partnerCatalogueItemIds(ctx: Ctx, shopId: string): Promise<string[]> {
  const products = await ctx.repository.partnerProducts.listForShop(shopId);
  return products
    .map((product) => product.catalogueItemId)
    .filter((id): id is string => id !== null);
}

/** The lines of an order that are this shop's: every line of its own restaurant order, else its products. */
export function partnerLinesOf(
  order: Order,
  shopId: string,
  catalogueItemIds: ReadonlySet<string>,
): OrderItem[] {
  if (order.restaurantShopId === shopId) return order.items;
  return order.items.filter(
    (item) => item.catalogueItemId !== null && catalogueItemIds.has(item.catalogueItemId),
  );
}

/** When messages to the Runner about this order close, or null while it is under way. */
export function messagesCloseAt(
  order: Pick<Order, 'status' | 'deliveredAt'>,
  config: Pick<AppContext['config'], 'partnerOrders'>,
): Date | null {
  if (PARTNER_ACTIVE.includes(order.status)) return null;
  if ((order.status === 'delivered' || order.status === 'completed') && order.deliveredAt) {
    return new Date(
      order.deliveredAt.getTime() + config.partnerOrders.messageMinutesAfterDelivery * 60_000,
    );
  }
  return new Date(0);
}

export function messagesOpen(
  order: Pick<Order, 'status' | 'deliveredAt'>,
  config: Pick<AppContext['config'], 'partnerOrders'>,
  now: Date,
): boolean {
  const closeAt = messagesCloseAt(order, config);
  return closeAt === null || now.getTime() < closeAt.getTime();
}

export const MESSAGES_CLOSED_WORDS =
  'This order is finished, so messages to its Runner have closed. For anything else, speak to us.';

/** "Corner Bakery says your order OZ-ABC123 is ready for pickup." */
export function readyWords(shopName: string, order: Pick<Order, 'id'>): string {
  return `${shopName} says your order ${orderReference(order.id)} is ready for pickup.`;
}

/** "Corner Bakery says: Running 10 minutes late. Order OZ-ABC123." */
export function messageWords(shopName: string, words: string, order: Pick<Order, 'id'>): string {
  return `${shopName} says: ${words}. Order ${orderReference(order.id)}.`;
}

/**
 * A notification on the Runner's devices, and a text to their phone only when they have no device
 * that can show one. Never stops what caused it: the Runner's job page shows the message too.
 */
export async function tellRunner(
  ctx: Pick<AppContext, 'repository' | 'config' | 'sendPush' | 'sendText'>,
  runner: Pick<Runner, 'id' | 'phone'>,
  words: string,
  tag: string,
  log?: FastifyBaseLogger,
): Promise<'push' | 'text' | 'none'> {
  let reached: 'push' | 'text' | 'none' = 'none';
  if (ctx.sendPush) {
    try {
      for (const device of await ctx.repository.pushSubscriptions.listForRunner(runner.id)) {
        try {
          const sent = await ctx.sendPush(device, {
            title: ctx.config.productName,
            body: words,
            url: '/runner/home',
            tag,
          });
          if (sent === 'gone') {
            await ctx.repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
          } else {
            reached = 'push';
          }
        } catch (failure) {
          log?.warn({ err: failure }, 'A notification from a shop did not go.');
        }
      }
    } catch (failure) {
      log?.warn({ err: failure }, 'Notifications from a shop could not be sent.');
    }
  }
  if (reached === 'none' && ctx.sendText && runner.phone) {
    try {
      await ctx.sendText(runner.phone, `${ctx.config.productName}: ${words}`);
      reached = 'text';
    } catch (failure) {
      log?.warn({ err: failure }, 'The text from a shop did not go.');
    }
  }
  return reached;
}

/** One order as the partner sees it (ruling 97): its own lines, the reference, the Runner in public. */
export async function partnerOrderView(
  ctx: Ctx,
  order: Order,
  shop: PartnerShop,
  catalogueItemIds: ReadonlySet<string>,
  messages: PartnerOrderMessage[],
) {
  const { repository, config } = ctx;
  const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
  const at = ctx.now();
  const lines = partnerLinesOf(order, shop.id, catalogueItemIds);
  const active = PARTNER_ACTIVE.includes(order.status);
  return {
    id: order.id,
    reference: orderReference(order.id),
    status: order.status,
    statusWords: PARTNER_STATUS_WORDS[order.status],
    active,
    waiting: WAITING.includes(order.status),
    placedAt: order.createdAt,
    acceptedAt: order.acceptedAt,
    deliveringAt: order.status === 'delivering' ? order.updatedAt : null,
    deliveredAt: order.deliveredAt,
    readyAt: order.readyAt,
    /** The Runner, by first name and Runner ID only. */
    runner: runnerInPublic(runner),
    /** Whether the Runner has reached the shop, when it is known: in it, on the way, or past it. */
    runnerAtShop:
      order.status === 'shopping'
        ? true
        : order.status === 'accepted'
          ? false
          : ['receipt_submitted', 'delivering', 'delivered', 'completed'].includes(order.status)
            ? true
            : null,
    lines: lines.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      /** What the Runner pays the shop for one, at its own counter: the shop's own figure. */
      runnerPaysPence: item.counterPricePence ?? item.shopPricePence ?? item.estimatedPricePence,
    })),
    messages: messages
      .filter((message) => message.partnerShopId === shop.id)
      .map((message) => ({
        id: message.id,
        kind: message.kind,
        words: message.words,
        at: message.at,
      })),
    canReady: READY_STATUSES.includes(order.status) && order.readyAt === null,
    canMessage: messagesOpen(order, config, at),
    canCall: runner !== null && active,
  };
}
