/**
 * The home-screen app can always tell when it is out of date (20 October 2026): it compares its
 * own build with the server's /version.json.
 */

import { describe, expect, it } from 'vitest';

import { newerBuildOnServer } from '../src/lib/updates';

function server(answer: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => answer })) as unknown as typeof fetch;
}

describe('is there a newer build?', () => {
  it('names the newer build when the server has one', async () => {
    expect(await newerBuildOnServer('old', server({ build: 'new' }))).toBe('new');
  });

  it('says no when this is the newest, the file is missing, or the network is down', async () => {
    expect(await newerBuildOnServer('same', server({ build: 'same' }))).toBeNull();
    expect(await newerBuildOnServer('old', server({}, false))).toBeNull();
    expect(await newerBuildOnServer('old', server({ nothing: true }))).toBeNull();
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await newerBuildOnServer('old', offline)).toBeNull();
  });
});
