/**
 * Ozi's everyday phrases, kept on the server (ruling 44, Anthony, 7 October 2026).
 *
 * Each kind of account has its own collection, written for the people who use it: Shoppers
 * (`config/ozi-phrases.json`), and Runners, partner shops, organisations, staff, family members,
 * investors and the owner (`config/phrases/<account>.json`). The files never reach a browser:
 * the app sends what was said to `POST /ozi/reply` and gets one reply back, so nobody, the
 * owner included, can read the collection from the app.
 *
 * The owner's Ozi has every collection: his own first, then everybody else's, so it can answer
 * anything any account can be asked. It calls him by `formOfAddress` from his file, and a reply
 * borrowed from another collection opens with "Yes, sir.", "Okay, sir." or "All right, sir.".
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  formatPence,
  normalisePhrase,
  phraseFingerprint,
  phraseWithoutName,
  type PhraseNames,
  type StoreConfig,
} from '@aldilivery/core';
import { loadStoreConfig, storeConfigPath } from '@aldilivery/core/node';

export const PHRASE_ACCOUNTS = [
  'shopper',
  'runner',
  'partner',
  'organisation',
  'staff',
  'family',
  'investor',
  'owner',
] as const;
export type PhraseAccount = (typeof PHRASE_ACCOUNTS)[number];

export interface Phrase {
  id: string;
  topic: string;
  when: string[];
  replies: string[];
  /** Set on the owner's copies of other accounts' phrases. */
  borrowed?: boolean;
}

export interface PhraseBook {
  collections: Record<PhraseAccount, Phrase[]>;
  /** How the owner is addressed: "Mr Anthony". */
  ownerAddress: string;
}

/** The blanks a reply may use. Anything else is a mistake the tests catch. */
export const BLANKS = [
  'assistant',
  'product',
  'motto',
  'fee',
  'maximum',
  'runnerPay',
  'callPrice',
  'instantRefund',
  'partnerPlan',
  'spotlight',
  'spotlightPlus',
  'owner',
] as const;

const OWNER_OPENINGS = ['Yes, sir.', 'Okay, sir.', 'All right, sir.'];

/** The names a file's blanks stand for, and every way Ozi's name is heard. */
export type Names = PhraseNames;

/** Compared without Ozi's name in it, however it was heard ("hey Ozzy, thank you"). */
export const withoutName = phraseWithoutName;

/** Lower case, no punctuation, single spaces: how phrases are compared. */
export const normalise = normalisePhrase;

/** Checks a file, throwing a sentence that says exactly which entry is wrong. */
export function parsePhrases(
  raw: unknown,
  file = 'ozi-phrases.json',
  names: Names = { product: 'product', assistant: '', heardAs: [] },
): Phrase[] {
  const list = (raw as { phrases?: unknown })?.phrases;
  if (!Array.isArray(list)) throw new Error(`${file} must have a "phrases" list.`);
  const ids = new Set<string>();
  return list.map((entry, index) => {
    const e = entry as Partial<Phrase>;
    const where = `${file} entry ${index + 1}${e.id ? ` (${e.id})` : ''}`;
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
    // The product's name is never written into a file (Rule Nine): "what is {product}".
    // Ozi's own name is taken out, as it is from what was said, so "Ozzy Delivery" matches too.
    const heard = e.when
      .map((w) =>
        withoutName(
          w.replace(/\{product\}/g, names.product).replace(/\{assistant\}/g, names.assistant),
          names,
        ),
      )
      .filter((w) => w !== '');
    if (heard.length === 0)
      throw new Error(`${where} needs a phrase besides ${names.assistant}'s name.`);
    return { id: e.id, topic: e.topic, when: heard, replies: e.replies };
  });
}

/** Reads every collection from the folder next to `store.json`. */
export function loadPhraseBook(directory: string, names?: Names): PhraseBook {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(directory, file), 'utf8'));
  const collections = {} as Record<PhraseAccount, Phrase[]>;
  let ownerAddress = 'sir';
  for (const account of PHRASE_ACCOUNTS) {
    const file = account === 'shopper' ? 'ozi-phrases.json' : `phrases/${account}.json`;
    const raw = read(file);
    collections[account] = parsePhrases(raw, file, names);
    if (account === 'owner') {
      const given = (raw as { formOfAddress?: unknown }).formOfAddress;
      if (typeof given === 'string' && given.trim() !== '') ownerAddress = given.trim();
    }
  }
  // The owner's Ozi is the first among them: his own, then everyone else's.
  collections.owner = [
    ...collections.owner,
    ...PHRASE_ACCOUNTS.filter((a) => a !== 'owner').flatMap((account) =>
      collections[account].map((p) => ({ ...p, id: `${account}:${p.id}`, borrowed: true })),
    ),
  ];
  return { collections, ownerAddress };
}

let cached: PhraseBook | null = null;

/** The phrase book for this process, read once from beside the store settings. */
export function phraseBook(explicitConfigPath?: string): PhraseBook {
  if (!cached) {
    const config = loadStoreConfig(explicitConfigPath);
    cached = loadPhraseBook(dirname(storeConfigPath(explicitConfigPath)), {
      product: config.productName,
      assistant: config.assistantName,
      heardAs: config.assistantHeardAs,
    });
  }
  return cached;
}

/** The figures and names a reply may mention, always from the store's own settings. */
export function fillIn(reply: string, config: StoreConfig, ownerAddress: string): string {
  const money = (pence: number): string => formatPence(pence, config.store.currencySymbol);
  const values: Record<(typeof BLANKS)[number], string> = {
    assistant: config.assistantName,
    product: config.productName,
    motto: config.motto,
    fee: money(config.fees.standardDeliveryPence),
    maximum: money(config.fees.maximumGoodsPence),
    runnerPay: money(config.fees.runnerPaymentPence),
    callPrice: `${config.calls.pencePerMinute}p`,
    instantRefund: money(config.problems.instantRefundUpToPence),
    partnerPlan: money(config.extras.partnerMonthlyPence),
    spotlight: money(config.extras.spotlightPence),
    spotlightPlus: money(config.extras.spotlightPlusPence),
    owner: ownerAddress,
  };
  return reply.replace(
    /\{(\w+)\}/g,
    (whole, key: string) => values[key as keyof typeof values] ?? whole,
  );
}

/** Little words that say nothing about what was asked, left out of keyword matching. */
const STOP_WORDS = new Set(
  (
    'a an the and or but if so to of for in on at by with from up out about into over is are was ' +
    'were be been am do does did done have has had i im ive id me my mine you your yours we our us ' +
    'it its this that these those there here what whats when where which who whom why how can ' +
    'could would should will shall may might must please thanks thank just really very much more ' +
    'some any all get got go going want like need tell know say said let lets ok okay yes no not ' +
    'dont doesnt cant hey hi hello oh well also too then than as'
  ).split(' '),
);

/** The words that carry the meaning: "how do refunds work" → refund, work. */
export function keywords(text: string): string[] {
  return normalise(text)
    .replace(/'/g, '')
    .split(' ')
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map((word) =>
      word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word,
    );
}

interface PhraseIndex {
  size: number;
  /** Every whole "when" phrase, for an instant exact answer. */
  exact: Map<string, Phrase>;
  /** Each "when" phrase's keywords, and how many phrases each keyword appears in. */
  keyed: Array<{ phrase: Phrase; words: Set<string> }>;
  spread: Map<string, number>;
}

const indexes = new WeakMap<Phrase[], PhraseIndex>();

/** Built once per collection, and again only if phrases were added since (ruling 49). */
function indexOf(collection: Phrase[]): PhraseIndex {
  const known = indexes.get(collection);
  if (known && known.size === collection.length) return known;
  const exact = new Map<string, Phrase>();
  const keyed: PhraseIndex['keyed'] = [];
  const spread = new Map<string, number>();
  for (const phrase of collection) {
    const seen = new Set<string>();
    for (const when of phrase.when) {
      if (!exact.has(when)) exact.set(when, phrase);
      const words = new Set(keywords(when));
      if (words.size > 0) keyed.push({ phrase, words });
      for (const word of words) seen.add(word);
    }
    for (const word of seen) spread.set(word, (spread.get(word) ?? 0) + 1);
  }
  const built = { size: collection.length, exact, keyed, spread };
  indexes.set(collection, built);
  return built;
}

/**
 * The phrase whose keywords best match what was said (Anthony, 7 October 2026: "pick it up by
 * keyword"). Two or more of a phrase's keywords, covering at least half of them; or, in a
 * short sentence, one word that only a few phrases use. Null when nothing is close enough.
 */
function byKeywords(said: string, index: PhraseIndex): Phrase | null {
  const heard = new Set(keywords(said));
  if (heard.size === 0) return null;
  let best: { phrase: Phrase; score: number } | null = null;
  for (const { phrase, words } of index.keyed) {
    let shared = 0;
    let weight = 0;
    for (const word of words) {
      if (!heard.has(word)) continue;
      shared += 1;
      weight += 1 / (index.spread.get(word) ?? 1);
    }
    if (shared === 0) continue;
    const cover = shared / words.size;
    const enough =
      (shared >= 2 && cover >= 0.5) ||
      (shared === 1 &&
        words.size === 1 &&
        heard.size <= 3 &&
        (index.spread.get([...words][0]!) ?? 99) <= 3);
    if (!enough) continue;
    const score = shared * 2 + cover + weight;
    if (!best || score > best.score) best = { phrase, score };
  }
  return best?.phrase ?? null;
}

/**
 * A reply, if the words are an everyday phrase for this account. `exact`: the whole sentence,
 * apart from Ozi's name, is one of them, found at once from an index. `within`: one of them is
 * somewhere in the sentence, or failing that, enough of a phrase's keywords are (ruling 49).
 * Replies are taken in turn, so Ozi does not sound like a recording.
 */
export function phraseReply(
  text: string,
  turn: number,
  mode: 'exact' | 'within',
  account: PhraseAccount,
  config: StoreConfig,
  book: PhraseBook = phraseBook(),
): string | null {
  const said = withoutName(text, {
    product: config.productName,
    assistant: config.assistantName,
    heardAs: config.assistantHeardAs,
  });
  if (said === '') return null;
  const collection = book.collections[account];
  const index = indexOf(collection);
  let found: Phrase | null = index.exact.get(said) ?? null;
  if (!found && mode === 'within') {
    const padded = ` ${said} `;
    found =
      collection.find((phrase) => phrase.when.some((when) => padded.includes(` ${when} `))) ?? null;
    found ??= byKeywords(said, index);
  }
  if (!found) return null;
  const reply = fillIn(found.replies[turn % found.replies.length]!, config, book.ownerAddress);
  if (account === 'owner' && found.borrowed) {
    return `${OWNER_OPENINGS[turn % OWNER_OPENINGS.length]} ${reply}`;
  }
  return reply;
}

/** The fingerprints of every whole phrase this account's Ozi knows, for the app (ruling 49). */
export function phraseFingerprints(
  account: PhraseAccount,
  book: PhraseBook = phraseBook(),
): string[] {
  return [...indexOf(book.collections[account]).exact.keys()].map(phraseFingerprint);
}
