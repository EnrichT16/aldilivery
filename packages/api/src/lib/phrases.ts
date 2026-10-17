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
  deliverySteps,
  deliveryStepsWords,
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
  'smallFee',
  'smallUpTo',
  'middleFee',
  'largeUpTo',
  'memberFee',
  'memberLargeFee',
  'plusFee',
  'plusLargeFee',
  'paygDelivery',
  'memberDelivery',
  'plusDelivery',
  'itemCharge',
  'membership',
  'plusPrice',
  'familyPrice',
  'orgClient',
  'maximum',
  'maximumProduct',
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
  const paygSteps = deliverySteps('payg', config.fees);
  const memberSteps = deliverySteps('membership', config.fees);
  const plusSteps = deliverySteps('plus', config.fees);
  const values: Record<(typeof BLANKS)[number], string> = {
    assistant: config.assistantName,
    product: config.productName,
    motto: config.motto,
    // Delivery by plan and by the value of the shopping, in bands (rulings 58 and 63). On pay as
    // you go, {smallFee} is the smallest shop's price (up to {smallUpTo}), {middleFee} the step
    // below the dearest (up to {largeUpTo}) and {fee} the dearest, over {largeUpTo}. Members pay
    // {memberFee} up to {largeUpTo} and {memberLargeFee} over; Plus and Family and Carer {plusFee}
    // and {plusLargeFee}. {paygDelivery}, {memberDelivery} and {plusDelivery} say a whole plan's
    // prices in one phrase: "£7.99 for shopping up to £30.00, £9.99 up to £60.00, and £13.50 over
    // £60.00".
    fee: money(paygSteps[paygSteps.length - 1]!.pence),
    smallFee: money(paygSteps[0]!.pence),
    smallUpTo: money(paygSteps[0]!.upToPence ?? 0),
    middleFee: money(paygSteps[Math.max(0, paygSteps.length - 2)]!.pence),
    largeUpTo: money(paygSteps[Math.max(0, paygSteps.length - 2)]!.upToPence ?? 0),
    memberFee: money(memberSteps[0]!.pence),
    memberLargeFee: money(memberSteps[memberSteps.length - 1]!.pence),
    plusFee: money(plusSteps[0]!.pence),
    plusLargeFee: money(plusSteps[plusSteps.length - 1]!.pence),
    paygDelivery: deliveryStepsWords('payg', config.fees, money),
    memberDelivery: deliveryStepsWords('membership', config.fees, money),
    plusDelivery: deliveryStepsWords('plus', config.fees, money),
    // The smallest item charge, said as pence when it is under a pound.
    itemCharge:
      config.fees.itemCharge.basePence < 100
        ? `${config.fees.itemCharge.basePence}p`
        : money(config.fees.itemCharge.basePence),
    membership: money(config.extras.membershipPence),
    plusPrice: money(config.extras.plusPence),
    familyPrice: money(config.extras.familyPence),
    orgClient: money(config.extras.organisations.clientMonthlyPence),
    maximum: money(config.fees.maximumOrderGoodsPence),
    maximumProduct: money(config.fees.maximumProductPence),
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

/** One "when" phrase with at least one keyword, and its place in the collection. */
interface Keyed {
  phrase: Phrase;
  when: string;
  words: Set<string>;
  /** The phrase's position in the collection, so the first phrase listed still wins a tie. */
  order: number;
}

interface PhraseIndex {
  size: number;
  /** Every whole "when" phrase, for an instant exact answer. */
  exact: Map<string, Phrase>;
  /**
   * Keyword buckets (ruling 66): each keyword, and the "when" phrases that use it. Looking a
   * sentence up touches only the buckets of its own keywords, so the time taken no longer
   * grows with the size of the whole collection, which passed 1,900 phrases on 17 October 2026.
   */
  buckets: Map<string, Keyed[]>;
  /** The "when" phrases made only of little words ("thank you"), which no bucket can hold. */
  unkeyed: Array<{ phrase: Phrase; when: string; order: number }>;
  /** How many phrases each keyword appears in: a rare word says more than a common one. */
  spread: Map<string, number>;
}

const indexes = new WeakMap<Phrase[], PhraseIndex>();

/** Built once per collection, and again only if phrases were added since (ruling 49). */
function indexOf(collection: Phrase[]): PhraseIndex {
  const known = indexes.get(collection);
  if (known && known.size === collection.length) return known;
  const exact = new Map<string, Phrase>();
  const buckets = new Map<string, Keyed[]>();
  const unkeyed: PhraseIndex['unkeyed'] = [];
  const spread = new Map<string, number>();
  collection.forEach((phrase, order) => {
    const seen = new Set<string>();
    for (const when of phrase.when) {
      if (!exact.has(when)) exact.set(when, phrase);
      const words = new Set(keywords(when));
      if (words.size === 0) {
        unkeyed.push({ phrase, when, order });
        continue;
      }
      const keyed: Keyed = { phrase, when, words, order };
      for (const word of words) {
        seen.add(word);
        const bucket = buckets.get(word);
        if (bucket) bucket.push(keyed);
        else buckets.set(word, [keyed]);
      }
    }
    for (const word of seen) spread.set(word, (spread.get(word) ?? 0) + 1);
  });
  const built = { size: collection.length, exact, buckets, unkeyed, spread };
  indexes.set(collection, built);
  return built;
}

/**
 * The "when" phrases that share at least one keyword with what was said, each once, in the
 * order the collection lists them. A phrase inside a sentence shares every keyword with it,
 * so this is also every phrase that could be found within the sentence.
 */
function candidates(heard: Set<string>, index: PhraseIndex): Keyed[] {
  const found = new Set<Keyed>();
  for (const word of heard) {
    const bucket = index.buckets.get(word);
    if (bucket) for (const keyed of bucket) found.add(keyed);
  }
  return [...found].sort((a, b) => a.order - b.order);
}

/**
 * The first phrase, in the collection's order, that is somewhere inside the sentence, whole:
 * "ozzy, thank you so much" holds "thank you".
 */
function within(said: string, heard: Set<string>, index: PhraseIndex): Phrase | null {
  const padded = ` ${said} `;
  let best: { phrase: Phrase; order: number } | null = null;
  const consider = (phrase: Phrase, when: string, order: number): void => {
    if ((best && order >= best.order) || !padded.includes(` ${when} `)) return;
    best = { phrase, order };
  };
  for (const entry of index.unkeyed) consider(entry.phrase, entry.when, entry.order);
  for (const entry of candidates(heard, index)) consider(entry.phrase, entry.when, entry.order);
  return best ? (best as { phrase: Phrase }).phrase : null;
}

/**
 * The phrase whose keywords best match what was said (Anthony, 7 October 2026: "pick it up by
 * keyword"). Two or more of a phrase's keywords, covering at least half of them; or, in a
 * short sentence, one word that only a few phrases use. Null when nothing is close enough.
 */
function byKeywords(heard: Set<string>, index: PhraseIndex): Phrase | null {
  if (heard.size === 0) return null;
  let best: { phrase: Phrase; score: number } | null = null;
  for (const { phrase, words } of candidates(heard, index)) {
    let shared = 0;
    let weight = 0;
    for (const word of words) {
      if (!heard.has(word)) continue;
      shared += 1;
      weight += 1 / (index.spread.get(word) ?? 1);
    }
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
    const heard = new Set(keywords(said));
    found = within(said, heard, index) ?? byKeywords(heard, index);
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
