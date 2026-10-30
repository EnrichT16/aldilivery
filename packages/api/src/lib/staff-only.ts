/**
 * What only staff may see of a partner's terms (Anthony, 30 October 2026): the price each thing
 * cost at the partner's own till, what the Runner pays for it at the counter, and the discount
 * and mark-up percentages a partner agreed with us. A Shopper, a family member paying, an
 * organisation, a partner looking at its listing, or anybody else is never sent them, in any
 * response: order details, past orders, the order page, receipts, shop pages, the catalogue.
 *
 * One hook takes them out of every response before it is written, so a new route cannot forget.
 * Staff (the admin panel, which checks who is asking) are sent everything. The Runner on a job is
 * told the counter amount by the job's own words and figures (`tillExpectedPence`), which carry
 * other names, so they still see what to pay.
 */

import type { FastifyRequest } from 'fastify';

/** The fields only staff are sent. */
export const STAFF_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'shopPricePence',
  'counterPricePence',
  'counterPence',
  'restaurantDiscountPercent',
  'agreedDiscountPercent',
  'agreedMarkupPercent',
]);

function plain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** A copy of the value with every staff-only field taken out, however deep. */
export function withoutStaffOnlyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutStaffOnlyFields);
  if (value === null || typeof value !== 'object' || !plain(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (STAFF_ONLY_FIELDS.has(key)) continue;
    kept[key] = withoutStaffOnlyFields(inner);
  }
  return kept;
}

/** Whether staff are asking: the admin panel's routes, or a request staff were checked on. */
export function askedByStaff(request: FastifyRequest): boolean {
  if (request.staffActor) return true;
  const path = (request.routeOptions.url ?? request.url.split('?')[0] ?? '').replace(
    /^\/api(?=\/)/,
    '',
  );
  return path.startsWith('/staff/') || path === '/staff';
}
