import { describe, expect, it } from 'vitest';

import { FakeEmail, appHarness, testConfig } from './support.js';

/** Test responses are read loosely; the assertions check their shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

async function body(response: Response): Promise<Loose> {
  return (await response.json()) as Loose;
}

describe('the Inbox helper, end to end through the web', () => {
  it('receives an email by webhook, waits for approval, sends it, and learns the answer', async () => {
    const sender = new FakeEmail();
    const { call, app } = appHarness({ email: sender, noBrain: true });
    app.runtime.helper('inbox'); // made from the config

    // 1. An email arrives from an email service.
    const hook = await call(
      'POST',
      '/hooks/email',
      {
        from: 'Jane Smith <jane@customer.example>',
        to: 'hello@example.com',
        subject: 'Parking at your office',
        text: 'Is there parking at your office?',
        messageId: '<p1@c>',
      },
      { 'x-helpers-secret': 'hook-secret', authorization: '' },
    );
    expect(hook.status).toBe(200);
    expect(await body(hook)).toMatchObject({
      ok: true,
      action: 'needs-answer',
      category: 'general',
    });

    // 2. It is waiting on the admin page.
    const review = await body(await call('GET', '/api/helpers/inbox/review'));
    expect(review.review).toHaveLength(1);
    const item = review.review[0];
    expect(item.email.subject).toBe('Parking at your office');

    // 3. Anthony writes the answer and approves; it is sent and taught.
    const approved = await body(
      await call('POST', `/api/helpers/inbox/review/${item.id}/approve`, {
        answer:
          'Hello Jane,\n\nYes, there are two free spaces at the front.\n\nKind regards,\nThe Example team',
      }),
    );
    expect(approved.message).toBe('Sent to jane@customer.example.');
    expect(sender.sent[0]).toMatchObject({
      to: 'jane@customer.example',
      subject: 'Re: Parking at your office',
      inReplyTo: '<p1@c>',
    });
    expect(approved.taught).toMatchObject({
      question: 'Parking at your office',
      answer: 'Yes, there are two free spaces at the front.',
    });

    // 4. Anthony lets taught replies go alone. The next person asking gets an answer at once.
    await call('PUT', '/api/helpers/inbox/act-alone', { kind: 'taught-reply', on: true });
    const second = await call(
      'POST',
      '/hooks/email?secret=hook-secret',
      {
        from: 'sam@other.example',
        to: 'hello@example.com',
        subject: 'Parking at your office?',
        text: 'Hi, is there parking at your office?',
      },
      { authorization: '' },
    );
    expect((await body(second)).action).toBe('replied');
    expect(sender.sent[1]!.text).toBe(
      'Hello,\n\nYes, there are two free spaces at the front.\n\nKind regards,\nThe Example team',
    );

    // 5. All of it is in the plain English log.
    const log = (await body(await call('GET', '/api/log'))).log.map(
      (entry: { text: string }) => entry.text,
    );
    expect(log).toContain(
      'Inbox helper sent a reply to sam@other.example about "Parking at your office?".',
    );
    expect(
      log.some((line: string) =>
        line.startsWith('Anthony approved a reply to "Parking at your office"'),
      ),
    ).toBe(true);
  });

  it('keeps approved replies in the outbox when no email sender is set up', async () => {
    const { call } = appHarness({ noBrain: true });
    await call(
      'POST',
      '/hooks/email',
      {
        from: 'a@b.example',
        to: 'hello@example.com',
        subject: 'Question here',
        text: 'Do you work weekends?',
      },
      { 'x-helpers-secret': 'hook-secret' },
    );
    const [item] = (await body(await call('GET', '/api/helpers/inbox/review'))).review;
    const approved = await body(
      await call('POST', `/api/helpers/inbox/review/${item.id}/approve`, {
        answer: 'Yes, Saturdays.',
      }),
    );
    expect(approved.message).toMatch(/outbox/);
    expect((await body(await call('GET', '/api/outbox'))).outbox).toHaveLength(1);
  });
});

describe('the admin API', () => {
  it('needs the admin key', async () => {
    const { call } = appHarness();
    expect(
      (await call('GET', '/api/overview', undefined, { authorization: 'Bearer wrong' })).status,
    ).toBe(401);
    expect((await call('GET', '/api/overview', undefined, { authorization: '' })).status).toBe(401);
    expect((await call('GET', '/api/overview')).status).toBe(200);
  });

  it('is switched off when no admin key is set', async () => {
    const { call } = appHarness({ env: { ADMIN_TOKEN: '' } });
    expect((await call('GET', '/api/overview')).status).toBe(503);
  });

  it('refuses incoming email without the webhook secret', async () => {
    const { call } = appHarness();
    expect(
      (await call('POST', '/hooks/email', { from: 'a@b.example' }, { 'x-helpers-secret': 'nope' }))
        .status,
    ).toBe(401);
  });

  it('teaches, tries, lists and forgets', async () => {
    const { call } = appHarness({ noBrain: true });
    const taught = await call('POST', '/api/helpers/inbox/knowledge', {
      question: 'Do you fix laptops?',
      alternatives: 'Can you repair a laptop?\n',
      answer: 'Yes, most makes.',
    });
    expect(taught.status).toBe(201);
    const tried = await body(
      await call('POST', '/api/helpers/inbox/ask', { question: 'can you repair a laptop' }),
    );
    expect(tried).toMatchObject({ source: 'exact', answer: 'Yes, most makes.' });
    const { knowledge } = await body(await call('GET', '/api/helpers/inbox/knowledge'));
    expect(knowledge).toHaveLength(1);
    expect((await call('DELETE', `/api/helpers/inbox/knowledge/${knowledge[0].id}`)).status).toBe(
      200,
    );
    expect((await body(await call('GET', '/api/helpers/inbox/knowledge'))).knowledge).toHaveLength(
      0,
    );
  });

  it('explains refusals in plain English', async () => {
    const { call } = appHarness();
    const refused = await call('POST', '/api/helpers/inbox/knowledge', {
      question: 'Refund?',
      answer: 'Text us your card number.',
    });
    expect(refused.status).toBe(422);
    expect((await body(refused)).message).toMatch(/never do/);
  });

  it('gives an overview with brains, waiting counts and the planned helpers', async () => {
    const { call } = appHarness();
    const overview = await body(await call('GET', '/api/overview'));
    expect(overview.owner).toBe('Anthony');
    expect(overview.helpers.map((h: { id: string }) => h.id)).toEqual([
      'inbox',
      'watchman',
      'briefing',
    ]);
    expect(overview.helpers[0].messageKinds.map((m: { kind: string }) => m.kind)).toContain(
      'taught-reply',
    );
    expect(overview.planned).toHaveLength(6);
  });

  it('serves an accessible admin page', async () => {
    const { call } = appHarness();
    const response = await call('GET', '/admin');
    const html = await response.text();
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('Skip to the main part');
    // Every input, select and textarea has a label joined to it.
    const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*\bid="([^"]+)"/g)].map(
      (m) => m[1],
    );
    for (const id of ids) expect(html, id).toContain(`for="${id}"`);
    expect((await call('GET', '/health')).status).toBe(200);
  });
});

describe('the website help box', () => {
  function config() {
    const c = testConfig({ allowedOrigins: ['https://www.example.com'] });
    return c;
  }

  it('answers from taught answers only when allowed, and refuses other websites', async () => {
    const { call, app } = appHarness({ config: config(), noBrain: true });
    const helper = app.runtime.helper('inbox')!;
    await helper.teach({ question: 'Where are you based?', answer: 'In Leeds.', by: 'Anthony' });
    const ask = (origin: string, question: string) =>
      call('POST', '/api/ask/inbox', { question }, { origin, authorization: '' });

    expect((await ask('https://evil.example', 'Where are you based?')).status).toBe(403);
    expect(
      (
        await call(
          'POST',
          '/api/ask/inbox',
          { question: 'Where are you based?' },
          { authorization: '' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await body(await ask('https://www.example.com', 'Where are you based?'))).answer,
    ).toBeNull();
    await helper.setActAlone('website-answer', true, 'Anthony');
    const answered = await ask('https://www.example.com', 'Where are you based?');
    expect(answered.headers.get('access-control-allow-origin')).toBe('https://www.example.com');
    expect((await body(answered)).answer).toBe('In Leeds.');

    await ask('https://www.example.com', 'Do you do house calls?');
    expect((await helper.waiting()).map((i) => i.question)).toContain('Do you do house calls?');
  });
});
