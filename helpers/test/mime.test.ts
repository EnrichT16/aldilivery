import { describe, expect, it } from 'vitest';

import { fromWebhook } from '../src/helpers/inbox/adapters.js';
import {
  decodeHeader,
  newestPart,
  parseAddress,
  parseRawEmail,
} from '../src/helpers/inbox/mime.js';

const MULTIPART = [
  'From: "Jane Smith" <Jane@Customer.example>',
  'To: hello@example.com',
  'Subject: =?utf-8?B?Q2Fmw6kgb3BlbmluZyBob3Vycw==?=',
  'Message-ID: <m1@customer.example>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  'This is a multi-part message in MIME format.',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hello, when is the caf=C3=A9 open? I=E2=80=99d like to visit.=',
  ' Thanks',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hello, when is the café open?</p>',
  '--b1--',
  '',
].join('\r\n');

describe('reading raw email', () => {
  it('reads headers, encoded subjects, multipart and quoted-printable', () => {
    const email = parseRawEmail(MULTIPART);
    expect(email.from).toBe('jane@customer.example');
    expect(email.fromName).toBe('Jane Smith');
    expect(email.subject).toBe('Café opening hours');
    expect(email.text).toBe('Hello, when is the café open? I’d like to visit. Thanks');
    expect(email.messageId).toBe('<m1@customer.example>');
  });

  it('reads base64 and falls back to HTML', () => {
    const raw = [
      'From: a@b.example',
      'To: hello@example.com',
      'Subject: Hi',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      btoa('<html><body><p>Line one</p><p>Line &amp; two</p></body></html>'),
    ].join('\n');
    expect(parseRawEmail(raw).text).toBe('Line one\nLine & two');
  });

  it('uses the envelope addresses Cloudflare gives', () => {
    const email = parseRawEmail(MULTIPART, {
      from: 'bounce@relay.example',
      to: 'sales@example.com',
    });
    expect(email.from).toBe('bounce@relay.example');
    expect(email.to).toBe('sales@example.com');
  });

  it('decodes Q-encoded headers and addresses', () => {
    expect(decodeHeader('=?iso-8859-1?Q?Caf=E9_hours?=')).toBe('Café hours');
    expect(parseAddress('Bob <BOB@x.example>')).toEqual({ address: 'bob@x.example', name: 'Bob' });
    expect(parseAddress('bob@x.example')).toEqual({ address: 'bob@x.example', name: null });
  });

  it('takes off quoted earlier messages', () => {
    expect(newestPart('Yes please.\n\nOn Tue, 6 Oct 2026, Shop wrote:\n> Would you like it?')).toBe(
      'Yes please.',
    );
    expect(newestPart('Thanks\n> old\n-- \nJane')).toBe('Thanks');
  });
});

describe('webhook email', () => {
  it('reads Postmark style JSON', () => {
    const email = fromWebhook({
      From: 'Jane <jane@c.example>',
      To: 'hello@example.com',
      Subject: 'Hours',
      TextBody: 'When are you open?',
      MessageID: 'p-1',
      Headers: [{ Name: 'Auto-Submitted', Value: 'auto-replied' }],
    });
    expect(email).toMatchObject({
      from: 'jane@c.example',
      fromName: 'Jane',
      subject: 'Hours',
      text: 'When are you open?',
      messageId: 'p-1',
    });
    expect(email.headers['auto-submitted']).toBe('auto-replied');
  });

  it('reads Mailgun style forms and raw MIME', () => {
    expect(
      fromWebhook({
        sender: 'a@b.example',
        recipient: 'hello@example.com',
        subject: 'S',
        'body-plain': 'Body',
      }).text,
    ).toBe('Body');
    expect(fromWebhook({ email: MULTIPART }).subject).toBe('Café opening hours');
  });
});
