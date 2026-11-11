/**
 * Cloudflare Workers: the recommended home, free to start. Wakes for web requests, for the
 * timers in wrangler.toml, and for each email Cloudflare Email Routing receives; then sleeps.
 *
 * Memory is Cloudflare D1 (binding `DB`), or KV (binding `HELPERS_KV`) if there is no D1.
 * The brain can be Workers AI (binding `AI`). Secrets are Worker secrets (`wrangler secret put`).
 */
import bannedWords from '../../config/banned-words.json' with { type: 'json' };
import config from '../../helpers.config.json' with { type: 'json' };
import type { WorkersAIBinding } from '../brains/workers-ai.js';
import type { Env } from '../core/types.js';
import { inboxFor } from '../helpers/inbox/inbox.js';
import { parseRawEmail } from '../helpers/inbox/mime.js';
import { D1Store, KVStore, type D1Like, type KVLike } from '../storage/cloudflare.js';
import { MemoryStore, type KeyValueStore } from '../storage/store.js';
import { createApp, type App } from './app.js';

interface WorkerEnv {
  DB?: D1Like;
  HELPERS_KV?: KVLike;
  AI?: WorkersAIBinding;
  [name: string]: unknown;
}

/** The parts of Cloudflare's incoming email message the helpers use. */
interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  forward(to: string): Promise<unknown>;
}

interface ScheduledEvent {
  readonly cron: string;
  readonly scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function storeFor(env: WorkerEnv): KeyValueStore {
  if (env.DB) return new D1Store(env.DB);
  if (env.HELPERS_KV) return new KVStore(env.HELPERS_KV);
  console.warn('No DB or HELPERS_KV binding: the helpers will forget everything between runs.');
  return new MemoryStore();
}

function strings(env: WorkerEnv): Env {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === 'string'),
  ) as Env;
}

function appFor(env: WorkerEnv): App {
  return createApp({
    config,
    bannedWords,
    store: storeFor(env),
    env: strings(env),
    workersAI: env.AI,
  });
}

/** Emails bigger than this are not read by the helper; they are still forwarded to a person. */
const LARGEST_EMAIL = 2 * 1024 * 1024;

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return appFor(env).fetch(request);
  },

  scheduled(event: ScheduledEvent, env: WorkerEnv, context: ExecutionContext): void {
    context.waitUntil(appFor(env).scheduled(new Date(event.scheduledTime), event.cron));
  },

  async email(message: EmailMessage, env: WorkerEnv): Promise<void> {
    const app = appFor(env);
    const helper = inboxFor(app.runtime, message.to);
    // A person always gets the original too, in their normal inbox, if one is set.
    const forwardTo = helper?.config.inbox?.forwardToEnv
      ? strings(env)[helper.config.inbox.forwardToEnv]
      : undefined;
    if (forwardTo) await message.forward(forwardTo);
    if (message.rawSize > LARGEST_EMAIL) {
      await app.runtime.records.log(
        helper?.id ?? 'system',
        'email.too-big',
        `An email from ${message.from} was too big to read; it was only forwarded.`,
      );
      return;
    }
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    await app.email(parseRawEmail(raw, { from: message.from, to: message.to }));
  },
};
