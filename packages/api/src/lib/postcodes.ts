/**
 * Turning a UK postcode into a place (Anthony, 30 October 2026), with postcodes.io: free, run on
 * the official Office for National Statistics postcode list, and needing no key.
 *
 * It is behind this one small function so the tests hand in a stand-in and never reach the
 * network. Asked when a postcode is saved (services/areas.ts keeps the answer), never on every
 * request. Anything slow, unknown or odd is simply no answer: nothing waits for it, and the area
 * still comes from the postcode's letters.
 */

import { z } from 'zod';

const LOOKUP_URL = 'https://api.postcodes.io/postcodes';
/** A sign-up or an order never waits longer than this for it. */
const WAIT_MS = 3_000;

export interface PostcodePoint {
  latitude: number;
  longitude: number;
}

/** A postcode's place, or null when postcodes.io does not know it. Throws when it cannot be asked. */
export type PostcodeLookup = (postcode: string) => Promise<PostcodePoint | null>;

const answerShape = z.object({
  status: z.number(),
  result: z
    .object({ latitude: z.number().nullable(), longitude: z.number().nullable() })
    .nullable()
    .optional(),
});

type Fetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function postcodesIo(fetcher: Fetch = fetch as unknown as Fetch): PostcodeLookup {
  return async (postcode) => {
    const response = await fetcher(`${LOOKUP_URL}/${encodeURIComponent(postcode)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    // A postcode it does not know is an answer: there is no such place.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`postcodes.io answered ${response.status}.`);
    const answer = answerShape.safeParse(await response.json());
    if (!answer.success) throw new Error('postcodes.io answered with something unexpected.');
    const { latitude, longitude } = answer.data.result ?? { latitude: null, longitude: null };
    // Some postcodes (the Channel Islands, a few new ones) are known but have no place yet.
    if (latitude === null || longitude === null) return null;
    return { latitude, longitude };
  };
}
