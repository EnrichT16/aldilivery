/**
 * Who is signed in to the admin panel, and roughly where (ruling 85, Anthony, 31 October 2026).
 *
 * Each sign-in, and each spell of activity (at most one every few minutes for each account and
 * internet address), leaves a sighting: a keyed one-way code of the internet address, never the
 * address itself; the kind of device; and an approximate place, only from a header the hosting
 * platform itself adds (Cloudflare's `cf-ipcountry` and `cf-ipcity`, and the like). No geo-IP
 * service is ever asked, paid or free. No header, and the place is simply not known.
 *
 * A header can be added by anyone where the platform does not overwrite it, so the place is a
 * guide, never proof.
 */

import { createHmac } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import type { StaffSighting } from '../domain.js';

/** At most one activity sighting this often for each account and address. */
export const SIGHTING_EVERY_MS = 5 * 60_000;

/** Headers platforms add with the visitor's country, as a two-letter code. */
const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'x-appengine-country',
  'x-country-code',
];
/** Headers platforms add with the visitor's town, where they offer one. */
const TOWN_HEADERS = [
  'cf-ipcity',
  'x-vercel-ip-city',
  'cloudfront-viewer-city',
  'x-appengine-city',
];

function header(request: Pick<FastifyRequest, 'headers'>, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() !== '' ? first.trim() : undefined;
}

/** A place name fit to show and say: letters, spaces and a few marks, short. */
function tidyName(raw: string): string | null {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Not encoded: as it is.
  }
  const clean = text
    .replace(/[^\p{L}\p{M} .'’-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return clean === '' ? null : clean;
}

function countryName(code: string): string | null {
  const upper = code.trim().toUpperCase();
  // XX and ZZ mean unknown; T1 is the Tor network: no country at all.
  if (!/^[A-Z]{2}$/.test(upper) || ['XX', 'ZZ', 'T1'].includes(upper)) return null;
  try {
    const name = new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(upper);
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}

/** The approximate place the platform's headers give: "Leeds, United Kingdom", or null. */
export function placeFrom(request: Pick<FastifyRequest, 'headers'>): string | null {
  const countryCode = COUNTRY_HEADERS.map((name) => header(request, name)).find(Boolean);
  const townRaw = TOWN_HEADERS.map((name) => header(request, name)).find(Boolean);
  const country = countryCode ? countryName(countryCode) : null;
  const town = townRaw ? tidyName(townRaw) : null;
  if (town && country) return `${town}, ${country}`;
  return town ?? country;
}

/** What kind of device, from the user agent: phone, tablet, computer or other. */
export function userAgentKind(agent: string | undefined): StaffSighting['userAgentKind'] {
  const text = (agent ?? '').toLowerCase();
  if (text === '') return 'other';
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/.test(text)) return 'tablet';
  if (/iphone|ipod|mobile|android|blackberry|opera mini|iemobile/.test(text)) return 'phone';
  if (/windows|macintosh|mac os x|linux|cros|x11/.test(text)) return 'computer';
  return 'other';
}

/** A keyed one-way code of an internet address: two sightings can be matched, nothing more. */
export function ipHash(secret: string, ip: string): string {
  return createHmac('sha256', `staff-sighting:${secret}`)
    .update(ip)
    .digest('base64url')
    .slice(0, 22);
}

const lastNoted = new WeakMap<object, Map<string, number>>();

/**
 * Notes a sighting of this account. A sign-in is always noted; activity at most once every
 * `SIGHTING_EVERY_MS` for each account and address. Never throws: what was asked carries on.
 */
export async function noteStaffSighting(
  request: FastifyRequest,
  staffId: string,
  event: StaffSighting['event'],
): Promise<void> {
  const { repository, env, now } = request.server.ctx;
  const at = now();
  const hash = ipHash(env.authTokenSecret, request.ip ?? '');
  let seen = lastNoted.get(repository);
  if (!seen) {
    seen = new Map();
    lastNoted.set(repository, seen);
  }
  const key = `${staffId} ${hash}`;
  const last = seen.get(key);
  if (event === 'activity' && last !== undefined && at.getTime() - last < SIGHTING_EVERY_MS) {
    return;
  }
  seen.set(key, at.getTime());
  if (seen.size > 10_000) seen.clear();
  try {
    await repository.staffSightings.record({
      staffId,
      at,
      event,
      ipHash: hash,
      place: placeFrom(request),
      userAgentKind: userAgentKind(
        Array.isArray(request.headers['user-agent'])
          ? request.headers['user-agent'][0]
          : request.headers['user-agent'],
      ),
    });
  } catch (failure) {
    request.log.warn({ err: failure }, 'A staff sighting could not be noted.');
  }
}
