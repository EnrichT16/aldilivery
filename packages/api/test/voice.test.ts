/**
 * The pass to Oluoma Voice (ruling 53): the app gets a five-minute token, never the engine's
 * key, and `{ enabled: false }` whenever there is no engine to talk to, so the phone's own
 * speech carries on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readEnv } from '../src/env.js';
import { oluomaVoice, type VoiceEngineLink } from '../src/lib/oluoma-voice.js';

import { buildTestApp, type TestHarness } from './helpers.js';

const KEY = 'ov_test_key_that_must_never_be_seen';

let harness: TestHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** The engine, answering session-tokens as the real one does. */
function fakeEngineFetch(answer: () => Response | Promise<Response>) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GET /voice/session', () => {
  it('says not enabled when the engine is not set up', async () => {
    harness = await buildTestApp();
    for (const url of ['/voice/session', '/api/voice/session']) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ enabled: false });
    }
  });

  it('swaps the key for a five-minute token, and never gives out the key', async () => {
    const send = fakeEngineFetch(() =>
      json({ token: 'ovs_short_lived', expires_at: 1_791_374_700 }),
    );
    harness = await buildTestApp(undefined, {
      voice: oluomaVoice({ url: 'https://voice.example.test/', key: KEY, fetch: send }),
    });

    const response = await harness.app.inject({ method: 'GET', url: '/api/voice/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      url: 'https://voice.example.test',
      token: 'ovs_short_lived',
      expiresAt: new Date(1_791_374_700 * 1000).toISOString(),
    });
    expect(response.body).not.toContain(KEY);

    // The engine was asked properly: the key as the bearer, for five minutes.
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0]!;
    expect(String(url)).toBe('https://voice.example.test/v1/session-tokens');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init?.body))).toEqual({ ttl_seconds: 300 });
  });

  it('says not enabled when the engine refuses, or cannot be reached', async () => {
    const answers: Array<() => Response> = [
      () => json({ error: { kind: 'unauthorised', message: 'No.' } }, 401),
      () => json({ token: '' }),
      () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const answer of answers) {
      harness = await buildTestApp(undefined, {
        voice: oluomaVoice({
          url: 'https://voice.example.test',
          key: KEY,
          fetch: fakeEngineFetch(answer),
        }),
      });
      const response = await harness.app.inject({ method: 'GET', url: '/voice/session' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ enabled: false });
      expect(response.body).not.toContain(KEY);
      await harness.close();
      harness = undefined;
    }
  });

  it('is limited per internet address', async () => {
    let issued = 0;
    const voice: VoiceEngineLink = {
      url: 'https://voice.example.test',
      issueToken: async () => {
        issued += 1;
        return { token: `t${issued}`, expiresAt: '2026-10-07T10:05:00.000Z' };
      },
    };
    harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'), { voice });
    const ask = (ip: string) =>
      harness!.app.inject({
        method: 'GET',
        url: '/api/voice/session',
        headers: { 'do-connecting-ip': ip },
      });
    for (let i = 0; i < 60; i += 1) expect((await ask('203.0.113.9')).statusCode).toBe(200);
    expect((await ask('203.0.113.9')).statusCode).toBe(429);
    expect(issued).toBe(60);
    // Somebody else is not affected, and the limit lifts after ten minutes.
    expect((await ask('198.51.100.7')).statusCode).toBe(200);
    harness.setNow(new Date(harness.now().getTime() + 10 * 60 * 1000));
    expect((await ask('203.0.113.9')).statusCode).toBe(200);
  });
});

describe('the health route', () => {
  it('says whether Oluoma Voice is set up, without asking it', async () => {
    harness = await buildTestApp();
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().voiceEnabled).toBe(
      false,
    );
    await harness.close();

    const issueToken = vi.fn();
    harness = await buildTestApp(undefined, {
      voice: { url: 'https://voice.example.test', issueToken },
    });
    expect((await harness.app.inject({ method: 'GET', url: '/health' })).json().voiceEnabled).toBe(
      true,
    );
    expect(issueToken).not.toHaveBeenCalled();
  });
});

describe('the Oluoma Voice settings', () => {
  it('are read from the environment, and a placeholder counts as none', () => {
    const set = readEnv({
      NODE_ENV: 'test',
      OLUOMA_VOICE_URL: 'https://voice.example.test',
      OLUOMA_VOICE_KEY: KEY,
    });
    expect(set.oluomaVoiceUrl).toBe('https://voice.example.test');
    expect(set.oluomaVoiceKey).toBe(KEY);

    const unset = readEnv({ NODE_ENV: 'test', OLUOMA_VOICE_KEY: 'replace_with_your_key' });
    expect(unset.oluomaVoiceUrl).toBeUndefined();
    expect(unset.oluomaVoiceKey).toBeUndefined();
  });
});
