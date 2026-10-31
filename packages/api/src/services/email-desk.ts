/**
 * Ozi reads the business mailbox (ruling 76, Anthony, 22 October 2026): important emails are
 * read to the owner on Ozi's call, unimportant ones never ring him, and simple customer
 * questions may be answered by Ozi itself.
 *
 * Every five minutes (index.ts) the unread emails in INBOX are read. Each new one (its sender,
 * subject, the start of its plain text, and its attachments' names only) is sorted by the
 * language model's `triageEmail`:
 *
 * - Decisions, complaints, legal or official mail, partner or organisation approaches, and
 *   anything else the model marks important become a matter on Ozi's desk (`askOwner`, kind
 *   "email"), only to hear: who it is from and what it is about.
 * - Spam, newsletters and automatic notices are only marked as read. They never ring.
 * - A customer question the service's own facts answer is replied to by email, only when
 *   EMAIL_AUTO_REPLY is "on"; otherwise it is a matter too.
 * - Without the language model, every email from a person becomes a matter with its sender and
 *   subject only; anything plainly sent by a machine or to a list does not.
 *
 * Each email is recorded once, by its Message-ID (only the sender's domain is kept), before it
 * is marked as read, so nothing is read or rung about twice. Nothing of an email's words is ever
 * written to the log.
 *
 * Several mailboxes, and listening on request (ruling 85, Anthony, 31 October 2026): each sweep is
 * for one mailbox, with its number and the label Ozi says aloud. Every email also leaves a short
 * stored summary for the owner to ask about (who it is from by name, the subject, when, one or two
 * sentences, the category, important or not, heard or not, and the start of its words with
 * numbers, codes and addresses blanked), kept `emailDesk.summaryKeepDays`. Never an attachment.
 * His alert choices decide whether an email rings, texts, notifies or only waits: an important one
 * always goes on the desk; another email from a person goes there only if he asked to hear of
 * other emails. The email is always data, never instructions: nothing in it is ever acted on.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type { EmailCategory } from '../domain.js';
import type { EmailTriage } from '../lib/language-model.js';
import {
  emailKey,
  FIRST_MAILBOX_LABEL,
  type IncomingEmail,
  type Mailbox,
  type Mailer,
} from '../lib/mailbox.js';
import { blankedExcerpt, blankPrivate } from '../lib/redact.js';
import { alertPreferences } from './alert-preferences.js';
import { askOwner, auditAutomatic } from './owner-desk.js';

export type EmailContext = Pick<AppContext, 'repository' | 'config' | 'brain' | 'now'>;

export interface EmailDeskOptions {
  mailbox: Mailbox;
  /** For replies; null when no outgoing server is set. */
  mailer: Mailer | null;
  /** EMAIL_AUTO_REPLY is "on". */
  autoReply: boolean;
  /** The mailbox's own address, which is never answered. */
  ownAddress: string;
  /** How many emails one sweep reads at most. */
  limit?: number;
  /** Which mailbox this is (ruling 85): 1 unless given. */
  number?: number;
  /** What Ozi calls it aloud: "the business mailbox" unless given. */
  label?: string;
}

export interface EmailSweepReport {
  read: number;
  matters: number;
  replied: number;
  /** Marked as read and nothing more: spam, newsletters, notices, nothing that needs him. */
  quiet: number;
  duplicates: number;
  failed: number;
}

/** Never ring about these, whatever else is said about them. */
const NEVER_RINGS: ReadonlySet<EmailCategory> = new Set([
  'spam_or_marketing',
  'newsletter',
  'automated_notification',
]);
/** Always on the desk. */
const ALWAYS_RINGS: ReadonlySet<EmailCategory> = new Set([
  'important_decision',
  'complaint',
  'legal_or_official',
  'partner_or_organisation',
]);

/** A sender that is a machine, not a person: "noreply", bounces and the like. */
const MACHINE_SENDER =
  /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?)([._+-]|$)/i;

/** Sent to a list: a newsletter, whatever else it is. */
export function isNewsletter(email: IncomingEmail): boolean {
  return email.listUnsubscribe || email.listId;
}

/** Sent by a machine, or from our own mailbox: never answered, and without the model not rung. */
export function isAutomated(email: IncomingEmail, ownAddress: string): boolean {
  const local = email.fromAddress.split('@')[0] ?? '';
  return (
    email.fromAddress === '' ||
    email.fromAddress === ownAddress.toLowerCase() ||
    MACHINE_SENDER.test(local) ||
    email.autoSubmitted ||
    email.bulk
  );
}

export function senderDomain(address: string): string {
  const domain = address.split('@')[1]?.trim().toLowerCase();
  return domain ? domain.slice(0, 200) : 'unknown';
}

/** Who an email is from, in words Ozi can say: a name, never an address. */
function spokenSender(email: IncomingEmail): string {
  const domain = senderDomain(email.fromAddress);
  const name = email.fromName && !email.fromName.includes('@') ? email.fromName : null;
  return name ? `${name.slice(0, 80)} at ${domain}` : `someone at ${domain}`;
}

function shortSubject(subject: string): string {
  const words = subject.trim() || 'no subject';
  return words.length > 100 ? `${words.slice(0, 97)}…` : words;
}

interface Decision {
  category: EmailCategory;
  important: boolean;
  /** One or two spoken sentences for the stored summary (ruling 85). */
  summary: string;
  /** What Ozi says, when it goes on the desk. */
  ask: string | null;
  /** A reply to send instead, when it may be answered automatically. */
  reply: string | null;
}

/** What to do with one email: ask the owner, reply, or only mark it as read. */
async function decide(
  ctx: EmailContext,
  email: IncomingEmail,
  options: EmailDeskOptions,
): Promise<Decision> {
  const automated = isAutomated(email, options.ownAddress);
  const newsletter = isNewsletter(email);
  const who = spokenSender(email);
  const subject = shortSubject(email.subject);

  let triage: EmailTriage | null = null;
  if (ctx.brain?.triageEmail) {
    triage = await ctx.brain.triageEmail({
      fromName: email.fromName,
      fromAddress: email.fromAddress,
      subject: email.subject,
      text: email.text,
      attachmentNames: email.attachmentNames,
    });
  }

  const to = (options.number ?? 1) > 1 ? ` to ${options.label ?? 'another mailbox'}` : '';
  const plain = `An email${to} from ${who}, with the subject: ${subject}.`;
  if (!triage) {
    // No model, or it did not answer: a person is asked about, a machine or a list is not.
    if (newsletter) {
      return { category: 'newsletter', important: false, summary: plain, ask: null, reply: null };
    }
    if (automated) {
      return {
        category: 'automated_notification',
        important: false,
        summary: plain,
        ask: null,
        reply: null,
      };
    }
    return { category: 'other', important: true, summary: plain, ask: plain, reply: null };
  }

  const { category } = triage;
  const summary = triage.summary;
  const ask = `${plain} ${summary}`;
  if (NEVER_RINGS.has(category)) {
    return { category, important: false, summary, ask: null, reply: null };
  }
  if (category === 'customer_question') {
    const mayReply =
      options.autoReply &&
      options.mailer !== null &&
      triage.suggestedReply !== null &&
      !triage.important &&
      !automated &&
      !newsletter;
    return mayReply
      ? { category, important: false, summary, ask: null, reply: triage.suggestedReply }
      : { category, important: triage.important, summary, ask, reply: null };
  }
  const important = triage.important || ALWAYS_RINGS.has(category);
  return { category, important, summary, ask: important ? ask : null, reply: null };
}

/** The display name only, never an address (ruling 85). */
function displayName(email: IncomingEmail): string | null {
  const name = email.fromName?.replace(/\s+/g, ' ').trim() ?? '';
  if (!name || name.includes('@')) return null;
  return blankPrivate(name).slice(0, 80);
}

/** The reply as sent: short, polite, signed as the service (Rule Nine). */
export function replyText(ctx: Pick<AppContext, 'config'>, answer: string): string {
  return `Hello,\n\n${answer.trim()}\n\nKind regards,\n${ctx.config.productName}`;
}

/**
 * Reads the unread emails once. Safe to run as often as anyone likes: an email already recorded
 * is only marked as read again.
 */
export async function sweepEmail(
  ctx: EmailContext,
  options: EmailDeskOptions,
  log?: FastifyBaseLogger,
): Promise<EmailSweepReport> {
  const report: EmailSweepReport = {
    read: 0,
    matters: 0,
    replied: 0,
    quiet: 0,
    duplicates: 0,
    failed: 0,
  };
  const session = await options.mailbox.open();
  try {
    for (const email of await session.unseen(options.limit ?? 25)) {
      try {
        const key = emailKey(email);
        if (await ctx.repository.emails.findByMessageId(key)) {
          await session.markSeen(email.uid);
          report.duplicates += 1;
          continue;
        }
        report.read += 1;
        const decision = await decide(ctx, email, options);
        const domain = senderDomain(email.fromAddress);
        let matterId: string | null = null;
        let replied = false;
        let ask = decision.ask;

        if (decision.reply && options.mailer) {
          try {
            await options.mailer.send({
              to: email.fromAddress,
              subject: /^re:/i.test(email.subject)
                ? email.subject
                : `Re: ${email.subject || 'your email'}`,
              text: replyText(ctx, decision.reply),
              inReplyTo: email.messageId,
            });
            replied = true;
            await auditAutomatic(
              ctx,
              `email=${domain}`,
              `Answered a customer question by email from someone at ${domain}.`,
            );
          } catch (failure) {
            log?.warn(
              { err: failure instanceof Error ? failure.message : 'unknown', uid: email.uid },
              'An automatic reply to an email could not be sent; the owner is asked instead.',
            );
            ask = `An email from ${spokenSender(email)}, with the subject: ${shortSubject(email.subject)}. It is a customer question that could not be answered automatically.`;
          }
        }

        // Another email from a person goes on the desk only if he asked to hear of them (ruling
        // 85); spam, newsletters and notices never do.
        let alertKind: 'importantEmail' | 'otherEmail' = 'importantEmail';
        if (
          !ask &&
          !replied &&
          !decision.important &&
          !NEVER_RINGS.has(decision.category) &&
          !isAutomated(email, options.ownAddress) &&
          !isNewsletter(email)
        ) {
          const preferences = await alertPreferences(ctx);
          if (preferences.ways.otherEmail !== 'none') {
            ask = `An email${(options.number ?? 1) > 1 ? ` to ${options.label ?? 'another mailbox'}` : ''} from ${spokenSender(email)}, with the subject: ${shortSubject(email.subject)}. ${decision.summary}`;
            alertKind = 'otherEmail';
          }
        }

        if (ask && !replied) {
          const matter = await askOwner(
            ctx,
            {
              kind: 'email',
              subjectId: key,
              summary: ask,
              options: 'acknowledge',
              ...(alertKind === 'otherEmail' ? { alertKind } : {}),
              email: {
                from: email.fromName
                  ? `${email.fromName} <${email.fromAddress}>`
                  : email.fromAddress,
                subject: email.subject || '(no subject)',
              },
            },
            log,
          );
          // Not kept: leave the email unread and try again next time.
          if (!matter) throw new Error('The matter for an email could not be kept.');
          matterId = matter.id;
          report.matters += 1;
        } else if (replied) {
          report.replied += 1;
        } else {
          report.quiet += 1;
        }

        // The short summary for the owner to listen to (ruling 85). Never an attachment; the
        // address only to send his reply, never shown or said.
        const received = email.date ? new Date(email.date) : ctx.now();
        await ctx.repository.emailSummaries.save({
          messageId: key,
          mailbox: options.number ?? 1,
          mailboxLabel: options.label ?? FIRST_MAILBOX_LABEL,
          fromName: displayName(email),
          replyTo: email.fromAddress,
          subject: blankPrivate(email.subject).slice(0, 300),
          receivedAt: Number.isNaN(received.getTime()) ? ctx.now() : received,
          summary: blankPrivate(decision.summary).slice(0, 400),
          category: decision.category,
          important: decision.important,
          excerpt: blankedExcerpt(email.text, ctx.config.emailDesk.readAloudCharacters),
        });

        await ctx.repository.emails.record({
          messageId: key,
          fromDomain: domain,
          category: decision.category,
          important: decision.important,
          matterId,
          replied,
          processedAt: ctx.now(),
        });
        // Only once it is recorded: an email marked read is never lost track of.
        await session.markSeen(email.uid);
      } catch (failure) {
        report.failed += 1;
        log?.warn(
          { err: failure instanceof Error ? failure.message : 'unknown', uid: email.uid },
          'An email could not be sorted; it stays unread and is tried again.',
        );
      }
    }
  } finally {
    await session.close();
  }
  return report;
}
