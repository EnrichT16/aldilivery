/**
 * How Ozi's everyday phrases are compared, in one place, so the server and the app agree to the
 * letter (rulings 34, 44 and 49).
 */

/** The names a phrase file's blanks stand for, and every way Ozi's name is heard. */
export interface PhraseNames {
  product: string;
  assistant: string;
  heardAs: readonly string[];
}

/** Lower case, no punctuation, single spaces: how phrases are compared. */
export function normalisePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compared without Ozi's name in it, however it was heard ("hey Ozzy, thank you"). */
export function phraseWithoutName(text: string, names: PhraseNames): string {
  const all = [names.assistant, ...names.heardAs].filter((name) => name.trim() !== '');
  if (all.length === 0) return normalisePhrase(text);
  const pattern = all.map(escape).join('|');
  return normalisePhrase(text.replace(new RegExp(`\\b(hey\\s+)?(?:${pattern})\\b`, 'ig'), ' '));
}

/**
 * A one-way fingerprint of a phrase (32-bit FNV-1a, as hex). The app is given these, never the
 * phrases or the answers, so it knows at once when something said cannot be an everyday phrase
 * and goes straight on to the shopping, without asking the server and waiting.
 */
export function phraseFingerprint(normalised: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i += 1) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
