/**
 * Ozi's everyday replies (ruling 44): the app says what was heard, the server answers from the
 * collection for whoever is signed in. The collections themselves are never sent anywhere.
 *
 * The account is decided by the credentials, never by anything in the request body, so a
 * Shopper cannot ask for the owner's collection: the owner's own session (signed in with his
 * passcode), a family member or investor, other staff, a partner shop or an organisation, a
 * Runner, and otherwise a Shopper, signed in or not.
 */

import { PassThrough } from 'node:stream';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  knownSpeakerReply,
  PARTNER_KIND_WORDS,
  SHOPPER_ACCOUNT_FOR_ORDERS,
  type KnownSpeaker,
} from '@aldilivery/core';
import { z } from 'zod';

import type { LearnedPhrase, PartnerShop } from '../domain.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { bannedList, containsBanned, fitToKeep } from '../lib/banned.js';
import { itemWords, type Speaker, type Understanding } from '../lib/language-model.js';
import { feltDelaysOf, summarise } from '../lib/ozi-latency.js';
import {
  carryOutDecision,
  isClearYes,
  modelTurnsOf,
  ownerTools,
  PendingDecisions,
  recentTurns,
  SIMPLER_TODAY,
  whoIsSpeaking,
} from '../lib/ozi-conversation.js';
import {
  BRAINS,
  CHANNELS,
  conversationKey,
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
import { rankedForListing } from '../lib/partner-standing.js';
import { unsaidPart } from '../lib/sentences.js';
import { staffActor } from '../lib/staff.js';

/** One short line of what is on the screen: cut, never refused, so a long page still arrives. */
const screenLine = (most: number) =>
  z
    .string()
    .transform((text) => text.replace(/\s+/g, ' ').trim().slice(0, most))
    .pipe(z.string());
const screenLines = (each: number, most: number) =>
  z
    .array(z.string())
    .max(200)
    .transform((lines) =>
      lines
        .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, each))
        .filter((line) => line !== '')
        .slice(0, most),
    )
    .optional();

/**
 * What is on the person's screen (ruling 89): bounded here, blanked again by `screenWords`
 * before the model sees it, and never kept in Ozi's memory. The app never sends a form field's
 * value; the server would blank anything like a number, a code or an email address anyway.
 */
const screenShape = z
  .object({
    path: screenLine(200).pipe(z.string().min(1)),
    title: screenLine(120).optional(),
    headings: screenLines(120, 6),
    status: screenLines(200, 4),
    section: screenLine(80).optional(),
    lines: screenLines(120, 12),
  })
  .strip();

const body = z.object({
  text: z.string().trim().min(1).max(300),
  mode: z.enum(['exact', 'within']),
  turn: z.number().int().min(0).max(1_000_000).default(0),
  /** The app's own id for this visit, so a conversation's turns read together (ruling 68). */
  conversation: z.string().trim().min(1).max(80).optional(),
  /** What is in the basket, in words, so the model understands "take off the milk" (ruling 69). */
  basket: z.array(z.string().trim().max(80)).max(40).optional(),
  /** What is on their screen now (ruling 89). A malformed one is simply left out. */
  screen: screenShape.optional().catch(undefined),
  /** Sentences as they come (ruling 92), as `Accept: text/event-stream` also asks. */
  stream: z.boolean().optional(),
});
type ReplyBody = z.infer<typeof body>;

/** The delay the person felt (ruling 92), from finishing speaking to the first word heard. */
const feltBody = z.object({
  conversation: z.string().trim().min(1).max(80),
  turn: z.number().int().min(0).max(1_000_000).default(0),
  feltMs: z.number().int().min(0).max(600_000),
});

/** What one turn gives back: the same JSON whether it was streamed or not. */
interface Answer {
  reply: string | null;
  understood?: Understanding;
  awaitingYes?: boolean;
}

/** How long the turn is taking (ruling 92), for Ozi's memory. */
interface Timing {
  started: number;
  modelMs: number | null;
  firstWordAt: number | null;
}

/** Where a streamed turn sends its sentences and its one status line; silent otherwise. */
interface Sink {
  sentence(text: string): void;
  status(text: string): void;
}
const SILENT: Sink = { sentence: () => undefined, status: () => undefined };

/** Whether the app asked for the reply a sentence at a time (ruling 92). */
function wantsStream(request: FastifyRequest, input: ReplyBody): boolean {
  const accept = request.headers.accept;
  const header = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
  return input.stream === true || /text\/event-stream/i.test(header);
}

const DAY_MS = 24 * 60 * 60_000;

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
    /** Who was speaking, the exact model when it answered, and how long it took (ruling 92). */
    extra: { speaker?: Speaker; model?: string | null; timing?: Timing } = {},
  ): void {
    const timing = extra.timing;
    const at = Date.now();
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
        accountKind: extra.speaker?.kind ?? null,
        model: extra.model ?? null,
        modelMs: timing?.modelMs ?? null,
        // The first spoken sentence left the server when it was streamed, else with the reply.
        firstWordMs: timing && said ? (timing.firstWordAt ?? at) - timing.started : null,
        totalMs: timing ? at - timing.started : null,
      },
      request.log,
      banned,
    );
  }

  // The day's model turns for each account, and the owner's one decision waiting for his yes
  // (31 October 2026), kept by this server.
  const modelTurns = modelTurnsOf(app.ctx);
  const toldSimpler = new Set<string>();
  const pendingDecisions = new PendingDecisions();

  const names = {
    product: config.productName,
    assistant: config.assistantName,
    heardAs: config.assistantHeardAs,
  };

  /** The shops whose pages are public right now (ruling 65). */
  /** Listed shops, Ozi Preferred Partners first (Anthony, 30 October 2026), then the rest. */
  async function listedShops(): Promise<PartnerShop[]> {
    return rankedForListing(
      (await repository.partnerShops.list()).filter(
        (shop) => shop.active && shop.status === 'approved',
      ),
      now(),
      config,
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
        `${PARTNER_KIND_WORDS[shop.kind]} ${shop.name} ${shop.about} ${[...shop.cuisines, ...shop.specialities, ...shop.categories].join(' ')} ${products
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

  /**
   * One turn (ruling 92): the same answer whether streamed or not. With a streaming sink, each
   * sentence of a model's reply is sent as soon as it is complete, and the owner is told once
   * when his model looks something up; the final JSON is the same as the plain route's.
   */
  async function answerOnce(
    request: FastifyRequest,
    input: ReplyBody,
    identity: Awaited<ReturnType<typeof whoIsSpeaking>>,
    timing: Timing,
    sink: Sink,
  ): Promise<Answer> {
    const { text, mode, turn, conversation } = input;
    const { account, speaker, allowanceKey } = identity;
    const kept = (said: string | null, brain: Brain, outcome: Outcome, model?: string | null) =>
      keep(request, account, conversation, turn, text, said, brain, outcome, {
        speaker,
        model,
        timing,
      });
    /** A streamed sentence, unless it has a word Ozi will not say. */
    const sentence = (words: string): void => {
      if (words.trim() === '' || containsBanned(words, banned)) return;
      sink.sentence(words);
    };

    // Rule One for the owner's desk by voice (31 October 2026): a decision read back last turn is
    // carried out only on a clear yes now, and forgotten on anything else.
    if (account === 'owner' && mode === 'within' && conversation) {
      const pending = pendingDecisions.take(conversation, Date.now());
      if (pending) {
        if (isClearYes(text)) {
          const outcome = await carryOutDecision(app.ctx, pending, request.log, {
            // The owner's own account, from his sign-in (ruling 85): the audit log's actor.
            actorId: request.staffActor?.id ?? null,
            ip: request.ip ?? '',
          });
          kept(outcome.words, 'flow', 'answered');
          return { reply: outcome.words };
        }
        if (/^\s*(no|nope|no thanks?|no thank you|don'?t|leave it|not now|cancel)\b/i.test(text)) {
          const words = "All right, I haven't done it.";
          kept(words, 'flow', 'stopped');
          return { reply: words };
        }
        // Anything else: nothing is done, and what he said is answered as itself.
      }
    }

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
          kept(reply, 'shops', 'answered');
          return { reply };
        }
      }
    }
    // The owner and staff are known (ruling 84, 31 October 2026): with the model on, everything
    // they say, "hello" and "good morning" included, goes to the conversation, never to a phrase
    // book first, so the owner is never greeted as a Shopper. Without it, the owner's greeting,
    // "do you know my name" and "this is the owner" are answered personally, from configuration;
    // staff, family and investors have their own books, never the Shopper's.
    const brain = app.ctx.brain;
    const knownWho: KnownSpeaker | null =
      account === 'owner'
        ? { kind: 'owner', firstName: null }
        : account === 'staff' || account === 'family' || account === 'investor'
          ? { kind: 'staff', firstName: speaker.firstName }
          : null;
    const personal = (): { reply: string } | null => {
      if (knownWho?.kind !== 'owner') return null;
      const words = knownSpeakerReply(
        text,
        knownWho,
        { ...names, spokenName: config.owner.spokenName },
        now(),
      );
      if (!words) return null;
      kept(words, 'flow', 'answered');
      return { reply: words };
    };
    const toTheModel = knownWho !== null && brain !== null && brain !== undefined;
    if (!toTheModel) {
      const known = personal();
      if (known) return known;
      // The phrase book first, but only for a clear, known phrase: the whole sentence (31
      // October 2026). Questions, chat, worries and anything open go to the model below.
      const exact = phraseReply(text, turn, 'exact', account, config, book, live);
      if (exact) {
        kept(exact, 'phrases', 'answered');
        return { reply: exact };
      }
      // An exact look-up that found nothing is the app checking before it shops: not a turn.
      if (mode !== 'within') return { reply: null };
    }
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
    const keepForLearning = (): void => {
      if (!fitToKeep(said, banned)) return;
      void repository.learned
        .heard({ account, text: said, at: now() })
        .catch((failure: unknown) => {
          request.log.warn({ err: failure }, 'Could not keep an unanswered question.');
        });
    };
    /** The phrase book's looser match, when the model is away, slow or used up for today. */
    const looser = (lead = ''): { reply: string | null } | null => {
      const reply = phraseReply(text, turn, 'within', account, config, book, live);
      if (!reply && !lead) return null;
      const words = `${lead}${reply ?? ''}`.trim();
      kept(words, reply ? 'phrases' : 'flow', 'answered');
      return { reply: words };
    };

    const owner = account === 'owner';
    // The cost guard (31 October 2026): at most `ozi.maxModelTurnsPerDay` model turns a day for
    // each account; the owner has no limit. Past it, Ozi says so once and carries on without.
    if (brain && !modelTurns.take(allowanceKey, config.ozi.maxModelTurnsPerDay, now(), owner)) {
      const day = now().toISOString().slice(0, 10);
      const first = !toldSimpler.has(`${day}:${allowanceKey}`);
      if (first) toldSimpler.add(`${day}:${allowanceKey}`);
      const known = personal();
      if (known) return known;
      const answered = looser(first ? `${SIMPLER_TODAY} ` : '');
      if (answered) return answered;
      kept(null, 'none', 'unanswered');
      keepForLearning();
      return { reply: null };
    }

    const history = brain && conversation ? await recentTurns(app.ctx, conversation) : [];

    // The owner on the newest Opus (ruling 86), with his desk tools (31 October 2026). It may
    // read; a decision is only read back here, and waits for his yes in his next turn.
    if (owner && brain?.talkWithOwner) {
      const asked = Date.now();
      const talk = await brain.talkWithOwner({
        text,
        channel: 'app',
        history,
        tools: ownerTools(app.ctx),
        ...(input.screen ? { screen: input.screen } : {}),
        onSentence: sentence,
        onStatus: (words) => sink.status(words),
      });
      timing.modelMs = Date.now() - asked;
      if (talk && !containsBanned(talk.reply, banned)) {
        if (talk.proposal && conversation) {
          pendingDecisions.set(conversation, { ...talk.proposal, at: Date.now() });
        }
        kept(talk.reply, 'model', 'answered', brain.ownerModel ?? brain.model);
        return talk.proposal && conversation
          ? { reply: talk.reply, awaitingYes: true }
          : { reply: talk.reply };
      }
    } else if (brain) {
      // Everybody else (ruling 69, now a conversation): it either hears shopping in the words,
      // which the app shops for as it would any list, or answers, knowing who is speaking and
      // what was said before. Its answers still go to the Learning list. Too slow, and it is as
      // if absent.
      const asked = Date.now();
      const understood = await brain.understand({
        text,
        account,
        channel: 'app',
        who: speaker,
        history,
        ...(input.basket ? { basket: input.basket } : {}),
        ...(input.screen ? { screen: input.screen } : {}),
        onSentence: sentence,
      });
      timing.modelMs = Date.now() - asked;
      if (understood && (understood.kind === 'items' || understood.kind === 'remove')) {
        // Staff are not Shoppers (ruling 84): orders stay safe behind a Shopper account, said
        // kindly, never with an offer to open one.
        if (knownWho && understood.items.length > 0) {
          kept(SHOPPER_ACCOUNT_FOR_ORDERS, 'flow', 'refused');
          return { reply: SHOPPER_ACCOUNT_FOR_ORDERS };
        }
        if (understood.items.length > 0) {
          kept(
            `[${understood.kind}: ${understood.items.map(itemWords).join(', ')}]`,
            'model',
            'answered',
            brain.model,
          );
          return { reply: null, understood };
        }
      } else if (understood?.reply && !containsBanned(understood.reply, banned)) {
        kept(understood.reply, 'model', 'answered', brain.model);
        keepForLearning();
        return { reply: understood.reply, understood };
      }
    }
    // The model slow, away or silent: the owner and staff are still known (ruling 84).
    const known = personal();
    if (known) return known;
    const fallback = looser();
    if (fallback) return fallback;
    kept(null, 'none', 'unanswered');
    keepForLearning();
    return { reply: null };
  }

  app.post('/ozi/reply', async (request, reply) => {
    const input = body.parse(request.body ?? {});
    const timing: Timing = { started: Date.now(), modelMs: null, firstWordAt: null };
    // Who is speaking comes from the sign-in alone, never from the request's words (31 October
    // 2026): the owner, staff, a partner, an organisation, a Runner, a Shopper or a visitor.
    const identity = await whoIsSpeaking(request);
    if (!wantsStream(request, input)) return answerOnce(request, input, identity, timing, SILENT);

    // Streamed (ruling 92): server-sent events, {type:"sentence"} as each completes, at most
    // one {type:"status"}, then {type:"done"} with the same JSON the plain route gives, plus
    // "unsaid": the part of the reply not yet sent as sentences, for the app to say.
    const out = new PassThrough();
    const send = (event: Record<string, unknown>): void => {
      out.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const sent: string[] = [];
    const sink: Sink = {
      sentence(text) {
        if (timing.firstWordAt === null) timing.firstWordAt = Date.now();
        sent.push(text);
        send({ type: 'sentence', text });
      },
      status(text) {
        send({ type: 'status', text });
      },
    };
    void (async () => {
      try {
        const answer = await answerOnce(request, input, identity, timing, sink);
        const unsaid = answer.reply ? unsaidPart(answer.reply, sent) : '';
        send({ type: 'done', ...answer, unsaid });
      } catch (failure) {
        request.log.error({ err: failure }, "A streamed turn of Ozi's conversation failed.");
        send({ type: 'error' });
      } finally {
        out.end();
      }
    })();
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache, no-transform')
      .header('x-accel-buffering', 'no')
      .send(out);
  });

  /**
   * The delay the person felt (ruling 92), measured on their phone from finishing speaking to the
   * first word heard, sent after the turn and written on that exchange. Fire and forget for the
   * app; it never changes what Ozi says.
   */
  app.post('/ozi/felt', async (request) => {
    const input = feltBody.parse(request.body ?? {});
    await whoIsSpeaking(request);
    const key = conversationKey(env.authTokenSecret, input.conversation);
    try {
      await repository.memory.recordFelt(key, input.turn, input.feltMs);
    } catch (failure) {
      request.log.warn({ err: failure }, 'A felt delay could not be kept.');
    }
    feltDelaysOf(app.ctx).record(input.feltMs, now());
    return { ok: true };
  });

  /**
   * What the app said on its own (ruling 68): small talk answered in the app, shopping added,
   * a question asked, an order sent. The app is trusted only for the words; whose Ozi it was
   * comes from the credentials.
   */
  app.post('/ozi/heard', async (request) => {
    const input = heardBody.parse(request.body ?? {});
    const { account, speaker } = await whoIsSpeaking(request);
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
        accountKind: speaker.kind,
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
        // Ozi's own suggestion from its weekly review (31 October 2026), for a person to judge.
        suggestedReply: row.suggestedReply ?? null,
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
    const [rows, counts, felt] = await Promise.all([
      repository.memory.list({ ...where, limit: 200 }),
      repository.memory.counts(),
      repository.memory.feltSince(new Date(now().getTime() - DAY_MS)),
    ]);
    return {
      counts,
      // How long people waited in the last day (ruling 92): the felt delay, for everyone and
      // for the owner, each the median and the 90th percentile, or null when none was reported.
      latency: {
        everyone: summarise(felt.map((row) => row.feltMs)),
        owner: summarise(
          felt.filter((row) => row.accountKind === 'owner').map((row) => row.feltMs),
        ),
      },
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
        model: row.model ?? null,
        accountKind: row.accountKind ?? null,
        modelMs: row.modelMs ?? null,
        firstWordMs: row.firstWordMs ?? null,
        totalMs: row.totalMs ?? null,
        feltMs: row.feltMs ?? null,
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
