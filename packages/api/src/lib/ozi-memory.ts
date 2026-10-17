/**
 * Ozi's memory (Anthony, 17 October 2026, ruling 68): "everything it hears and everything it
 * says to what it hears", kept so a person can mark each answer right or wrong, teach a better
 * one, and so the company's own language model (Okugard Brain), or any other model plugged in
 * later, can learn from real conversations rather than from phrases written cold.
 *
 * What is kept: the words heard, the words said back, which part of Ozi answered, how it went,
 * which channel, and whose Ozi. What is never kept: anything with a banned word (ruling 49), a
 * telephone number, a card number, a code, an email address or a postcode, which are blanked
 * before the row is written; and who said it, beyond a one-way code for the conversation made
 * with a server secret, so a call's turns can be read together but the number cannot be found.
 *
 * Remembering can never fail a conversation: a row that cannot be written is logged and lost.
 */

import { createHmac } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { OziExchange } from '../domain.js';
import { bannedList, containsBanned, type BannedList } from './banned.js';

export const BRAINS = [
  'phrases',
  'learned',
  'small-talk',
  'shops',
  'shopping',
  'flow',
  'none',
] as const;
export type Brain = (typeof BRAINS)[number];

export const OUTCOMES = [
  'answered',
  'unanswered',
  'added',
  'not-found',
  'asked',
  'sent',
  'stopped',
  'refused',
  'ended',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CHANNELS = ['app', 'phone', 'text'] as const;

/** The most of each that is kept; speech recognisers can run on, and so can a read-back. */
const HEARD_MAX = 300;
const SAID_MAX = 600;

/** A one-way code for a conversation, the same every turn, that cannot be turned back. */
export function conversationKey(secret: string, raw: string): string {
  return createHmac('sha256', `ozi-memory:${secret}`).update(raw).digest('base64url').slice(0, 16);
}

/**
 * Takes out what must never be written: email addresses, postcodes, card numbers, codes and
 * telephone numbers (any run of three or more digits, with or without spaces between them),
 * each replaced by a word in square brackets so the sentence still reads.
 */
export function scrub(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/gi, '[email]')
    .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi, '[postcode]')
    .replace(/\b\d(?:[ -]?\d){11,18}\b/g, '[card]')
    .replace(/\b\d(?:[ -]?\d){2,}\b/g, '[number]')
    .replace(
      /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)[ -]){5,}(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b/gi,
      '[number]',
    );
}

export interface Heard {
  channel: OziExchange['channel'];
  account: string;
  /** What identifies the conversation: a call's id, the app's own id for a visit, a number. */
  conversation: string;
  turn: number;
  heard: string;
  said: string;
  brain: Brain;
  outcome: Outcome;
}

/** Writes one exchange, scrubbed, unless it holds a banned word. Never throws. */
export async function remember(
  ctx: Pick<AppContext, 'repository' | 'env' | 'now'>,
  input: Heard,
  log?: FastifyBaseLogger,
  banned: BannedList = bannedList(ctx.env.storeConfigPath),
): Promise<OziExchange | null> {
  try {
    const heard = scrub(input.heard).slice(0, HEARD_MAX);
    const said = scrub(input.said).slice(0, SAID_MAX);
    if (said === '' && heard === '') return null;
    // Swearing is answered kindly and forgotten at once (ruling 49), here as on the Learning list.
    if (containsBanned(heard, banned) || containsBanned(said, banned)) return null;
    return await ctx.repository.memory.remember({
      at: ctx.now(),
      channel: input.channel,
      account: input.account,
      conversationKey: conversationKey(ctx.env.authTokenSecret, input.conversation),
      turn: Math.max(0, Math.floor(input.turn)),
      heard,
      said,
      brain: input.brain,
      outcome: input.outcome,
      verdict: 'unrated',
      betterReply: null,
      ratedBy: null,
      ratedAt: null,
    });
  } catch (failure) {
    log?.warn({ err: failure }, "An exchange could not be kept in Ozi's memory.");
    return null;
  }
}

/** The words Ozi spoke in a piece of TwiML, for the telephone line's memory. */
export function spokenIn(twiml: string): string {
  return [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)]
    .map((match) => match[1] ?? '')
    .join(' ')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * One line of a training file, the shape most language models are taught from: what was said
 * to the assistant, what the assistant should have said (a person's better answer when there
 * is one), and enough about the moment to filter on. Nothing about who.
 */
export function trainingLine(row: OziExchange): string {
  return JSON.stringify({
    prompt: row.heard,
    completion: row.verdict === 'wrong' && row.betterReply ? row.betterReply : row.said,
    said: row.said,
    verdict: row.verdict,
    brain: row.brain,
    outcome: row.outcome,
    channel: row.channel,
    account: row.account,
    conversation: row.conversationKey,
    turn: row.turn,
    at: row.at.toISOString(),
  });
}
