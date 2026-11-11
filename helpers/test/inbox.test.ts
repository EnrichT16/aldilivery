import { describe, expect, it } from 'vitest';

import { sortEmail } from '../src/helpers/inbox/classify.js';
import { composeReply, handleEmail, isAutomatic } from '../src/helpers/inbox/inbox.js';
import { FakeBrain, FakeEmail, email, harness } from './support.js';

describe('sorting email', () => {
  it('sorts the common kinds', () => {
    expect(sortEmail('Where is my order?', 'My delivery has not come').category).toBe('order');
    expect(
      sortEmail('Complaint', 'The driver was rude and the food was cold. I want a refund.')
        .category,
    ).toBe('complaint');
    expect(
      sortEmail('Partnership', 'We run a shop and would like to list our products').category,
    ).toBe('partner');
    expect(sortEmail('Licence renewal', 'From the borough council licensing team').category).toBe(
      'council',
    );
    expect(
      sortEmail(
        'SEO services',
        'We can get you backlinks and rank your website on the first page of Google',
      ).category,
    ).toBe('spam');
    expect(sortEmail('Hello', 'Just saying thank you').category).toBe('general');
  });

  it('flags urgent email, and never calls urgent email spam', () => {
    const sorted = sortEmail('URGENT', 'A runner had an accident, the police are here');
    expect(sorted.urgent).toBe(true);
    expect(sorted.urgentWords).toEqual(expect.arrayContaining(['urgent', 'accident', 'police']));
    expect(sortEmail('crypto lottery', 'you have won, urgent fraud alert').category).not.toBe(
      'spam',
    );
  });

  it('learns extra words from the configuration', () => {
    expect(sortEmail('Hamper', 'About my hamper', { order: ['hamper'] }).category).toBe('order');
  });
});

describe('automatic email', () => {
  it('is never answered', () => {
    expect(isAutomatic(email({ from: 'no-reply@shop.example' }))).toBe(true);
    expect(isAutomatic(email({ headers: { 'auto-submitted': 'auto-replied' } }))).toBe(true);
    expect(isAutomatic(email({ headers: { 'list-unsubscribe': '<mailto:x>' } }))).toBe(true);
    expect(isAutomatic(email({ subject: 'Out of office: back Monday' }))).toBe(true);
    expect(isAutomatic(email())).toBe(false);
  });
});

describe('the Inbox helper', () => {
  it('answers from a taught answer, but waits for approval until allowed to act alone', async () => {
    const sender = new FakeEmail();
    const { runtime } = harness({ email: sender, noBrain: true });
    const helper = runtime.helper('inbox')!;
    await helper.teach({
      question: 'What are your opening hours?',
      answer: 'We are open nine till five.',
      by: 'Anthony',
    });

    const first = await handleEmail(runtime, email());
    expect(first.action).toBe('drafted');
    expect(sender.sent).toHaveLength(0);
    const [draft] = await helper.waiting();
    expect(draft!.suggestedAnswer).toBe(
      'Hello Jane,\n\nWe are open nine till five.\n\nKind regards,\nThe Example team',
    );
    expect(draft!.messageKind).toBe('taught-reply');

    await helper.setActAlone('taught-reply', true, 'Anthony');
    const second = await handleEmail(runtime, email({ messageId: '<second@x>' }));
    expect(second.action).toBe('replied');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      from: 'hello@example.com',
      to: 'jane@customer.example',
      subject: 'Re: Opening hours',
      inReplyTo: '<second@x>',
    });
  });

  it('drafts with the brain when nothing taught matches', async () => {
    const brain = new FakeBrain(
      () => 'Hello Sam,\n\nYes, we can help with that.\n\nKind regards,\nThe Example team',
    );
    const { runtime } = harness({ brain });
    const result = await handleEmail(
      runtime,
      email({ fromName: 'Sam', subject: 'Laptop repair', text: 'Can you fix a laptop screen?' }),
    );
    expect(result.action).toBe('drafted');
    const [draft] = await runtime.helper('inbox')!.waiting();
    expect(draft!.suggestedBy).toBe('brain');
    expect(draft!.messageKind).toBe('drafted-reply');
  });

  it('puts an email nobody can answer on the review list', async () => {
    const { runtime } = harness({ noBrain: true });
    const result = await handleEmail(
      runtime,
      email({ subject: 'Question', text: 'Do you sponsor football teams?' }),
    );
    expect(result.action).toBe('needs-answer');
    expect((await runtime.helper('inbox')!.waiting())[0]!.suggestedAnswer).toBeNull();
  });

  it('texts Anthony about urgent email, and never sends a reply to it alone', async () => {
    const sender = new FakeEmail();
    const { runtime, sms } = harness({ email: sender, noBrain: true });
    const helper = runtime.helper('inbox')!;
    await helper.setActAlone('taught-reply', true, 'Anthony');
    await helper.teach({
      question: 'There was an accident outside',
      answer: 'Sorry to hear that.',
      by: 'Anthony',
    });
    const result = await handleEmail(
      runtime,
      email({ subject: 'Urgent: accident', text: 'There was an accident outside, please call me' }),
    );
    expect(result.urgent).toBe(true);
    expect(result.action).toBe('drafted');
    expect(sender.sent).toHaveLength(0);
    expect(sms.sentForReal).toHaveLength(1);
    expect(sms.sentForReal[0]!.to).toBe('+447700900000');
    expect(sms.sentForReal[0]!.text).toMatch(
      /^Anthony, urgent email to Example Services from Jane Smith/,
    );
  });

  it('sets spam aside without answering', async () => {
    const { runtime } = harness();
    const result = await handleEmail(
      runtime,
      email({
        subject: 'SEO services',
        text: 'Buy backlinks, rank your website, first page of google',
      }),
    );
    expect(result.action).toBe('ignored');
    expect(await runtime.helper('inbox')!.waiting()).toHaveLength(0);
  });

  it('does not reply to machines or to itself', async () => {
    const { runtime } = harness();
    expect((await handleEmail(runtime, email({ from: 'noreply@bank.example' }))).action).toBe(
      'ignored',
    );
    expect((await handleEmail(runtime, email({ from: 'hello@example.com' }))).action).toBe(
      'ignored',
    );
  });

  it('never keeps a card number or a banned word from an email', async () => {
    const { runtime, store } = harness({ noBrain: true });
    await handleEmail(
      runtime,
      email({
        subject: 'Refund',
        text: 'Refund to my card 4242 4242 4242 4242 you shit company. My password is hunter22',
      }),
    );
    const everything = [...store.data.values()].join(' ');
    expect(everything).not.toMatch(/4242|shit|hunter22/);
    expect(everything).toContain('[card number removed]');
  });

  it('keeps nothing of an email whose banned words cannot be taken out, but still asks a person', async () => {
    const { runtime, store } = harness({ noBrain: true });
    const result = await handleEmail(runtime, email({ subject: 'Hi', text: 'you are a f u c k' }));
    expect(result.action).toBe('needs-answer');
    expect([...store.data.values()].join(' ')).not.toMatch(/f u c k/);
  });

  it('does only what its permissions allow', async () => {
    const { runtime } = harness({ noBrain: true });
    runtime.helper('inbox')!.config.permissions = ['draft-replies'];
    const result = await handleEmail(runtime, email());
    expect(result.action).toBe('not-allowed');
    expect((await runtime.records.recentLog())[0]!.text).toMatch(/not allowed/);
  });

  it('builds a reply around a taught answer', () => {
    expect(composeReply('Yes.', 'Jane Smith', 'The team')).toBe('Hello Jane,\n\nYes.\n\nThe team');
    expect(composeReply('Yes.', null, 'The team')).toBe('Hello,\n\nYes.\n\nThe team');
    expect(composeReply('Yes.', 'info@x', 'The team')).toBe('Hello,\n\nYes.\n\nThe team');
  });
});
