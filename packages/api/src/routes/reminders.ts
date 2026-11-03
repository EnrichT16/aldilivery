/**
 * Reminders for everyone (Anthony, 3 November 2026, ruling 93): the screen's side, and Ozi's
 * reminder calls on the telephone.
 *
 * `GET /reminders`, `POST /reminders`, `DELETE /reminders/:id` and `POST /reminders/:id/heard`
 * work for every signed-in kind of account. Who is asking comes from the sign-in alone: a
 * Shopper's or Runner's session, a Shop Partner's or organisation's business token, a staff
 * member's or the owner's staff token. A person sees only their own.
 *
 * The calls: when a reminder by phone call is due, Ozi rings the person's own number and Twilio
 * asks here what to say: "Hello, this is Ozi with your reminder: …", then "Press 1 if you've
 * heard it, 2 to remind you again in ten minutes." Every request must carry Twilio's signature,
 * exactly as on the owner's desk and the telephone line, or it is refused.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Reminder } from '../domain.js';
import { ForbiddenError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { staffActor } from '../lib/staff.js';
import { escapeXml, goodbye, say, signedByTwilio } from '../lib/twilio-voice.js';
import {
  callAllowed,
  callOpening,
  callPlanWords,
  callPrompt,
  cancelReminder,
  createReminder,
  listReminders,
  markHeard,
  markHeardFor,
  REMINDER_CHANNELS,
  REMINDER_REPEATS,
  remindAgain,
  reminderView,
  reminderWebhookBase,
  type ReminderAccount,
} from '../services/reminders.js';

function has(request: FastifyRequest, name: string): boolean {
  const value = request.headers[name];
  return typeof value === 'string' ? value !== '' : Array.isArray(value) && value.length > 0;
}

/** Whose reminders: from the credentials alone. The staff key has no account, so no reminders. */
export async function reminderAccount(request: FastifyRequest): Promise<ReminderAccount> {
  if (has(request, 'x-staff-token') || has(request, 'x-staff-key')) {
    const actor = await staffActor(request);
    if (!actor.id) {
      throw new ForbiddenError(
        'Reminders belong to a person. Please sign in with your own staff account.',
      );
    }
    return { kind: actor.isOwner ? 'owner' : 'staff', id: actor.id };
  }
  if (has(request, 'x-business-token')) {
    const user = await businessActor(request);
    if (user.kind === 'partner' && user.partnerShopId) {
      return { kind: 'partner', id: user.partnerShopId };
    }
    if (user.kind === 'organisation' && user.organisationId) {
      return { kind: 'organisation', id: user.organisationId };
    }
    throw new ForbiddenError('Please sign in.');
  }
  const session = requireSession(request);
  return { kind: session.role === 'runner' ? 'runner' : 'shopper', id: session.accountId };
}

const createBody = z.object({
  text: z.string().trim().min(1, 'Please say what to remind you about.').max(1000),
  dueAt: z.string().datetime({ offset: true }),
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  channel: z.enum(['notification', 'text', 'call']).default('notification'),
});

export async function registerReminderRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const { env, repository, now } = ctx;

  async function view(account: ReminderAccount) {
    const at = now();
    const allowed = await callAllowed(ctx, account);
    return {
      reminders: (await listReminders(ctx, account)).map((row) => reminderView(row, at)),
      callAllowed: allowed,
      callPlanWords: allowed ? null : callPlanWords(ctx, account.kind),
      channels: REMINDER_CHANNELS,
      repeats: REMINDER_REPEATS,
      maxTextLength: ctx.config.reminders.maxTextLength,
      maxPerAccount: ctx.config.reminders.maxPerAccount,
    };
  }

  app.get('/reminders', async (request) => view(await reminderAccount(request)));

  app.post('/reminders', async (request, reply) => {
    const account = await reminderAccount(request);
    const input = createBody.parse(request.body ?? {});
    const reminder = await createReminder(ctx, account, {
      text: input.text,
      dueAt: new Date(input.dueAt),
      repeat: input.repeat,
      channel: input.channel,
      createdVia: 'screen',
    });
    return reply.status(201).send({
      reminder: reminderView(reminder, now()),
      message: `Reminder set for ${reminderView(reminder, now()).whenWords}.`,
    });
  });

  app.delete('/reminders/:id', async (request) => {
    const account = await reminderAccount(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const reminder = await cancelReminder(ctx, account, id);
    return { reminder: reminderView(reminder, now()), message: 'Reminder cancelled.' };
  });

  app.post('/reminders/:id/heard', async (request) => {
    const account = await reminderAccount(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const reminder = await markHeardFor(ctx, account, id);
    return { reminder: reminderView(reminder, now()) };
  });

  /* -------------------------------------------------------------- the calls */

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

  /** The reminder, then one key; silence comes back too, so it can be said once more. */
  function readOut(reminder: Reminder, again: boolean): string {
    const action = `${reminderWebhookBase(ctx)}/key?reminder=${encodeURIComponent(reminder.id)}&again=${again ? '1' : '0'}`;
    return (
      '<Response>' +
      `<Gather input="dtmf" numDigits="1" timeout="8" actionOnEmptyResult="true" method="POST" action="${escapeXml(action)}">` +
      say(
        `${again ? "I'll say that again. " : ''}${callOpening(ctx, reminder)} ${callPrompt(ctx)}`,
      ) +
      '</Gather>' +
      '</Response>'
    );
  }

  const query = z.object({ reminder: z.string().min(1), again: z.string().optional() });

  app.post('/webhooks/twilio/reminders/voice', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    const { reminder: id } = query.parse(request.query);
    const reminder = await repository.reminders.findById(id);
    if (!reminder || reminder.status === 'cancelled') {
      return twiml(reply, '<Response><Hangup/></Response>');
    }
    return twiml(reply, readOut(reminder, false));
  });

  app.post('/webhooks/twilio/reminders/key', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    const { reminder: id, again } = query.parse(request.query);
    const reminder = await repository.reminders.findById(id);
    if (!reminder) return twiml(reply, '<Response><Hangup/></Response>');
    const digits = (params['Digits'] ?? '').trim();
    if (digits === '1') {
      await markHeard(ctx, reminder.id);
      return twiml(reply, goodbye('Thank you. Goodbye.'));
    }
    if (digits === '2') {
      await remindAgain(ctx, reminder.id);
      return twiml(
        reply,
        goodbye(
          `All right. I'll remind you again in ${ctx.config.reminders.againMinutes} minutes. Goodbye.`,
        ),
      );
    }
    // Silence, or another key: said once more, then goodbye; the reminder stays on the screen.
    if (again !== '1') return twiml(reply, readOut(reminder, true));
    return twiml(reply, goodbye('Your reminder is on your screen too. Goodbye.'));
  });

  app.post('/webhooks/twilio/reminders/status', async (request, reply) => {
    const params = verified(request);
    if (!params) return refused(reply);
    // Nothing to record: the reminder was marked sent when the call was placed. A call that
    // was not answered stays sent, on the screen and in the inbox of the app.
    return reply.status(204).send();
  });
}
