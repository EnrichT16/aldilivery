/**
 * The quick protections from the security proposal (ruling 44): security headers on every
 * reply, and a limit on sign-in tries from one internet address.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp, type TestHarness } from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await buildTestApp(new Date('2026-10-07T10:00:00.000Z'));
});

afterEach(async () => {
  await harness.close();
});

describe('security headers', () => {
  it('are on every reply, at the root and under /api', async () => {
    for (const url of ['/health', '/api/health']) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    }
  });
});

describe('sign-in tries from one address', () => {
  it('are limited, per address, and the limit lifts after ten minutes', async () => {
    const attempt = (ip: string) =>
      harness.app.inject({
        method: 'POST',
        url: '/api/staff/sign-in',
        payload: { username: 'nobody', password: 'wrong password' },
        headers: { 'do-connecting-ip': ip },
      });
    for (let i = 0; i < 30; i += 1) expect((await attempt('203.0.113.9')).statusCode).toBe(401);
    const blocked = await attempt('203.0.113.9');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.message).toMatch(/wait ten minutes/);
    // Somebody else, somewhere else, is not affected.
    expect((await attempt('198.51.100.7')).statusCode).toBe(401);

    harness.setNow(new Date(harness.now().getTime() + 10 * 60 * 1000));
    expect((await attempt('203.0.113.9')).statusCode).toBe(401);
  });
});
