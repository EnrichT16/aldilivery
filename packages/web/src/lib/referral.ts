/**
 * The invitation a person followed: `/join?ref=R4K7Q2AB`. Kept for this visit, so it is still
 * there when they reach the sign-up form a few screens later.
 *
 * Since 30 October 2026 (Anthony: referral links for everybody), any page can carry a link, and
 * whichever kind of account the person opens, the link is counted for whoever shared it. What a
 * link carries is kept on the device until sign-up completes (`rememberJoinedVia` in lib/api.ts),
 * then forgotten:
 *
 * - `?ref=R…`, a Runner's ID, as Runners' links have always been;
 * - `?via=<kind>-<code>`, anybody's referral link: a Shopper's (`shopper-<handle>`), a Runner's,
 *   a shop's (`partner-<id>`), an organisation's or a staff member's. Shoppers' and staff links
 *   have had this shape since ruling 44, and keep it;
 * - `?ambassador=<kind>-<code>`, an Ozi Ambassador's "Introduce a business" link to
 *   /business/join.
 */

import { rememberAmbassador, rememberJoinedVia } from './api';

const KEY = 'ozidelivery.referral';

export function rememberReferral(code: string | null): void {
  if (!code || !/^[A-Za-z0-9]{4,20}$/.test(code)) return;
  try {
    window.sessionStorage.setItem(KEY, code.toUpperCase());
  } catch {
    // Private browsing: the code is simply not kept.
  }
}

export function readReferral(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const VIA = /^(staff|shopper|runner|partner|organisation)-([A-Za-z0-9_-]{1,40})$/;
const AMBASSADOR = /^(shopper|runner|partner|organisation)-([A-Za-z0-9_-]{1,40})$/;

/** Keeps whatever referral link these query parameters carry, on any page. */
export function rememberLinkFrom(params: URLSearchParams): void {
  const ref = params.get('ref');
  rememberReferral(ref);
  // A Runner's link can bring anybody: counted for the Runner who shared it.
  if (ref && /^R[A-Z0-9]{7}$/i.test(ref)) rememberJoinedVia(`runner:${ref.toUpperCase()}`);
  const via = VIA.exec(params.get('via') ?? '');
  if (via) rememberJoinedVia(`${via[1]}:${via[2]}`);
  const ambassador = AMBASSADOR.exec(params.get('ambassador') ?? '');
  if (ambassador) rememberAmbassador(`${ambassador[1]}:${ambassador[2]}`);
}
