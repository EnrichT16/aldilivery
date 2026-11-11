/**
 * The configuration: which businesses, which helpers, which brain each one uses, and how alerts
 * and emails are sent. Plain JSON (see `helpers.config.example.json`), checked when the program
 * starts, so a mistake is reported in plain English rather than discovered later. It never holds
 * a secret: it names the environment setting that does.
 */
import type { BrainConfig } from '../brains/index.js';
import type { EmailConfig } from '../senders/email.js';
import type { SmsConfig } from '../senders/sms.js';

export type HelperType = 'inbox' | 'watchman' | 'briefing';

/** Everything a helper might be allowed to do. A helper does only what its list allows. */
export const PERMISSIONS = [
  'read-email',
  'draft-replies',
  'send-email',
  'text-owner',
  'email-owner',
  'check-websites',
  'read-log',
  'read-metrics',
  'answer-website',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface Business {
  id: string;
  name: string;
  website?: string;
  /** How replies are signed, for example "The Tofadachi team". */
  signature: string;
}

export interface InboxSettings {
  /** The addresses this helper looks after, for example "hello@example.co.uk". */
  addresses: string[];
  /** The address replies are sent from. Defaults to the first address. */
  replyFrom?: string;
  /** Environment setting holding a person's own inbox, where every email is also forwarded. */
  forwardToEnv?: string;
  /** Extra words for sorting, added to the built-in ones: { "orders": ["basket"] }. */
  categoryWords?: Record<string, string[]>;
}

export interface WatchCheck {
  name: string;
  url: string;
  /** Text that must appear in the page, for example "Sign in". */
  expectText?: string;
  /** For a health address that answers JSON, a field that must have a value: { "status": "ok" }. */
  expectJson?: Record<string, string | number | boolean>;
  /** Slower than this counts as a problem. Default 5,000 (five seconds). */
  slowMs?: number;
  /** Give up after this long. Default 10,000. */
  timeoutMs?: number;
}

export interface WatchmanSettings {
  checks: WatchCheck[];
  /** How many failed checks in a row before Anthony is told. Default 2, so one blip is ignored. */
  alertAfterFailures?: number;
}

export interface Metric {
  /** Spoken label, for example "orders". */
  label: string;
  /** An address answering JSON with a number, for example { "count": 12 }. */
  url?: string;
  urlEnv?: string;
  /** Environment setting holding a token for that address. */
  tokenEnv?: string;
  /** The field holding the number. Default "count". */
  field?: string;
  /** Money and private numbers: only in briefings for Anthony. Default true. */
  ownerOnly?: boolean;
}

export interface BriefingSettings {
  /** Where the briefing goes besides the admin page: "text" and "email" to Anthony. */
  deliver?: Array<'text' | 'email'>;
  metrics?: Metric[];
}

export interface HelperConfig {
  id: string;
  type: HelperType;
  name: string;
  business: string;
  brain?: BrainConfig;
  permissions: Permission[];
  /** Kinds of message it may send without asking, from the start. Normally empty. */
  actAlone?: string[];
  /** An Oluoma Voice voice for this helper, when there is one. */
  voice?: { oluomaVoiceId?: string };
  inbox?: InboxSettings;
  watchman?: WatchmanSettings;
  briefing?: BriefingSettings;
}

export interface HelpersConfig {
  configVersion: 1;
  owner: {
    /** How the helpers address the owner, for example "Anthony". */
    name: string;
    phoneEnv?: string;
    emailEnv?: string;
  };
  /** For dates and times said in briefings. Default "Europe/London". */
  timeZone?: string;
  businesses: Business[];
  helpers: HelperConfig[];
  sms?: SmsConfig;
  email?: EmailConfig;
  /** When timed work runs, as cron lines in UTC. The same lines go in wrangler.toml. */
  schedule?: { watchman?: string; dailyBriefing?: string; weeklyBriefing?: string };
  /** Web addresses allowed to use the public "ask" endpoint, for a website's help box. */
  allowedOrigins?: string[];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The helpers configuration has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`,
    );
    this.name = 'ConfigError';
  }
}

const HELPER_TYPES: HelperType[] = ['inbox', 'watchman', 'briefing'];
const BRAIN_TYPES = ['none', 'workers-ai', 'ollama', 'openai-compatible', 'claude'];

/** Checks a configuration and returns it typed, or throws a `ConfigError` listing every problem. */
export function parseConfig(raw: unknown): HelpersConfig {
  const problems: string[] = [];
  const config = raw as Partial<HelpersConfig> | null;
  if (!config || typeof config !== 'object')
    throw new ConfigError(['The configuration is not an object.']);
  if (config.configVersion !== 1) problems.push('configVersion must be 1.');
  if (!config.owner || typeof config.owner.name !== 'string' || !config.owner.name.trim()) {
    problems.push('owner.name is needed, for example "Anthony".');
  }
  const businesses = Array.isArray(config.businesses) ? config.businesses : [];
  if (businesses.length === 0) problems.push('At least one business is needed.');
  const businessIds = new Set<string>();
  for (const business of businesses) {
    if (!business?.id || !business.name || !business.signature) {
      problems.push('Each business needs an id, a name and a signature.');
    } else {
      businessIds.add(business.id);
    }
  }
  const helpers = Array.isArray(config.helpers) ? config.helpers : [];
  if (helpers.length === 0) problems.push('At least one helper is needed.');
  const helperIds = new Set<string>();
  for (const helper of helpers) {
    const label = helper?.id ? `Helper "${helper.id}"` : 'A helper';
    if (!helper?.id || !/^[a-z0-9-]+$/.test(helper.id)) {
      problems.push(`${label} needs an id of small letters, numbers and dashes.`);
      continue;
    }
    if (helperIds.has(helper.id)) problems.push(`${label} appears twice.`);
    helperIds.add(helper.id);
    if (!HELPER_TYPES.includes(helper.type)) {
      problems.push(
        `${label} has type "${String(helper.type)}"; it must be one of ${HELPER_TYPES.join(', ')}.`,
      );
    }
    if (!helper.name) problems.push(`${label} needs a name.`);
    if (!businessIds.has(helper.business))
      problems.push(`${label} names a business that is not listed.`);
    if (!Array.isArray(helper.permissions)) {
      problems.push(`${label} needs a permissions list (it may be empty).`);
    } else {
      for (const permission of helper.permissions) {
        if (!(PERMISSIONS as readonly string[]).includes(permission)) {
          problems.push(`${label} has an unknown permission "${permission}".`);
        }
      }
    }
    if (helper.brain && !BRAIN_TYPES.includes(helper.brain.type)) {
      problems.push(`${label} has an unknown brain "${String(helper.brain.type)}".`);
    }
    if (
      helper.type === 'inbox' &&
      (!helper.inbox ||
        !Array.isArray(helper.inbox.addresses) ||
        helper.inbox.addresses.length === 0)
    ) {
      problems.push(`${label} is an inbox helper and needs inbox.addresses.`);
    }
    if (helper.type === 'watchman') {
      const checks = helper.watchman?.checks;
      if (!Array.isArray(checks) || checks.length === 0) {
        problems.push(`${label} is a watchman and needs at least one check.`);
      } else {
        for (const check of checks) {
          if (!check.name || !/^https?:\/\//.test(check.url ?? '')) {
            problems.push(`${label} has a check without a name or a web address starting http.`);
          }
        }
      }
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return config as HelpersConfig;
}
