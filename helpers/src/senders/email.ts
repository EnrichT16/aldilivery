import type { Env, FetchLike } from '../core/types.js';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** The message being answered, so the reply joins the same conversation. */
  inReplyTo?: string | null;
}

/** Sends email replies once they are approved (or once Anthony lets a kind of reply go alone). */
export interface EmailSender {
  readonly description: string;
  send(email: OutgoingEmail): Promise<{ sent: boolean; detail: string }>;
}

export type EmailConfig =
  | { type: 'outbox' }
  | { type: 'resend'; apiKeyEnv?: string }
  | { type: 'webhook'; urlEnv?: string; tokenEnv?: string };

/**
 * Sends nothing. Approved replies stay in the outbox on the admin page, ready for a person to
 * copy into the normal email program. The safe way to start.
 */
export class OutboxOnly implements EmailSender {
  readonly description = 'outbox only (a person sends approved replies)';
  readonly kept: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<{ sent: boolean; detail: string }> {
    this.kept.push(email);
    return { sent: false, detail: 'Kept in the outbox for a person to send.' };
  }
}

function threadHeaders(email: OutgoingEmail): Record<string, string> {
  return email.inReplyTo ? { 'In-Reply-To': email.inReplyTo, References: email.inReplyTo } : {};
}

/** Resend, an email sending service with a free monthly allowance. */
export class ResendEmail implements EmailSender {
  readonly description = 'Resend';

  constructor(private readonly options: { apiKey: string; fetch?: FetchLike }) {}

  async send(email: OutgoingEmail): Promise<{ sent: boolean; detail: string }> {
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        headers: threadHeaders(email),
      }),
    });
    return response.ok
      ? { sent: true, detail: 'Email sent.' }
      : { sent: false, detail: `The email service answered with status ${response.status}.` };
  }
}

/** Posts the email as JSON to any address, for another sending service or an automation. */
export class WebhookEmail implements EmailSender {
  readonly description = 'email webhook';

  constructor(private readonly options: { url: string; token?: string; fetch?: FetchLike }) {}

  async send(email: OutgoingEmail): Promise<{ sent: boolean; detail: string }> {
    const fetcher = this.options.fetch ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    const response = await fetcher(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...email, headers: threadHeaders(email) }),
    });
    return response.ok
      ? { sent: true, detail: 'Email sent.' }
      : { sent: false, detail: `The email webhook answered with status ${response.status}.` };
  }
}

export function createEmailSender(
  config: EmailConfig | undefined,
  env: Env,
  fetcher?: FetchLike,
): EmailSender {
  if (!config || config.type === 'outbox') return new OutboxOnly();
  if (config.type === 'resend') {
    const apiKey = env[config.apiKeyEnv ?? 'RESEND_API_KEY'];
    return apiKey ? new ResendEmail({ apiKey, fetch: fetcher }) : new OutboxOnly();
  }
  const url = env[config.urlEnv ?? 'EMAIL_WEBHOOK_URL'];
  if (!url) return new OutboxOnly();
  return new WebhookEmail({
    url,
    token: env[config.tokenEnv ?? 'EMAIL_WEBHOOK_TOKEN'],
    fetch: fetcher,
  });
}
