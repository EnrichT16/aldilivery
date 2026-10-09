/**
 * When the shopping should arrive (docs/BUILD_PROMPT.md, Section G; docs/STILL_TO_DO.md item 6).
 *
 * A simple, honest estimate, always said as "about": a range, never a promise to the minute. It
 * is worked out again each time the order page asks, from where the order has got to and, once
 * the Runner is on the way, from how far they are from the door when the app knows where they
 * are. Nothing here pretends to know traffic or queues at the till.
 *
 * Pure: the time is passed in.
 */

import type { OrderStatus } from '@aldilivery/core';

import type { VehicleType } from '../domain.js';

const MINUTE_MS = 60_000;

/** Finding a Runner, from payment to somebody taking it. */
export const FINDING_MINUTES = 10;
/** Getting to the shop, once taken. */
export const TO_SHOP_MINUTES = 10;
/** Paying and packing, once the till total is in. */
export const PACKING_MINUTES = 5;
/** The trip to the door when where the Runner is, or the door, is not known. */
export const UNKNOWN_TRIP_MINUTES = 15;

/** Average speeds in towns, in miles an hour, with stops. */
const MILES_AN_HOUR: Record<VehicleType, number> = {
  on_foot: 3,
  bicycle: 9,
  motorbike: 15,
  car: 15,
  van: 13,
};
/** Roads are not straight lines. */
const ROAD_FACTOR = 1.3;

export interface EtaInput {
  status: OrderStatus;
  now: Date;
  /** When the Runner took it. */
  acceptedAt: Date | null;
  itemCount: number;
  /** The Runner's way of travelling now, and where they are, if the app knows. */
  travelMode: VehicleType | null;
  runner: { latitude: number | null; longitude: number | null } | null;
  /** The door, if the order has a point for it. */
  door: { latitude: number | null; longitude: number | null };
}

export interface Eta {
  /** The range, from now, in whole minutes. */
  fromMinutes: number;
  toMinutes: number;
  /** The latest time it should be there, for "around 2:35pm". */
  byAt: Date;
  /** "about 20 to 30 minutes", ready to show or say. */
  words: string;
}

/** Shopping time: a base, and a little more for a long list, within reason. */
export function shoppingMinutes(itemCount: number): number {
  return Math.min(45, 15 + Math.max(0, itemCount));
}

function milesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

/** Minutes for the trip to the door, from where the Runner is when that is known. */
export function tripMinutes(input: EtaInput): number {
  const { runner, door, travelMode } = input;
  if (
    runner?.latitude == null ||
    runner.longitude == null ||
    door.latitude === null ||
    door.longitude === null
  ) {
    return UNKNOWN_TRIP_MINUTES;
  }
  const miles =
    milesBetween(
      { latitude: runner.latitude, longitude: runner.longitude },
      { latitude: door.latitude, longitude: door.longitude },
    ) * ROAD_FACTOR;
  const speed = MILES_AN_HOUR[travelMode ?? 'on_foot'];
  return Math.max(2, Math.round((miles / speed) * 60));
}

function minutesSince(from: Date | null, now: Date): number {
  return from ? Math.max(0, (now.getTime() - from.getTime()) / MINUTE_MS) : 0;
}

/** The middle of the estimate, in minutes from now. Null once delivered, or not yet paid. */
export function middleMinutes(input: EtaInput): number | null {
  const shop = shoppingMinutes(input.itemCount);
  const trip = tripMinutes(input);
  switch (input.status) {
    case 'paid':
    case 'offered':
      return FINDING_MINUTES + TO_SHOP_MINUTES + shop + PACKING_MINUTES + trip;
    case 'accepted':
      return (
        Math.max(2, TO_SHOP_MINUTES - minutesSince(input.acceptedAt, input.now)) +
        shop +
        PACKING_MINUTES +
        trip
      );
    case 'shopping': {
      // Shopping starts about when they reach the shop; what is left of it, never less than a
      // few minutes, because the till is still to come.
      const shoppingFor = minutesSince(input.acceptedAt, input.now) - TO_SHOP_MINUTES;
      return Math.max(5, shop - Math.max(0, shoppingFor)) + PACKING_MINUTES + trip;
    }
    case 'receipt_submitted':
      return PACKING_MINUTES + trip;
    case 'delivering':
      return trip;
    default:
      return null;
  }
}

function roundToFive(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** A range around the middle: wider the further off it is, as any honest guess should be. */
export function estimateArrival(input: EtaInput): Eta | null {
  const middle = middleMinutes(input);
  if (middle === null) return null;
  const spread = Math.max(5, middle * 0.2);
  const fromMinutes = Math.max(
    input.status === 'delivering' ? 1 : 5,
    Math.floor((middle - spread) / 5) * 5,
  );
  const toMinutes = Math.max(fromMinutes + 5, roundToFive(middle + spread));
  const byAt = new Date(input.now.getTime() + toMinutes * MINUTE_MS);
  const words =
    fromMinutes <= 5 && toMinutes <= 10
      ? 'about 5 to 10 minutes'
      : `about ${fromMinutes} to ${toMinutes} minutes`;
  return { fromMinutes, toMinutes, byAt, words };
}
