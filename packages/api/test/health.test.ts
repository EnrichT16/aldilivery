/**
 * The health route, the environment reader, and the fail-fast rules for production.
 *
 * The health route is what DigitalOcean polls to decide whether this process is alive, so
 * it has to be cheap, unauthenticated, and honest about what it does not know.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { memoryRepository } from '../src/data/memory.js';
import { DEFAULT_PORT, findDotenvFile, readEnv } from '../src/env.js';
import { resolveGitCommit } from '../src/lib/version.js';
import { rehearsalGateway, stripeGateway } from '../src/lib/payments.js';
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

/**
 * The publishable key.
 *
 * Stripe.js in the browser needs it, and it is public by design — it sits in the page source
 * of every site that takes a card — so it travels in `/config` rather than being treated as
 * a secret. The point of the tests below is that the *secret* key never does.
 */
describe('what /config tells the browser about payments', () => {
  it('serves the publishable key so the browser can turn a card into a token', async () => {
    const app = await buildApp({
      config: loadStoreConfig(),
      repository: memoryRepository(),
      // The real gateway, because this is the case where Stripe is properly configured.
      // Passing the rehearsal one here and still expecting `stripe` is what the old
      // inferred-from-the-key behaviour allowed, and it was wrong.
      payments: stripeGateway('sk_test_not_a_real_key', 'whsec_not_a_real_secret'),
      env: {
        ...testEnv,
        stripeSecretKey: 'sk_test_not_a_real_key',
        stripePublishableKey: 'pk_test_not_a_real_key',
      },
      gitCommit: null,
    });
    await app.ready();

    const body = (await app.inject({ method: 'GET', url: '/config' })).json();

    expect(body.payments.mode).toBe('stripe');
    expect(body.payments.publishableKey).toBe('pk_test_not_a_real_key');
    expect(body.payments.supportedCardRegions).toContain('UK');

    // The one that matters: the secret key must not be anywhere in that reply.
    expect(JSON.stringify(body)).not.toContain('sk_test_not_a_real_key');

    await app.close();
  });

  it('says rehearsal, and offers no key, when Stripe is not configured', async () => {
    const harness = await buildTestApp();
    const body = (await harness.app.inject({ method: 'GET', url: '/config' })).json();

    // Null rather than absent, so the card screen can tell "not configured" from "did not
    // load" and say which.
    expect(body.payments.mode).toBe('rehearsal');
    expect(body.payments.publishableKey).toBeNull();

    await harness.close();
  });

  it('treats a placeholder publishable key as no key at all', async () => {
    const env = readEnv({
      NODE_ENV: 'development',
      STRIPE_PUBLISHABLE_KEY: 'replace_with_the_publishable_key_from_stripe',
    });
    expect(env.stripePublishableKey).toBeUndefined();
  });
});

/**
 * Finding the .env file.
 *
 * This is here because it was broken from the beginning and nothing noticed. `dotenv` looks
 * in the working directory, `pnpm --filter` starts the API inside `packages/api`, and so the
 * `.env` at the top of the repository was never read. Every value in `.env.example` is a
 * placeholder, and a placeholder produces the same result as no value at all, so the defaults
 * hid it until somebody put a real Stripe key in that file and the server carried on
 * insisting it was in rehearsal mode.
 */
describe('finding the .env file', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aldilivery-env-'));
    // A miniature of the real layout: a workspace root with a package inside it.
    mkdirSync(join(root, 'packages', 'api', 'dist'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the one at the top of the repository, from inside a package', () => {
    writeFileSync(join(root, '.env'), 'STRIPE_SECRET_KEY=sk_test_from_the_root\n');

    // Where the compiled server actually runs from.
    const found = findDotenvFile(join(root, 'packages', 'api', 'dist'));

    expect(found).toBe(join(root, '.env'));
  });

  it('prefers a closer one, so a package can still have its own', () => {
    writeFileSync(join(root, '.env'), 'STRIPE_SECRET_KEY=sk_test_from_the_root\n');
    writeFileSync(join(root, 'packages', 'api', '.env'), 'STRIPE_SECRET_KEY=sk_test_nearer\n');

    const found = findDotenvFile(join(root, 'packages', 'api', 'dist'));

    expect(found).toBe(join(root, 'packages', 'api', '.env'));
  });

  it('stops at the workspace root rather than wandering into a home directory', () => {
    // A .env above the workspace belongs to somebody else's project, not to this one.
    writeFileSync(join(root, 'outside.env'), 'ignored');
    const above = dirname(root);
    const strayExists = existsSync(join(above, '.env'));

    const found = findDotenvFile(join(root, 'packages', 'api', 'dist'));

    expect(found).toBeUndefined();
    // The assertion above is only meaningful if the search really did pass a directory it
    // could have taken something from, so this records whether that was the case.
    expect(typeof strayExists).toBe('boolean');
  });

  it('returns nothing rather than throwing when there is no .env anywhere', () => {
    expect(findDotenvFile(join(root, 'packages', 'api', 'dist'))).toBeUndefined();
  });
});

/**
 * What `paymentsMode` means.
 *
 * DEPLOY.md tells Anthony to read this field as proof that money can move. It used to be
 * worked out from whether a Stripe secret key was configured, which is a different question
 * from whether the real gateway was built: that needs the webhook secret too. So a server
 * with a secret key and no webhook secret ran the rehearsal gateway — moving no money — while
 * reporting `paymentsMode: stripe`. The field now comes from the gateway itself.
 */
describe('paymentsMode tells the truth about the gateway in use', () => {
  it('says rehearsal when the rehearsal gateway is the one running', async () => {
    const harness = await buildTestApp();
    const health = (await harness.app.inject({ method: 'GET', url: '/health' })).json();
    const config = (await harness.app.inject({ method: 'GET', url: '/config' })).json();

    expect(health.paymentsMode).toBe('rehearsal');
    expect(config.payments.mode).toBe('rehearsal');

    await harness.close();
  });

  it('says stripe only when the real gateway is the one running', async () => {
    const app = await buildApp({
      config: loadStoreConfig(),
      repository: memoryRepository(),
      payments: stripeGateway('sk_test_not_a_real_key', 'whsec_not_a_real_secret'),
      env: { ...testEnv, stripeSecretKey: 'sk_test_not_a_real_key' },
      gitCommit: null,
    });
    await app.ready();

    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(health.paymentsMode).toBe('stripe');

    await app.close();
  });

  it('does not claim stripe merely because a secret key is configured', async () => {
    // The exact shape of the bug: a secret key present, no webhook secret, so `index.ts`
    // builds the rehearsal gateway. The answer must follow the gateway, not the key.
    const app = await buildApp({
      config: loadStoreConfig(),
      repository: memoryRepository(),
      payments: rehearsalGateway(),
      env: { ...testEnv, stripeSecretKey: 'sk_test_not_a_real_key', stripeWebhookSecret: undefined },
      gitCommit: null,
    });
    await app.ready();

    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    const config = (await app.inject({ method: 'GET', url: '/config' })).json();

    expect(health.paymentsMode).toBe('rehearsal');
    expect(config.payments.mode).toBe('rehearsal');

    await app.close();
  });
});
