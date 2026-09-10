/**
 * Building a whole, real Aldilivery API for a test.
 *
 * No database, no network, no Stripe account and no wall clock. Everything the application
 * needs is injected, so the tests below prove the rules against the same code that runs in
 * production rather than against a simplified stand-in.
 */

import type { FastifyInstance } from 'fastify';
import { loadStoreConfig } from '@aldilivery/core/node';
import type { StoreConfig } from '@aldilivery/core';

import { buildApp } from '../src/app.js';
import { memoryRepository } from '../src/data/memory.js';
import type { Repository } from '../src/data/repository.js';
import type { Env } from '../src/env.js';
import { rehearsalGateway, type RehearsalGateway } from '../src/lib/payments.js';

export const TEST_SECRET = 'test-secret-that-is-long-enough-for-hmac';

export const testEnv: Env = {
  nodeEnv: 'test',
  isProduction: false,
  host: '127.0.0.1',
  port: 0,
  allowedOrigins: ['*'],
  storeConfigPath: undefined,
  dataBackend: 'memory',
  databaseUrl: undefined,
  stripeSecretKey: undefined,
  stripeWebhookSecret: undefined,
  authTokenSecret: TEST_SECRET,
  // Long, because several tests move the clock weeks forward to reach a recurring order.
  authTokenTtlHours: 24 * 365,
  otpLength: 6,
  otpTtlSeconds: 600,
  otpDelivery: 'log',
};

export interface TestHarness {
  app: FastifyInstance;
  repository: Repository;
  payments: RehearsalGateway;
  config: StoreConfig;
  /** The clock the application sees. Move it with `setNow`. */
  setNow: (at: Date) => void;
  now: () => Date;
  /** Codes handed to `deliverCode`, most recent last. */
  deliveredCodes: Array<{ phone: string; code: string }>;
  close: () => Promise<void>;
}

export async function buildTestApp(startAt = new Date('2026-09-09T09:00:00.000Z')): Promise<TestHarness> {
  const config = loadStoreConfig();
  const repository = memoryRepository();
  const payments = rehearsalGateway();
  const deliveredCodes: Array<{ phone: string; code: string }> = [];

  let currentTime = startAt;
  const now = (): Date => currentTime;

  const app = await buildApp({
    config,
    repository,
    payments,
    env: testEnv,
    // Pinned so the tests never shell out to git, and never depend on which commit is
    // checked out. `resolveGitCommit` itself is proved separately, in health.test.ts.
    gitCommit: null,
    now,
    deliverCode: async (phone, code) => {
      deliveredCodes.push({ phone, code });
    },
  });

  await app.ready();

  return {
    app,
    repository,
    payments,
    config,
    now,
    setNow: (at: Date) => {
      currentTime = at;
    },
    deliveredCodes,
    close: async () => {
      await app.close();
    },
  };
}

/** An everyday basket, plus the one age restricted row that must never be sellable. */
export async function seedCatalogue(repository: Repository): Promise<{
  milk: string;
  bread: string;
  beans: string;
  wine: string;
  penny: string;
}> {
  const milk = await repository.catalogue.create({
    name: 'Semi skimmed milk, 2 pints',
    category: 'Dairy',
    estimatedPricePence: 125,
    source: 'community',
  });
  const bread = await repository.catalogue.create({
    name: 'White sliced bread, 800g',
    category: 'Bakery',
    estimatedPricePence: 89,
    source: 'community',
  });
  const beans = await repository.catalogue.create({
    name: 'Baked beans, 415g',
    category: 'Cupboard',
    estimatedPricePence: 45,
    source: 'community',
  });
  const wine = await repository.catalogue.create({
    name: 'Bottle of red wine, 75cl',
    category: 'Alcohol',
    estimatedPricePence: 549,
    ageRestricted: true,
    source: 'community',
  });
  // Rule Four: there is no minimum spend, so a one penny item must be orderable.
  const penny = await repository.catalogue.create({
    name: 'A single penny sweet',
    category: 'Cupboard',
    estimatedPricePence: 1,
    source: 'community',
  });

  return { milk: milk.id, bread: bread.id, beans: beans.id, wine: wine.id, penny: penny.id };
}

export interface SignedInShopper {
  shopperId: string;
  token: string;
  paymentMethodId: string;
  authHeader: { authorization: string };
}

export async function signUpShopper(
  harness: TestHarness,
  overrides: { displayName?: string; phone?: string; doorstepProtocol?: string } = {},
): Promise<SignedInShopper> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/shoppers',
    payload: {
      displayName: overrides.displayName ?? 'Margaret',
      phone: overrides.phone ?? '+447700900001',
      doorstepProtocol: overrides.doorstepProtocol ?? 'Knock loudly and wait.',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Could not sign up a Shopper: ${response.body}`);
  }
  const body = response.json() as { shopper: { id: string }; token: string };
  const authHeader = { authorization: `Bearer ${body.token}` };

  const card = await harness.app.inject({
    method: 'POST',
    url: '/payment-methods',
    headers: authHeader,
    payload: { stripePaymentMethodId: 'pm_test_visa', lastFour: '4242', region: 'UK' },
  });
  if (card.statusCode !== 201) {
    throw new Error(`Could not save a payment method: ${card.body}`);
  }
  const cardBody = card.json() as { paymentMethod: { id: string } };

  return {
    shopperId: body.shopper.id,
    token: body.token,
    paymentMethodId: cardBody.paymentMethod.id,
    authHeader,
  };
}

export interface SignedInRunner {
  runnerId: string;
  token: string;
  authHeader: { authorization: string };
}

export async function signUpRunner(
  harness: TestHarness,
  overrides: { name?: string; phone?: string; verified?: boolean; latitude?: number; longitude?: number } = {},
): Promise<SignedInRunner> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/runners',
    payload: {
      name: overrides.name ?? 'Tomasz',
      phone: overrides.phone ?? '+447700900101',
      vehicleType: 'car',
      stripeConnectedAccountId: 'acct_test_runner',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`Could not sign up a Runner: ${response.body}`);
  }
  const body = response.json() as { runner: { id: string }; token: string };

  // Checks are done by a person, not by an API call, so the test sets them directly.
  if (overrides.verified !== false) {
    await harness.repository.runners.update(body.runner.id, {
      rightToWorkVerified: true,
      criminalRecordCheckVerified: true,
      available: true,
      latitude: overrides.latitude ?? 52.4862,
      longitude: overrides.longitude ?? -1.8904,
    });
  }

  return {
    runnerId: body.runner.id,
    token: body.token,
    authHeader: { authorization: `Bearer ${body.token}` },
  };
}
