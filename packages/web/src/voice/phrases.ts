import rawPhrases from '@ozi-phrases';

import { storeConfig } from '../config';
import { money } from '../lib/money';
import { NAME_PATTERN } from './name';

/**
 * Ozi's everyday phrases (ruling 34, Anthony, 6 October 2026): what Ozi says to "thank you",
 * "who are you", "how much is delivery" and hundreds more, read from `config/ozi-phrases.json`.
 * A scheduled task adds to that file every day; nothing here needs changing when it grows, and
 * nothing costs anything per conversation. No AI model is involved.
 *
 * Only used when nothing about an order or the basket was meant, and only when the whole
 * sentence is one of the phrases, or Ozi was called by name. So a television saying "thank you"
 * mid-sentence is not answered.
 */

export interface Phrase {
  id: string;
  topic: string;
  when: string[];
  replies: string[];
}

/** Lower case, no punctuation, single spaces: how phrases are compared. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Checks the file, throwing a sentence that says exactly which entry is wrong. */
export function parsePhrases(raw: unknown): Phrase[] {
  const list = (raw as { phrases?: unknown })?.phrases;
  if (!Array.isArray(list)) throw new Error('ozi-phrases.json must have a "phrases" list.');
  const ids = new Set<string>();
  return list.map((entry, index) => {
    const e = entry as Partial<Phrase>;
    const where = `ozi-phrases.json entry ${index + 1}${e.id ? ` (${e.id})` : ''}`;
    if (typeof e.id !== 'string' || e.id === '') throw new Error(`${where} needs an id.`);
    if (ids.has(e.id)) throw new Error(`${where}: the id is used twice.`);
    ids.add(e.id);
    if (typeof e.topic !== 'string') throw new Error(`${where} needs a topic.`);
    if (
      !Array.isArray(e.when) ||
      e.when.length === 0 ||
      e.when.some((w) => typeof w !== 'string' || normalise(w) === '')
    ) {
      throw new Error(`${where} needs at least one phrase in "when".`);
    }
    if (
      !Array.isArray(e.replies) ||
      e.replies.length === 0 ||
      e.replies.some((r) => typeof r !== 'string' || r.trim() === '' || r.length > 400)
    ) {
      throw new Error(`${where} needs replies, each under 400 characters.`);
    }
    return { id: e.id, topic: e.topic, when: e.when.map(normalise), replies: e.replies };
  });
}

/** The figures and names a reply may mention, always from the store's own settings. */
export function fillIn(reply: string): string {
  const fees = storeConfig.fees;
  const values: Record<string, string> = {
    assistant: storeConfig.assistantName,
    product: storeConfig.productName,
    motto: storeConfig.motto,
    fee: money(fees.standardDeliveryPence),
    maximum: money(fees.maximumGoodsPence),
    runnerPay: money(fees.runnerPaymentPence),
    callPrice: `${storeConfig.calls.pencePerMinute}p`,
    instantRefund: money(storeConfig.problems.instantRefundUpToPence),
  };
  return reply.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export const PHRASES: Phrase[] = parsePhrases(rawPhrases);

/**
 * A reply, if the words are an everyday phrase. `exact`: the whole sentence, apart from Ozi's
 * name, is one of them; checked before an order is looked for, so "Ozi, thank you" is never
 * ordered as an item. `within`: one of them is somewhere in a sentence said to Ozi by name;
 * checked only after it turned out not to be an order. Replies are taken in turn, so Ozi does
 * not sound like a recording.
 */
export function phraseReply(
  text: string,
  turn: number,
  mode: 'exact' | 'within',
  phrases: Phrase[] = PHRASES,
): string | null {
  const said = normalise(text.replace(new RegExp(`\\b(hey\\s+)?${NAME_PATTERN}\\b`, 'ig'), ' '));
  if (said === '') return null;
  for (const phrase of phrases) {
    const hit = phrase.when.some((when) =>
      mode === 'exact' ? said === when : ` ${said} `.includes(` ${when} `),
    );
    if (hit) return fillIn(phrase.replies[turn % phrase.replies.length]!);
  }
  return null;
}
