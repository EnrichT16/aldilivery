/**
 * Ozi reads the business mailbox (ruling 76, 22 October 2026): important emails go on Ozi's
 * desk, unimportant ones never ring, and simple customer questions are answered only when
 * EMAIL_AUTO_REPLY is on. Acted out with a stand-in mailbox, a stand-in mailer and a stand-in
 * brain: no network is used.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { readEnv } from '../src/env.js';
import type { EmailTriage, EmailTriageInput, OziBrain } from '../src/lib/language-model.js';
import {
  emailKey,
  mailboxSettings,
  readEmail,
  TEXT_LIMIT,
  type IncomingEmail,
  type Mailbox,
  type Mailer,
  type OutgoingEmail,
} from '../src/lib/mailbox.js';
import { sweepEmail, type EmailDeskOptions } from '../src/services/email-desk.js';
import { STAFF, buildTestApp, testEnv, type TestHarness } from './helpers.js';

const OWN = 'hello@business.example.test';
let harness: TestHarness;

afterEach(async () => {
  await harness?.close();
});

let nextUid = 1;
function anEmail(overrides: Partial<IncomingEmail> = {}): IncomingEmail {
  const uid = nextUid++;
  return {
    uid,
    messageId: `<message-${uid}@sender.example.test>`,
    fromAddress: 'jane.smith@example.test',
    fromName: 'Jane Smith',
    subject: 'A question',
    text: 'Hello, I have a question.',
    attachmentNames: [],
    date: '2026-10-22T09:00:00.000Z',
    listUnsubscribe: false,
    listId: false,
    autoSubmitted: false,
    bulk: false,
    ...overrides,
  };
}

/** A mailbox holding some unread emails. Marking one read takes it out of the unread list. */
function standInMailbox(emails: IncomingEmail[]) {
  const unread = [...emails];
  const seen: number[] = [];
  let opened = 0;
  let closed = 0;
  const mailbox: Mailbox = {
    async open() {
      opened += 1;
      return {
        async unseen(limit) {
          return unread.slice(0, limit);
        },
        async markSeen(uid) {
          seen.push(uid);
          const index = unread.findIndex((email) => email.uid === uid);
          if (index >= 0) unread.splice(index, 1);
        },
        async close() {
          closed += 1;
        },
      };
    },
  };
  return {
    mailbox,
    seen,
    unread,
    deliver(email: IncomingEmail) {
      unread.push(email);
    },
    counts: () => ({ opened, closed }),
  };
}

function standInMailer() {
  const sent: OutgoingEmail[] = [];
  const mailer: Mailer = {
    async send(email) {
      sent.push(email);
    },
  };
  return { mailer, sent };
}

function standInBrain(answer: (input: EmailTriageInput) => EmailTriage | null) {
  const asked: EmailTriageInput[] = [];
  const brain: OziBrain = {
    name: 'model',
    model: 'stand-in',
    understand: async () => null,
    triageEmail: async (input) => {
      asked.push(input);
      return answer(input);
    },
  };
  return { brain, asked };
}

const AT = new Date('2026-10-22T10:00:00.000Z');

async function build(brain?: OziBrain): Promise<TestHarness> {
  harness = await buildTestApp(AT, brain ? { brain } : {});
  return harness;
}

function options(mailbox: Mailbox, extra: Partial<EmailDeskOptions> = {}): EmailDeskOptions {
  return { mailbox, mailer: null, autoReply: false, ownAddress: OWN, ...extra };
}

describe('an important email', () => {
  it('becomes a matter on Ozi’s desk, says who it is from and what about, and is marked read', async () => {
    const { brain, asked } = standInBrain(() => ({
      category: 'legal_or_official',
      important: true,
      summary:
        'HMRC says the VAT return for reference 123456789012 is due by the end of the month.',
      suggestedReply: null,
    }));
    await build(brain);
    const email = anEmail({
      fromName: 'HMRC',
      fromAddress: 'noreply@hmrc.example.test',
      subject: 'Your VAT return is due',
      text: 'Dear taxpayer, '.repeat(400),
      attachmentNames: ['letter.pdf'],
    });
    const box = standInMailbox([email]);

    const report = await sweepEmail(harness.app.ctx, options(box.mailbox));
    expect(report).toMatchObject({ read: 1, matters: 1, quiet: 0, failed: 0 });
    expect(asked[0]).toMatchObject({
      subject: 'Your VAT return is due',
      attachmentNames: ['letter.pdf'],
    });

    const [matter] = await harness.repository.ownerDesk.findMattersFor('email', emailKey(email));
    expect(matter).toMatchObject({
      kind: 'email',
      options: 'acknowledge',
      status: 'open',
      emailFrom: 'HMRC <noreply@hmrc.example.test>',
      emailSubject: 'Your VAT return is due',
    });
    expect(matter!.summary).toContain('An email from HMRC at hmrc.example.test');
    expect(matter!.summary).toContain('Your VAT return is due');
    // Never a long number or an address read aloud.
    expect(matter!.summary).not.toMatch(/\d{9,}/);
    expect(matter!.summary).not.toContain('@');

    const record = await harness.repository.emails.findByMessageId(emailKey(email));
    expect(record).toMatchObject({
      fromDomain: 'hmrc.example.test',
      category: 'legal_or_official',
      important: true,
      matterId: matter!.id,
      replied: false,
    });
    expect(box.seen).toEqual([email.uid]);
    expect(box.counts()).toEqual({ opened: 1, closed: 1 });

    // The admin panel's desk shows who it is from and the subject.
    const listed = await harness.app.inject({ method: 'GET', url: '/staff/desk', headers: STAFF });
    expect(listed.json().matters).toEqual([
      expect.objectContaining({
        kind: 'email',
        emailFrom: 'HMRC <noreply@hmrc.example.test>',
        emailSubject: 'Your VAT return is due',
      }),
    ]);
  });

  it('a complaint rings even if the model says it is not important', async () => {
    const { brain } = standInBrain(() => ({
      category: 'complaint',
      important: false,
      summary: 'They say their order came late.',
      suggestedReply: null,
    }));
    await build(brain);
    const box = standInMailbox([anEmail()]);
    expect(await sweepEmail(harness.app.ctx, options(box.mailbox))).toMatchObject({ matters: 1 });
  });
});

describe('spam, newsletters and notices', () => {
  it('are only marked read: no matter, never a ring', async () => {
    const categories = ['spam_or_marketing', 'newsletter', 'automated_notification'] as const;
    let index = 0;
    const { brain } = standInBrain(() => ({
      category: categories[index++]!,
      // Even marked important, these never ring.
      important: true,
      summary: 'Buy now.',
      suggestedReply: null,
    }));
    await build(brain);
    const emails = [anEmail(), anEmail(), anEmail()];
    const box = standInMailbox(emails);
    const report = await sweepEmail(harness.app.ctx, options(box.mailbox));
    expect(report).toMatchObject({ read: 3, matters: 0, quiet: 3 });
    expect(await harness.repository.ownerDesk.listUnsettled()).toEqual([]);
    expect(box.seen).toEqual(emails.map((email) => email.uid));
    const record = await harness.repository.emails.findByMessageId(emailKey(emails[0]!));
    expect(record).toMatchObject({
      category: 'spam_or_marketing',
      important: false,
      matterId: null,
    });
  });
});

describe('the same email twice', () => {
  it('is sorted once: a second copy with the same Message-ID is only marked read', async () => {
    const { brain, asked } = standInBrain(() => ({
      category: 'partner_or_organisation',
      important: true,
      summary: 'A charity would like to work with us.',
      suggestedReply: null,
    }));
    await build(brain);
    const first = anEmail({ messageId: '<same@example.test>' });
    const box = standInMailbox([first]);
    await sweepEmail(harness.app.ctx, options(box.mailbox));

    // The same email again, under another UID (copied back, or unread again).
    box.deliver(anEmail({ messageId: '<same@example.test>' }));
    const again = await sweepEmail(harness.app.ctx, options(box.mailbox));
    expect(again).toMatchObject({ read: 0, duplicates: 1, matters: 0 });
    expect(asked).toHaveLength(1);
    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(1);
    expect(box.unread).toEqual([]);
  });

  it('an email that could not be recorded stays unread and is tried again', async () => {
    const { brain } = standInBrain(() => ({
      category: 'complaint',
      important: true,
      summary: 'A complaint.',
      suggestedReply: null,
    }));
    await build(brain);
    const box = standInMailbox([anEmail()]);
    const record = harness.repository.emails.record;
    harness.repository.emails.record = async () => {
      throw new Error('database down');
    };
    expect(await sweepEmail(harness.app.ctx, options(box.mailbox))).toMatchObject({ failed: 1 });
    expect(box.seen).toEqual([]);
    harness.repository.emails.record = record;
    expect(await sweepEmail(harness.app.ctx, options(box.mailbox))).toMatchObject({ matters: 1 });
    expect(box.unread).toEqual([]);
    // Still only one matter: the first attempt's matter is the same one.
    expect(await harness.repository.ownerDesk.listUnsettled()).toHaveLength(1);
  });
});

describe('a simple customer question', () => {
  const answer = (): EmailTriage => ({
    category: 'customer_question',
    important: false,
    summary: 'Jane asks whether you deliver on Sundays.',
    suggestedReply: 'Yes, we deliver every day of the week.',
  });

  it('is answered automatically only when EMAIL_AUTO_REPLY is on', async () => {
    const { brain } = standInBrain(answer);
    await build(brain);
    const { mailer, sent } = standInMailer();
    const email = anEmail({ subject: 'Sunday delivery?' });
    const box = standInMailbox([email]);
    const report = await sweepEmail(
      harness.app.ctx,
      options(box.mailbox, { mailer, autoReply: true }),
    );
    expect(report).toMatchObject({ replied: 1, matters: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'jane.smith@example.test',
      subject: 'Re: Sunday delivery?',
      inReplyTo: email.messageId,
    });
    expect(sent[0]!.text).toContain('Yes, we deliver every day of the week.');
    expect(sent[0]!.text).toContain(`Kind regards,\n${harness.config.productName}`);
    expect(await harness.repository.emails.findByMessageId(emailKey(email))).toMatchObject({
      category: 'customer_question',
      replied: true,
      matterId: null,
    });
    expect(await harness.repository.ownerDesk.listUnsettled()).toEqual([]);
    const audit = await harness.repository.audit.list({ search: 'automatic-check' });
    expect(audit[0]?.detail).toContain('example.test');
  });

  it('is a matter for the owner when automatic replies are off', async () => {
    const { brain } = standInBrain(answer);
    await build(brain);
    const { mailer, sent } = standInMailer();
    const box = standInMailbox([anEmail()]);
    const report = await sweepEmail(harness.app.ctx, options(box.mailbox, { mailer }));
    expect(report).toMatchObject({ replied: 0, matters: 1 });
    expect(sent).toEqual([]);
  });

  it('is never answered when it came from a machine, and a failed send asks the owner', async () => {
    const { brain } = standInBrain(answer);
    await build(brain);
    const failing: Mailer = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const { mailer, sent } = standInMailer();
    const box = standInMailbox([anEmail({ fromAddress: 'no-reply@shop.example.test' })]);
    await sweepEmail(harness.app.ctx, options(box.mailbox, { mailer, autoReply: true }));
    expect(sent).toEqual([]);

    const second = standInMailbox([anEmail()]);
    const report = await sweepEmail(
      harness.app.ctx,
      options(second.mailbox, { mailer: failing, autoReply: true }),
    );
    expect(report).toMatchObject({ replied: 0, matters: 1 });
  });
});

describe('without the language model key', () => {
  it('an email from a person is a matter with sender and subject; noreply and lists are not', async () => {
    await build();
    const person = anEmail({ fromName: 'Tom Brown', subject: 'Can we talk?' });
    const noreply = anEmail({ fromAddress: 'noreply@bank.example.test', fromName: 'The Bank' });
    const newsletter = anEmail({ fromAddress: 'news@shop.example.test', listUnsubscribe: true });
    const box = standInMailbox([person, noreply, newsletter]);
    const report = await sweepEmail(harness.app.ctx, options(box.mailbox));
    expect(report).toMatchObject({ read: 3, matters: 1, quiet: 2 });
    const open = await harness.repository.ownerDesk.listUnsettled();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: 'email',
      subjectId: emailKey(person),
      summary: 'An email from Tom Brown at example.test, with the subject: Can we talk?.',
      emailSubject: 'Can we talk?',
    });
    expect(await harness.repository.emails.findByMessageId(emailKey(newsletter))).toMatchObject({
      category: 'newsletter',
    });
    expect(await harness.repository.emails.findByMessageId(emailKey(noreply))).toMatchObject({
      category: 'automated_notification',
    });
    expect(box.unread).toEqual([]);
  });
});

describe('the settings', () => {
  it('are off unless host, user and password are all real', () => {
    expect(mailboxSettings(testEnv)).toBeNull();
    expect(mailboxSettings(readEnv({ NODE_ENV: 'test' }))).toBeNull();
    expect(
      mailboxSettings(
        readEnv({
          NODE_ENV: 'test',
          EMAIL_IMAP_HOST: 'mail.example.test',
          EMAIL_IMAP_USER: 'hello@example.test',
          EMAIL_IMAP_PASSWORD: 'replace_with_the_mailbox_password',
        }),
      ),
    ).toBeNull();
    expect(
      mailboxSettings(
        readEnv({
          NODE_ENV: 'test',
          EMAIL_IMAP_HOST: 'replace_with_the_incoming_server_from_cpanel',
          EMAIL_IMAP_USER: 'hello@example.test',
          EMAIL_IMAP_PASSWORD: 'a real password',
        }),
      ),
    ).toBeNull();
  });

  it('read port 993 over TLS by default, and replies only with an outgoing server', () => {
    const settings = mailboxSettings(
      readEnv({
        NODE_ENV: 'test',
        EMAIL_IMAP_HOST: 'mail.example.test',
        EMAIL_IMAP_USER: 'hello@example.test',
        EMAIL_IMAP_PASSWORD: 'a real password',
      }),
    );
    expect(settings).toMatchObject({
      imap: { host: 'mail.example.test', port: 993, secure: true },
      smtp: null,
      user: 'hello@example.test',
      autoReply: false,
    });
    const replying = mailboxSettings(
      readEnv({
        NODE_ENV: 'test',
        EMAIL_IMAP_HOST: 'mail.example.test',
        EMAIL_IMAP_USER: 'hello@example.test',
        EMAIL_IMAP_PASSWORD: 'a real password',
        EMAIL_SMTP_HOST: 'mail.example.test',
        EMAIL_AUTO_REPLY: 'on',
      }),
    );
    expect(replying).toMatchObject({
      smtp: { host: 'mail.example.test', port: 465, secure: true },
      autoReply: true,
    });
  });
});

describe('reading an email', () => {
  it('takes the sender, subject, the start of the text, attachment names and list headers', async () => {
    const raw = [
      'From: "Jane Smith" <Jane.Smith@Example.test>',
      'To: hello@business.example.test',
      'Subject: Hello there',
      'Message-ID: <abc@example.test>',
      'List-Unsubscribe: <mailto:off@example.test>',
      'Date: Thu, 22 Oct 2026 10:00:00 +0100',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'x'.repeat(5000),
      '--b',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'SGVsbG8=',
      '--b--',
      '',
    ].join('\r\n');
    const email = await readEmail(7, Buffer.from(raw));
    expect(email).toMatchObject({
      uid: 7,
      messageId: '<abc@example.test>',
      fromAddress: 'jane.smith@example.test',
      fromName: 'Jane Smith',
      subject: 'Hello there',
      attachmentNames: ['invoice.pdf'],
      listUnsubscribe: true,
      autoSubmitted: false,
    });
    expect(email.text).toHaveLength(TEXT_LIMIT);
    expect(emailKey(email)).toBe('<abc@example.test>');
    expect(emailKey({ ...email, messageId: null })).toMatch(/^no-message-id:[0-9a-f]{64}$/);
  });
});
