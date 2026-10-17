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
import { PARTNER_KIND_WORDS } from '@aldilivery/core';
import { z } from 'zod';

import type { LearnedPhrase, PartnerShop } from '../domain.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { bannedList, containsBanned, fitToKeep } from '../lib/banned.js';
import {
  BRAINS,
  CHANNELS,
  OUTCOMES,
  remember,
  trainingLine,
  type Brain,
  type Outcome,
} from '../lib/ozi-memory.js';
import {
  fillIn,
  normalise,
  PHRASE_ACCOUNTS,
  phraseBook,
  phraseFingerprints,
  phraseReply,
  withoutName,
  type LiveBlanks,
  type Phrase,
  type PhraseAccount,
  type PhraseBook,
} from '../lib/phrases.js';
import { staffActor } from '../lib/staff.js';

const body = z.object({
  text: z.string().trim().min(1).max(300),
  mode: z.enum(['exact', 'within']),
  turn: z.number().int().min(0).max(1_000_000).default(0),
  /** The app's own id for this visit, so a conversation's turns read together (ruling 68). */
  conversation: z.string().trim().min(1).max(80).optional(),
});

/** What the app said back on its own, for Ozi's memory (ruling 68). */
const heardBody = z.object({
  heard: z.string().trim().max(300).default(''),
  said: z.string().trim().min(1).max(600),
  brain: z.enum(BRAINS),
  outcome: z.enum(OUTCOMES),
  conversation: z.string().trim().min(1).max(80),
  turn: z.number().int().min(0).max(1_000_000).default(0),
});

/**
 * The live phrase book of each server, so the telephone line answers from the same book as the
 * app, learned answers included.
 */
const BOOKS = new WeakMap<FastifyInstance, PhraseBook>();
export function liveBook(app: FastifyInstance): PhraseBook {
  return BOOKS.get(app) ?? phraseBook(app.ctx.env.storeConfigPath);
}

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
  BOOKS.set(app, book);
  // Answers people approved before this server started (ruling 49).
  for (const learned of await repository.learned.list('approved')) teach(book, learned);

  /** One line in Ozi's memory (ruling 68), never in the way of the answer. */
  function keep(
    request: FastifyRequest,
    account: PhraseAccount,
    conversation: string | undefined,
    turn: number,
    heard: string,
    said: string | null,
    brain: Brain,
    outcome: Outcome,
  ): void {
    void remember(
      app.ctx,
      {
        channel: 'app',
        account,
        conversation: conversation ?? `app:${account}`,
        turn,
        heard,
        said: said ?? '',
        brain,
        outcome,
      },
      request.log,
      banned,
    );
  }

  const names = {
    product: config.productName,
    assistant: config.assistantName,
    heardAs: config.assistantHeardAs,
  };

  /** The shops whose pages are public right now (ruling 65). */
  async function listedShops(): Promise<PartnerShop[]> {
    return (await repository.partnerShops.list()).filter(
      (shop) => shop.active && shop.status === 'approved',
    );
  }

  /** "The Corner Shop, Tony's Barbers and 3 more." Names come from what is listed, never code. */
  function namesWords(shops: PartnerShop[]): string {
    const named = shops.slice(0, 6).map((shop) => shop.name);
    const rest = shops.length - named.length;
    const list =
      named.length === 1
        ? named[0]!
        : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]!}`;
    return `${list}${rest > 0 ? ` and ${rest} more` : ''}`;
  }

  function shopsWords(shops: PartnerShop[]): string {
    if (shops.length === 0) return `No shops have their own page on ${config.productName} yet.`;
    return `${shops.length} ${shops.length === 1 ? 'shop is' : 'shops are'} on ${config.productName}: ${namesWords(shops)}. The Local shops page has them all.`;
  }

  /** "is there a barber on Ozi", "are there any cafés here": the kind of shop asked for, or null. */
  function askedForKind(said: string): string | null {
    const match =
      /^(?:is|are) there (?:a|an|any|some) (.+?)(?: (?:on|in|with|at|near|around)(?: .*)?| here| near me| nearby)?$/.exec(
        said,
      ) ??
      /^(?:do you have|have you got) (?:a|an|any|some) (.+?)(?: (?:on|in|with|here|near)(?: .*)?)?$/.exec(
        said,
      );
    const kind = match?.[1]?.trim() ?? '';
    if (kind === '' || kind.split(' ').length > 3) return null;
    // "shops" is the whole list, not a kind.
    if (/^(shops?|local shops?|businesses)$/.test(kind)) return null;
    return kind;
  }

  function singular(word: string): string {
    return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
  }

  /** The listed shops of a kind, found in the shop's kind, name, words about itself or products. */
  async function shopsOfKind(kind: string): Promise<PartnerShop[]> {
    const words = normalise(kind).split(' ').map(singular).filter(Boolean);
    const found: PartnerShop[] = [];
    for (const shop of await listedShops()) {
      const products = (await repository.partnerProducts.listForShop(shop.id)).filter(
        (product) => product.status === 'approved',
      );
      const text = normalise(
        `${PARTNER_KIND_WORDS[shop.kind]} ${shop.name} ${shop.about} ${products
          .map((product) => `${product.name} ${product.tags}`)
          .join(' ')}`,
      );
      const haystack = ` ${text.split(' ').map(singular).join(' ')} `;
      if (words.every((word) => haystack.includes(` ${word} `))) found.push(shop);
    }
    return found;
  }

  /** The Shopper's reply from one phrase by id, filled from the moment. */
  function replyFrom(id: string, turn: number, live: LiveBlanks): string | null {
    const phrase = book.collections.shopper.find((known) => known.id === id);
    if (!phrase) return null;
    return fillIn(phrase.replies[turn % phrase.replies.length]!, config, book.ownerAddress, live);
  }

  app.post('/ozi/reply', async (request) => {
    const { text, mode, turn, conversation } = body.parse(request.body ?? {});
    const account = await accountOf(request);
    // Which shops are on here, and whether there is a barber (ruling 65): answered from what is
    // listed right now, in the words of the phrases file, never with a shop's name in code.
    const live: LiveBlanks = {};
    const asked = normalise(withoutName(text, names));
    if (account === 'shopper' || account === 'owner') {
      if (/\bshops?\b|\bbusinesses\b/.test(asked))
        live.shopsOnOzi = shopsWords(await listedShops());
      const kind = askedForKind(asked);
      if (kind) {
        const found = await shopsOfKind(kind);
        const reply = replyFrom(
          found.length > 0 ? 'shopper-shop-kind-found' : 'shopper-shop-kind-none',
          turn,
          {
            shopKind: kind,
            shopsForKind: found.length > 0 ? namesWords(found) : 'the Local shops page',
          },
        );
        if (reply) {
          keep(request, account, conversation, turn, text, reply, 'shops', 'answered');
          return { reply };
        }
      }
    }
    const reply = phraseReply(text, turn, mode, account, config, book, live);
    if (reply) {
      keep(request, account, conversation, turn, text, reply, 'phrases', 'answered');
      return { reply };
    }
    // An exact look-up that found nothing is the app checking before it shops: not a turn.
    if (mode !== 'within') return { reply };
    // Said to Ozi, and not understood. Swearing is answered kindly and forgotten at once;
    // anything else fit to keep goes to the list for a person to approve an answer.
    if (containsBanned(text, banned)) {
      return { reply: "I'm here to help with your shopping. Let's keep it kind." };
    }
    keep(request, account, conversation, turn, text, null, 'none', 'unanswered');
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

  /**
   * What the app said on its own (ruling 68): small talk answered in the app, shopping added,
   * a question asked, an order sent. The app is trusted only for the words; whose Ozi it was
   * comes from the credentials.
   */
  app.post('/ozi/heard', async (request) => {
    const input = heardBody.parse(request.body ?? {});
    const account = await accountOf(request);
    await remember(
      app.ctx,
      {
        channel: 'app',
        account,
        conversation: input.conversation,
        turn: input.turn,
        heard: input.heard,
        said: input.said,
        brain: input.brain,
        outcome: input.outcome,
      },
      request.log,
      banned,
    );
    return { ok: true };
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

  /* ------------------------------------------------------------- Ozi's memory (ruling 68) */

  const memoryQuery = z.object({
    verdict: z.enum(['unrated', 'right', 'wrong']).optional(),
    channel: z.enum(CHANNELS).optional(),
  });

  /** The latest exchanges, newest first, for a person to judge; the same people as Learning. */
  app.get('/staff/memory', async (request) => {
    await staffActor(request, 'learning');
    const where = memoryQuery.parse(request.query ?? {});
    const [rows, counts] = await Promise.all([
      repository.memory.list({ ...where, limit: 200 }),
      repository.memory.counts(),
    ]);
    return {
      counts,
      exchanges: rows.map((row) => ({
        id: row.id,
        at: row.at,
        channel: row.channel,
        account: row.account,
        conversation: row.conversationKey,
        turn: row.turn,
        heard: row.heard,
        said: row.said,
        brain: row.brain,
        outcome: row.outcome,
        verdict: row.verdict,
        betterReply: row.betterReply,
        ratedBy: row.ratedBy,
      })),
    };
  });

  /**
   * A verdict on one exchange. "Wrong" with a better answer also teaches Ozi: the better answer
   * goes straight into this account's book (and the owner's), as an approved learned phrase,
   * so the next person who says the same thing hears it.
   */
  app.post('/staff/memory/:id', async (request) => {
    const actor = await staffActor(request, 'learning');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = z
      .object({
        verdict: z.enum(['right', 'wrong']),
        betterReply: z
          .string()
          .trim()
          .min(2, 'Please write what Ozi should have said.')
          .max(400, 'Please keep the answer under 400 characters.')
          .optional(),
      })
      .parse(request.body ?? {});
    const row = await repository.memory.findById(id);
    if (!row) throw new NotFoundError('exchange');
    if (input.betterReply && containsBanned(input.betterReply, banned)) {
      throw new BadRequestError('That answer has a word Ozi will not say.');
    }
    const better = input.verdict === 'wrong' ? (input.betterReply ?? null) : null;
    await repository.memory.judge(id, {
      verdict: input.verdict,
      betterReply: better,
      ratedBy: actor.name,
      ratedAt: now(),
    });
    let taught = false;
    const account = row.account as PhraseAccount;
    const said = normalise(withoutName(row.heard, names));
    if (better && PHRASE_ACCOUNTS.includes(account) && fitToKeep(said, banned)) {
      await repository.learned.heard({ account, text: said, at: now() });
      const waiting = await repository.learned.findByText(account, said);
      if (waiting) {
        const decided = await repository.learned.decide(waiting.id, {
          status: 'approved',
          reply: better,
          decidedBy: actor.name,
          decidedAt: now(),
        });
        teach(book, decided);
        taught = true;
      }
    }
    return {
      message:
        input.verdict === 'right'
          ? 'Marked right. Thank you.'
          : taught
            ? `Marked wrong. ${config.assistantName} now answers "${said}" with your words.`
            : better
              ? 'Marked wrong, and your answer is kept for training. That sentence cannot be taught as a phrase.'
              : 'Marked wrong.',
    };
  });

  /**
   * The training export, the owner's alone: one line per exchange in the shape language models
   * are taught from, oldest first, for Okugard Brain or any model plugged in later.
   */
  app.get('/staff/memory/export', async (request) => {
    const actor = await staffActor(request, 'learning');
    if (!actor.isOwner) throw new ForbiddenError("Only the owner can export Ozi's memory.");
    const { since } = z
      .object({ since: z.string().datetime().optional() })
      .parse(request.query ?? {});
    const rows = await repository.memory.listSince(since ? new Date(since) : new Date(0), 20_000);
    return { count: rows.length, lines: rows.map(trainingLine) };
  });
}
