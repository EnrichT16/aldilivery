import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../src/core/types.js';
import { checkOnce, currentWatch, runWatchman } from '../src/helpers/watchman/watchman.js';
import { appHarness, harness } from './support.js';

/** A pretend internet: each address answers as told. */
function sites(answers: Record<string, () => Response | Promise<Response>>): FetchLike {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const answer = answers[url];
    if (!answer) throw new Error('getaddrinfo ENOTFOUND');
    return answer();
  };
}

const healthy = {
  'https://example.com': () => new Response('<h1>Welcome</h1>'),
  'https://api.example.com/health': () => Response.json({ status: 'ok' }),
};

describe('one check', () => {
  it('passes a working page and a healthy health address', async () => {
    const { runtime } = harness({ fetch: sites(healthy) });
    expect((await checkOnce(runtime, { name: 'site', url: 'https://example.com', expectText: 'Welcome' })).ok).toBe(true);
    expect((await checkOnce(runtime, { name: 'api', url: 'https://api.example.com/health', expectJson: { status: 'ok' } })).ok).toBe(true);
  });

  it('describes each kind of problem in plain English', async () => {
    const { runtime } = harness({
      fetch: sites({
        'https://a.example': () => new Response('oops', { status: 503 }),
        'https://b.example': () => new Response('<h1>Maintenance</h1>'),
        'https://c.example': () => Response.json({ status: 'degraded' }),
      }),
    });
    const problem = async (url: string, extra = {}) => (await checkOnce(runtime, { name: 'x', url, ...extra })).problem;
    expect(await problem('https://a.example')).toBe('answered with error 503');
    expect(await problem('https://b.example', { expectText: 'Welcome' })).toBe('answered, but the page did not say "Welcome"');
    expect(await problem('https://c.example', { expectJson: { status: 'ok' } })).toBe('says status is "degraded" instead of "ok"');
    expect(await problem('https://gone.example')).toBe('could not be reached (getaddrinfo ENOTFOUND)');
  });

  it('notices a slow site, and one that never answers', async () => {
    let tick = 0;
    const clock = () => (tick += 3_000);
    const { runtime } = harness({ fetch: sites(healthy) });
    expect((await checkOnce(runtime, { name: 's', url: 'https://example.com', slowMs: 2_000 }, clock)).problem).toBe('is slow: it took 3.0 seconds');

    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const { runtime: stuck } = harness({ fetch: hanging });
    expect((await checkOnce(stuck, { name: 's', url: 'https://example.com', timeoutMs: 20 })).problem).toBe('did not answer within 0.0 seconds');
  });
});

describe('the Watchman', () => {
  it('ignores one blip, texts Anthony once after two failures, and again when it is fixed', async () => {
    let apiUp = true;
    const fetcher = sites({
      ...healthy,
      'https://api.example.com/health': () => (apiUp ? Response.json({ status: 'ok' }) : new Response('down', { status: 502 })),
    });
    const { runtime, sms, now } = harness({ fetch: fetcher });

    expect(await runWatchman(runtime)).toBe('all 2 working');

    apiUp = false;
    await runWatchman(runtime);
    expect(sms.sentForReal).toHaveLength(0); // one blip is ignored

    now.value = new Date('2026-10-07T09:05:00Z');
    expect(await runWatchman(runtime)).toBe('the app server answered with error 502');
    expect(sms.sentForReal.map((t) => t.text)).toEqual([
      'Anthony, the app server answered with error 502. It has failed 2 checks in a row. From the Watchman.',
    ]);

    now.value = new Date('2026-10-07T09:10:00Z');
    await runWatchman(runtime);
    expect(sms.sentForReal).toHaveLength(1); // not again

    apiUp = true;
    now.value = new Date('2026-10-07T09:40:00Z');
    await runWatchman(runtime);
    expect(sms.sentForReal[1]!.text).toBe('Good news, Anthony: the app server is working again after 40 minutes.');

    const log = (await runtime.records.recentLog()).map((e) => e.event);
    expect(log.filter((e) => e === 'watch.down')).toHaveLength(1);
    expect(log.filter((e) => e === 'watch.recovered')).toHaveLength(1);
    expect((await currentWatch(runtime)).every((c) => c.state === null || c.state.status === 'up')).toBe(true);
  });

  it('runs on its timer and on demand', async () => {
    const { app } = appHarness({ fetch: sites(healthy) });
    expect(await app.scheduled(new Date('2026-10-07T09:05:00Z'))).toEqual(['watchman: all 2 working']);
    expect(await app.scheduled(new Date('2026-10-07T09:06:00Z'))).toEqual([]);
    expect(await app.scheduled(new Date(), '*/5 * * * *')).toEqual(['watchman: all 2 working']);
    expect(await app.tasks.watchman!()).toBe('all 2 working');
  });

  it('checks nothing without permission', async () => {
    const { runtime } = harness({ fetch: sites(healthy) });
    runtime.helper('watchman')!.config.permissions = [];
    expect(await runWatchman(runtime)).toBe('nothing was checked');
  });
});
