/**
 * What is left of an account, and of an order, once the privacy page says the personal parts
 * must go (docs/LEGAL_REVIEW.md, the account closing and retention jobs). Both backends use
 * these, so a removed account looks the same whichever database holds it.
 */

import type { Order, Runner, Shopper } from '../domain.js';

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
    // A closed account is never charged again for a plan.
    planRenews: false,
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

/**
 * What a Runner who left keeps once their days to change their mind are over (ruling 60):
 * nothing that says who they were or where they went. Their pay records stay, as money records,
 * against the same id; the record of their checks stays for two years after they stopped, as the
 * privacy page says. The phone number must stay unique, so it becomes a marker from the id.
 */
export function erasedRunnerPatch(runnerId: string, at: Date): Partial<Runner> {
  return {
    name: 'Closed Runner account',
    phone: `closed:${runnerId}`,
    latitude: null,
    longitude: null,
    available: false,
    issuingTermsAcceptedIp: null,
    insuranceReminderFor: null,
    insuranceReminderDays: null,
    erasedAt: at,
  };
}
