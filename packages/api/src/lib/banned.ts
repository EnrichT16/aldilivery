/**
 * Words Ozi never learns (ruling 49, Anthony, 7 October 2026): swearing, slurs and anything
 * vulgar. Something said to Ozi with one of these in it is never kept for review, never stored,
 * and never repeated: it is deleted at once. The list is `config/banned-words.json`, on the
 * server only.
 *
 * People hide these words, so they are looked for however they are written: in capitals,
 * with letters spaced out ("f u c k"), with stars or dots ("f*ck", "f.u.c.k"), with numbers or
 * symbols for letters ("sh1t", "@ss"), and with letters stretched ("fuuuck").
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { storeConfigPath } from '@aldilivery/core/node';

export interface BannedList {
  words: ReadonlySet<string>;
  /** The longer words with doubled letters made single, for "fuuuck"; never short ones like "ass". */
  squeezed: ReadonlySet<string>;
  roots: readonly string[];
}

const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
};

/** "fuuuck" → "fuck", so a stretched word is still the word. */
function squeeze(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

export function loadBannedList(path: string): BannedList {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { words?: unknown; roots?: unknown };
  const words = Array.isArray(raw.words) ? raw.words.filter((w) => typeof w === 'string') : [];
  const roots = Array.isArray(raw.roots) ? raw.roots.filter((w) => typeof w === 'string') : [];
  const all = new Set((words as string[]).map((word) => word.toLowerCase()));
  const squeezed = new Set(
    [...all]
      .filter((word) => word.length >= 4)
      .map(squeeze)
      .filter((word) => word.length >= 4),
  );
  return { words: all, squeezed, roots: (roots as string[]).map((root) => root.toLowerCase()) };
}

let cached: BannedList | null = null;

/** The list for this process, read once from beside the store settings. */
export function bannedList(explicitConfigPath?: string): BannedList {
  cached ??= loadBannedList(
    join(dirname(storeConfigPath(explicitConfigPath)), 'banned-words.json'),
  );
  return cached;
}

/** The words of a sentence, with every disguise taken off; spelt-out letters marked. */
function plainWords(text: string): Array<{ word: string; spelt: boolean }> {
  const lowered = text
    .toLowerCase()
    .replace(/[0-9!@$]/g, (character) => LOOKALIKES[character] ?? character)
    // Stars, dots, dashes and the like inside a word: "f*ck", "f.u.c.k", "f-u-c-k".
    .replace(/([a-z])[*._\-+~^]+(?=[a-z])/g, '$1');
  const tokens = lowered.split(/[^a-z]+/).filter(Boolean);
  // Letters said one at a time, "f u c k", become one word again.
  const joined: Array<{ word: string; spelt: boolean }> = [];
  let run = '';
  const endRun = (): void => {
    if (run) joined.push({ word: run, spelt: run.length > 1 });
    run = '';
  };
  for (const token of tokens) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    endRun();
    joined.push({ word: token, spelt: false });
  }
  endRun();
  return joined;
}

/** Whether anything in `text` is on the banned list, however it is written. */
export function containsBanned(text: string, list: BannedList = bannedList()): boolean {
  for (const { word, spelt } of plainWords(text)) {
    const squeezed = squeeze(word);
    if (list.words.has(word)) return true;
    if (squeezed.length >= 4 && list.squeezed.has(squeezed)) return true;
    // "is it a f u c k" runs on as "afuck": look inside spelt-out letters too.
    if (spelt && [...list.words].some((banned) => banned.length >= 4 && word.includes(banned))) {
      return true;
    }
    if (list.roots.some((root) => word.startsWith(root) || squeezed.startsWith(squeeze(root)))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether something said may be kept for a person to review: no banned word, nothing that looks
 * like a phone number, card, code, email or postcode, and a real sentence of sensible length.
 */
export function fitToKeep(text: string, list: BannedList = bannedList()): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || text.length > 160) return false;
  if (/\d{4,}|\d[\s-]?\d[\s-]?\d[\s-]?\d/.test(text)) return false;
  if (/@|\bat\s+\w+\s+dot\s+\w+/i.test(text)) return false;
  if (/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/i.test(text)) return false;
  return !containsBanned(text, list);
}
