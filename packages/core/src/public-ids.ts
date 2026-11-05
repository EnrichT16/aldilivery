/**
 * Speakable IDs for everyone (ruling 97, 5 November 2026): a short public ID a person can say
 * over the phone and a Shop Partner can write on a bag, made once and kept.
 *
 * - Shoppers S-, Shop Partners P-, Organisations G-, Staff T-, each followed by six characters.
 * - Runners keep the Runner ID they already have (`referralCode`, "R…"), unchanged.
 * - The characters leave out the ones people mishear or misread: 0 and O, 1 and I and L.
 *
 * The prefixes and the length come from `publicIds` in config/store.json (Rule Nine); the pure
 * rules live here so the server, the screens and Ozi all read an ID the same way.
 */

/** Letters and digits with the confusable ones (0, O, 1, I, L) left out. */
export const SPEAKABLE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Who an ID belongs to. A Runner's is their Runner ID, made elsewhere and kept as it is. */
export type PublicIdKind = 'shopper' | 'partner' | 'organisation' | 'staff';

export interface PublicIdSettings {
  /** How many characters follow the prefix and the dash. */
  readonly length: number;
  /** The letter that starts each kind of ID. */
  readonly prefixes: Readonly<Record<PublicIdKind, string>>;
}

/** The plain word for each kind, as shown beside the ID ("Your Shopper ID"). */
export const PUBLIC_ID_WORDS: Readonly<Record<PublicIdKind, string>> = {
  shopper: 'Shopper ID',
  partner: 'Partner ID',
  organisation: 'Organisation ID',
  staff: 'Staff ID',
};

/**
 * A fresh ID of this kind. `random(n)` gives a whole number from 0 up to but not including n;
 * the server passes a cryptographic one.
 */
export function newPublicId(
  kind: PublicIdKind,
  settings: PublicIdSettings,
  random: (below: number) => number,
): string {
  let body = '';
  for (let index = 0; index < settings.length; index += 1) {
    body += SPEAKABLE_ALPHABET[random(SPEAKABLE_ALPHABET.length)];
  }
  return `${settings.prefixes[kind]}-${body}`;
}

/** Whether a string is an ID of this kind, as made here: the prefix, a dash, and only speakable characters. */
export function isSpeakableId(
  value: string,
  kind: PublicIdKind,
  settings: PublicIdSettings,
): boolean {
  const prefix = settings.prefixes[kind];
  if (!value.startsWith(`${prefix}-`)) return false;
  const body = value.slice(prefix.length + 1);
  if (body.length !== settings.length) return false;
  return [...body].every((character) => SPEAKABLE_ALPHABET.includes(character));
}

/**
 * An ID spelt out for Ozi to say, in groups of three so it is easy to hear and write down:
 * "S-7K4M2X" becomes "S, 7 K 4, M 2 X". A Runner ID ("RABCD234") is spelt the same way.
 */
export function spellId(id: string): string {
  const tidy = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (tidy === '') return '';
  const prefix = tidy.slice(0, 1);
  const body = tidy.slice(1);
  const groups: string[] = [];
  for (let index = 0; index < body.length; index += 3) {
    groups.push(
      body
        .slice(index, index + 3)
        .split('')
        .join(' '),
    );
  }
  return [prefix, ...groups].join(', ');
}

/** What Ozi says when asked to read an ID out: "Your Shopper ID is S, 7 K 4, M 2 X." */
export function idReadOut(words: string, id: string): string {
  return `Your ${words} is ${spellId(id)}.`;
}
