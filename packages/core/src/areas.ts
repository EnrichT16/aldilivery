/**
 * Areas (Anthony, 30 October 2026). Ozi runs across the whole UK, area by area, and any area can
 * start first. An area is a UK postcode area, the leading letters of a postcode: M for
 * Manchester, ME for Medway, AB for Aberdeen. The London postcode areas are one area, "London".
 * The names and the groups live in `areas` in `config/store.json`, never here; an area the
 * names do not know is called by its letters.
 *
 * The pure rules live here: finding a postcode in an address, its area, and the area's name.
 * Whether an area is running (a Runner, a shop, not paused) is the server's to say.
 */

import { postcodeArea } from './partners.js';

export interface AreaSettings {
  /** What each area is called: "M" is "Manchester". An area missing here is called by its letters. */
  readonly names: Readonly<Record<string, string>>;
  /** Areas run as one: "London" is E, EC, N, NW, SE, SW, W and WC. The key is the area's code. */
  readonly groups: Readonly<Record<string, readonly string[]>>;
  /** What a Shopper in an area that is running is told when they ask. {area} is its name. */
  readonly runningWords: string;
  /** What a Shopper in an area that is not running yet is told, before paying. */
  readonly notRunningWords: string;
  /** The text the waiting list gets, once, when their area starts. {area} is its name. */
  readonly startedWords: string;
  /** No waiting-list texts between these times (UK time), so nobody is woken. */
  readonly textQuietFrom: string;
  readonly textQuietUntil: string;
  /** A Runner's live position older than this is not trusted; their home postcode is used. */
  readonly livePositionMinutes: number;
  /** How often the Runner app shares where they are while on shift, in seconds. */
  readonly shareOnShiftSeconds: number;
  /** How often, at most, while they have a job in hand, in seconds. */
  readonly shareOnJobSeconds: number;
}

const POSTCODE_IN_TEXT = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/**
 * The full postcode in an address, tidied ("me7 1aa" gives "ME7 1AA"), or '' when there is none.
 * The last one wins, because an address ends with its postcode.
 */
export function postcodeIn(text: string): string {
  const all = [...text.toUpperCase().matchAll(new RegExp(POSTCODE_IN_TEXT.source, 'gi'))];
  const last = all[all.length - 1];
  return last ? `${last[1]} ${last[2]}` : '';
}

/** A postcode tidied to capitals with one space ("me71aa" gives "ME7 1AA"), or '' if it is not one. */
export function tidyPostcode(postcode: string): string {
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/.exec(postcode.toUpperCase().trim());
  return match ? `${match[1]} ${match[2]}` : '';
}

/**
 * The area of a postcode, a postcode district or an address: its leading letters, or the group
 * they belong to ("SE1 7PB" gives "London"). Null when there is no postcode to go by.
 */
export function areaOf(text: string, settings: Pick<AreaSettings, 'groups'>): string | null {
  const postcode = postcodeIn(text) || text.trim();
  const district = postcodeArea(postcode);
  const letters = /^([A-Z]{1,2})\d/.exec(district)?.[1];
  if (!letters) return null;
  for (const [group, members] of Object.entries(settings.groups)) {
    if (members.includes(letters)) return group;
  }
  return letters;
}

/** What an area is called: its configured name, or its letters when it has none. */
export function areaName(area: string, settings: Pick<AreaSettings, 'names'>): string {
  return settings.names[area] ?? area;
}
