/**
 * A Shop Partner's orders, and reaching their Runner (ruling 97, 5 November 2026). Kept apart
 * from lib/api.ts so it can be read in one go; it uses the same `request`, with the business
 * sign-in. Nothing here ever carries a Shopper's name or anybody's telephone number.
 */

import { businessToken, request, type CallJoin } from './api';

export type PartnerOrderStatus =
  | 'paid'
  | 'offered'
  | 'accepted'
  | 'shopping'
  | 'receipt_submitted'
  | 'delivering'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface PartnerOrderLine {
  id: string;
  name: string;
  quantity: number;
  /** What the Runner pays the shop for one, at its counter. */
  runnerPaysPence: number;
}

export interface PartnerOrderMessageRow {
  id: string;
  kind: string;
  words: string;
  at: string;
}

export interface PartnerOrderRow {
  id: string;
  /** "OZ-ABC123": the same reference the Runner and the Shopper use. */
  reference: string;
  status: PartnerOrderStatus;
  statusWords: string;
  active: boolean;
  waiting: boolean;
  placedAt: string;
  acceptedAt: string | null;
  deliveringAt: string | null;
  deliveredAt: string | null;
  readyAt: string | null;
  /** The Runner, by first name and Runner ID only. Null until one has it. */
  runner: { firstName: string; runnerId: string } | null;
  /** In the shop (true), on the way (false), or not known (null). */
  runnerAtShop: boolean | null;
  lines: PartnerOrderLine[];
  messages: PartnerOrderMessageRow[];
  canReady: boolean;
  canMessage: boolean;
  canCall: boolean;
}

export interface PartnerOrdersPage {
  shop: {
    id: string;
    name: string;
    publicId: string | null;
    /** On a paid package: calls to the Runner come with it. */
    paidPlan: boolean;
    /** Said beside a disabled call button on the free listing, or null. */
    callWords: string | null;
  };
  messageKinds: Array<{ kind: string; words: string }>;
  active: PartnerOrderRow[];
  recent: PartnerOrderRow[];
  page: number;
  pages: number;
  total: number;
  historyDays: number;
}

function partnerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, headers: { 'x-business-token': businessToken() } });
}

export function fetchPartnerOrders(page = 1): Promise<PartnerOrdersPage> {
  return partnerRequest(`/partner/orders?page=${page}`);
}

export function fetchPartnerOrder(id: string): Promise<{ order: PartnerOrderRow }> {
  return partnerRequest(`/partner/orders/${encodeURIComponent(id)}`);
}

export interface PartnerOrderAnswer {
  order: PartnerOrderRow;
  message: string;
  told: 'push' | 'text' | 'none' | 'already';
}

/** "Ready for pickup": once per order. */
export function markPartnerOrderReady(id: string): Promise<PartnerOrderAnswer> {
  return partnerRequest(`/partner/orders/${encodeURIComponent(id)}/ready`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** One of the set messages, by its kind. Never free text. */
export function sendPartnerMessage(id: string, kind: string): Promise<PartnerOrderAnswer> {
  return partnerRequest(`/partner/orders/${encodeURIComponent(id)}/message`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
}

export interface PartnerCallInfo {
  id: string;
  orderId: string;
  status: 'ringing' | 'live' | 'ended';
  startedBy: 'shopper' | 'runner' | 'partner';
  free: boolean;
  words: string | null;
}

/** Start a call to the Runner (paid packages), or rejoin the one this shop started. */
export function startPartnerCall(
  orderId: string,
): Promise<{ call: PartnerCallInfo; join: CallJoin }> {
  return partnerRequest(`/partner/orders/${encodeURIComponent(orderId)}/calls`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function fetchPartnerCurrentCall(
  orderId: string,
): Promise<{ call: PartnerCallInfo | null }> {
  return partnerRequest(`/partner/orders/${encodeURIComponent(orderId)}/calls/current`);
}

export function endPartnerCall(callId: string): Promise<{ call: PartnerCallInfo }> {
  return partnerRequest(`/partner/calls/${encodeURIComponent(callId)}/end`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
