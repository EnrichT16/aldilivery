/**
 * The business mailbox (ruling 76, Anthony, 22 October 2026): read over IMAP, answered over
 * SMTP, on the company's existing mail host. Nothing about where mail is delivered changes: no
 * DNS, no MX records, no forwarding. This only signs in to the mailbox as a mail app would.
 *
 * Kept behind two small interfaces, `Mailbox` and `Mailer`, so the email desk
 * (services/email-desk.ts) is tested with stand-ins and no network at all.
 *
 * The password is never logged, and neither is any part of an email's words: the IMAP library's
 * own logging is switched off for that reason.
 */

import { createHash } from 'node:crypto';

import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';

import type { Env } from '../env.js';

/** One email, as the email desk needs it. Only the start of its words; attachments by name. */
export interface IncomingEmail {
  /** The IMAP UID, to mark it as read. */
  uid: number;
  /** The Message-ID header, or null when it has none. */
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  /** The plain text, cut to `TEXT_LIMIT` characters. */
  text: string;
  attachmentNames: string[];
  /** The Date header, as given, for the fingerprint of an email without a Message-ID. */
  date: string | null;
  /** Headers that say an email was sent by a machine or to a list. */
  listUnsubscribe: boolean;
  listId: boolean;
  /** Auto-Submitted, other than "no" (RFC 3834). */
  autoSubmitted: boolean;
  /** Precedence: bulk, list or junk. */
  bulk: boolean;
}

/** An open connection to the mailbox's INBOX. */
export interface MailboxSession {
  /** The unread emails in INBOX, oldest first, at most `limit` of them. Marks none as read. */
  unseen(limit: number): Promise<IncomingEmail[]>;
  /** Marks one email as read (\Seen). */
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}

export interface Mailbox {
  open(): Promise<MailboxSession>;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** The Message-ID being answered, so the reply sits in the same conversation. */
  inReplyTo: string | null;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}

/** How much of an email's plain text is read: the start is enough to sort it. */
export const TEXT_LIMIT = 2000;
/** How much of an email is fetched at all. Attachments past this are not downloaded. */
const SOURCE_LIMIT = 1_000_000;

export interface MailboxSettings {
  imap: { host: string; port: number; secure: boolean };
  /** For replies only; null when no outgoing server is given. */
  smtp: { host: string; port: number; secure: boolean } | null;
  user: string;
  password: string;
  autoReply: boolean;
}

/**
 * The mailbox's settings, or null when it is off: the IMAP host, the user and the password must
 * all be real values (a placeholder counts as nothing).
 */
export function mailboxSettings(env: Env): MailboxSettings | null {
  const { emailImapHost: host, emailImapUser: user, emailImapPassword: password } = env;
  if (!host || !user || !password) return null;
  return {
    // 993 is IMAP over TLS; 143 starts plain and is upgraded with STARTTLS.
    imap: { host, port: env.emailImapPort, secure: env.emailImapPort !== 143 },
    smtp: env.emailSmtpHost
      ? { host: env.emailSmtpHost, port: env.emailSmtpPort, secure: env.emailSmtpPort === 465 }
      : null,
    user,
    password,
    autoReply: env.emailAutoReply,
  };
}

function firstAddress(from: AddressObject | AddressObject[] | undefined): {
  address: string;
  name: string | null;
} {
  const list = Array.isArray(from) ? from : from ? [from] : [];
  for (const group of list) {
    for (const entry of group.value) {
      if (entry.address) return { address: entry.address, name: entry.name?.trim() || null };
    }
  }
  return { address: '', name: null };
}

/** An email's raw source turned into what the desk needs. Exported for the tests. */
export async function readEmail(uid: number, source: Buffer): Promise<IncomingEmail> {
  const parsed = await simpleParser(source, { skipTextToHtml: true, skipImageLinks: true });
  const header = (name: string): string => {
    const value = parsed.headers.get(name);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  // The raw header names: the parser folds List-* headers into one "list" header of its own.
  const present = new Set(parsed.headerLines.map((line) => line.key.toLowerCase()));
  const from = firstAddress(parsed.from);
  const autoSubmitted = header('auto-submitted').trim().toLowerCase();
  return {
    uid,
    messageId: parsed.messageId?.trim() || null,
    fromAddress: from.address.toLowerCase(),
    fromName: from.name,
    subject: (parsed.subject ?? '').replace(/\s+/g, ' ').trim(),
    text: (parsed.text ?? '').replace(/\r/g, '').trim().slice(0, TEXT_LIMIT),
    attachmentNames: parsed.attachments
      .map((attachment) => attachment.filename?.trim() ?? '')
      .filter((name) => name !== '')
      .slice(0, 20),
    date: parsed.date ? parsed.date.toISOString() : null,
    listUnsubscribe: present.has('list-unsubscribe'),
    listId: present.has('list-id'),
    autoSubmitted: autoSubmitted !== '' && autoSubmitted !== 'no',
    bulk: /^(bulk|list|junk)$/i.test(header('precedence').trim()),
  };
}

/** The key an email is remembered by: its Message-ID, or a fingerprint for one without. */
export function emailKey(email: IncomingEmail): string {
  if (email.messageId) return email.messageId.slice(0, 500);
  const fingerprint = createHash('sha256')
    .update(`${email.fromAddress}\n${email.subject}\n${email.date ?? ''}\n${email.text}`)
    .digest('hex');
  return `no-message-id:${fingerprint}`;
}

/** The real mailbox, over IMAP with `imapflow`. */
export function imapMailbox(settings: MailboxSettings): Mailbox {
  return {
    async open() {
      const client = new ImapFlow({
        host: settings.imap.host,
        port: settings.imap.port,
        secure: settings.imap.secure,
        auth: { user: settings.user, pass: settings.password },
        // Its log would carry the conversation with the server: never written.
        logger: false,
        connectionTimeout: 30_000,
        socketTimeout: 120_000,
      });
      // A dropped connection is reported here rather than crashing the process.
      client.on('error', () => undefined);
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      return {
        async unseen(limit) {
          const found = await client.search({ seen: false }, { uid: true });
          const uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b).slice(0, limit);
          if (uids.length === 0) return [];
          const sources: Array<{ uid: number; source: Buffer }> = [];
          // `source` is fetched with BODY.PEEK, so fetching never marks anything as read.
          for await (const message of client.fetch(
            uids,
            { uid: true, source: { maxLength: SOURCE_LIMIT } },
            { uid: true },
          )) {
            if (message.source) sources.push({ uid: message.uid, source: message.source });
          }
          const emails: IncomingEmail[] = [];
          for (const { uid, source } of sources.sort((a, b) => a.uid - b.uid)) {
            emails.push(await readEmail(uid, source));
          }
          return emails;
        },
        async markSeen(uid) {
          await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
        },
        async close() {
          lock.release();
          await client.logout().catch(() => undefined);
        },
      };
    },
  };
}

/** Replies, over SMTP with `nodemailer`, from the mailbox itself and signed as the service. */
export function smtpMailer(
  settings: MailboxSettings & { smtp: NonNullable<MailboxSettings['smtp']> },
  senderName: string,
): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    requireTLS: !settings.smtp.secure,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
  });
  return {
    async send(email) {
      await transport.sendMail({
        from: { name: senderName, address: settings.user },
        to: email.to,
        subject: email.subject,
        text: email.text,
        ...(email.inReplyTo ? { inReplyTo: email.inReplyTo, references: email.inReplyTo } : {}),
        // An automatic reply says so (RFC 3834), so other machines do not answer it back.
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
    },
  };
}
