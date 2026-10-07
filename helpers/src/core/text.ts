/**
 * Matching what people say against what a helper was taught, with no AI at all: exact match
 * first, then keyword match. This is the "no brain" mode, and it costs nothing to run.
 */

const CONTRACTIONS: Record<string, string> = {
  "what's": 'what is',
  "where's": 'where is',
  "when's": 'when is',
  "how's": 'how is',
  "who's": 'who is',
  "it's": 'it is',
  "i'm": 'i am',
  "can't": 'can not',
  cannot: 'can not',
  "won't": 'will not',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "isn't": 'is not',
  "you're": 'you are',
  "we're": 'we are',
  "i've": 'i have',
  "i'd": 'i would',
  "i'll": 'i will',
};

/** Words that carry no meaning on their own, so two questions never match on them alone. */
const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for from with about as into is are was were ' +
    'be been being am do does did done have has had having i me my mine we us our ours you your ' +
    'yours he him his she her hers it its they them their theirs this that these those there here ' +
    'what which who whom whose when where why how can could would should will shall may might must ' +
    'not no yes please thanks thank hello hi dear regards kind best just also very really any some ' +
    'all get got want wanted like know tell let make need one up out over more much than too only ' +
    'own same such again further once ok okay well'
  ).split(' '),
);

/** Lower case, accents and punctuation taken off, contractions opened, spaces tidied. */
export function normalise(text: string): string {
  const lowered = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʼ]/g, "'");
  const opened = lowered.replace(/[a-z]+'[a-z]+|cannot/g, (word) => CONTRACTIONS[word] ?? word);
  return opened
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A rough word root, so "deliveries", "delivered" and "delivery" meet. */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  // "delivery" and "deliveries" meet "deliver".
  if (word.endsWith('eries') && word.length > 7) return word.slice(0, -3);
  if (word.endsWith('ery') && word.length > 6) return word.slice(0, -1);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && /(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The meaning words of a sentence, rooted, without repeats. */
export function keywords(text: string): string[] {
  const seen = new Set<string>();
  for (const word of normalise(text).split(' ')) {
    if (!word || STOPWORDS.has(word) || word.length < 2) continue;
    seen.add(stem(word));
  }
  return [...seen];
}

/**
 * How well a message matches one taught phrasing, from 0 to 1.
 *
 * - 1: the same words, once tidied.
 * - 0.95: the taught phrasing appears whole inside a longer message.
 * - Otherwise the share of meaning words the two have in common (the Dice score), and never from
 *   a single common word: at least two must be shared, unless the taught phrasing has only one.
 */
export function matchScore(message: string, taught: string): number {
  const a = normalise(message);
  const b = normalise(taught);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const taughtWords = keywords(taught);
  if (b.split(' ').length >= 3 && ` ${a} `.includes(` ${b} `)) return 0.95;
  const messageWords = keywords(message);
  if (taughtWords.length === 0 || messageWords.length === 0) return 0;
  const shared = taughtWords.filter((word) => messageWords.includes(word)).length;
  const needed = taughtWords.length === 1 ? 1 : 2;
  if (shared < needed) return 0;
  const dice = (2 * shared) / (taughtWords.length + messageWords.length);
  // Every meaning word of a three word (or longer) taught question, found in a longer message.
  const covered = shared === taughtWords.length && taughtWords.length >= 3 ? 0.8 : 0;
  // Only the same words, once tidied, score a full 1.
  return Math.min(Math.max(dice, covered), 0.99);
}

/** The first `limit` characters of a message, cut at a word, for logs and texts. */
export function shorten(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trim()}...`;
}
