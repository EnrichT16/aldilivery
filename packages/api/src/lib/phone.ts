/**
 * Phone numbers, in one form.
 *
 * Until 26 Sep 2026 a phone number was stored exactly as it was typed, so "07700 900123",
 * "07700900123" and "+44 7700 900123" were three different people. That did not matter while
 * nobody could sign back in; it matters the moment somebody has to type their number again,
 * on another device, and be found. Every number is now kept in the international form a
 * text message is sent to: `+44` and the number without its leading nought.
 *
 * Aldilivery is United Kingdom only, so this only understands United Kingdom numbers. That
 * is also the first defence against somebody using the sign-in screen to send texts
 * abroad at our expense: a number that is not British never becomes a destination.
 */

/** A United Kingdom number in `+44…` form, or undefined if it is not one. */
export function ukPhone(input: string): string | undefined {
  let digits = input.replace(/[\s().-]/g, '');

  if (digits.startsWith('+44')) digits = digits.slice(3);
  else if (digits.startsWith('0044')) digits = digits.slice(4);
  else if (digits.startsWith('44') && digits.length >= 11) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  else return undefined;

  // Somebody writing "+44 (0)7700…" leaves the nought in.
  if (digits.startsWith('0')) digits = digits.slice(1);

  // Nine or ten digits after the country code: every UK number in use today.
  return /^[1-9]\d{8,9}$/.test(digits) ? `+44${digits}` : undefined;
}

/** A mobile, which is the only kind of number a text can be sent to. */
export function isUkMobile(phone: string): boolean {
  return /^\+447\d{9}$/.test(phone);
}

export const NOT_A_UK_NUMBER =
  'We can only use phone numbers in the United Kingdom at the moment. Please give one that starts 07 or +44.';
