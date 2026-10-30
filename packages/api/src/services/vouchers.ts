/**
 * Sending a referral reward voucher (Anthony, 30 October 2026).
 *
 * On the staff Referrals page, for a person who has reached a level, staff paste the voucher code
 * (and, if they have one, a link) and press "Send voucher". It goes as a message in that person's
 * own company inbox, whatever kind of account they have (a Shopper, a Runner, a Shop Partner or
 * an organisation all have one, ruling 77): "Your £10 Amazon shopping voucher from" the
 * product's name, with the code shown clearly to them, a "Copy code" button, and "Amazon gift cards
 * last 10 years" (there is no expiry here). The level is marked given, by whoever sent it.
 *
 * The record keeps who sent it and when, which level, the code, and how it stands: Sent, Opened
 * (the first time the person opens or reads the message) and Used (when they tap "I've used it";
 * Amazon cannot tell us whether a code was spent, so this is the person's own word).
 *
 * Reminders: Ozi rings to remind them, on the day it is sent and 7 and 14 days later, while it is
 * still unopened (`referrals.voucherReminderDays`), three calls at most, stopping as soon as it is
 * opened, and never in quiet hours (`ownerDesk.quietFrom` to `quietUntil`): a reminder due then is
 * moved to the next allowed time. It rings in the app, through the inbox's own call (the company
 * call banner), when the person has the app open; not answered in
 * `referrals.voucherRingSeconds`, or with the app not open, it is a text instead. What Ozi says:
 * "Hello, this is Ozi from <the product>. You've been sent a £10 shopping voucher as a thank you.
 * Open your Ozi inbox to see it." Each reminder is kept on the voucher record.
 *
 * The code is sensitive. It is shown in full only to the person, in their inbox, and to staff who
 * open the record (which is written in the audit log); the list shows only its last four. It is
 * never in the inbox message text (so never in the messages log), never in an application log
 * (no log line here carries it, and the audit hook hides any field called a code), and it is
 * emptied when the account is erased.
 */

import type { FastifyBaseLogger } from 'fastify';

import { maskedVoucherCode, voucherReminderWords, voucherTitle } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { ReferralKind, ReferralVoucher, VoucherReminderVia } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import type { StaffActor } from '../lib/staff.js';
import { findAccount as findContactAccount, notifyAccount } from './company-contact.js';
import { inQuietHours, nextDayAt } from './owner-desk.js';

type VoucherContext = Pick<AppContext, 'repository' | 'config' | 'now' | 'env'> &
  Partial<Pick<AppContext, 'sendText' | 'sendPush'>>;

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ the words */

/** "Your £10 Amazon shopping voucher from <the product>". */
export function voucherTitleFor(ctx: Pick<AppContext, 'config'>, rewardPence: number): string {
  const { config } = ctx;
  return voucherTitle(
    rewardPence,
    config.referrals.givenAs,
    config.productName,
    config.store.currencySymbol,
  );
}

/** "Amazon gift cards last 10 years." */
export function voucherLastsWords(ctx: Pick<AppContext, 'config'>): string {
  const { referrals } = ctx.config;
  const brand = referrals.givenAs.replace(/\s*voucher$/i, '').trim();
  return `${brand} gift cards last ${referrals.voucherLastsYears} years.`;
}

/** The message text: never the code, which is shown from the record to the person alone. */
function messageText(ctx: Pick<AppContext, 'config'>, rewardPence: number): string {
  const { config } = ctx;
  return `${voucherTitleFor(ctx, rewardPence)}. Thank you for introducing people to ${config.productName}. Your voucher code is shown with this message, with a button to copy it. ${voucherLastsWords(ctx)} When you have used it, please tap "I've used it".`;
}

/** What Ozi says on a reminder call, and in the text instead. */
export function reminderWordsFor(ctx: Pick<AppContext, 'config'>, rewardPence: number): string {
  const { config } = ctx;
  return voucherReminderWords(
    rewardPence,
    config.assistantName,
    config.productName,
    config.store.currencySymbol,
  );
}

/* ------------------------------------------------------------------ how it stands */

export type VoucherStatus = 'sent' | 'opened' | 'used';

export function voucherStatus(voucher: ReferralVoucher): VoucherStatus {
  return voucher.usedAt ? 'used' : voucher.openedAt ? 'opened' : 'sent';
}

/** The reminders made so far, in order: when, and how they reached the person. */
export function remindersOf(
  voucher: ReferralVoucher,
): Array<{ number: number; at: Date; via: VoucherReminderVia }> {
  const slots = [
    [voucher.reminder1At, voucher.reminder1Via],
    [voucher.reminder2At, voucher.reminder2Via],
    [voucher.reminder3At, voucher.reminder3Via],
  ] as const;
  return slots.flatMap(([at, via], index) => (at && via ? [{ number: index + 1, at, via }] : []));
}

const VIA_WORDS: Record<VoucherReminderVia, string> = {
  app: 'ringing in the app',
  app_answered: 'answered in the app',
  app_declined: 'turned down in the app',
  app_then_text: 'not answered in the app, so texted',
  text: 'texted',
  none: 'could not be reached: no app open and no mobile',
};

/** What staff see on the list: never the code but its last four. */
export function staffVoucherView(voucher: ReferralVoucher) {
  return {
    id: voucher.id,
    levelId: voucher.levelId,
    label: voucher.label,
    status: voucherStatus(voucher),
    sentAt: voucher.sentAt,
    sentByName: voucher.sentByName,
    openedAt: voucher.openedAt,
    usedAt: voucher.usedAt,
    codeMasked: maskedVoucherCode(voucher.code),
    codeLastFour: voucher.code.slice(-4),
    hasLink: voucher.link !== null,
    erased: voucher.erasedAt !== null,
    nextReminderAt: voucher.nextReminderAt,
    reminders: remindersOf(voucher).map((row) => ({ ...row, words: VIA_WORDS[row.via] })),
  };
}

/** What the person sees with the message: the code in full, and whether they have used it. */
export function accountVoucherView(ctx: Pick<AppContext, 'config'>, voucher: ReferralVoucher) {
  return {
    id: voucher.id,
    title: voucherTitleFor(ctx, voucher.rewardPence),
    code: voucher.code,
    link: voucher.link,
    lastsWords: voucherLastsWords(ctx),
    openedAt: voucher.openedAt,
    usedAt: voucher.usedAt,
  };
}

/* ------------------------------------------------------------------ sending */

const CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{3,59}$/;

/** Only a link to the voucher itself, on the voucher's own site, so a message cannot mislead. */
function checkedLink(link: string | null | undefined): string | null {
  const given = (link ?? '').trim();
  if (given === '') return null;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw new BadRequestError('That link does not look right. Please paste the whole link.');
  }
  const host = url.hostname.toLowerCase();
  const amazon = ['amazon.co.uk', 'amazon.com'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (url.protocol !== 'https:' || !amazon) {
    throw new BadRequestError('The link must be an Amazon link that starts with https.');
  }
  return url.toString();
}

/** When the reminder `index` (0, 1, 2) is due: the days after it was sent, at the sending time. */
function reminderDue(ctx: VoucherContext, sentAt: Date, index: number): Date | null {
  const days = ctx.config.referrals.voucherReminderDays[index];
  return days === undefined ? null : new Date(sentAt.getTime() + days * DAY);
}

/**
 * Staff send the voucher for a level reached: into the person's inbox, the level marked given,
 * the person told there is a message, and the first reminder due at once. One voucher a level.
 */
export async function sendVoucher(
  ctx: VoucherContext,
  input: { levelId: string; code: string; link?: string | null; actor: StaffActor; by: string },
  log?: FastifyBaseLogger,
): Promise<{ voucher: ReferralVoucher; message: string }> {
  const { repository, config } = ctx;
  const code = input.code.trim();
  if (!CODE.test(code)) {
    throw new BadRequestError(
      'Please paste the voucher code: 4 to 60 letters, numbers, spaces or dashes.',
    );
  }
  const link = checkedLink(input.link);
  const level = await repository.referrals.findLevel(input.levelId);
  if (!level) throw new NotFoundError('reward level');
  if (await repository.vouchers.findByLevel(level.id)) {
    throw new ConflictError('A voucher has already been sent for that level.');
  }
  const account = await findContactAccount(ctx, level.referrerKind, level.referrerId);
  if (!account) throw new NotFoundError('account');
  const at = ctx.now();
  const contact = repository.companyContact;
  const thread = await contact.openThread(account.kind, account.id);
  const message = await contact.addMessage({
    threadId: thread.id,
    fromStaff: true,
    staffId: input.actor.id,
    senderName: input.by,
    text: messageText(ctx, level.rewardPence),
    createdAt: at,
    sentAt: at,
    readAt: null,
    status: 'sent',
    authorisedBy: 'self',
    authorisedByName: input.by,
  });
  await contact.updateThread(thread.id, { lastMessageAt: at });
  const voucher = await repository.vouchers.create({
    levelId: level.id,
    accountKind: level.referrerKind,
    accountId: level.referrerId,
    label: level.label,
    rewardPence: level.rewardPence,
    code,
    link,
    messageId: message.id,
    sentById: input.actor.id,
    sentByName: input.by,
    sentAt: at,
    nextReminderAt: reminderDue(ctx, at, 0),
  });
  if (!voucher) throw new ConflictError('A voucher has already been sent for that level.');
  if (!level.givenAt) {
    await repository.referrals.updateLevel(level.id, { givenAt: at, givenBy: input.by });
  }
  await notifyAccount(ctx, account, log);
  return {
    voucher,
    message: `The ${level.label} is sent to ${account.name}'s ${config.productName} inbox.`,
  };
}

/** The person's own voucher, by id, or not found. */
async function ownVoucher(
  ctx: VoucherContext,
  account: { kind: ReferralKind; id: string },
  id: string,
): Promise<ReferralVoucher> {
  const voucher = await ctx.repository.vouchers.findById(id);
  if (!voucher || voucher.accountKind !== account.kind || voucher.accountId !== account.id) {
    throw new NotFoundError('voucher');
  }
  return voucher;
}

/** The first time the person opens or reads the voucher message: no more reminders. */
export async function voucherOpened(
  ctx: VoucherContext,
  voucher: ReferralVoucher,
): Promise<ReferralVoucher> {
  if (voucher.openedAt) return voucher;
  return ctx.repository.vouchers.update(voucher.id, {
    openedAt: ctx.now(),
    nextReminderAt: null,
    ringingUntil: null,
  });
}

/** Every unopened voucher of this account whose message it has now read. */
export async function vouchersRead(
  ctx: VoucherContext,
  account: { kind: ReferralKind; id: string },
): Promise<void> {
  for (const voucher of await ctx.repository.vouchers.listFor(account.kind, account.id)) {
    if (!voucher.openedAt && voucher.erasedAt === null) await voucherOpened(ctx, voucher);
  }
}

/**
 * "I've used it": the person's own word, kept with the time. Amazon cannot tell us whether a
 * code has been spent, so this is the only way the record knows.
 */
export async function voucherUsed(
  ctx: VoucherContext,
  account: { kind: ReferralKind; id: string },
  id: string,
): Promise<ReferralVoucher> {
  const voucher = await voucherOpened(ctx, await ownVoucher(ctx, account, id));
  if (voucher.usedAt) return voucher;
  return ctx.repository.vouchers.update(voucher.id, { usedAt: ctx.now() });
}

/* ------------------------------------------------------------------ reminders */

/** Who has the app open: asked for their inbox or a call within the last two minutes. */
const seen = new WeakMap<object, Map<string, number>>();
const OPEN_FOR_MS = 2 * 60 * 1000;

export function accountSeen(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  kind: string,
  id: string,
): void {
  const map = seen.get(ctx.repository) ?? new Map<string, number>();
  map.set(`${kind}:${id}`, ctx.now().getTime());
  seen.set(ctx.repository, map);
}

function appOpen(ctx: Pick<AppContext, 'repository' | 'now'>, kind: string, id: string): boolean {
  const last = seen.get(ctx.repository)?.get(`${kind}:${id}`);
  return last !== undefined && ctx.now().getTime() - last <= OPEN_FOR_MS;
}

/** The next moment outside quiet hours, `at` itself when it is not quiet. */
export function nextAllowedAt(at: Date, from: string, until: string): Date {
  if (!inQuietHours(at, from, until)) return at;
  // Quiet hours run past midnight: after midnight, the end is today; before, tomorrow.
  const today = nextDayAt(new Date(at.getTime() - DAY), until);
  return today.getTime() > at.getTime() ? today : nextDayAt(at, until);
}

/** The slot a reminder is kept in, and when the next one is due after it. */
function reminderPatch(
  ctx: VoucherContext,
  voucher: ReferralVoucher,
  number: number,
  at: Date,
  via: VoucherReminderVia,
): Partial<ReferralVoucher> {
  const next = reminderDue(ctx, voucher.sentAt, number);
  return {
    [`reminder${number}At`]: at,
    [`reminder${number}Via`]: via,
    nextReminderAt: next && next.getTime() > at.getTime() ? next : next ? at : null,
    ringingUntil: null,
  } as Partial<ReferralVoucher>;
}

async function textReminder(
  ctx: VoucherContext,
  voucher: ReferralVoucher,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  const account = await findContactAccount(ctx, voucher.accountKind, voucher.accountId);
  if (!account?.phone || !ctx.sendText) return false;
  try {
    await ctx.sendText(account.phone, reminderWordsFor(ctx, voucher.rewardPence));
    return true;
  } catch (failure) {
    log?.warn({ err: failure, voucherId: voucher.id }, 'A voucher reminder text did not go.');
    return false;
  }
}

/**
 * Every voucher reminder that is due: rung in the app when the person has it open, or texted;
 * a ring not answered in time becomes a text. Never in quiet hours, never once it is opened,
 * three at most. Run every minute.
 */
export async function sweepVoucherReminders(
  ctx: VoucherContext,
  log?: FastifyBaseLogger,
): Promise<number> {
  const { repository, config } = ctx;
  const at = ctx.now();
  const { quietFrom, quietUntil } = config.ownerDesk;
  let done = 0;
  for (const voucher of await repository.vouchers.listDue(at)) {
    try {
      if (voucher.openedAt || voucher.erasedAt) {
        await repository.vouchers.update(voucher.id, { nextReminderAt: null, ringingUntil: null });
        continue;
      }
      const number = remindersOf(voucher).length + (voucher.ringingUntil ? 0 : 1);
      if (voucher.ringingUntil) {
        // Still ringing in the app: wait. Not answered in time: a text instead, if not quiet.
        if (voucher.ringingUntil.getTime() > at.getTime()) continue;
        const quiet = inQuietHours(at, quietFrom, quietUntil);
        const texted = !quiet && (await textReminder(ctx, voucher, log));
        await repository.vouchers.update(
          voucher.id,
          reminderPatch(ctx, voucher, number, at, texted ? 'app_then_text' : 'app'),
        );
        done += 1;
        continue;
      }
      if (number > config.referrals.voucherReminderDays.length) {
        await repository.vouchers.update(voucher.id, { nextReminderAt: null });
        continue;
      }
      if (inQuietHours(at, quietFrom, quietUntil)) {
        await repository.vouchers.update(voucher.id, {
          nextReminderAt: nextAllowedAt(at, quietFrom, quietUntil),
        });
        continue;
      }
      if (appOpen(ctx, voucher.accountKind, voucher.accountId)) {
        // Ringing in the app, through the inbox's call: kept now, its answer kept when it comes.
        await repository.vouchers.update(voucher.id, {
          [`reminder${number}At`]: at,
          [`reminder${number}Via`]: 'app',
          ringingUntil: new Date(at.getTime() + config.referrals.voucherRingSeconds * 1000),
        } as Partial<ReferralVoucher>);
        done += 1;
        continue;
      }
      const texted = await textReminder(ctx, voucher, log);
      await repository.vouchers.update(
        voucher.id,
        reminderPatch(ctx, voucher, number, at, texted ? 'text' : 'none'),
      );
      done += 1;
    } catch (failure) {
      log?.warn({ err: failure, voucherId: voucher.id }, 'A voucher reminder could not be made.');
    }
  }
  return done;
}

/** Ozi ringing this account in the app about a voucher, now, or null. */
export async function ringingVoucher(
  ctx: VoucherContext,
  account: { kind: ReferralKind; id: string },
): Promise<{ id: string; from: string; words: string } | null> {
  const at = ctx.now().getTime();
  const ringing = (await ctx.repository.vouchers.listFor(account.kind, account.id)).find(
    (voucher) =>
      voucher.ringingUntil !== null &&
      voucher.ringingUntil.getTime() > at &&
      voucher.openedAt === null,
  );
  return ringing
    ? {
        id: ringing.id,
        from: ctx.config.assistantName,
        words: reminderWordsFor(ctx, ringing.rewardPence),
      }
    : null;
}

/** The person answered Ozi's ring in the app, or turned it down: kept on the reminder. */
export async function answerVoucherRing(
  ctx: VoucherContext,
  account: { kind: ReferralKind; id: string },
  id: string,
  answered: boolean,
): Promise<{ words: string }> {
  const voucher = await ownVoucher(ctx, account, id);
  if (!voucher.ringingUntil) return { words: reminderWordsFor(ctx, voucher.rewardPence) };
  const number = Math.max(1, remindersOf(voucher).length);
  await ctx.repository.vouchers.update(
    voucher.id,
    reminderPatch(ctx, voucher, number, ctx.now(), answered ? 'app_answered' : 'app_declined'),
  );
  return { words: reminderWordsFor(ctx, voucher.rewardPence) };
}
