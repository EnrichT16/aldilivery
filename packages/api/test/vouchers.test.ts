/**
 * Sending a referral reward voucher (Anthony, 30 October 2026): staff paste the code on the
 * Referrals page and press "Send voucher"; it goes to the person's own inbox with the code shown
 * to them alone, "Amazon gift cards last 10 years" and "I've used it"; the record keeps who sent
 * it, when, which level, the code (masked on the list), Sent, Opened and Used with times, and
 * Ozi's reminder calls: on the day, 7 and 14 days later while unopened, three at most, never in
 * quiet hours, in the app when it is open, a text otherwise. The code is never in the message
 * text, the audit log or a log line, and goes with the account when it is erased.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sweepVoucherReminders } from '../src/services/vouchers.js';
import {
  STAFF,
  buildTestApp,
  signUpShopper,
  type SignedInShopper,
  type TestHarness,
} from './helpers.js';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const CODE = 'GIFT-ABCD-9876';

let harness: TestHarness;
let shopper: SignedInShopper;
let texts: Array<{ to: string; body: string }>;
let product: string;
let assistant: string;

beforeEach(async () => {
  texts = [];
  harness = await buildTestApp(NOW, {
    sendText: async (to, body) => {
      texts.push({ to, body });
    },
  });
  product = harness.app.ctx.config.productName;
  assistant = harness.app.ctx.config.assistantName;
  shopper = await signUpShopper(harness, { displayName: 'Margaret', phone: '+447700900777' });
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'GET', url, headers });
}

function post(url: string, payload: object, headers: Record<string, string> = STAFF) {
  return harness.app.inject({ method: 'POST', url, payload, headers });
}

async function levelFor(kind: 'shopper' | 'partner', id: string) {
  const level = await harness.repository.referrals.reachLevel({
    referrerKind: kind,
    referrerId: id,
    activeReferrals: 20,
    rewardPence: 1000,
    label: '£10 voucher',
    activeAtReach: 20,
    joinedAtReach: 24,
    reachedAt: harness.now(),
  });
  return level!;
}

async function send(levelId: string, payload: object = { code: CODE }) {
  const sent = await post(`/staff/referrals/levels/${levelId}/voucher`, payload);
  expect(sent.statusCode, sent.body).toBe(201);
  return sent.json().voucher as { id: string; status: string; codeMasked: string };
}

const reminderWords = () =>
  `Hello, this is ${assistant} from ${product}. You've been sent a £10 shopping voucher as a thank you. Open your ${assistant} inbox to see it.`;

const sweep = () => sweepVoucherReminders(harness.app.ctx, harness.app.log);
const remindersTexted = () => texts.filter((row) => row.body === reminderWords());

describe('sending a voucher', () => {
  it('puts it in the person’s inbox, the code shown to them alone, and marks the level given', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id, {
      code: CODE,
      link: 'https://www.amazon.co.uk/gc/redeem',
    });
    expect(voucher).toMatchObject({ status: 'sent', codeMasked: '••••••••••9876' });

    const inbox = (await get('/inbox', shopper.authHeader)).json();
    const message = inbox.messages[0];
    expect(message.text).toMatch(
      new RegExp(`^Your £10 Amazon shopping voucher from ${product}\\.`),
    );
    expect(message.text).toContain('Amazon gift cards last 10 years.');
    // The code is never in the message text, only with the voucher, for this person.
    expect(message.text).not.toContain(CODE);
    expect(message.voucher).toMatchObject({
      title: `Your £10 Amazon shopping voucher from ${product}`,
      code: CODE,
      link: 'https://www.amazon.co.uk/gc/redeem',
      lastsWords: 'Amazon gift cards last 10 years.',
      usedAt: null,
    });
    expect((await harness.repository.referrals.findLevel(level.id))?.givenAt).toEqual(NOW);
    // The person is told there is a message.
    expect(texts.some((row) => row.to === '+447700900777')).toBe(true);
  });

  it('shows staff the status and the last four on the list, never the whole code', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    await send(level.id);
    const page = await get('/staff/referrals');
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).not.toContain(CODE);
    expect(page.body).not.toContain('GIFT-ABCD');
    const detail = (await get(`/staff/referrals/shopper/${shopper.shopperId}`)).json();
    expect(detail.levels[0].voucher).toMatchObject({
      status: 'sent',
      sentByName: expect.any(String),
      codeLastFour: '9876',
      openedAt: null,
      usedAt: null,
    });
  });

  it('opens the record in full for staff, and writes that down without the code', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    const opened = (await get(`/staff/referrals/vouchers/${voucher.id}`)).json();
    expect(opened.voucher.code).toBe(CODE);
    const entries = await harness.repository.audit.list({ limit: 50 });
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['referrals.voucher-sent', 'referrals.voucher-opened']),
    );
    expect(JSON.stringify(entries)).not.toContain(CODE);
  });

  it('refuses a second voucher for the same level, a code that is not one, and a link elsewhere', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    expect(
      (await post(`/staff/referrals/levels/${level.id}/voucher`, { code: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`/staff/referrals/levels/${level.id}/voucher`, {
          code: CODE,
          link: 'http://amazon.co.uk/gc',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`/staff/referrals/levels/${level.id}/voucher`, {
          code: CODE,
          link: 'https://amazon.co.uk.example.com/gc',
        })
      ).statusCode,
    ).toBe(400);
    await send(level.id);
    expect(
      (await post(`/staff/referrals/levels/${level.id}/voucher`, { code: CODE })).statusCode,
    ).toBe(409);
  });

  it('goes to a Shop Partner’s own inbox too', async () => {
    const shop = await harness.repository.partnerShops.create({
      name: 'Corner Shop',
      address: '1 High Street',
      telephone: '',
      about: '',
      monthlyPence: 0,
      kind: 'shop',
    });
    const level = await levelFor('partner', shop.id);
    await send(level.id);
    const thread = await harness.repository.companyContact.findThread('partner', shop.id);
    expect(thread).not.toBeNull();
    const messages = await harness.repository.companyContact.listMessages(thread!.id);
    expect(messages[0]?.text).toMatch(/^Your £10 Amazon shopping voucher/);
  });
});

describe('opened and used', () => {
  it('is Opened the first time the person reads it, and Used when they tap "I’ve used it"', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    harness.setNow(new Date(NOW.getTime() + 60_000));
    await post('/inbox/read', {}, shopper.authHeader);
    let record = (await harness.repository.vouchers.findById(voucher.id))!;
    expect(record.openedAt).toEqual(harness.now());
    expect(record.nextReminderAt).toBeNull();
    // Read again later: still the first time.
    harness.setNow(new Date(NOW.getTime() + 120_000));
    await post('/inbox/read', {}, shopper.authHeader);
    record = (await harness.repository.vouchers.findById(voucher.id))!;
    expect(record.openedAt).toEqual(new Date(NOW.getTime() + 60_000));

    // Nobody else can say it was used.
    const other = await signUpShopper(harness, { displayName: 'Bob', phone: '+447700900778' });
    expect(
      (await post(`/inbox/vouchers/${voucher.id}/used`, {}, other.authHeader)).statusCode,
    ).toBe(404);
    const used = await post(`/inbox/vouchers/${voucher.id}/used`, {}, shopper.authHeader);
    expect(used.statusCode, used.body).toBe(200);
    expect(used.json().voucher.usedAt).toBeTruthy();
    const detail = (await get(`/staff/referrals/shopper/${shopper.shopperId}`)).json();
    expect(detail.levels[0].voucher.status).toBe('used');
  });
});

describe('Ozi’s reminder calls', () => {
  it('texts on the day, 7 and 14 days later while unopened: three in total', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    await sweep();
    expect(remindersTexted()).toHaveLength(1);
    harness.setNow(new Date(NOW.getTime() + 3 * DAY));
    await sweep();
    expect(remindersTexted()).toHaveLength(1);
    harness.setNow(new Date(NOW.getTime() + 7 * DAY));
    await sweep();
    expect(remindersTexted()).toHaveLength(2);
    harness.setNow(new Date(NOW.getTime() + 14 * DAY));
    await sweep();
    harness.setNow(new Date(NOW.getTime() + 21 * DAY));
    await sweep();
    expect(remindersTexted()).toHaveLength(3);
    const record = (await harness.repository.vouchers.findById(voucher.id))!;
    expect([record.reminder1Via, record.reminder2Via, record.reminder3Via]).toEqual([
      'text',
      'text',
      'text',
    ]);
    expect(record.nextReminderAt).toBeNull();
    const detail = (await get(`/staff/referrals/shopper/${shopper.shopperId}`)).json();
    expect(detail.levels[0].voucher.reminders).toHaveLength(3);
  });

  it('stops as soon as it is opened', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    await send(level.id);
    await sweep();
    await post('/inbox/read', {}, shopper.authHeader);
    harness.setNow(new Date(NOW.getTime() + 7 * DAY));
    await sweep();
    harness.setNow(new Date(NOW.getTime() + 14 * DAY));
    await sweep();
    expect(remindersTexted()).toHaveLength(1);
  });

  it('never rings in quiet hours: moved to the next allowed time, 06:00', async () => {
    // Sent at 23:00 in the UK (GMT in November): quiet until 06:00.
    harness.setNow(new Date('2026-11-02T23:00:00.000Z'));
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    await sweep();
    expect(remindersTexted()).toHaveLength(0);
    expect((await harness.repository.vouchers.findById(voucher.id))?.nextReminderAt).toEqual(
      new Date('2026-11-03T06:00:00.000Z'),
    );
    harness.setNow(new Date('2026-11-03T05:59:00.000Z'));
    await sweep();
    expect(remindersTexted()).toHaveLength(0);
    harness.setNow(new Date('2026-11-03T06:00:00.000Z'));
    await sweep();
    expect(remindersTexted()).toHaveLength(1);
  });

  it('rings in the app when it is open, and keeps the answer', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    // The app is open: it asks for the inbox count.
    await get('/inbox/unread', shopper.authHeader);
    await sweep();
    expect(remindersTexted()).toHaveLength(0);
    const ringing = (await get('/inbox/unread', shopper.authHeader)).json().ozi;
    expect(ringing).toEqual({ id: voucher.id, from: assistant, words: reminderWords() });
    const answered = await post(
      `/inbox/vouchers/${voucher.id}/ring/answer`,
      {},
      shopper.authHeader,
    );
    expect(answered.json().words).toBe(reminderWords());
    const record = (await harness.repository.vouchers.findById(voucher.id))!;
    expect(record.reminder1Via).toBe('app_answered');
    expect(record.ringingUntil).toBeNull();
    expect((await get('/inbox/unread', shopper.authHeader)).json().ozi).toBeNull();
  });

  it('texts instead when the ring in the app is not answered in time', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    await get('/inbox/unread', shopper.authHeader);
    await sweep();
    harness.setNow(new Date(NOW.getTime() + 91_000));
    await sweep();
    expect(remindersTexted()).toHaveLength(1);
    expect((await harness.repository.vouchers.findById(voucher.id))?.reminder1Via).toBe(
      'app_then_text',
    );
  });
});

describe('erasing the account', () => {
  it('removes the code, and no more reminders are made', async () => {
    const level = await levelFor('shopper', shopper.shopperId);
    const voucher = await send(level.id);
    await harness.repository.retention.eraseShopper(shopper.shopperId, harness.now());
    const record = (await harness.repository.vouchers.findById(voucher.id))!;
    expect(record.code).toBe('');
    expect(record.link).toBeNull();
    expect(record.nextReminderAt).toBeNull();
    const opened = (await get(`/staff/referrals/vouchers/${voucher.id}`)).json();
    expect(opened.voucher.code).toBe('');
    await sweep();
    expect(remindersTexted()).toHaveLength(0);
  });
});
