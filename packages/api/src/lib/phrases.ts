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

import { formatPence, type StoreConfig } from '@aldilivery/core';
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
export interface Names {
  product: string;
  assistant: string;
  heardAs: readonly string[];
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compared without Ozi's name in it, however it was heard ("hey Ozzy, thank you"). */
export function withoutName(text: string, names: Names): string {
  const all = [names.assistant, ...names.heardAs].filter((name) => name.trim() !== '');
  if (all.length === 0) return normalise(text);
  const pattern = all.map(escape).join('|');
  return normalise(text.replace(new RegExp(`\\b(hey\\s+)?(?:${pattern})\\b`, 'ig'), ' '));
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

/**
 * A reply, if the words are an everyday phrase for this account. `exact`: the whole sentence,
 * apart from Ozi's name, is one of them. `within`: one of them is somewhere in the sentence.
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
  for (const phrase of book.collections[account]) {
    const hit = phrase.when.some((when) =>
      mode === 'exact' ? said === when : ` ${said} `.includes(` ${when} `),
    );
    if (!hit) continue;
    const reply = fillIn(phrase.replies[turn % phrase.replies.length]!, config, book.ownerAddress);
    if (account === 'owner' && phrase.borrowed) {
      return `${OWNER_OPENINGS[turn % OWNER_OPENINGS.length]} ${reply}`;
    }
    return reply;
  }
  return null;
}
