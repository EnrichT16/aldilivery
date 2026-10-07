/**
 * Everything one running copy of the helpers needs, made once from the configuration and the
 * platform's adapters. Each platform (Cloudflare, Node server, home computer) builds one of these
 * and hands it requests, timers and emails.
 */
import { createBrain, type Brain } from '../brains/index.js';
import type { WorkersAIBinding } from '../brains/workers-ai.js';
import { createEmailSender, type EmailSender } from '../senders/email.js';
import { createSms, type SmsSender } from '../senders/sms.js';
import type { KeyValueStore } from '../storage/store.js';
import { parseConfig, type HelperConfig, type HelperType, type HelpersConfig } from './config.js';
import { TeachableHelper } from './helper.js';
import { Records } from './records.js';
import { bannedListFrom, type BannedList } from './safety.js';
import type { Clock, Env, FetchLike } from './types.js';

export interface RuntimeOptions {
  config: unknown;
  bannedWords: unknown;
  store: KeyValueStore;
  env: Env;
  clock?: Clock;
  fetch?: FetchLike;
  workersAI?: WorkersAIBinding;
  /** For tests: choose each helper's brain directly. */
  brainFor?: (helper: HelperConfig) => Brain;
  sms?: SmsSender;
  email?: EmailSender;
}

export class Runtime {
  readonly config: HelpersConfig;
  readonly records: Records;
  readonly banned: BannedList;
  readonly env: Env;
  readonly clock: Clock;
  readonly fetch: FetchLike;
  readonly sms: SmsSender;
  readonly email: EmailSender;
  private readonly helpers = new Map<string, TeachableHelper>();

  constructor(options: RuntimeOptions) {
    this.config = parseConfig(options.config);
    this.env = options.env;
    this.clock = options.clock ?? (() => new Date());
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.records = new Records(options.store, this.clock);
    this.banned = bannedListFrom(options.bannedWords);
    this.sms = options.sms ?? createSms(this.config.sms, this.env, this.fetch);
    this.email = options.email ?? createEmailSender(this.config.email, this.env, this.fetch);
    for (const helper of this.config.helpers) {
      const business = this.config.businesses.find((b) => b.id === helper.business)!;
      const makeBrain = options.brainFor
        ? () => options.brainFor!(helper)
        : () =>
            createBrain(helper.brain, this.env, {
              fetch: this.fetch,
              workersAI: options.workersAI,
            });
      this.helpers.set(
        helper.id,
        new TeachableHelper(helper, business, this.config, this.records, this.banned, makeBrain),
      );
    }
  }

  get ownerName(): string {
    return this.config.owner.name;
  }

  get timeZone(): string {
    return this.config.timeZone ?? 'Europe/London';
  }

  ownerPhone(): string | undefined {
    return this.env[this.config.owner.phoneEnv ?? 'OWNER_PHONE'];
  }

  ownerEmail(): string | undefined {
    return this.env[this.config.owner.emailEnv ?? 'OWNER_EMAIL'];
  }

  helper(id: string): TeachableHelper | undefined {
    return this.helpers.get(id);
  }

  all(): TeachableHelper[] {
    return [...this.helpers.values()];
  }

  ofType(type: HelperType): TeachableHelper[] {
    return this.all().filter((helper) => helper.config.type === type);
  }

  /** Texts Anthony, if the helper may, and logs either way. */
  async textOwner(helper: TeachableHelper, text: string): Promise<boolean> {
    if (!(await helper.allowed('text-owner', 'send a text to the owner'))) return false;
    const phone = this.ownerPhone();
    if (!phone) {
      await helper.log(
        'alert.not-sent',
        `No text was sent because the owner's phone number is not set. The alert was: ${text}`,
      );
      return false;
    }
    try {
      const result = await this.sms.send(phone, text);
      await helper.log(
        result.sent ? 'alert.sent' : 'alert.not-sent',
        result.sent
          ? `Texted ${this.ownerName}: ${text}`
          : `Did not text ${this.ownerName} (${result.detail}) The alert was: ${text}`,
      );
      return result.sent;
    } catch (error) {
      await helper.log(
        'alert.not-sent',
        `Could not text ${this.ownerName}: ${(error as Error).message}. The alert was: ${text}`,
      );
      return false;
    }
  }
}
