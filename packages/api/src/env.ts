/**
 * Environment. Read once, validated once, and never read from `process.env` again anywhere
 * else in the codebase.
 *
 * Nothing here has a real secret as a default. Where a secret is missing the server either
 * refuses to start, in production, or falls back to a clearly labelled rehearsal mode that
 * moves no money.
 */

import { config as loadDotenv } from 'dotenv';

export type DataBackend = 'postgres' | 'memory';

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  host: string;
  port: number;
  webOrigin: string;
  storeConfigPath: string | undefined;
  dataBackend: DataBackend;
  databaseUrl: string | undefined;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  authTokenSecret: string;
  authTokenTtlHours: number;
  otpLength: number;
  otpTtlSeconds: number;
  /** `log` writes the code to the server log, for development. */
  otpDelivery: 'log' | 'sms';
}

const PLACEHOLDER_MARKERS = ['placeholder', 'change_me', 'replace_with'];

function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const lowered = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

function integer(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  loadDotenv();

  const nodeEnv = (source['NODE_ENV'] ?? 'development') as Env['nodeEnv'];
  const isProduction = nodeEnv === 'production';

  const stripeSecretKey = looksLikePlaceholder(source['STRIPE_SECRET_KEY'])
    ? undefined
    : source['STRIPE_SECRET_KEY'];
  const stripeWebhookSecret = looksLikePlaceholder(source['STRIPE_WEBHOOK_SECRET'])
    ? undefined
    : source['STRIPE_WEBHOOK_SECRET'];
  const databaseUrl = looksLikePlaceholder(source['DATABASE_URL'])
    ? source['DATABASE_URL']
    : source['DATABASE_URL'];

  const authTokenSecret = source['AUTH_TOKEN_SECRET'];
  if (isProduction && looksLikePlaceholder(authTokenSecret)) {
    throw new Error(
      'AUTH_TOKEN_SECRET is missing or still the placeholder. Set a real one before running in production.',
    );
  }
  if (isProduction && !stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is missing. Aldilivery will not run in production without it.');
  }

  const requestedBackend = source['DATA_BACKEND'];
  const dataBackend: DataBackend =
    requestedBackend === 'memory' || (!databaseUrl && !isProduction) ? 'memory' : 'postgres';

  return {
    nodeEnv,
    isProduction,
    host: source['API_HOST'] ?? '0.0.0.0',
    port: integer(source['API_PORT'], 3001),
    webOrigin: source['WEB_ORIGIN'] ?? 'http://localhost:5173',
    storeConfigPath: source['STORE_CONFIG_PATH'],
    dataBackend,
    databaseUrl,
    stripeSecretKey,
    stripeWebhookSecret,
    authTokenSecret: authTokenSecret ?? 'development-only-secret-not-for-production',
    authTokenTtlHours: integer(source['AUTH_TOKEN_TTL_HOURS'], 720),
    otpLength: integer(source['OTP_LENGTH'], 6),
    otpTtlSeconds: integer(source['OTP_TTL_SECONDS'], 600),
    otpDelivery: source['OTP_DELIVERY'] === 'sms' ? 'sms' : 'log',
  };
}
