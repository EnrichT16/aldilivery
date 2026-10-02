/**
 * A PIN said aloud (docs/BUILD_PROMPT.md, Section D: typed or spoken, the Shopper's choice).
 *
 * People say a PIN as four separate numbers — "two seven five nine", "2 7 5 9", "oh eight
 * one four", "double seven one three" — and a recogniser may write any of those as words or
 * figures, or run the figures together. Anything else said around it ("my PIN is…") is
 * ignored. Exactly four digits, or nothing: a guess is never filled in.
 */

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  nil: '0',
  one: '1',
  won: '1',
  two: '2',
  to: '2',
  too: '2',
  three: '3',
  four: '4',
  for: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  ate: '8',
  nine: '9',
};

export function parsePin(text: string): string | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let digits = '';
  let repeat = 1;
  for (const word of words) {
    if (word === 'double' || word === 'triple') {
      repeat = word === 'double' ? 2 : 3;
      continue;
    }
    const value = /^\d+$/.test(word) ? word : DIGIT_WORDS[word];
    if (value === undefined) {
      repeat = 1;
      continue;
    }
    digits += value.length === 1 ? value.repeat(repeat) : value;
    repeat = 1;
  }
  return /^\d{4}$/.test(digits) ? digits : null;
}
