/**
 * The ways email reaches the Inbox helper:
 *
 * - **Cloudflare Email Routing** (free): Cloudflare receives mail for the domain and hands each
 *   email to the Worker. See `platform/worker.ts`.
 * - **Webhook**: any email service that can post incoming email to a web address (Postmark,
 *   Mailgun, SendGrid, CloudMailin and others). See `fromWebhook` below.
 * - **IMAP**: reads an existing mailbox (for example a Google Workspace or Microsoft 365 inbox)
 *   every few minutes, from a Node server or home computer. See `ImapPoller` below.
 */
import { htmlToText, parseAddress, parseRawEmail, type IncomingEmail } from './mime.js';

function pick(body: Record<string, unknown>, ...names: string[]): string | undefined {
  const lower = new Map(Object.entries(body).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = lower.get(name.toLowerCase());
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function headerMap(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (Array.isArray(raw)) {
    // Postmark: [{ "Name": "List-Id", "Value": "..." }]
    for (const entry of raw as Array<Record<string, unknown>>) {
      const name = entry.Name ?? entry.name;
      const value = entry.Value ?? entry.value;
      if (typeof name === 'string' && typeof value === 'string')
        headers[name.toLowerCase()] = value;
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
    }
  } else if (typeof raw === 'string') {
    // SendGrid: all headers as one block of text.
    for (const line of raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon > 0)
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return headers;
}

/**
 * Reads an incoming email posted by an email service, as JSON or as a form. Understands the
 * common field names; a raw email in a `raw` or `email` field is read in full.
 */
export function fromWebhook(body: Record<string, unknown>): IncomingEmail {
  const raw = pick(body, 'raw', 'email', 'mime', 'body-mime');
  if (raw && /\r?\n\r?\n/.test(raw) && /^[\w-]+:/m.test(raw)) {
    return parseRawEmail(raw, { from: pick(body, 'envelope_from'), to: pick(body, 'envelope_to') });
  }
  const fromField = pick(body, 'from', 'sender', 'From') ?? '';
  const from = parseAddress(fromField);
  const html = pick(body, 'html', 'body-html', 'HtmlBody', 'stripped-html');
  const text =
    pick(body, 'text', 'body-plain', 'plain', 'TextBody', 'stripped-text', 'body') ??
    (html ? htmlToText(html) : '');
  const headers = headerMap(body.headers ?? body.Headers ?? body['message-headers']);
  return {
    from: from.address,
    fromName: pick(body, 'fromName', 'FromName') ?? from.name,
    to: parseAddress(pick(body, 'to', 'recipient', 'To', 'OriginalRecipient') ?? '').address,
    subject: pick(body, 'subject', 'Subject') ?? '',
    text: text.replace(/\r\n/g, '\n').trim(),
    messageId:
      pick(body, 'messageId', 'message-id', 'Message-Id', 'MessageID') ??
      headers['message-id'] ??
      null,
    headers,
  };
}

/**
 * The parts of an IMAP client the poller uses. They match the free `imapflow` library, which a
 * Node server or home computer can add with `npm install imapflow`.
 */
export interface ImapClientLike {
  connect(): Promise<void>;
  mailboxOpen(path: string): Promise<unknown>;
  search(query: { seen: boolean }, options: { uid: true }): Promise<number[] | false>;
  fetchOne(
    uid: string,
    query: { source: true },
    options: { uid: true },
  ): Promise<{ source?: Uint8Array } | false>;
  messageFlagsAdd(uid: string, flags: string[], options: { uid: true }): Promise<unknown>;
  logout(): Promise<void>;
}

/**
 * Reads unread email from a mailbox, hands each to the helper, then marks it read. Run it every
 * few minutes from the Node scheduler.
 */
export class ImapPoller {
  constructor(
    private readonly makeClient: () => Promise<ImapClientLike> | ImapClientLike,
    private readonly handle: (email: IncomingEmail) => Promise<unknown>,
    private readonly mailbox = 'INBOX',
  ) {}

  /** Returns how many emails were handled. */
  async poll(): Promise<number> {
    const client = await this.makeClient();
    await client.connect();
    let handled = 0;
    try {
      await client.mailboxOpen(this.mailbox);
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, 50)) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) continue;
        await this.handle(parseRawEmail(message.source));
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        handled += 1;
      }
    } finally {
      await client.logout();
    }
    return handled;
  }
}

/**
 * Connects with `imapflow` if it is installed. Settings come only from the environment:
 * IMAP_HOST, IMAP_PORT (default 993), IMAP_USER and IMAP_PASSWORD (an app password, never the
 * main one).
 */
export async function imapFlowClient(
  env: Readonly<Record<string, string | undefined>>,
): Promise<ImapClientLike> {
  const name = 'imapflow';
  let library: { ImapFlow: new (options: unknown) => ImapClientLike };
  try {
    library = (await import(name)) as typeof library;
  } catch {
    throw new Error(
      'To read a mailbox by IMAP, install the imapflow library: npm install imapflow',
    );
  }
  if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASSWORD) {
    throw new Error(
      'IMAP needs IMAP_HOST, IMAP_USER and IMAP_PASSWORD in the environment settings.',
    );
  }
  return new library.ImapFlow({
    host: env.IMAP_HOST,
    port: Number(env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASSWORD },
    logger: false,
  });
}
