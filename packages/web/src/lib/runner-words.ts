/**
 * Promises to Runners that appear on more than one page, written once so they cannot drift
 * apart. Corrected after an audit so that each one says only what the code does: paying back
 * waits for a person when the amount is large or unclear (services/reimburse.ts), and the
 * automatic document check approves only what is clearly in order (Anthony, 30 October 2026).
 */

import { storeConfig } from '../config';
import { money } from './money';

/** Paying a Runner back for the shopping, as services/reimburse.ts does it. */
export const PAID_BACK_PROMISE =
  'Paid back straight away when you send a photo of the receipt. Large or unclear amounts are checked by a person first, usually the same day. You are always paid back in full once checked.';

/** The same, with the amount above which a receipt with no photo waits for a person. */
export function paidBackInFull(): string {
  return `${PAID_BACK_PROMISE} Without a photo, anything over ${money(storeConfig.receipts.photoNeededAbovePence)} is checked first.`;
}

/** Who checks a Runner's documents. */
export const DOCUMENT_CHECK_WORDS =
  'Our automatic check approves documents that are clearly in order. Anything unclear is looked at by a person.';

/**
 * The enhanced DBS check, which is optional: only for "closer help" jobs, which are not offered
 * yet. The basic DBS check stays required, as the server enforces (Anthony, 30 October 2026).
 */
export const ENHANCED_DBS_OPTIONAL =
  "Optional: an enhanced DBS check. You only need this if you want 'closer help' jobs, where you go inside a Shopper's home to carry shopping in or put it away in cupboards or the fridge. Every other job needs only the basic DBS check. These closer-help jobs are not offered yet.";
