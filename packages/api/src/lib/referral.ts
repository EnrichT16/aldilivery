/**
 * A person's own ID, used in the invitation link they share (rulings of 2 October 2026).
 *
 * Short enough to read out over the phone: a letter saying whose it is (R for a Runner), then
 * seven characters with the easily confused ones (0 and O, 1 and I and L) left out.
 */

import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newReferralCode(prefix: 'R' | 'S'): string {
  let code = prefix;
  for (let i = 0; i < 7; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
