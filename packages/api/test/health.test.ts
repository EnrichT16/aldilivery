/**
 * The health route, the environment reader, and the fail-fast rules for production.
 *
 * The health route is what DigitalOcean polls to decide whether this process is alive, so
 * it has to be cheap, unauthenticated, and honest about what it does not know.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { memoryRepository } from '../src/data/memory.js';
import { DEFAULT_PORT, readEnv } from '../src/env.js';
import { resolveGitCommit } from '../src/lib/version.js';
import { rehearsalGateway } from '../src/lib/payments.js';
import { loadStoreConfig } from '@aldilivery/core/node';

import { buildTestApp, testEnv, type TestHarness } from './helpers.js';

/**
 * A bare production environment with every secret filled in. Individual tests take one
 * value away to prove the server refuses to start without it.
 */
function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pw@db.example.com:25060/aldilivery?sslmode=require',
    STRIPE_SECRET_KEY: 'sk_live_realish',
    STRIPE_WEBHOOK_SECRET: 'whsec_realish',
    AUTH_TOKEN_SECRET: 'a-long-random-value-fit-for-signing-sessions',
    ALLOWED_ORIGIN: 'https://aldilivery.example.com',
    ...overrides,
  };
}

describe('GET /health', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildTestApp();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('answers ok without a token', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('carries the commit, and says null rather than guessing when it does not know', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });

    // The harness pins the commit to null, which is the shape a machine with no git
    // checkout and no build stamp would produce.
    expect(response.json()).toHaveProperty('commit', null);
  });

  it('reports the commit it was built from when one is known', async () => {
    const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const app = await buildApp({
      config: loadStoreConfig(),
      repository: memoryRepository(),
      payments: rehearsalGateway(),
      env: testEnv,
      gitCommit: commit,
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toMatchObject({ status: 'ok', commit });

    await app.close();
  });
});

describe('resolveGitCommit', () => {
  it('reads the commit a platform put in the environment', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';
    expect(resolveGitCommit({ GIT_COMMIT: commit } as NodeJS.ProcessEnv)).toBe(commit);
  });

  it('ignores a variable that is not a commit at all', () => {
    // An empty or templated value is worse than nothing, because it looks like an answer.
    expect(resolveGitCommit({ GIT_COMMIT: '${COMMIT}' } as NodeJS.ProcessEnv)).not.toBe(
      '${COMMIT}',
    );
  });
});

describe('the environment reader', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('listens on 0.0.0.0 and port 8080 when nothing says otherwise', () => {
    const env = readEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);

    expect(env.host).toBe('0.0.0.0');
    expect(env.port).toBe(DEFAULT_PORT);
    expect(env.port).toBe(8080);
  });

  it('prefers the platform PORT over anything else', () => {
    const env = readEnv({ PORT: '9999', API_PORT: '3001' } as NodeJS.ProcessEnv);
    expect(env.port).toBe(9999);
  });

  it('uses the Prisma backend when DATABASE_URL is present', () => {
    const env = readEnv(productionEnv());
    expect(env.dataBackend).toBe('postgres');
  });

  it('falls back to the in-memory store, with its warning, when DATABASE_URL is absent', () => {
    const env = readEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(env.dataBackend).toBe('memory');
    expect(env.databaseUrl).toBeUndefined();
  });

  it('treats a placeholder DATABASE_URL as no database at all', () => {
    const env = readEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://aldilivery:change_me_locally@localhost:5433/aldilivery',
    } as NodeJS.ProcessEnv);
    expect(env.dataBackend).toBe('memory');
  });

  it('restricts CORS to ALLOWED_ORIGIN', () => {
    const env = readEnv({ ALLOWED_ORIGIN: 'https://aldilivery.example.com' } as NodeJS.ProcessEnv);
    expect(env.allowedOrigins).toEqual(['https://aldilivery.example.com']);
  });

  it('accepts more than one allowed origin, and forgives a trailing slash', () => {
    const env = readEnv({
      ALLOWED_ORIGIN: 'https://a.example.com/, https://b.example.com',
    } as NodeJS.ProcessEnv);
    expect(env.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('falls back to the local web address in development', () => {
    const env = readEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(env.allowedOrigins).toEqual(['http://localhost:5173']);
  });
});

describe('production refuses to start without its secrets', () => {
  it('starts when everything is present', () => {
    expect(() => readEnv(productionEnv())).not.toThrow();
  });

  it('refuses without STRIPE_SECRET_KEY, and says so plainly', () => {
    expect(() => readEnv(productionEnv({ STRIPE_SECRET_KEY: undefined }))).toThrow(
      /STRIPE_SECRET_KEY is missing/,
    );
  });

  it('refuses on a placeholder STRIPE_SECRET_KEY', () => {
    expect(() =>
      readEnv(productionEnv({ STRIPE_SECRET_KEY: 'sk_test_placeholder_do_not_use' })),
    ).toThrow(/STRIPE_SECRET_KEY is missing/);
  });

  it('refuses without STRIPE_WEBHOOK_SECRET', () => {
    expect(() => readEnv(productionEnv({ STRIPE_WEBHOOK_SECRET: undefined }))).toThrow(
      /STRIPE_WEBHOOK_SECRET is missing/,
    );
  });

  it('refuses without DATABASE_URL rather than losing every order in memory', () => {
    expect(() => readEnv(productionEnv({ DATABASE_URL: undefined }))).toThrow(
      /DATABASE_URL is missing/,
    );
  });

  it('refuses on a placeholder AUTH_TOKEN_SECRET', () => {
    expect(() =>
      readEnv(productionEnv({ AUTH_TOKEN_SECRET: 'replace_with_a_long_random_value' })),
    ).toThrow(/AUTH_TOKEN_SECRET/);
  });
});
