/**
 * The Inbox helper. For each email that arrives:
 *
 *   1. Takes out card numbers, passwords, codes and banned words before anything is kept.
 *   2. Sorts it: spam, complaint, order, shop or partner, council, job, or general.
 *   3. Texts Anthony at once if it is urgent.
 *   4. Answers from what it was taught (or drafts with its brain).
 *   5. Sends the reply only if Anthony has let that kind of reply go alone; otherwise it waits on
 *      the review list for a person to approve, correct or turn down. Approved replies are taught.
 *
 * It never replies to automatic emails (no-reply addresses, mailing lists, out of office), so two
 * robots can never write to each other all night.
 */
import type { TeachableHelper } from '../../core/helper.js';
import type { Runtime } from '../../core/runtime.js';
import { shorten } from '../../core/text.js';
import type { ReviewItem } from '../../core/types.js';
import { CATEGORY_LABELS, sortEmail, type Category } from './classify.js';
import { newestPart, type IncomingEmail } from './mime.js';

export type InboxAction = 'ignored' | 'replied' | 'drafted' | 'needs-answer' | 'not-allowed';

export interface InboxResult {
  helperId: string;
  category: Category | null;
  urgent: boolean;
  action: InboxAction;
  reviewId: string | null;
  /** Plain English, as written in the log. */
  summary: string;
}

/** The inbox helper that looks after an address; the first inbox helper if none names it. */
export function inboxFor(runtime: Runtime, to: string): TeachableHelper | undefined {
  const inboxes = runtime.ofType('inbox');
  const address = to.toLowerCase();
  return (
    inboxes.find((helper) =>
      helper.config.inbox?.addresses.some((a) => a.toLowerCase() === address),
    ) ?? inboxes[0]
  );
}

/** An email written by a machine, which must never be answered by a machine. */
export function isAutomatic(email: IncomingEmail): boolean {
  const headers = email.headers;
  if (
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?)[@+._-]/i.test(
      email.from,
    )
  )
    return true;
  if (headers['auto-submitted'] && headers['auto-submitted'].toLowerCase() !== 'no') return true;
  if (headers['list-id'] || headers['list-unsubscribe']) return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(headers.precedence ?? '')) return true;
  if (headers['x-autoreply'] || headers['x-autorespond']) return true;
  if (
    /^(auto(matic)? reply|out of (the )?office|autoreply|undeliverable|delivery status notification)/i.test(
      email.subject,
    )
  ) {
    return true;
  }
  return false;
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && /^[A-Za-z][A-Za-z'-]{1,30}$/.test(first) ? first : null;
}

/** A reply built around a taught answer: greeting, the answer, the business's signature. */
export function composeReply(answer: string, name: string | null, signature: string): string {
  const hello = firstName(name) ? `Hello ${firstName(name)},` : 'Hello,';
  return `${hello}\n\n${answer.trim()}\n\n${signature}`;
}

function replySubject(subject: string): string {
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject || 'your email'}`;
}

/** Sends an approved (or act alone) reply, and notes on the review item what happened. */
export async function sendReply(
  runtime: Runtime,
  helper: TeachableHelper,
  item: ReviewItem,
): Promise<ReviewItem> {
  if (!item.email || !item.finalAnswer) return item;
  if (!helper.can('send-email')) {
    return helper.recordOutcome(
      item,
      'Approved. This helper may not send email, so a person needs to send it.',
    );
  }
  const from = helper.config.inbox?.replyFrom ?? helper.config.inbox?.addresses[0] ?? item.email.to;
  try {
    const result = await runtime.email.send({
      from,
      to: item.email.from,
      subject: replySubject(item.email.subject),
      text: item.finalAnswer,
      inReplyTo: item.email.messageId,
    });
    if (result.sent) {
      await helper.log(
        'email.replied',
        `${helper.name} sent a reply to ${item.email.from} about "${shorten(item.email.subject)}".`,
      );
      return helper.recordOutcome(item, `Sent to ${item.email.from}.`);
    }
    await helper.log(
      'email.outbox',
      `The reply to ${item.email.from} is in the outbox for a person to send. ${result.detail}`,
    );
    return helper.recordOutcome(item, `In the outbox for a person to send to ${item.email.from}.`);
  } catch (error) {
    await helper.log(
      'email.failed',
      `The reply to ${item.email.from} could not be sent: ${(error as Error).message}`,
    );
    return helper.recordOutcome(item, 'Approved, but sending failed. A person needs to send it.');
  }
}

export async function handleEmail(runtime: Runtime, email: IncomingEmail): Promise<InboxResult> {
  const helper = inboxFor(runtime, email.to);
  if (!helper) throw new Error('No inbox helper is set up.');
  const result = (partial: Omit<InboxResult, 'helperId'>): InboxResult => ({
    helperId: helper.id,
    ...partial,
  });

  if (!(await helper.allowed('read-email', 'read an email'))) {
    return result({
      category: null,
      urgent: false,
      action: 'not-allowed',
      reviewId: null,
      summary: 'Not allowed to read email.',
    });
  }
  const own = (helper.config.inbox?.addresses ?? []).map((a) => a.toLowerCase());
  if (own.includes(email.from.toLowerCase())) {
    const summary = 'An email from our own address was ignored, to avoid writing to ourselves.';
    await helper.log('email.ignored', summary);
    return result({ category: null, urgent: false, action: 'ignored', reviewId: null, summary });
  }

  // 1. Nothing private and no banned word is ever kept.
  const subjectClean = helper.clean(email.subject);
  const bodyClean = helper.clean(newestPart(email.text) || email.text);
  const subject = subjectClean.cleaned ?? '(subject not kept: it contained words we do not keep)';
  const body = bodyClean.cleaned;
  const removed = [...new Set([...subjectClean.removed, ...bodyClean.removed])];

  // 2. Sort it.
  const sorted = sortEmail(subject, body ?? '', helper.config.inbox?.categoryWords);
  const who = email.fromName ? `${email.fromName} (${email.from})` : email.from;
  await helper.log(
    'email.received',
    `An email from ${who} about "${shorten(subject)}" arrived. It looks like ${CATEGORY_LABELS[sorted.category]}${sorted.urgent ? ', and it is urgent' : ''}.` +
      (removed.length > 0 ? ` Taken out before keeping: ${removed.join(', ')}.` : ''),
    { category: sorted.category, urgent: sorted.urgent },
  );

  if (sorted.category === 'spam') {
    const summary = `Spam from ${email.from} was set aside.`;
    await helper.log('email.spam', summary);
    return result({ category: 'spam', urgent: false, action: 'ignored', reviewId: null, summary });
  }

  // 3. Urgent: tell Anthony now, by text.
  if (sorted.urgent) {
    await runtime.textOwner(
      helper,
      `${runtime.ownerName}, urgent email to ${helper.business.name} from ${email.fromName ?? email.from}: ${shorten(subject, 60)}. Words: ${sorted.urgentWords.slice(0, 3).join(', ')}.`,
    );
  }

  const context = {
    from: email.from,
    to: email.to,
    subject,
    messageId: email.messageId,
    category: sorted.category,
    urgent: sorted.urgent,
  };

  if (body === null) {
    const item = await helper.askForReview({
      kind: 'reply',
      messageKind: 'sensitive-reply',
      question: '(This email contained words we do not keep. Please read it in the normal inbox.)',
      email: context,
    });
    return result({
      category: sorted.category,
      urgent: sorted.urgent,
      action: 'needs-answer',
      reviewId: item.id,
      summary: 'Needs a person: it contained words we do not keep.',
    });
  }

  if (isAutomatic(email)) {
    const summary = `No reply to ${email.from}: it was sent by a machine.`;
    await helper.log('email.no-reply', summary);
    return result({
      category: sorted.category,
      urgent: sorted.urgent,
      action: 'ignored',
      reviewId: null,
      summary,
    });
  }

  // 4. Answer from what was taught, or draft with the brain.
  const question = subject && !/^\(subject/.test(subject) ? `${subject}\n${body}` : body;
  const answer = (await helper.allowed('draft-replies', 'draft a reply'))
    ? await helper.answer(question, 'email')
    : null;
  const taught = answer?.source === 'exact' || answer?.source === 'keyword';
  const reply =
    answer?.text && taught
      ? composeReply(answer.text, email.fromName, helper.business.signature)
      : (answer?.text ?? null);
  const messageKind = sorted.urgent
    ? 'urgent-reply'
    : sorted.category === 'complaint'
      ? 'complaint-reply'
      : taught
        ? 'taught-reply'
        : 'drafted-reply';

  // 5. Send alone only if Anthony said so for this kind of reply; otherwise a person approves.
  if (reply && (await helper.mayActAlone(messageKind)) && helper.can('send-email')) {
    const item = await helper.askForReview({
      kind: 'reply',
      messageKind,
      question: body,
      suggestedAnswer: reply,
      suggestedBy: taught ? 'taught' : 'brain',
      email: context,
    });
    const decided: ReviewItem = {
      ...item,
      status: 'approved',
      finalAnswer: reply,
      decidedBy: `${helper.name} (on its own, as allowed)`,
    };
    await helper.records.saveReview(decided);
    const sent = await sendReply(runtime, helper, decided);
    const summary = `${helper.name} answered ${email.from} on its own: ${sent.outcome ?? ''}`;
    return result({
      category: sorted.category,
      urgent: sorted.urgent,
      action: 'replied',
      reviewId: item.id,
      summary,
    });
  }

  const item = await helper.askForReview({
    kind: 'reply',
    messageKind,
    question: body,
    suggestedAnswer: reply,
    suggestedBy: reply ? (taught ? 'taught' : 'brain') : null,
    email: context,
  });
  const summary = reply
    ? `A reply to ${email.from} is drafted and waiting for approval.`
    : `The email from ${email.from} needs a person to answer; it is on the review list.`;
  await helper.log(reply ? 'email.drafted' : 'email.needs-answer', summary);
  return result({
    category: sorted.category,
    urgent: sorted.urgent,
    action: reply ? 'drafted' : 'needs-answer',
    reviewId: item.id,
    summary,
  });
}
