/**
 * A Shop Partner's orders, and reaching their Runner (ruling 97, 5 November 2026).
 *
 * - `GET /partner/orders`: the orders under way and the last `partnerOrders.historyDays` days,
 *   paged; only orders carrying this shop's lines, and only those lines. The Runner is shown by
 *   first name and Runner ID, never surname or phone. The Shopper is never named.
 * - `POST /partner/orders/:id/ready`: "Ready for pickup", once per order, while the Runner is on
 *   the way or in the shop; the Runner is told in Ozi's words. Every package.
 * - `POST /partner/orders/:id/message`: one of the set messages in `partnerOrders.messages`, never
 *   free text, while the order is under way and for a few minutes after delivery. Every package.
 * - Calls to the Runner, in the app, free to both sides: paid packages only. The free listing is
 *   told so plainly ("Calls to your Runner come with Shop Partner Plus.").
 *
 * Every change here is written in the audit log with the shop as the actor (lib/audit.ts).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Call, CallLeg, Order, PartnerShop } from '../domain.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from '../errors.js';
import { recordAudit } from '../lib/audit.js';
import { businessActor } from '../lib/business.js';
import type { CallProvider } from '../lib/livekit.js';
import {
  CALLS_CLOSED_MESSAGE,
  callsClosed,
  finishCall,
  partnerCall,
  partnerCallingWords,
} from '../services/calls.js';
import {
  CALLS_NEED_PLUS_WORDS,
  MESSAGES_CLOSED_WORDS,
  PARTNER_ACTIVE,
  READY_STATUSES,
  messageWords,
  messagesOpen,
  partnerCatalogueItemIds,
  partnerOnPaidPlan,
  partnerOrderView,
  readyWords,
  tellRunner,
} from '../services/partner-orders.js';
import { ensurePublicId } from '../services/public-ids.js';
import { orderReference } from './runner-account.js';

/** A pass into a room lasts long enough to connect, not for ever. */
const TOKEN_SECONDS = 10 * 60;

export async function registerPartnerOrderRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;

  async function myShop(request: FastifyRequest): Promise<PartnerShop> {
    const user = await businessActor(request, 'partner');
    const shop = user.partnerShopId
      ? await repository.partnerShops.findById(user.partnerShopId)
      : null;
    if (!shop) throw new NotFoundError('partner shop');
    await ensurePublicId(app.ctx, 'partner', shop);
    return shop;
  }

  /** The shop as the audit log names it: its name and its Partner ID. */
  function actorFor(shop: PartnerShop) {
    return { id: shop.id, name: `${shop.name} (${shop.publicId ?? ''})`.trim(), role: 'partner' };
  }

  /** An order of this shop's, or nothing: an order of anybody else's is "not found", never "forbidden". */
  async function myOrder(
    shop: PartnerShop,
    orderId: string,
  ): Promise<{ order: Order; itemIds: Set<string> }> {
    const itemIds = new Set(await partnerCatalogueItemIds(app.ctx, shop.id));
    const order = await repository.orders.findById(orderId);
    const mine =
      order &&
      (order.restaurantShopId === shop.id ||
        order.items.some(
          (item) => item.catalogueItemId !== null && itemIds.has(item.catalogueItemId),
        ));
    if (!order || !mine) throw new NotFoundError('order');
    return { order, itemIds };
  }

  async function view(shop: PartnerShop, order: Order, itemIds: Set<string>) {
    return partnerOrderView(
      app.ctx,
      order,
      shop,
      itemIds,
      await repository.partnerMessages.listForOrder(order.id),
    );
  }

  async function runnerOf(order: Order) {
    const runner = order.runnerId ? await repository.runners.findById(order.runnerId) : null;
    if (!runner) throw new ConflictError('There is no Runner on this order yet.');
    return runner;
  }

  app.get('/partner/orders', async (request) => {
    const shop = await myShop(request);
    const { page } = z
      .object({ page: z.coerce.number().int().min(1).default(1) })
      .parse(request.query ?? {});
    const itemIds = new Set(await partnerCatalogueItemIds(app.ctx, shop.id));
    const since = new Date(now().getTime() - config.partnerOrders.historyDays * 24 * 3_600_000);
    const orders = (
      await repository.orders.listForPartnerShop({
        shopId: shop.id,
        catalogueItemIds: [...itemIds],
        since,
      })
    ).filter((order) => order.status !== 'draft');
    const active = orders.filter(
      (order) =>
        PARTNER_ACTIVE.includes(order.status) || ['paid', 'offered'].includes(order.status),
    );
    const recent = orders.filter((order) => !active.includes(order));
    const size = config.partnerOrders.pageSize;
    const pages = Math.max(1, Math.ceil(recent.length / size));
    const slice = recent.slice((page - 1) * size, page * size);
    return {
      shop: {
        id: shop.id,
        name: shop.name,
        publicId: shop.publicId,
        paidPlan: partnerOnPaidPlan(shop, app.ctx),
        callWords: partnerOnPaidPlan(shop, app.ctx) ? null : CALLS_NEED_PLUS_WORDS,
      },
      messageKinds: Object.entries(config.partnerOrders.messages).map(([kind, words]) => ({
        kind,
        words,
      })),
      active: await Promise.all(active.map((order) => view(shop, order, itemIds))),
      recent: await Promise.all(slice.map((order) => view(shop, order, itemIds))),
      page,
      pages,
      total: recent.length,
      historyDays: config.partnerOrders.historyDays,
    };
  });

  app.get('/partner/orders/:id', async (request) => {
    const shop = await myShop(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { order, itemIds } = await myOrder(shop, id);
    return { order: await view(shop, order, itemIds) };
  });

  /** "Ready for pickup": once per order, every package. */
  app.post('/partner/orders/:id/ready', async (request) => {
    const shop = await myShop(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { order, itemIds } = await myOrder(shop, id);
    const words = readyWords(shop.name, order);
    if (order.readyAt !== null) {
      // Said already: the same answer, and the Runner is not told twice.
      return {
        order: await view(shop, order, itemIds),
        message: `You have already said this order is ready. Your Runner was told: "${words}"`,
        told: 'already',
      };
    }
    if (!READY_STATUSES.includes(order.status)) {
      throw new ConflictError(
        order.runnerId
          ? 'This order is past the shop now, so there is no need to say it is ready.'
          : 'There is no Runner on this order yet. You can say it is ready once a Runner is on the way.',
      );
    }
    const runner = await runnerOf(order);
    const at = now();
    const updated = await repository.orders.update(order.id, { readyAt: at });
    await repository.partnerMessages.create({
      orderId: order.id,
      partnerShopId: shop.id,
      kind: 'ready',
      words: config.partnerOrders.messages['ready'] ?? 'Ready for pickup',
      at,
    });
    const told = await tellRunner(app.ctx, runner, words, `shop-ready-${order.id}`, request.log);
    await recordAudit(request, {
      actor: actorFor(shop),
      action: 'partner.order-ready',
      target: `order=${order.id}`,
      detail: words,
    });
    return {
      order: await view(shop, updated, itemIds),
      message: `Thank you. Your Runner has been told: "${words}"`,
      told,
    };
  });

  /** One of the set messages, never free text. */
  app.post('/partner/orders/:id/message', async (request) => {
    const shop = await myShop(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const kinds = Object.keys(config.partnerOrders.messages);
    const { kind } = z
      .object({
        kind: z
          .string()
          .refine((value) => kinds.includes(value), 'Please choose one of the set messages.'),
      })
      .parse(request.body ?? {});
    const { order, itemIds } = await myOrder(shop, id);
    if (!messagesOpen(order, config, now())) throw new ConflictError(MESSAGES_CLOSED_WORDS);
    const runner = await runnerOf(order);
    const setWords = config.partnerOrders.messages[kind]!;
    const words = messageWords(shop.name, setWords, order);
    const at = now();
    const saved = await repository.partnerMessages.create({
      orderId: order.id,
      partnerShopId: shop.id,
      kind,
      words: setWords,
      at,
    });
    let updated = order;
    if (kind === 'ready' && order.readyAt === null && READY_STATUSES.includes(order.status)) {
      updated = await repository.orders.update(order.id, { readyAt: at });
    }
    const told = await tellRunner(app.ctx, runner, words, `shop-message-${saved.id}`, request.log);
    await recordAudit(request, {
      actor: actorFor(shop),
      action: 'partner.message',
      target: `order=${order.id}`,
      detail: words,
    });
    return {
      order: await view(shop, updated, itemIds),
      message: `Sent. Your Runner has been told: "${words}"`,
      told,
    };
  });

  /* ------------------------------------------------------------------ calls to the Runner */

  function provider(): CallProvider {
    if (!app.ctx.calls) {
      throw new UnavailableError(
        'In-app calls are not switched on yet. You can still send your Runner a message from here.',
      );
    }
    return app.ctx.calls;
  }

  function requirePaid(shop: PartnerShop): void {
    if (!partnerOnPaidPlan(shop, app.ctx)) throw new ForbiddenError(CALLS_NEED_PLUS_WORDS);
  }

  function publicCall(call: Call) {
    return {
      id: call.id,
      orderId: call.orderId,
      status: call.status,
      startedBy: call.startedBy,
      free: true,
      words: call.priceStatement,
    };
  }

  async function legFor(call: Call, shop: PartnerShop): Promise<CallLeg> {
    const identity = `partner-${shop.id}`;
    const existing = (await repository.callLegs.listForCall(call.id)).find(
      (leg) => leg.identity === identity,
    );
    if (existing) return existing;
    return repository.callLegs.create({
      callId: call.id,
      role: 'partner',
      identity,
      name: shop.name,
      connectedSince: null,
      secondsConnected: 0,
      inviteCodeHash: null,
      priceStatement: null,
      createdAt: now(),
    });
  }

  async function pass(call: Call, leg: CallLeg) {
    const token = await provider().issueToken({
      roomName: call.roomName,
      identity: leg.identity,
      name: leg.name,
      ttlSeconds: TOKEN_SECONDS,
    });
    return { url: provider().url, token, roomName: call.roomName };
  }

  /** Start a call to the Runner of an active order, or rejoin the one this shop started. */
  app.post('/partner/orders/:id/calls', async (request, reply) => {
    const shop = await myShop(request);
    requirePaid(shop);
    provider();
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { order } = await myOrder(shop, id);
    const runner = await runnerOf(order);
    if (!PARTNER_ACTIVE.includes(order.status) || callsClosed(order, config, now())) {
      throw new ConflictError(CALLS_CLOSED_MESSAGE);
    }
    let call = await repository.calls.findOpenForOrder(order.id);
    if (call && call.partnerShopId !== shop.id) {
      throw new ConflictError(
        'Your Runner is on another call about this order. Please try again in a minute.',
      );
    }
    let started = false;
    if (!call) {
      call = await repository.calls.create({
        ...partnerCall(order, shop, now()),
        priceStatement: partnerCallingWords(shop.name, orderReference(order.id)),
      });
      started = true;
    }
    const leg = await legFor(call, shop);
    if (started) {
      void tellRunner(
        app.ctx,
        runner,
        `${partnerCallingWords(shop.name, orderReference(order.id))} Open your Runner page to answer. This call is free.`,
        `shop-call-${call.id}`,
        request.log,
      );
      await recordAudit(request, {
        actor: actorFor(shop),
        action: 'partner.call-started',
        target: `order=${order.id}`,
      });
    }
    void reply.status(started ? 201 : 200);
    return { call: publicCall(call), join: await pass(call, leg) };
  });

  /** The call about this order that is ringing or live, if this shop started it. */
  app.get('/partner/orders/:id/calls/current', async (request) => {
    const shop = await myShop(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { order } = await myOrder(shop, id);
    const call = await repository.calls.findOpenForOrder(order.id);
    return { call: call && call.partnerShopId === shop.id ? publicCall(call) : null };
  });

  /** End the shop's call. */
  app.post('/partner/calls/:callId/end', async (request) => {
    const shop = await myShop(request);
    const { callId } = z.object({ callId: z.string().min(1) }).parse(request.params);
    const call = await repository.calls.findById(callId);
    if (!call || call.partnerShopId !== shop.id) throw new NotFoundError('call');
    if (call.status === 'ended') return { call: publicCall(call) };
    if (!app.ctx.calls) throw new BadRequestError('Calls are not switched on.');
    await app.ctx.calls.endRoom(call.roomName).catch((failure: unknown) => {
      request.log.warn({ err: failure }, 'LiveKit could not close the room.');
    });
    const ended = await finishCall(app.ctx, call, now(), request.log);
    return { call: publicCall(ended) };
  });
}
