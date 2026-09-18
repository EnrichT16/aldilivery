/**
 * Environment. Read once, validated once, and never read from `process.env` again anywhere
 * else in the codebase.
 *
 * Nothing here has a real secret as a default. Where a secret is missing the server either
 * refuses to start, in production, or falls back to a clearly labelled rehearsal mode that
 * moves no money.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Find the `.env` to read, searching upward from this file.
 *
 * `dotenv` on its own looks in the current working directory, and the working directory is
 * wherever the process happened to be started. `pnpm --filter @aldilivery/api dev` starts it
 * inside `packages/api`, so the `.env` at the top of the repository — the one `.env.example`
 * sits beside and tells you to copy — was never read at all.
 *
 * That went unnoticed for a long time because every value in `.env.example` is a placeholder,
 * and a placeholder produces exactly what no value at all produces: the in-memory store,
 * rehearsal payments, localhost origins. The defaults hid it perfectly. It surfaced the first
 * time somebody put a real Stripe key in that file and the server carried on saying
 * `paymentsMode: rehearsal`.
 *
 * So the search starts from this module rather than from the working directory, and walks up.
 * The nearest `.env` wins, which means a `packages/api/.env` still overrides the shared one if
 * anybody wants that. The walk stops at the workspace root and never goes above it, because a
 * stray `.env` in a home directory belongs to somebody else's project, not to this one.
 */
export function findDotenvFile(startDirectory: string): string | undefined {
  let directory = startDirectory;

  for (;;) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;

    // The workspace root is the last place worth looking.
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return undefined;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export type DataBackend = 'postgres' | 'memory';

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  host: string;
  port: number;
  /**
   * Which browser origins may call this API. A single origin, a comma separated list, or
   * `*` for anything, which is only ever sensible in development and in the tests.
   */
  allowedOrigins: string[];
  storeConfigPath: string | undefined;
  dataBackend: DataBackend;
  databaseUrl: string | undefined;
  stripeSecretKey: string | undefined;
  /**
   * The key Stripe.js uses in the browser. Public by design — it is in the page source of
   * every site that takes a card — so it is served from `/config` rather than kept secret.
   * Without it the browser cannot turn a card into a payment method, so no card can be
   * saved, and the card screen says so plainly instead of failing at the last moment.
   */
  stripePublishableKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  authTokenSecret: string;
  authTokenTtlHours: number;
  otpLength: number;
  otpTtlSeconds: number;
  /** `log` writes the code to the server log, for development. */
  otpDelivery: 'log' | 'sms';
  /**
   * Fill an empty catalogue at startup. On by default, because a deployed Aldilivery with
   * no catalogue looks broken. Set `SEED_ON_START=false` once the catalogue comes from
   * somewhere else.
   */
  seedOnStart: boolean;
}

/** The port a platform-supplied `PORT` would have to beat. Used in production too. */
export const DEFAULT_PORT = 8080;

const PLACEHOLDER_MARKERS = ['placeholder', 'change_me', 'replace_with'];

function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lowered = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

/** A value we can actually use, or nothing. A placeholder is nothing. */
function realValue(value: string | undefined): string | undefined {
  return looksLikePlaceholder(value) ? undefined : value;
}

function integer(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function originList(value: string | undefined, fallback: string): string[] {
  const raw = value?.trim() ? value : fallback;
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Never overrides a variable the platform has already set: on DigitalOcean there is no
  // .env at all and everything comes from the real environment.
  const envFile = findDotenvFile(dirname(fileURLToPath(import.meta.url)));
  loadDotenv(envFile ? { path: envFile } : {});

  const nodeEnv = (source['NODE_ENV'] ?? 'development') as Env['nodeEnv'];
  const isProduction = nodeEnv === 'production';

  const stripeSecretKey = realValue(source['STRIPE_SECRET_KEY']);
  const stripePublishableKey = realValue(source['STRIPE_PUBLISHABLE_KEY']);
  const stripeWebhookSecret = realValue(source['STRIPE_WEBHOOK_SECRET']);
  const databaseUrl = realValue(source['DATABASE_URL']);

  const authTokenSecret = source['AUTH_TOKEN_SECRET'];
  if (isProduction && looksLikePlaceholder(authTokenSecret)) {
    throw new Error(
      'AUTH_TOKEN_SECRET is missing or still the placeholder. Set a real one before running in production.',
    );
  }
  // Fail fast, and say which one. A production server that starts without these would take
  // an order it cannot charge for, or accept a webhook it cannot prove came from Stripe.
  if (isProduction && !stripeSecretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is missing. Aldilivery will not run in production without it.',
    );
  }
  if (isProduction && !stripeWebhookSecret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is missing. Aldilivery will not run in production without it, because an unverified webhook is not an event.',
    );
  }
  if (isProduction && !databaseUrl) {
    throw new Error(
      'DATABASE_URL is missing. Aldilivery will not run in production on the in-memory store, because everything in it is lost when the process stops.',
    );
  }

  const requestedBackend = source['DATA_BACKEND'];
  const dataBackend: DataBackend =
    databaseUrl && requestedBackend !== 'memory' ? 'postgres' : 'memory';

  return {
    nodeEnv,
    isProduction,
    host: source['HOST'] ?? source['API_HOST'] ?? '0.0.0.0',
    // `PORT` is what a platform sets. `API_PORT` is kept for anyone whose .env still has it.
    port: integer(source['PORT'] ?? source['API_PORT'], DEFAULT_PORT),
    allowedOrigins: originList(
      source['ALLOWED_ORIGIN'] ?? source['WEB_ORIGIN'],
      'http://localhost:5173',
    ),
    storeConfigPath: source['STORE_CONFIG_PATH'],
    dataBackend,
    databaseUrl,
    stripeSecretKey,
    stripePublishableKey,
    stripeWebhookSecret,
    authTokenSecret: authTokenSecret ?? 'development-only-secret-not-for-production',
    authTokenTtlHours: integer(source['AUTH_TOKEN_TTL_HOURS'], 720),
    otpLength: integer(source['OTP_LENGTH'], 6),
    otpTtlSeconds: integer(source['OTP_TTL_SECONDS'], 600),
    otpDelivery: source['OTP_DELIVERY'] === 'sms' ? 'sms' : 'log',
    seedOnStart: source['SEED_ON_START'] !== 'false',
  };
}
