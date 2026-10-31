/**
 * Blanking what must never be read aloud or shown from an email (ruling 85, 31 October 2026):
 * email addresses, card numbers, telephone numbers and codes. Used on everything kept from an
 * email for the owner to hear: its subject, its summary and the start of its words.
 *
 * It errs towards blanking: a long reference number goes the same way as a card number, because
 * a blind owner hearing it would gain nothing and a customer's number must never be spoken.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** 13 to 19 digits, with or without spaces or dashes: a card number. */
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
/** A telephone number: +44 or 0 and nine or ten more digits, or any nine digits or more. */
const PHONE = /(?:\+\d{1,3}[\s-]?)?\(?\d(?:[\s().-]?\d){8,}/g;
/** "code: 123456", "PIN 4821", "password is hunter2", "passcode 123456#": the word stays. */
const NAMED_CODE =
  /\b(code|pin|passcode|password|otp|one[- ]time code|verification code|security code)(\s*(?:is|:|=|-)?\s*)([^\s,.;]+)/gi;
/** A run of five to eight digits on its own: a code or a reference. */
const DIGITS = /\b\d{5,8}\b/g;
/** Letters and digits mixed, six or more long, with at least two digits: a code or a reference. */
const MIXED = /\b(?=[A-Za-z0-9-]*\d[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{6,}\b/g;

export function blankPrivate(text: string): string {
  return text
    .replace(EMAIL, '[email address]')
    .replace(CARD, '[card number]')
    .replace(PHONE, '[phone number]')
    .replace(NAMED_CODE, (_whole, word: string, between: string) => `${word}${between}[code]`)
    .replace(DIGITS, '[code]')
    .replace(MIXED, '[code]');
}

/** The plain words of an email, blanked and cut to `limit` characters at a word. */
export function blankedExcerpt(text: string, limit: number): string {
  const tidy = blankPrivate(
    text
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
  if (tidy.length <= limit) return tidy;
  const cut = tidy.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${space > limit * 0.8 ? cut.slice(0, space) : cut}…`;
}
