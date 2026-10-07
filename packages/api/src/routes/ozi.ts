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

import type { LearnedPhrase } from '../domain.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { bannedList, containsBanned, fitToKeep } from '../lib/banned.js';
import {
  normalise,
  PHRASE_ACCOUNTS,
  phraseBook,
  phraseFingerprints,
  phraseReply,
  withoutName,
  type Phrase,
  type PhraseAccount,
  type PhraseBook,
} from '../lib/phrases.js';
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

/** Adds an approved answer to the live phrase book: that account's Ozi, and the owner's. */
export function teach(book: PhraseBook, learned: LearnedPhrase): void {
  if (!learned.reply) return;
  const account = learned.account as PhraseAccount;
  if (!PHRASE_ACCOUNTS.includes(account)) return;
  const phrase: Phrase = {
    id: `learned-${learned.id}`,
    topic: 'learned',
    when: [normalise(learned.text)],
    replies: [learned.reply],
  };
  if (book.collections[account].some((known) => known.id === phrase.id)) return;
  book.collections[account].push(phrase);
  if (account !== 'owner') {
    book.collections.owner.push({ ...phrase, id: `${account}:${phrase.id}`, borrowed: true });
  }
}

export async function registerOziRoutes(app: FastifyInstance): Promise<void> {
  const { config, env, repository, now } = app.ctx;
  // Read at start-up, so a broken file stops the server rather than a conversation. Each app
  // has its own copy of the lists, so what is approved here is added here.
  const shared = phraseBook(env.storeConfigPath);
  const book: PhraseBook = {
    ownerAddress: shared.ownerAddress,
    collections: Object.fromEntries(
      PHRASE_ACCOUNTS.map((account) => [account, [...shared.collections[account]]]),
    ) as PhraseBook['collections'],
  };
  const banned = bannedList(env.storeConfigPath);
  // Answers people approved before this server started (ruling 49).
  for (const learned of await repository.learned.list('approved')) teach(book, learned);

  app.post('/ozi/reply', async (request) => {
    const { text, mode, turn } = body.parse(request.body ?? {});
    const account = await accountOf(request);
    const reply = phraseReply(text, turn, mode, account, config, book);
    if (reply || mode !== 'within') return { reply };
    // Said to Ozi, and not understood. Swearing is answered kindly and forgotten at once;
    // anything else fit to keep goes to the list for a person to approve an answer.
    if (containsBanned(text, banned)) {
      return { reply: "I'm here to help with your shopping. Let's keep it kind." };
    }
    const said = withoutName(text, {
      product: config.productName,
      assistant: config.assistantName,
      heardAs: config.assistantHeardAs,
    });
    if (fitToKeep(said, banned)) {
      void repository.learned
        .heard({ account, text: said, at: now() })
        .catch((failure: unknown) => {
          request.log.warn({ err: failure }, 'Could not keep an unanswered question.');
        });
    }
    return { reply: null };
  });

  /** Fingerprints of the whole phrases this account's Ozi knows, so the app can skip a wait. */
  app.get('/ozi/known', async (request, reply) => {
    const account = await accountOf(request);
    void reply.header('cache-control', 'private, max-age=600');
    return { fingerprints: phraseFingerprints(account, book) };
  });

  /* ------------------------------------------------------------- learning (ruling 49) */

  app.get('/staff/learning', async (request) => {
    await staffActor(request, 'learning');
    const waiting = await repository.learned.list('waiting');
    return {
      waiting: waiting.map((row) => ({
        id: row.id,
        account: row.account,
        text: row.text,
        timesHeard: row.timesHeard,
        lastHeardAt: row.lastHeardAt,
      })),
    };
  });

  app.post('/staff/learning/:id', async (request) => {
    const actor = await staffActor(request, 'learning');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = z
      .object({
        approve: z.boolean(),
        reply: z
          .string()
          .trim()
          .min(2, 'Please write the answer Ozi should give.')
          .max(400, 'Please keep the answer under 400 characters.')
          .optional(),
      })
      .parse(request.body ?? {});
    const row = await repository.learned.findById(id);
    if (!row) throw new NotFoundError('question');
    if (input.approve && !input.reply) {
      throw new BadRequestError('Please write the answer Ozi should give.');
    }
    if (input.reply && containsBanned(input.reply, banned)) {
      throw new BadRequestError('That answer has a word Ozi will not say.');
    }
    const decided = await repository.learned.decide(id, {
      status: input.approve ? 'approved' : 'rejected',
      reply: input.approve ? (input.reply ?? null) : null,
      decidedBy: actor.name,
      decidedAt: now(),
    });
    if (input.approve) teach(book, decided);
    return {
      message: input.approve
        ? `Approved. Ozi now answers "${decided.text}".`
        : 'Turned down. Ozi will not learn that one.',
    };
  });
}
