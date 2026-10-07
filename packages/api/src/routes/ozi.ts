/**
 * Ozi's everyday replies (ruling 44): the app says what was heard, the server answers from the
 * collection for whoever is signed in. The collections themselves are never sent anywhere.
 *
 * The account is decided by the credentials, never by anything in the request body, so a
 * Shopper cannot ask for the owner's collection: the owner's own session (signed in with his
 * passcode), a family member or investor, other staff, a partner shop or an organisation, a
 * Runner, and otherwise a Shopper, signed in or not.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { businessActor } from '../lib/business.js';
import { phraseBook, phraseReply, type PhraseAccount } from '../lib/phrases.js';
import { staffActor } from '../lib/staff.js';

const body = z.object({
  text: z.string().trim().min(1).max(300),
  mode: z.enum(['exact', 'within']),
  turn: z.number().int().min(0).max(1_000_000).default(0),
});

function has(request: FastifyRequest, name: string): boolean {
  const value = request.headers[name];
  return typeof value === 'string' ? value !== '' : Array.isArray(value) && value.length > 0;
}

async function accountOf(request: FastifyRequest): Promise<PhraseAccount> {
  if (has(request, 'x-staff-token') || has(request, 'x-staff-key')) {
    const actor = await staffActor(request);
    if (actor.isOwner) return 'owner';
    if (actor.role === 'family') return 'family';
    if (actor.role === 'investor') return 'investor';
    return 'staff';
  }
  if (has(request, 'x-business-token')) {
    const user = await businessActor(request);
    return user.kind === 'partner' ? 'partner' : 'organisation';
  }
  return request.session?.role === 'runner' ? 'runner' : 'shopper';
}

export async function registerOziRoutes(app: FastifyInstance): Promise<void> {
  const { config, env } = app.ctx;
  // Read at start-up, so a broken file stops the server rather than a conversation.
  const book = phraseBook(env.storeConfigPath);

  app.post('/ozi/reply', async (request) => {
    const { text, mode, turn } = body.parse(request.body ?? {});
    const account = await accountOf(request);
    return { reply: phraseReply(text, turn, mode, account, config, book) };
  });
}
