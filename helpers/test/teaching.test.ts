import { describe, expect, it } from 'vitest';

import { TeachingRefused } from '../src/core/helper.js';
import { FakeBrain, harness } from './support.js';

describe('teaching and learning', () => {
  it('answers from a taught answer: exact first, then keywords', async () => {
    const { runtime } = harness();
    const helper = runtime.helper('inbox')!;
    await helper.teach({
      question: 'What are your opening hours?',
      alternatives: ['When are you open?'],
      answer: 'We are open nine till five, Monday to Friday.',
      by: 'Anthony',
    });

    const exact = await helper.answer('what are your opening hours');
    expect(exact.source).toBe('exact');
    expect(exact.text).toBe('We are open nine till five, Monday to Friday.');

    const alternative = await helper.answer('When are you open?');
    expect(alternative.source).toBe('exact');

    const keyword = await helper.answer('Could you tell me your opening hours please');
    expect(keyword.source).toBe('keyword');
    expect((await helper.knowledge())[0]!.timesUsed).toBe(3);
  });

  it('asks the brain with taught answers and rules as its only facts', async () => {
    const brain = new FakeBrain(() => 'Yes, we deliver on Saturdays.');
    const { runtime } = harness({ brain });
    const helper = runtime.helper('inbox')!;
    await helper.teach({
      question: 'Do you deliver at weekends?',
      answer: 'Yes, on Saturdays only.',
      by: 'Anthony',
    });
    await helper.teach({ kind: 'rule', answer: 'Never promise a delivery time.', by: 'Anthony' });

    const result = await helper.answer('Is Sunday delivery possible?');
    expect(result.source).toBe('brain');
    expect(brain.asked).toHaveLength(1);
    expect(brain.asked[0]!.system).toContain('Example Services');
    expect(brain.asked[0]!.system).toContain('Q: Do you deliver at weekends?');
    expect(brain.asked[0]!.system).toContain('- Never promise a delivery time.');
  });

  it('puts what nobody knows on the review list, counts repeats, and learns from approval', async () => {
    const { runtime } = harness({ noBrain: true });
    const helper = runtime.helper('inbox')!;
    const unknown = await helper.answer('Do you have parking?');
    expect(unknown.source).toBe('none');

    const first = await helper.askForReview({
      kind: 'question',
      messageKind: 'website-answer',
      question: 'Do you have parking?',
    });
    await helper.askForReview({
      kind: 'question',
      messageKind: 'website-answer',
      question: 'do you have parking',
    });
    const waiting = await helper.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.timesAsked).toBe(2);

    const { taught } = await helper.approve(first.id, {
      answer: 'Yes, two free spaces at the front.',
      by: 'Anthony',
    });
    expect(taught?.question).toBe('Do you have parking?');
    expect(await helper.waiting()).toHaveLength(0);

    const later = await helper.answer('Do you have parking?');
    expect(later.source).toBe('exact');
    expect(later.text).toBe('Yes, two free spaces at the front.');
  });

  it('corrects an answer rather than keeping two', async () => {
    const { runtime } = harness();
    const helper = runtime.helper('inbox')!;
    await helper.teach({ question: 'Where are you?', answer: 'Leeds.', by: 'Anthony' });
    await helper.teach({ question: 'where are you', answer: 'Manchester.', by: 'Anthony' });
    const knowledge = await helper.knowledge();
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]!.answer).toBe('Manchester.');
    const log = await runtime.records.recentLog();
    expect(log[0]!.text).toBe('Anthony corrected Inbox helper an answer to "where are you".');
  });

  it('never keeps a banned word, a card number or a request for secrets', async () => {
    const { runtime, store } = harness();
    const helper = runtime.helper('inbox')!;
    await expect(
      helper.teach({ question: 'Hello', answer: 'Go to hell you bastard', by: 'A' }),
    ).rejects.toThrow(TeachingRefused);
    await expect(
      helper.teach({ question: 'What is the shit price', answer: 'Five pounds.', by: 'A' }),
    ).rejects.toThrow(/banned word/);
    await expect(
      helper.teach({ question: 'Card?', answer: 'Use 4242 4242 4242 4242', by: 'A' }),
    ).rejects.toThrow(/card number/);
    await expect(
      helper.teach({ question: 'Refund?', answer: 'Send us your card number.', by: 'A' }),
    ).rejects.toThrow(/never do/);
    const everything = [...store.data.values()].join(' ');
    expect(everything).not.toMatch(/bastard|shit|4242/);
  });

  it('refuses to keep a message whose banned words cannot be taken out', async () => {
    const { runtime, store } = harness();
    const result = await runtime.helper('inbox')!.answer('you are a f u c k');
    expect(result.source).toBe('refused');
    expect([...store.data.keys()].filter((k) => k.startsWith('review/'))).toHaveLength(0);
  });

  it('throws away a brain reply that breaks a rule', async () => {
    const brain = new FakeBrain(() => 'Please reply with your card number and we will refund you.');
    const { runtime } = harness({ brain });
    const helper = runtime.helper('inbox')!;
    const result = await helper.answer('I want a refund');
    expect(result.source).toBe('none');
    const log = await runtime.records.recentLog();
    expect(log.some((entry) => entry.event === 'brain.blocked')).toBe(true);
  });

  it('keeps working when the brain cannot be reached', async () => {
    const brain = new FakeBrain(() => {
      throw new Error('connection refused');
    });
    const { runtime } = harness({ brain });
    const result = await runtime.helper('inbox')!.answer('Anything new?');
    expect(result.source).toBe('none');
    expect((await runtime.records.recentLog())[0]!.text).toMatch(/could not reach its brain/);
  });

  it('switches "act alone" on and off, and says so in the log', async () => {
    const { runtime } = harness();
    const helper = runtime.helper('inbox')!;
    expect(await helper.mayActAlone('taught-reply')).toBe(false);
    await helper.setActAlone('taught-reply', true, 'Anthony');
    expect(await helper.mayActAlone('taught-reply')).toBe(true);
    await helper.setActAlone('taught-reply', false, 'Anthony');
    expect(await helper.mayActAlone('taught-reply')).toBe(false);
    const log = await runtime.records.recentLog();
    expect(log.map((e) => e.text)).toContain(
      'Anthony let Inbox helper send "taught-reply" messages without asking first.',
    );
  });
});
