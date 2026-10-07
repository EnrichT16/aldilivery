import { readFileSync } from 'node:fs';

import type { Brain, BrainRequest } from '../src/brains/brain.js';
import type { HelpersConfig } from '../src/core/config.js';
import { Runtime } from '../src/core/runtime.js';
import type { FetchLike } from '../src/core/types.js';
import { OutboxOnly, type EmailSender, type OutgoingEmail } from '../src/senders/email.js';
import { LogOnlySms } from '../src/senders/sms.js';
import { MemoryStore } from '../src/storage/store.js';
import { createApp, type ExtraTasks } from '../src/platform/app.js';

export const bannedWords = JSON.parse(
  readFileSync(new URL('../config/banned-words.json', import.meta.url), 'utf8'),
) as unknown;

/** A brain that answers from a script and remembers what it was asked. */
export class FakeBrain implements Brain {
  readonly description = 'fake brain';
  readonly thinks = true;
  readonly asked: BrainRequest[] = [];

  constructor(private readonly reply: (request: BrainRequest) => string = () => 'UNKNOWN') {}

  async think(request: BrainRequest): Promise<string> {
    this.asked.push(request);
    return this.reply(request);
  }
}

/** An email sender that really "sends", into a list. */
export class FakeEmail implements EmailSender {
  readonly description = 'fake email';
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<{ sent: boolean; detail: string }> {
    this.sent.push(email);
    return { sent: true, detail: 'Email sent.' };
  }
}

export function testConfig(overrides: Partial<HelpersConfig> = {}): HelpersConfig {
  return {
    configVersion: 1,
    owner: { name: 'Anthony' },
    businesses: [
      { id: 'biz', name: 'Example Services', signature: 'Kind regards,\nThe Example team' },
    ],
    helpers: [
      {
        id: 'inbox',
        type: 'inbox',
        name: 'Inbox helper',
        business: 'biz',
        permissions: ['read-email', 'draft-replies', 'send-email', 'text-owner', 'answer-website'],
        inbox: { addresses: ['hello@example.com'] },
      },
      {
        id: 'watchman',
        type: 'watchman',
        name: 'Watchman',
        business: 'biz',
        permissions: ['check-websites', 'text-owner'],
        watchman: {
          checks: [
            { name: 'the website', url: 'https://example.com', expectText: 'Welcome' },
            {
              name: 'the app server',
              url: 'https://api.example.com/health',
              expectJson: { status: 'ok' },
            },
          ],
        },
      },
      {
        id: 'briefing',
        type: 'briefing',
        name: 'Briefing',
        business: 'biz',
        permissions: ['read-log', 'read-metrics', 'text-owner', 'email-owner'],
        briefing: { deliver: ['text'], metrics: [] },
      },
    ],
    ...overrides,
  };
}

export interface Harness {
  runtime: Runtime;
  store: MemoryStore;
  brain: FakeBrain;
  sms: LogOnlySms & { sentForReal: Array<{ to: string; text: string }> };
  email: EmailSender;
  now: { value: Date };
}

export function harness(
  options: {
    config?: HelpersConfig;
    brain?: FakeBrain;
    email?: EmailSender;
    env?: Record<string, string>;
    fetch?: FetchLike;
    noBrain?: boolean;
  } = {},
): Harness {
  const store = new MemoryStore();
  const brain = options.brain ?? new FakeBrain();
  const now = { value: new Date('2026-10-07T09:00:00Z') };
  const sms = Object.assign(new LogOnlySms(), {
    sentForReal: [] as Array<{ to: string; text: string }>,
  });
  sms.send = async (to, text) => {
    sms.sentForReal.push({ to, text });
    return { sent: true, detail: 'Text sent.' };
  };
  const email = options.email ?? new OutboxOnly();
  const runtime = new Runtime({
    config: options.config ?? testConfig(),
    bannedWords,
    store,
    env: { OWNER_PHONE: '+447700900000', OWNER_EMAIL: 'owner@example.com', ...options.env },
    clock: () => now.value,
    fetch: options.fetch,
    brainFor: options.noBrain ? undefined : () => brain,
    sms,
    email,
  });
  return { runtime, store, brain, sms, email, now };
}

/** The whole app (web handler, tasks) over the same pieces as `harness`. */
export function appHarness(options: Parameters<typeof harness>[0] & { extra?: ExtraTasks } = {}) {
  const base = harness(options);
  const app = createApp(
    {
      config: options.config ?? testConfig(),
      bannedWords,
      store: base.store,
      env: {
        OWNER_PHONE: '+447700900000',
        ADMIN_TOKEN: 'admin-key',
        INBOX_WEBHOOK_SECRET: 'hook-secret',
        ...options.env,
      },
      clock: () => base.now.value,
      fetch: options.fetch,
      brainFor: () => base.brain,
      sms: base.sms,
      email: base.email,
    },
    options.extra,
  );
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.fetch(
      new Request(`https://helpers.example.com${path}`, {
        method,
        headers: {
          authorization: 'Bearer admin-key',
          'content-type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { ...base, app, call };
}

export function email(
  overrides: Partial<import('../src/helpers/inbox/mime.js').IncomingEmail> = {},
) {
  return {
    from: 'jane@customer.example',
    fromName: 'Jane Smith',
    to: 'hello@example.com',
    subject: 'Opening hours',
    text: 'Hello, what are your opening hours? Thanks, Jane',
    messageId: '<abc123@customer.example>',
    headers: {},
    ...overrides,
  };
}
