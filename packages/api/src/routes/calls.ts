/**
 * In-app calls about an order (docs/BUILD_PROMPT.md, Section F), carried by LiveKit.
 *
 * - The Shopper and the Runner of an order can call each other while the order is under way.
 *   Each gets a short-lived pass into that call's room, under an identity of ours. Nobody's
 *   telephone number is in any of it.
 * - The Shopper pays 5p a minute, and agrees to it first (Rule One): the price is put to them
 *   and they say yes before they can start or answer a call.
 * - MERGE: the Shopper can add people — a carer, a relative — by sending them a link. Before
 *   each one is added the price for them is put to the Shopper and they say yes. The Shopper
 *   pays for their minutes too. A Runner cannot add anybody, and never pays.
 * - Minutes come from LiveKit's own signed webhooks, not from anything an app reports.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSession, type Session } from '../app.js';
import type { Call, CallLeg, Order } from '../domain.js';
import {
  ApiError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from '../errors.js';
import type { CallProvider } from '../lib/livekit.js';
import {
  finishCall,
  guestPriceStatement,
  outstandingPence,
  priceStatement,
} from '../services/calls.js';
import { notifyShopper } from '../services/notify.js';

/** A pass into a room lasts long enough to connect, not for ever. */
const TOKEN_SECONDS = 10 * 60;
/** Orders that can still be talked about. */
const CALLABLE: Order['status'][] = [
  'paid',
  'offered',
  'accepted',
  'shopping',
  'receipt_submitted',
  'delivering',
  'delivered',
];

/** Rule One, for calls: the price is agreed before the call, never discovered after it. */
function priceNotAgreed(pencePerMinute: number): ApiError {
  return new ApiError(
    409,
    'confirmation_required',
    priceStatement(pencePerMinute) + ' Please say yes to that first.',
    {
      pencePerMinute,
    },
  );
}

const priceAccepted = z.literal(true, {
  errorMap: () => ({ message: 'Please say yes to the price of the call first.' }),
});

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export async function registerCallRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, env, now } = app.ctx;
  const pence = config.calls.pencePerMinute;

  function provider(): CallProvider {
    if (!app.ctx.calls) {
      throw new UnavailableError(
        'In-app calls are not switched on yet. Your Runner can still ask you things on your order page.',
      );
    }
    return app.ctx.calls;
  }

  /** The order, and which side of it this person is on. */
  async function sideOf(session: Session, orderId: string): Promise<Order> {
    const order = await repository.orders.findById(orderId);
    const mine =
      order &&
      ((session.role === 'shopper' && order.shopperId === session.accountId) ||
        (session.role === 'runner' && order.runnerId === session.accountId));
    if (!order || !mine) throw new NotFoundError('order');
    return order;
  }

  async function callFor(session: Session, callId: string): Promise<Call> {
    const call = await repository.calls.findById(callId);
    const mine =
      call &&
      ((session.role === 'shopper' && call.shopperId === session.accountId) ||
        (session.role === 'runner' && call.runnerId === session.accountId));
    if (!call || !mine) throw new NotFoundError('call');
    return call;
  }

  /** The leg for the Shopper or the Runner, made the first time they are part of the call. */
  async function legFor(call: Call, session: Session): Promise<CallLeg> {
    const identity = `${session.role}-${session.accountId}`;
    const existing = (await repository.callLegs.listForCall(call.id)).find(
      (leg) => leg.identity === identity,
    );
    if (existing) return existing;
    let name = 'Your Runner';
    if (session.role === 'shopper') {
      const shopper = await repository.shoppers.findById(session.accountId);
      name = firstName(shopper?.displayName ?? 'Shopper');
    } else {
      const runner = await repository.runners.findById(session.accountId);
      name = firstName(runner?.name ?? 'Your Runner');
    }
    return repository.callLegs.create({
      callId: call.id,
      role: session.role === 'shopper' ? 'shopper' : 'runner',
      identity,
      name,
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

  function publicCall(call: Call) {
    return {
      id: call.id,
      orderId: call.orderId,
      status: call.status,
      startedBy: call.startedBy,
      pencePerMinute: call.pencePerMinute,
      priceAccepted: call.priceAcceptedAt !== null,
      billedMinutes: call.billedMinutes,
      chargePence: call.chargePence,
      chargeStatus: call.chargeStatus,
    };
  }

  /** What the Shopper is asked to agree to, before calling or answering. */
  app.get('/calls/price', async () => ({
    pencePerMinute: pence,
    statement: priceStatement(pence),
  }));

  /** Start a call about an order, or join the one already ringing. */
  app.post('/orders/:orderId/calls', async (request: FastifyRequest, reply) => {
    const session = requireSession(request);
    provider();
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = z.object({ priceAccepted: priceAccepted.optional() }).parse(request.body ?? {});
    const order = await sideOf(session, orderId);
    if (!order.runnerId) {
      throw new ConflictError('There is no Runner on this order yet, so there is nobody to call.');
    }
    if (!CALLABLE.includes(order.status)) {
      throw new ConflictError('This order is finished, so calls about it are closed.');
    }
    if (session.role === 'shopper' && body.priceAccepted !== true) {
      throw priceNotAgreed(pence);
    }

    let call = await repository.calls.findOpenForOrder(order.id);
    let started = false;
    if (!call) {
      call = await repository.calls.create({
        orderId: order.id,
        shopperId: order.shopperId,
        runnerId: order.runnerId,
        roomName: `call-${randomBytes(16).toString('hex')}`,
        startedBy: session.role === 'shopper' ? 'shopper' : 'runner',
        status: 'ringing',
        createdAt: now(),
        endedAt: null,
        priceStatement: null,
        priceAcceptedAt: null,
        pencePerMinute: pence,
        billedMinutes: 0,
        chargePence: 0,
        chargeStatus: 'pending',
        paymentReference: null,
        chargedAt: null,
      });
      started = true;
    }
    if (session.role === 'shopper' && !call.priceAcceptedAt) {
      call = await repository.calls.update(call.id, {
        priceStatement: priceStatement(pence),
        priceAcceptedAt: now(),
      });
    }
    const leg = await legFor(call, session);

    if (started && session.role === 'runner') {
      void notifyShopper(
        { repository, sendPush: app.ctx.sendPush, log: request.log },
        order.shopperId,
        {
          title: 'Your Runner is calling',
          body: 'Open your order to answer.',
          url: '/my-order',
          tag: `call-${call.id}`,
        },
      );
    }

    void reply.status(started ? 201 : 200);
    return { call: publicCall(call), join: await pass(call, leg) };
  });

  /** The call about this order that is ringing or live, so either side can see it and answer. */
  app.get('/orders/:orderId/calls/current', async (request) => {
    const session = requireSession(request);
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    await sideOf(session, orderId);
    const call = await repository.calls.findOpenForOrder(orderId);
    return { call: call ? publicCall(call) : null };
  });

  /** Answer, or rejoin after a dropped signal. */
  app.post('/calls/:callId/join', async (request) => {
    const session = requireSession(request);
    provider();
    const { callId } = z.object({ callId: z.string().min(1) }).parse(request.params);
    const body = z.object({ priceAccepted: priceAccepted.optional() }).parse(request.body ?? {});
    let call = await callFor(session, callId);
    if (call.status === 'ended') throw new ConflictError('That call has ended.');
    if (session.role === 'shopper' && !call.priceAcceptedAt) {
      if (body.priceAccepted !== true) throw priceNotAgreed(pence);
      call = await repository.calls.update(call.id, {
        priceStatement: priceStatement(pence),
        priceAcceptedAt: now(),
      });
    }
    return { call: publicCall(call), join: await pass(call, await legFor(call, session)) };
  });

  /** MERGE: the Shopper adds somebody, who joins from a link. */
  app.post('/calls/:callId/guests', async (request, reply) => {
    const session = requireSession(request);
    provider();
    if (session.role !== 'shopper') {
      throw new ForbiddenError('Only the Shopper can add somebody to the call.');
    }
    const { callId } = z.object({ callId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        name: z
          .string()
          .trim()
          .min(1, 'Please say who you are adding.')
          .max(40, 'That name is too long.'),
        priceAccepted,
      })
      .parse(request.body);
    const call = await callFor(session, callId);
    if (call.status === 'ended') throw new ConflictError('That call has ended.');
    const owed = await outstandingPence(app.ctx, session.accountId);
    if (owed > config.calls.maxOutstandingPence) {
      throw new ConflictError(
        `There is ${config.store.currencySymbol}${(owed / 100).toFixed(2)} for earlier calls still to pay. Once that is paid, you can add people to calls again.`,
        { outstandingPence: owed },
      );
    }

    const code = randomBytes(24).toString('base64url');
    const leg = await repository.callLegs.create({
      callId: call.id,
      role: 'guest',
      identity: `guest-${randomBytes(8).toString('hex')}`,
      name: body.name,
      connectedSince: null,
      secondsConnected: 0,
      inviteCodeHash: hashCode(code),
      priceStatement: guestPriceStatement(body.name, pence),
      createdAt: now(),
    });
    const origin = env.primaryOrigin ?? '';
    void reply.status(201);
    return {
      guest: { id: leg.id, name: leg.name },
      // Sent by the Shopper, from their own phone, however they like. Not a phone number.
      link: `${origin}/call/join#${code}`,
      message: `Send this link to ${leg.name}. When they open it, they join the call.`,
    };
  });

  /**
   * The Runner rings the Shopper's own telephone into the call (ruling 46): for somebody who
   * ordered by phone and has no app. LiveKit dials out through our Twilio number, so the
   * Runner never sees or hears the number, and the Shopper's phone shows ours. Free for the
   * Shopper, who never agreed a price for it.
   */
  app.post('/calls/:callId/phone', async (request) => {
    const session = requireSession(request, 'runner');
    const calls = provider();
    if (!calls.dialPhone) {
      throw new UnavailableError(
        "Ringing the Shopper's phone is not switched on yet. Ask your question on the order page instead.",
      );
    }
    const { callId } = z.object({ callId: z.string().min(1) }).parse(request.params);
    const call = await callFor(session, callId);
    if (call.status === 'ended') throw new ConflictError('That call has ended.');
    const shopper = await repository.shoppers.findById(call.shopperId);
    if (!shopper) throw new NotFoundError('Shopper');
    const identity = `phone-${shopper.id}`;
    const legs = await repository.callLegs.listForCall(call.id);
    const already = legs.find((leg) => leg.identity === identity);
    if (already?.connectedSince) {
      throw new ConflictError(`${firstName(shopper.displayName)}'s phone is already on the call.`);
    }
    const name = firstName(shopper.displayName);
    if (!already) {
      await repository.callLegs.create({
        callId: call.id,
        role: 'phone',
        identity,
        name,
        connectedSince: null,
        secondsConnected: 0,
        inviteCodeHash: null,
        priceStatement: null,
        createdAt: now(),
      });
    }
    try {
      await calls.dialPhone({ roomName: call.roomName, phone: shopper.phone, identity, name });
    } catch (failure) {
      request.log.warn({ err: failure, callId: call.id }, 'The phone could not be rung.');
      throw new UnavailableError(
        `${name}'s phone could not be rung just now. Please try again, or ask on the order page.`,
      );
    }
    return {
      ringing: true,
      message: `Ringing ${name}'s phone now. Their number is never shown to you.`,
    };
  });

  /** A guest opens their link. No account needed; the code is the pass. */
  app.post('/calls/guest-join', async (request) => {
    provider();
    const body = z.object({ code: z.string().min(10).max(100) }).parse(request.body);
    const leg = await repository.callLegs.findByInviteCodeHash(hashCode(body.code));
    const call = leg ? await repository.calls.findById(leg.callId) : null;
    if (!leg || !call) throw new NotFoundError('call');
    if (call.status === 'ended') throw new ConflictError('That call has ended.');
    return { name: leg.name, join: await pass(call, leg) };
  });

  /** END CALL for everyone. Billing follows from LiveKit's own record of the room closing. */
  app.post('/calls/:callId/end', async (request) => {
    const session = requireSession(request);
    const { callId } = z.object({ callId: z.string().min(1) }).parse(request.params);
    const call = await callFor(session, callId);
    if (call.status !== 'ended') {
      await provider()
        .endRoom(call.roomName)
        .catch((failure: unknown) => {
          request.log.warn({ err: failure }, 'LiveKit could not close the room.');
        });
      const ended = await finishCall(app.ctx, call, now(), request.log);
      return { call: publicCall(ended) };
    }
    return { call: publicCall(call) };
  });

  /** What the Shopper still owes for calls, if anything. */
  app.get('/me/call-balance', async (request) => {
    const session = requireSession(request, 'shopper');
    const owed = await outstandingPence(app.ctx, session.accountId);
    return { outstandingPence: owed };
  });

  /** LiveKit's signed record of who joined, who left, and when the room closed. */
  app.post('/webhooks/livekit', async (request) => {
    const body = (request as FastifyRequest & { rawText?: string }).rawText;
    if (!body) throw new BadRequestError('That request had no body.');
    let event;
    try {
      event = await provider().verifyWebhook(body, request.headers.authorization);
    } catch (failure) {
      if (failure instanceof UnavailableError) throw failure;
      throw new BadRequestError('That signature did not check out.');
    }
    const call = event.roomName ? await repository.calls.findByRoomName(event.roomName) : null;
    if (!call || call.status === 'ended') return { received: true };

    if (event.event === 'participant_joined' || event.event === 'participant_left') {
      const leg = (await repository.callLegs.listForCall(call.id)).find(
        (candidate) => candidate.identity === event.identity,
      );
      if (!leg) return { received: true };
      if (event.event === 'participant_joined' && !leg.connectedSince) {
        await repository.callLegs.update(leg.id, { connectedSince: event.at });
        const answerer = call.startedBy === 'shopper' ? 'runner' : 'shopper';
        if (
          call.status === 'ringing' &&
          (leg.role === answerer || (leg.role === 'phone' && answerer === 'shopper'))
        ) {
          await repository.calls.update(call.id, { status: 'live' });
        }
      }
      if (event.event === 'participant_left' && leg.connectedSince) {
        const seconds = Math.max(
          0,
          Math.round((event.at.getTime() - leg.connectedSince.getTime()) / 1000),
        );
        await repository.callLegs.update(leg.id, {
          connectedSince: null,
          secondsConnected: leg.secondsConnected + seconds,
        });
      }
    } else if (event.event === 'room_finished') {
      await finishCall(app.ctx, call, event.at, request.log);
    }
    return { received: true };
  });
}
