import type { Env, FetchLike } from '../core/types.js';

/** Sends a short text message, for alerts to Anthony. Pluggable: change one line of configuration. */
export interface SmsSender {
  readonly description: string;
  send(to: string, text: string): Promise<{ sent: boolean; detail: string }>;
}

export type SmsConfig =
  | { type: 'log' }
  | { type: 'twilio'; accountSidEnv?: string; authTokenEnv?: string; fromEnv?: string }
  | { type: 'webhook'; urlEnv?: string; tokenEnv?: string };

/** Sends nothing; the alert is only written in the log. For trying things out. */
export class LogOnlySms implements SmsSender {
  readonly description = 'log only (no texts are sent)';
  readonly sent: Array<{ to: string; text: string }> = [];

  async send(to: string, text: string): Promise<{ sent: boolean; detail: string }> {
    this.sent.push({ to, text });
    return { sent: false, detail: 'Texts are switched off; the alert is in the log.' };
  }
}

/** Twilio, the common text message service. Charged per message: see HOSTING.md. */
export class TwilioSms implements SmsSender {
  readonly description = 'Twilio';

  constructor(
    private readonly options: {
      accountSid: string;
      authToken: string;
      from: string;
      fetch?: FetchLike;
    },
  ) {}

  async send(to: string, text: string): Promise<{ sent: boolean; detail: string }> {
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher(
      `https://api.twilio.com/2010-04-01/Accounts/${this.options.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${this.options.accountSid}:${this.options.authToken}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: this.options.from, Body: text }).toString(),
      },
    );
    return response.ok
      ? { sent: true, detail: 'Text sent.' }
      : { sent: false, detail: `The text service answered with status ${response.status}.` };
  }
}

/**
 * Posts `{ "to": ..., "text": ... }` to any address: for a phone's own text gateway app, an
 * automation service, or another text provider.
 */
export class WebhookSms implements SmsSender {
  readonly description = 'text message webhook';

  constructor(private readonly options: { url: string; token?: string; fetch?: FetchLike }) {}

  async send(to: string, text: string): Promise<{ sent: boolean; detail: string }> {
    const fetcher = this.options.fetch ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    const response = await fetcher(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, text }),
    });
    return response.ok
      ? { sent: true, detail: 'Text sent.' }
      : { sent: false, detail: `The text webhook answered with status ${response.status}.` };
  }
}

export function createSms(config: SmsConfig | undefined, env: Env, fetcher?: FetchLike): SmsSender {
  if (!config || config.type === 'log') return new LogOnlySms();
  if (config.type === 'twilio') {
    const accountSid = env[config.accountSidEnv ?? 'TWILIO_ACCOUNT_SID'];
    const authToken = env[config.authTokenEnv ?? 'TWILIO_AUTH_TOKEN'];
    const from = env[config.fromEnv ?? 'TWILIO_FROM'];
    if (!accountSid || !authToken || !from) return new LogOnlySms();
    return new TwilioSms({ accountSid, authToken, from, fetch: fetcher });
  }
  const url = env[config.urlEnv ?? 'SMS_WEBHOOK_URL'];
  if (!url) return new LogOnlySms();
  return new WebhookSms({
    url,
    token: env[config.tokenEnv ?? 'SMS_WEBHOOK_TOKEN'],
    fetch: fetcher,
  });
}
