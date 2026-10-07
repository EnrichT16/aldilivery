/**
 * The rules every helper keeps, whatever its brain says.
 *
 * 1. Banned words (swearing, slurs, anything vulgar) are never stored and never repeated. They
 *    are found however they are disguised: capitals, spaced letters ("f u c k"), stars or dots
 *    ("f*ck"), numbers for letters ("sh1t"), stretched letters ("fuuuck").
 * 2. Card numbers, passwords and codes are never stored: they are taken out of anything kept.
 * 3. A helper never asks anybody for a card number, password or code.
 */

export interface BannedList {
  words: ReadonlySet<string>;
  /** Longer words with doubled letters made single, for "fuuuck"; never short ones like "ass". */
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

function squeeze(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

/** Builds the list from `config/banned-words.json` (or anything shaped like it). */
export function bannedListFrom(raw: unknown): BannedList {
  const source = (raw ?? {}) as { words?: unknown; roots?: unknown };
  const words = Array.isArray(source.words)
    ? source.words.filter((w): w is string => typeof w === 'string')
    : [];
  const roots = Array.isArray(source.roots)
    ? source.roots.filter((w): w is string => typeof w === 'string')
    : [];
  const all = new Set(words.map((word) => word.toLowerCase()));
  const squeezed = new Set(
    [...all]
      .filter((word) => word.length >= 4)
      .map(squeeze)
      .filter((word) => word.length >= 4),
  );
  return { words: all, squeezed, roots: roots.map((root) => root.toLowerCase()) };
}

/** The words of a sentence with every disguise taken off; spelt-out letters joined and marked. */
function plainWords(text: string): Array<{ word: string; spelt: boolean }> {
  const lowered = text
    .toLowerCase()
    .replace(/[0-9!@$]/g, (character) => LOOKALIKES[character] ?? character)
    .replace(/([a-z])[*._\-+~^]+(?=[a-z])/g, '$1');
  const tokens = lowered.split(/[^a-z]+/).filter(Boolean);
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
export function containsBanned(text: string, list: BannedList): boolean {
  for (const { word, spelt } of plainWords(text)) {
    const squeezed = squeeze(word);
    if (list.words.has(word)) return true;
    if (squeezed.length >= 4 && list.squeezed.has(squeezed)) return true;
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
 * The text with every banned word replaced by "[removed]", or `null` if a banned word cannot be
 * cleanly taken out (for example when it is spelt out across several letters). `null` means:
 * do not keep this text at all.
 */
export function withoutBanned(text: string, list: BannedList): string | null {
  if (!containsBanned(text, list)) return text;
  const cleaned = text.replace(/\S+/g, (token) =>
    containsBanned(token, list) ? '[removed]' : token,
  );
  return containsBanned(cleaned, list) ? null : cleaned;
}

/** The Luhn check every real card number passes. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

const SECRET_WORDS =
  '(?:password|passwd|passcode|pass\\s?word|pin(?:\\s?number)?|cvv|cvc|cv2|security\\s?code|one[-\\s]?time\\s?(?:pass)?code|otp|verification\\s?code|login\\s?code|access\\s?code|2fa\\s?code)';

/** Kinds of private detail found in a message. */
export type SensitiveKind = 'card number' | 'password or code' | 'bank details';

/**
 * Takes card numbers, passwords, codes and bank details out of a message before it is kept,
 * and says what was taken out.
 */
export function redactSensitive(text: string): { text: string; removed: SensitiveKind[] } {
  const removed = new Set<SensitiveKind>();
  let result = text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) {
      removed.add('card number');
      return '[card number removed]';
    }
    return match;
  });
  result = result.replace(
    new RegExp(`\\b(${SECRET_WORDS})(\\s*(?:is|was|:|=|-)?\\s*)([^\\s,.;]{3,})`, 'gi'),
    (match, word: string, gap: string, value: string) => {
      // "your password is" followed by an ordinary word is not a password.
      if (/^(is|was|the|a|an|and|or|to|for|reset|has|have|not|will)$/i.test(value)) return match;
      removed.add('password or code');
      return `${word}${gap}[removed]`;
    },
  );
  result = result.replace(/\b\d{2}[- ]\d{2}[- ]\d{2}\b(?=[\s\S]{0,40}\b\d{8}\b)/g, () => {
    removed.add('bank details');
    return '[sort code removed]';
  });
  result = result.replace(
    /\b(account\s*(?:number|no\.?)?\s*:?\s*)(\d{8})\b/gi,
    (_m, lead: string) => {
      removed.add('bank details');
      return `${lead}[account number removed]`;
    },
  );
  return { text: result, removed: [...removed] };
}

/** Whether an outgoing message asks somebody for a card number, password, code or bank details. */
export function asksForSecrets(text: string): boolean {
  const asking =
    /\b(send|give|tell|share|provide|confirm|reply with|email|text|enter|type|read out|need|require)\b/i;
  const secret = new RegExp(
    `\\b(card\\s?(number|details|no)|long number on|(the|your) code|${SECRET_WORDS}|bank\\s?details|sort\\s?code|account\\s?number)\\b`,
    'i',
  );
  return text
    .split(/(?<=[.!?\n])/)
    .some((sentence) => asking.test(sentence) && secret.test(sentence));
}

/** Why an outgoing message may not go, in plain English; or null if it may. */
export function outgoingProblem(text: string, list: BannedList): string | null {
  if (!text.trim()) return 'The message is empty.';
  if (containsBanned(text, list)) return 'The message contains a banned word.';
  if (asksForSecrets(text)) {
    return 'The message asks for a card number, password, code or bank details, which we never do.';
  }
  if (redactSensitive(text).removed.length > 0) {
    return 'The message contains a card number, password, code or bank details.';
  }
  return null;
}
