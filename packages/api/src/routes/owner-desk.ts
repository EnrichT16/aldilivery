/**
 * Ozi's desk on the telephone and in the admin panel (ruling 74).
 *
 * Ozi rings the owner (services/owner-desk.ts decides when). When he answers, Twilio asks here
 * what to say: "Hello, Mr. Anthony. This is Ozi.", how many matters, then each one in turn, with
 * one key to press: 1 to approve, 2 to decline, 3 to decide later; or, for something he only
 * needs to hear, 1 if he has heard it, 3 to hear it later. Silence: it is said once more, then Ozi
 * moves on. At the end: "That's everything. Goodbye, Mr. Anthony." A voicemail (Twilio's machine
 * detection) is not him: Ozi puts the phone down and the call counts as unanswered.
 *
 * Every request must carry Twilio's signature, exactly as on the telephone line, or it is
 * refused. Where the call has got to is carried in the address of the next step, signed so it
 * cannot be changed.
 *
 * In the admin panel, the "Needs you now" page lists the open matters with Approve, Decline and
 * Later, for the founder and the owner.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { OwnerMatter } from '../domain.js';
import { ForbiddenError, NotFoundError } from '../errors.js';
import { staffActor } from '../lib/staff.js';
import { escapeXml, goodbye, say, signedByTwilio } from '../lib/twilio-voice.js';
import { countWords } from '../services/needs-you.js';
import {
  decideMatter,
  deskWebhookBase,
  inReadingOrder,
  recordCallStatus,
  tidyMatters,
  type DeskChoice,
} from '../services/owner-desk.js';

/** Where a call has got to: which call, the matters in the order read, which one, and repeats. */
interface DeskState {
  c: string;
  ids: string[];
  i: number;
  r: number;
  exp: number;
}

const LABEL = 'owner-desk-call:';
/** A call to the owner is allowed this long before its steps stop being accepted. */
const STATE_MINUTES = 30;

function seal(state: DeskState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(LABEL + payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function unseal(sealed: string, secret: string, now: Date): DeskState | null {
  const [payload, signature] = sealed.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(LABEL + payload)
      .digest('base64url'),
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeskState;
    if (typeof state.exp !== 'number' || state.exp * 1000 < now.getTime()) return null;
    if (!Array.isArray(state.ids) || typeof state.i !== 'number') return null;
    return state;
  } catch {
    return null;
  }
}

/** One key, nothing else; an empty answer comes back too, so silence can be repeated once. */
function gather(text: string, action: string): string {
  return (
    '<Response>' +
    `<Gather input="dtmf" numDigits="1" timeout="8" actionOnEmptyResult="true" method="POST" action="${escapeXml(action)}">` +
    say(text) +
    '</Gather>' +
    '</Response>'
  );
}

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

export function promptFor(matter: Pick<OwnerMatter, 'options'>): string {
  return matter.options === 'decide'
    ? 'Press 1 to approve, 2 to decline, 3 to decide later.'
    : 'Press 1 if you have heard it, 3 to hear it later.';
}

function publicMatter(matter: OwnerMatter) {
  return {
    id: matter.id,
    kind: matter.kind,
    summary: matter.summary,
    options: matter.options,
    urgent: matter.urgent,
    status: matter.status,
    laterUntil: matter.laterUntil,
    createdAt: matter.createdAt,
    callAttempts: matter.callAttempts,
    emailFrom: matter.emailFrom,
    emailSubject: matter.emailSubject,
  };
}

export async function registerOwnerDeskRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const { env, config, repository, now } = ctx;
  const name = config.owner.spokenName;
  const base = (): string => deskWebhookBase(ctx);

  /** Refuses anything Twilio did not sign. The address may arrive with or without `/api`. */
  function verified(request: FastifyRequest): Record<string, string> | null {
    const token = env.twilioAuthToken;
    const origin = env.primaryOrigin;
    if (!token || !origin) return null;
    const params = Object.fromEntries(
      Object.entries((request.body ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
    const path = request.url;
    const urls = path.startsWith('/api/')
      ? [`${origin}${path}`, `${origin}${path.slice(4)}`]
      : [`${origin}${path}`, `${origin}/api${path}`];
    const signature = request.headers['x-twilio-signature'];
    const given = Array.isArray(signature) ? signature[0] : signature;
    return signedByTwilio(token, urls, params, given) ? params : null;
  }

  function twiml(reply: FastifyReply, body: string): FastifyReply {
    return reply.type('text/xml; charset=utf-8').send(body);
  }

  function refused(reply: FastifyReply): FastifyReply {
    return reply.status(403).type('text/plain').send('Not signed by Twilio.');
  }

  const farewell = `That's everything. Goodbye, ${name}.`;

  /**
   * The matter at `state.i`, or the next still open one, read with its key prompt; or goodbye
   * when there are no more. Anything decided in the admin panel during the call is skipped.
   */
  async function readOut(opening: string, state: Omit<DeskState, 'exp'>): Promise<string> {
    let index = state.i;
    let matter: OwnerMatter | null = null;
    while (index < state.ids.length) {
      matter = await repository.ownerDesk.findMatter(state.ids[index] as string);
      if (matter && matter.status === 'open') break;
      matter = null;
      index += 1;
    }
    if (!matter) return goodbye(`${opening} ${farewell}`.trim());
    await repository.ownerDesk.updateMatter(matter.id, { lastReadAt: now() });
    const many = state.ids.length > 1;
    const which = many
      ? `The ${ORDINALS[index] ?? `number ${index + 1}`}${index === state.ids.length - 1 && index > 0 ? ', and last' : ''}. `
      : '';
    const sealed = seal(
      { ...state, i: index, exp: Math.floor(now().getTime() / 1000) + STATE_MINUTES * 60 },
      env.authTokenSecret,
    );
    return gather(
      `${opening} ${which}${matter.summary} ${promptFor(matter)}`.replace(/\s+/g, ' ').trim(),
      `${base()}/key?s=${encodeURIComponent(sealed)}`,
    );
  }

  /* -------------------------------------------------------------- answered */

  app.post('/webhooks/twilio/owner-desk/voice', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    const { call: callId } = z.object({ call: z.string().min(1) }).parse(request.query);
    const call = await repository.ownerDesk.findCall(callId);
    if (!call) return twiml(reply, '<Response><Hangup/></Response>');
    const answeredBy = params['AnsweredBy'] ?? '';
    if (/^(machine|fax)/.test(answeredBy)) {
      // A voicemail is not Mr. Anthony picking up: nothing is left on it, and the call counts
      // as unanswered so the next one comes as planned.
      await repository.ownerDesk.updateCall(call.id, { status: 'voicemail', endedAt: now() });
      return twiml(reply, '<Response><Hangup/></Response>');
    }
    await repository.ownerDesk.updateCall(call.id, { status: 'answered', answeredAt: now() });
    const open = inReadingOrder(await tidyMatters(ctx));
    const hello = `Hello, ${name}. This is ${config.assistantName}.`;
    if (open.length === 0) {
      return twiml(reply, goodbye(`${hello} Everything has been dealt with already. ${farewell}`));
    }
    const count =
      open.length === 1
        ? 'One thing needs you.'
        : `${countWords(open.length).charAt(0).toUpperCase()}${countWords(open.length).slice(1)} things need you.`;
    return twiml(
      reply,
      await readOut(`${hello} ${count}`, { c: call.id, ids: open.map((m) => m.id), i: 0, r: 0 }),
    );
  });

  /* -------------------------------------------------------------- a key, or silence */

  app.post('/webhooks/twilio/owner-desk/key', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    const { s } = z.object({ s: z.string().min(1) }).parse(request.query);
    const state = unseal(s, env.authTokenSecret, now());
    if (!state) {
      return twiml(reply, goodbye(`Sorry, this call has gone on too long. Goodbye, ${name}.`));
    }
    const matter = await repository.ownerDesk.findMatter(state.ids[state.i] ?? '');
    const next = { ...state, i: state.i + 1, r: 0 };
    if (!matter || matter.status !== 'open') {
      return twiml(reply, await readOut('That one has already been dealt with.', next));
    }
    const digits = (params['Digits'] ?? '').trim();
    const choice: DeskChoice | null =
      digits === '1'
        ? matter.options === 'decide'
          ? 'approve'
          : 'acknowledge'
        : digits === '2' && matter.options === 'decide'
          ? 'decline'
          : digits === '3'
            ? 'later'
            : null;
    if (!choice) {
      // Silence, or a key that does nothing here: said once more, then Ozi moves on, and it
      // stays open for the next call.
      if (state.r === 0) {
        return twiml(
          reply,
          await readOut(
            digits === '' ? "I'll say that again." : 'Sorry, that key does nothing here.',
            {
              ...state,
              r: 1,
            },
          ),
        );
      }
      return twiml(reply, await readOut("I'll keep that one for next time.", next));
    }
    const outcome = await decideMatter(ctx, matter, choice, 'phone', name, request.log);
    return twiml(reply, await readOut(outcome.words, next));
  });

  /* -------------------------------------------------------------- how the call went */

  app.post('/webhooks/twilio/owner-desk/status', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    const { call } = z.object({ call: z.string().min(1) }).parse(request.query);
    await recordCallStatus(ctx, call, params['CallStatus'] ?? '');
    return reply.status(204).send();
  });

  /* -------------------------------------------------------------- the admin panel */

  /** The open matters, urgent first, for the "Needs you now" page. */
  app.get('/staff/desk', async (request) => {
    await staffActor(request, 'overview');
    const unsettled = await tidyMatters(ctx);
    const open = inReadingOrder(unsettled);
    const later = unsettled.filter((matter) => matter.status === 'later');
    const [lastCall] = await repository.ownerDesk.latestCalls(1);
    return {
      matters: [...open, ...later].map(publicMatter),
      ringing: Boolean(env.ownerAlertPhone && ctx.placeCall && env.primaryOrigin),
      lastCall: lastCall
        ? { at: lastCall.placedAt, status: lastCall.status, attempt: lastCall.attempt }
        : null,
    };
  });

  app.post('/staff/desk/:id', async (request) => {
    const actor = await staffActor(request, 'overview');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { choice } = z
      .object({ choice: z.enum(['approve', 'decline', 'acknowledge', 'later']) })
      .parse(request.body ?? {});
    const matter = await repository.ownerDesk.findMatter(id);
    if (!matter) throw new NotFoundError('matter');
    // A staff member's message is approved only by the owner or someone he lets authorise
    // (ruling 77), never by the person who asked.
    if (matter.kind === 'message_approval' && choice !== 'later') {
      const { isAuthoriser } = await import('../services/company-contact.js');
      if (!(await isAuthoriser(ctx, actor))) {
        throw new ForbiddenError(
          'Only the owner, or someone he lets authorise, approves a staff message.',
        );
      }
    }
    const outcome = await decideMatter(ctx, matter, choice, 'panel', actor.name, request.log, {
      actorId: actor.id,
      ip: request.ip ?? '',
    });
    // Written in the audit log by the desk itself, in plain words.
    (request as FastifyRequest & { audited?: boolean }).audited = true;
    return { matter: publicMatter(outcome.matter), message: outcome.words };
  });
}
