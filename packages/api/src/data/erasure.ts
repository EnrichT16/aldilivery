/**
 * What is left of an account, and of an order, once the privacy page says the personal parts
 * must go (docs/LEGAL_REVIEW.md, the account closing and retention jobs). Both backends use
 * these, so a removed account looks the same whichever database holds it.
 */

import type { Order, Shopper } from '../domain.js';

/**
 * What a removed account keeps: nothing that says who it was. The phone number and handle must
 * stay unique, so each becomes a marker made from the account's own id.
 */
export function erasedShopperPatch(shopperId: string, at: Date): Partial<Shopper> {
  return {
    displayName: 'Closed account',
    handle: `closed-${shopperId}`,
    phone: `closed:${shopperId}`,
    spokenCodeHash: null,
    stripeCustomerId: null,
    pinHash: null,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    doorstepProtocol: '',
    deliveryAddress: '',
    budgetCapPence: null,
    familyCode: null,
    familyOwnerId: null,
    organisationId: null,
    organisationOffice: null,
    ageBand: null,
    joinedVia: null,
    deletionScheduledFor: null,
    erasedAt: at,
  };
}

/** What an order keeps once anonymised: the money, not where it went or what the door needed. */
export function erasedOrderPatch(at: Date): Partial<Order> {
  return {
    deliveryAddress: '',
    latitude: null,
    longitude: null,
    doorstepProtocolSnapshot: '',
    anonymisedAt: at,
  };
}
