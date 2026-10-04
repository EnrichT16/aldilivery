/**
 * Telephone numbers in twos (Anthony, 4 October 2026): "zero one, six three, four eight…" is
 * easy to follow and to remember; one long run of digits is too fast.
 *
 * On the screen the number is spaced in the same twos, so what is seen and what is heard match,
 * and a screen reader reads it at the same easy pace.
 */

const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

function digitsOf(number: string): string {
  return number.replace(/\D/g, '');
}

/** "0800 000 0000" → "08 00 00 00 00 0". */
export function inPairs(number: string): string {
  return (digitsOf(number).match(/\d{1,2}/g) ?? []).join(' ');
}

/** "0163 485 7125" → "zero one, six three, four eight, five seven, one two, five". */
export function pairsAloud(number: string): string {
  return (digitsOf(number).match(/\d{1,2}/g) ?? [])
    .map((pair) =>
      pair
        .split('')
        .map((digit) => DIGIT_WORDS[Number(digit)])
        .join(' '),
    )
    .join(', ');
}
