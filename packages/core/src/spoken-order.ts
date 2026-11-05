/**
 * Understanding a spoken order: the words, not the sound.
 *
 * These read text the voice engine has already recognised. They are deliberately plain: they
 * understand how people ask for shopping, and nothing here tries to guess around a recognition
 * mistake (Anthony, 30 Sep 2026: Oluoma Voice will not make the stand-in's mistakes, so the
 * ordering is not tuned to them).
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  single: 1,
  two: 2,
  couple: 2,
  pair: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/** How many, from "two", "2", "a dozen", "half a dozen", "just the one". Null when no number was said. */
export function parseQuantity(text: string): number | null {
  const lower = text.toLowerCase();
  // "half a dozen" is six, before "a" or "dozen" is read on its own.
  if (/\bhalf\s+a\s+dozen\b/.test(lower)) return 6;
  const words = lower.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      const n = Number(word);
      return n >= 1 && n <= 99 ? n : null;
    }
  }
  // "a dozen" is twelve, not one: "a" and "an" count only when no other number was said.
  const found = words.filter((word) => NUMBER_WORDS[word] !== undefined);
  const firm = found.find((word) => word !== 'a' && word !== 'an');
  const chosen = firm ?? found[0];
  return chosen === undefined ? null : (NUMBER_WORDS[chosen] as number);
}

/**
 * The unit words people say when they shop (ruling 96), each as the singular the catalogue uses.
 * "bunches" and "bunch" are one; "kilo", "kilos", "kg" and "kilogram" are one.
 */
const UNIT_SAID: Array<{ pattern: RegExp; unit: string }> = [
  { pattern: /^bunch(es)?$/, unit: 'bunch' },
  { pattern: /^packs?$|^packets?$|^pkts?$/, unit: 'pack' },
  { pattern: /^bags?$/, unit: 'bag' },
  { pattern: /^boxe?s?$/, unit: 'box' },
  { pattern: /^tins?$|^cans?$/, unit: 'tin' },
  { pattern: /^bottles?$/, unit: 'bottle' },
  { pattern: /^cartons?$/, unit: 'carton' },
  { pattern: /^jars?$/, unit: 'jar' },
  { pattern: /^loa(f|ves)$/, unit: 'loaf' },
  { pattern: /^punnets?$/, unit: 'punnet' },
  { pattern: /^tubs?$/, unit: 'tub' },
  { pattern: /^kilos?$|^kilograms?$|^kgs?$/, unit: 'kg' },
  { pattern: /^grams?$|^g$/, unit: 'g' },
  { pattern: /^litres?$|^liters?$|^l$/, unit: 'l' },
  { pattern: /^pints?$/, unit: 'pint' },
];

const NUMBER_SAID = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;

export interface SpokenItem {
  /** How many were asked for; null when no number was said ("bananas", "some bananas"). */
  quantity: number | null;
  /** The unit said, as the catalogue spells it ("bunch", "pack", "kg"), or null. */
  unit: string | null;
  /** The thing itself: "bananas" from "five bunches of bananas". */
  item: string;
}

/**
 * One item as a Shopper says it (ruling 96): "five bunches of bananas" is five, bunch, bananas;
 * "two packs of crisps" is two, pack, crisps; "a kilo of apples" is one, kg, apples; "half a
 * dozen eggs" is six eggs; "half a kilo of rice" is one, 500 g, rice; "bananas" is some bananas.
 * The quantity is what to put in the basket; the unit helps choose the right listing.
 */
export function parseSpokenItem(text: string): SpokenItem {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/, '')
    .replace(/^(some|a few|please)\s+/, '');
  // "half a dozen eggs", "half a kilo of rice".
  const half = new RegExp(`^half\\s+(?:a|an|one)\\s+(\\w+)\\s+(?:of\\s+)?(.+)$`).exec(said);
  if (half) {
    const [, unitWord, item] = half as unknown as [string, string, string];
    if (unitWord === 'dozen') return { quantity: 6, unit: null, item: item.trim() };
    const unit = unitSaid(unitWord);
    if (unit === 'kg') return { quantity: 1, unit: '500 g', item: item.trim() };
    if (unit === 'l') return { quantity: 1, unit: '500 ml', item: item.trim() };
    if (unit) return { quantity: 1, unit: `half a ${unit}`, item: item.trim() };
  }
  // "<number> <unit> of <item>", "<number> <unit> <item>", "<number> <item>".
  const withNumber = new RegExp(`^(${NUMBER_SAID})\\s+(?:(\\w+)\\s+of\\s+)?(.+)$`).exec(said);
  if (withNumber) {
    const [, numberWord, unitWord, rest] = withNumber as unknown as [
      string,
      string,
      string | undefined,
      string,
    ];
    const quantity = parseQuantity(numberWord);
    const firm = !/^an?$/.test(numberWord);
    if (unitWord) {
      const unit = unitSaid(unitWord);
      // "a couple of bananas", "two dozen of eggs": a count, not a unit.
      const count = NUMBER_WORDS[unitWord];
      if (count !== undefined && !/^an?$/.test(unitWord)) {
        return {
          quantity: firm && quantity !== null ? quantity * count : count,
          unit: null,
          item: rest.trim(),
        };
      }
      if (unit) return { quantity: firm ? quantity : 1, unit, item: rest.trim() };
      // "two of the apples", or a unit we do not know: keep its words with the item.
      return { quantity: firm ? quantity : null, unit: null, item: `${unitWord} ${rest}`.trim() };
    }
    // "two dozen eggs", "two bunch bananas": a unit without "of".
    const twoWords = /^(\w+)\s+(.+)$/.exec(rest);
    if (twoWords) {
      const [, maybeUnit, item] = twoWords as unknown as [string, string, string];
      if (maybeUnit === 'dozen') {
        return { quantity: quantity === null ? 12 : quantity * 12, unit: null, item: item.trim() };
      }
      const unit = unitSaid(maybeUnit);
      if (unit) return { quantity: firm ? quantity : 1, unit, item: item.trim() };
    }
    return { quantity: firm ? quantity : null, unit: null, item: rest.trim() };
  }
  return { quantity: null, unit: null, item: said };
}

function unitSaid(word: string): string | null {
  return UNIT_SAID.find((entry) => entry.pattern.test(word))?.unit ?? null;
}

/** Which of a short list was chosen: "the second", "number two", "two", "2". */
export function parseChoice(text: string, count: number): number | null {
  const lower = text.toLowerCase();
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
  for (let i = 0; i < Math.min(count, ordinals.length); i += 1) {
    if (lower.includes(ordinals[i] as string)) return i;
  }
  const n = parseQuantity(lower);
  return n !== null && n >= 1 && n <= count ? n - 1 : null;
}

const YES =
  /\b(yes|yeah|yep|yup|correct|right|that's right|that is right|ok|okay|sure|please do|go ahead|send it|confirm)\b/;
const NO = /\b(no|nope|not|wrong|don't|do not|stop|cancel)\b/;

/** A yes, a no, or neither. "No" wins when both are heard, so nothing is sent by mistake. */
export function parseYesNo(text: string): 'yes' | 'no' | null {
  const lower = text.toLowerCase();
  if (NO.test(lower)) return 'no';
  if (YES.test(lower)) return 'yes';
  return null;
}

/** Whether the Shopper wants to stop the whole order. */
export function wantsToStop(text: string): boolean {
  return /\b(cancel( the order| it)?|stop( the order| ordering)?|never mind|forget it)\b/.test(
    text.toLowerCase(),
  );
}

const LEADING = [
  /^(hey|hi|hello|ok|okay)\s+\w+[,.]?\s*/i,
  /^(please\s+)?(place|make|put in|start)\s+(an?\s+)?order\s+(of|for)\s+/i,
  /^(please\s+)?(can|could|would)\s+(i|you|we)\s+(have|get|order|bring( me)?)\s+/i,
  /^(i'd|i would|i)\s+(like|want|need)\s+(to\s+(order|get|buy|have)\s+)?/i,
  /^(please\s+)?(order|get|buy|bring( me)?)\s+/i,
  /^(some|a few)\s+/i,
];

/**
 * The things asked for, from "bananas, grapes, apples and oranges from Iceland, or the nearest
 * available shop". The shop part is returned separately: there is one listed shop until shop
 * listings are built, and Ozi says which.
 */
export function splitItems(
  text: string,
  assistantName?: string,
): { items: string[]; shopAskedFor: string | null } {
  let rest = text.trim().replace(/[.!?]+$/, '');
  // "Ozi, three bananas": the assistant's own name is who is being spoken to, not an item.
  if (assistantName) {
    // Said on its own, "Ozi" is a call for attention, with nothing asked for yet.
    rest = rest.replace(new RegExp(`^(hey\\s+)?${assistantName}[,.]?(\\s+|$)`, 'i'), '');
  }
  for (const pattern of LEADING) rest = rest.replace(pattern, '');

  let shopAskedFor: string | null = null;
  const fromMatch = rest.match(/\s+from\s+(.+)$/i);
  if (fromMatch) {
    shopAskedFor = (fromMatch[1] as string).replace(/,?\s*or\s+the\s+nearest.*$/i, '').trim();
    rest = rest.slice(0, fromMatch.index);
  }

  const items = rest
    .split(/,|\band\b|\bplus\b|\balso\b/i)
    .map((part) => part.replace(/^\s*(some|a few|please)\s+/i, '').trim())
    .filter((part) => part.length > 0);
  return { items, shopAskedFor };
}
