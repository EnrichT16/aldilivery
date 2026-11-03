/**
 * Reminders for everyone (Anthony, 3 November 2026, ruling 93).
 *
 * The founder asked Ozi "remind me tomorrow at 10" and Ozi could not. Now anybody signed in, a
 * Shopper, a Runner, a Shop Partner, an organisation, a member of staff or the owner, can set a
 * reminder by voice ("remind me tomorrow at ten to call the bank") or on their dashboard, and is
 * reminded when it is due by a notification on their devices, a text to their own phone, or a
 * phone call from Ozi that reads the reminder out.
 *
 * The rules:
 * - Rule One, kept for everything Ozi does on somebody's word: a reminder asked for by voice is
 *   read back ("I'll remind you tomorrow at 10 in the morning: call the bank. Shall I set that?")
 *   and set only on a clear yes in the very next turn (routes/ozi.ts).
 * - The words are blanked of anything like a telephone or card number, a code or an address when
 *   kept (lib/redact.ts), so a reminder can be read aloud, texted or spoken on a call and never
 *   carry a number. At most `reminders.maxTextLength` characters, at most `maxPerAccount` waiting
 *   for one account, not in the past by more than a minute, not more than a year ahead.
 * - Reminders by phone call come with a paid plan: the owner and staff always; a Shopper on
 *   Membership, Plus or Family and Carer; a Shop Partner on Partner Plus; an organisation with us.
 *   Everybody else has a notification or a text, and is told kindly which plan brings calls, in
 *   the plan's configured name and never a price.
 * - Quiet hours (`reminders.quietFrom` to `quietUntil`, UK time): a reminder by text or call due
 *   then is held until they end, unless the person set it for those hours themselves or it is
 *   the owner's. Notifications are never held.
 * - The sweep runs every minute (index.ts), sends each due reminder once however often it runs,
 *   and a repeating reminder moves itself on to its next time.
 */

import type { FastifyBaseLogger } from 'fastify';

import { ukWhenWords } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  PushSubscription,
  Reminder,
  ReminderAccountKind,
  ReminderChannel,
  ReminderRepeat,
} from '../domain.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { plusPaid } from '../lib/partner-standing.js';
import { blankPrivate } from '../lib/redact.js';
import {
  nextOccurrence,
  resolveWhen,
  whenWords,
  type ReminderPhrase,
} from '../lib/reminder-time.js';
import { findAccount } from './company-contact.js';
import { inQuietHours } from './owner-desk.js';
import { activePlan, planName } from './plans.js';
import { nextAllowedAt } from './vouchers.js';

export type ReminderContext = Pick<AppContext, 'repository' | 'config' | 'now' | 'env'> &
  Partial<Pick<AppContext, 'sendPush' | 'sendText' | 'placeCall'>>;

/** Whose reminder: decided from the sign-in alone, never from the request. */
export interface ReminderAccount {
  kind: ReminderAccountKind;
  id: string;
}

export const REMINDER_REPEATS: readonly ReminderRepeat[] = ['none', 'daily', 'weekly', 'monthly'];
export const REMINDER_CHANNELS: readonly ReminderChannel[] = ['notification', 'text', 'call'];

/* ------------------------------------------------------------------ who may be called */

/**
 * Whether this account may have a reminder by phone call: the owner and staff always; a Shopper
 * on a paid plan; a Shop Partner on Partner Plus; an organisation that is with us.
 */
export async function callAllowed(
  ctx: ReminderContext,
  account: ReminderAccount,
): Promise<boolean> {
  const at = ctx.now();
  switch (account.kind) {
    case 'owner':
    case 'staff':
      return true;
    case 'shopper': {
      const shopper = await ctx.repository.shoppers.findById(account.id);
      return shopper !== null && !shopper.erasedAt && activePlan(shopper, at) !== null;
    }
    case 'partner': {
      const shop = await ctx.repository.partnerShops.findById(account.id);
      return shop !== null && plusPaid(shop, at, ctx.config);
    }
    case 'organisation': {
      const organisation = await ctx.repository.organisations.findById(account.id);
      return organisation !== null && organisation.active;
    }
    case 'runner':
      return false;
  }
}

/**
 * Said kindly when a call is asked for without the plan that brings it. Every plan name comes
 * from configuration; never a price.
 */
export function callPlanWords(ctx: Pick<AppContext, 'config'>, kind: ReminderAccountKind): string {
  const ozi = ctx.config.assistantName;
  switch (kind) {
    case 'shopper':
      return `Reminders by phone call come with ${planName('membership', ozi)}, ${planName('plus', ozi)} or ${planName('family', ozi)}. I can remind you with a notification or a text instead.`;
    case 'partner':
      return 'Reminders by phone call come with Partner Plus. I can remind you with a notification or a text instead.';
    case 'organisation':
      return 'Reminders by phone call come with an organisation agreement. I can remind you with a notification or a text instead.';
    case 'runner':
      return 'Reminders by phone call are not part of the Runner app. I can remind you with a notification or a text instead.';
    case 'staff':
    case 'owner':
      return '';
  }
}

/* ------------------------------------------------------------------ making one */

export interface ReminderInput {
  text: string;
  dueAt: Date;
  repeat?: ReminderRepeat | undefined;
  channel?: ReminderChannel | undefined;
  createdVia: Reminder['createdVia'];
}

/** The words as kept: tidy, blanked of numbers and addresses, within the length. */
export function tidyReminderText(ctx: Pick<AppContext, 'config'>, text: string): string {
  const words = blankPrivate(text.replace(/\s+/g, ' ').trim());
  if (words === '') throw new BadRequestError('Please say what to remind you about.');
  if (words.length > ctx.config.reminders.maxTextLength) {
    throw new BadRequestError(
      `That reminder is too long. Please keep it under ${ctx.config.reminders.maxTextLength} characters.`,
    );
  }
  return words;
}

function checkDueAt(ctx: ReminderContext, dueAt: Date): void {
  const at = ctx.now().getTime();
  const { pastGraceMinutes, maxDaysAhead } = ctx.config.reminders;
  if (Number.isNaN(dueAt.getTime())) throw new BadRequestError('Please say when to remind you.');
  if (dueAt.getTime() < at - pastGraceMinutes * 60_000) {
    throw new BadRequestError('That time has already passed. Please choose a time still to come.');
  }
  if (dueAt.getTime() > at + maxDaysAhead * 24 * 60 * 60 * 1000) {
    throw new BadRequestError('A reminder can be set up to a year ahead, not further.');
  }
}

/** Whether the account's quiet hours cover this moment: the reminder was set for them on purpose. */
function insideQuiet(ctx: ReminderContext, at: Date): boolean {
  const { quietFrom, quietUntil } = ctx.config.reminders;
  return inQuietHours(at, quietFrom, quietUntil);
}

/** Every check, then the row. Throws in plain words when something is not right. */
export async function createReminder(
  ctx: ReminderContext,
  account: ReminderAccount,
  input: ReminderInput,
): Promise<Reminder> {
  const text = tidyReminderText(ctx, input.text);
  checkDueAt(ctx, input.dueAt);
  const repeat = input.repeat ?? 'none';
  const channel = input.channel ?? 'notification';
  if (!REMINDER_REPEATS.includes(repeat)) throw new BadRequestError('Please choose how often.');
  if (!REMINDER_CHANNELS.includes(channel)) throw new BadRequestError('Please choose how.');
  if (channel === 'call' && !(await callAllowed(ctx, account))) {
    throw new ForbiddenError(callPlanWords(ctx, account.kind), { code: 'call_needs_plan' });
  }
  const waiting = (await ctx.repository.reminders.listFor(account.kind, account.id)).filter(
    (row) => row.status === 'scheduled',
  );
  if (waiting.length >= ctx.config.reminders.maxPerAccount) {
    throw new BadRequestError(
      `You already have ${ctx.config.reminders.maxPerAccount} reminders waiting. Please cancel one first.`,
    );
  }
  return ctx.repository.reminders.create({
    accountKind: account.kind,
    accountId: account.id,
    text,
    dueAt: input.dueAt,
    repeat,
    channel,
    createdVia: input.createdVia,
    setInQuiet: insideQuiet(ctx, input.dueAt),
    createdAt: ctx.now(),
  });
}

/** One account's reminders: the ones waiting, soonest first, then the last few sent. */
export async function listReminders(
  ctx: ReminderContext,
  account: ReminderAccount,
): Promise<Reminder[]> {
  const rows = await ctx.repository.reminders.listFor(account.kind, account.id);
  const waiting = rows.filter((row) => row.status === 'scheduled');
  const past = rows
    .filter((row) => row.status === 'sent' || row.status === 'heard')
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))
    .slice(0, 10);
  return [...waiting, ...past];
}

async function ownReminder(
  ctx: ReminderContext,
  account: ReminderAccount,
  id: string,
): Promise<Reminder> {
  const found = await ctx.repository.reminders.findById(id);
  if (!found || found.accountKind !== account.kind || found.accountId !== account.id) {
    throw new NotFoundError('reminder');
  }
  return found;
}

export async function cancelReminder(
  ctx: ReminderContext,
  account: ReminderAccount,
  id: string,
): Promise<Reminder> {
  const found = await ownReminder(ctx, account, id);
  if (found.status !== 'scheduled') return found;
  return ctx.repository.reminders.update(found.id, { status: 'cancelled' });
}

/** "I've heard it": on the screen, or key 1 on the call. */
export async function markHeard(ctx: ReminderContext, id: string): Promise<Reminder | null> {
  const found = await ctx.repository.reminders.findById(id);
  if (!found) return null;
  if (found.status === 'heard') return found;
  if (found.status === 'sent' || (found.status === 'scheduled' && found.repeat !== 'none')) {
    return ctx.repository.reminders.update(found.id, {
      ...(found.status === 'sent' ? { status: 'heard' } : {}),
      heardAt: ctx.now(),
    });
  }
  return found;
}

export async function markHeardFor(
  ctx: ReminderContext,
  account: ReminderAccount,
  id: string,
): Promise<Reminder> {
  await ownReminder(ctx, account, id);
  return (await markHeard(ctx, id)) as Reminder;
}

/** Key 2 on the call: the same reminder again in `reminders.againMinutes`, quiet hours or not. */
export async function remindAgain(ctx: ReminderContext, id: string): Promise<Reminder | null> {
  const found = await ctx.repository.reminders.findById(id);
  if (!found || found.status === 'cancelled') return null;
  const dueAt = new Date(ctx.now().getTime() + ctx.config.reminders.againMinutes * 60_000);
  if (found.repeat !== 'none' && found.status === 'scheduled') {
    // A repeating reminder has already moved on: a one-off copy comes back in a few minutes.
    return ctx.repository.reminders.create({
      accountKind: found.accountKind,
      accountId: found.accountId,
      text: found.text,
      dueAt,
      repeat: 'none',
      channel: found.channel,
      createdVia: found.createdVia,
      setInQuiet: true,
      createdAt: ctx.now(),
    });
  }
  return ctx.repository.reminders.update(found.id, {
    status: 'scheduled',
    dueAt,
    setInQuiet: true,
  });
}

/* ------------------------------------------------------------------ the words */

/** "Call the bank": the reminder's words, blanked again in case anything slipped through. */
export function reminderText(reminder: Pick<Reminder, 'text'>): string {
  return blankPrivate(reminder.text);
}

/** What the call says first. */
export function callOpening(
  ctx: Pick<AppContext, 'config'>,
  reminder: Pick<Reminder, 'text'>,
): string {
  return `Hello, this is ${ctx.config.assistantName} with your reminder: ${reminderText(reminder)}.`;
}

/** What the call asks after the reminder. */
export function callPrompt(ctx: Pick<AppContext, 'config'>): string {
  return `Press 1 if you've heard it, 2 to remind you again in ${ctx.config.reminders.againMinutes} minutes.`;
}

/** The text message. */
export function textWords(
  ctx: Pick<AppContext, 'config'>,
  reminder: Pick<Reminder, 'text'>,
): string {
  return `${ctx.config.assistantName} reminder: ${reminderText(reminder)}`;
}

/** What the screen and Ozi say about one reminder: "tomorrow at 10 in the morning: call the bank". */
export function reminderWords(reminder: Reminder, now: Date): string {
  return `${whenWords(reminder.dueAt, reminder.repeat, now)}: ${reminderText(reminder)}`;
}

/* ------------------------------------------------------------------ the read-back */

export interface ReminderDraft {
  text: string;
  dueAtIso: string;
  repeat: ReminderRepeat;
  channel: ReminderChannel;
}

/** What the model, or the sentence itself, asked for. Either an exact moment or words about when. */
export interface ReminderRequest {
  text: string;
  dueAtIso?: string | null | undefined;
  relative?: string | null | undefined;
  repeat?: ReminderRepeat | null | undefined;
  channel?: ReminderChannel | null | undefined;
}

export type ReminderProposal =
  { ok: true; draft: ReminderDraft; readBack: string } | { ok: false; why: string };

/**
 * Checks a reminder asked for by voice and reads it back in the server's own words. Nothing is
 * kept: the draft waits for the person's clear yes in their next turn (Rule One).
 */
export async function proposeReminder(
  ctx: ReminderContext,
  account: ReminderAccount,
  request: ReminderRequest,
): Promise<ReminderProposal> {
  const now = ctx.now();
  let text: string;
  try {
    text = tidyReminderText(ctx, request.text);
  } catch (failure) {
    return { ok: false, why: failure instanceof Error ? failure.message : 'Please say the words.' };
  }
  let dueAt: Date | null = null;
  let repeat: ReminderRepeat = request.repeat ?? 'none';
  if (request.dueAtIso) {
    const exact = new Date(request.dueAtIso);
    if (!Number.isNaN(exact.getTime())) dueAt = exact;
  }
  if (!dueAt && request.relative) {
    const resolved = resolveWhen(request.relative, now);
    if (resolved) {
      dueAt = resolved.dueAt;
      if (resolved.repeat && repeat === 'none') repeat = resolved.repeat;
    }
  }
  if (!dueAt) {
    return {
      ok: false,
      why: `When would you like me to remind you about ${text}? For example, tomorrow at ten, or in twenty minutes.`,
    };
  }
  try {
    checkDueAt(ctx, dueAt);
  } catch (failure) {
    return {
      ok: false,
      why: failure instanceof Error ? failure.message : 'That time is not right.',
    };
  }
  const waiting = (await ctx.repository.reminders.listFor(account.kind, account.id)).filter(
    (row) => row.status === 'scheduled',
  );
  if (waiting.length >= ctx.config.reminders.maxPerAccount) {
    return {
      ok: false,
      why: `You already have ${ctx.config.reminders.maxPerAccount} reminders waiting. Please cancel one first.`,
    };
  }
  let channel: ReminderChannel = request.channel ?? 'notification';
  let lead = '';
  if (channel === 'call' && !(await callAllowed(ctx, account))) {
    lead = `${callPlanWords(ctx, account.kind)} `;
    channel = 'notification';
  }
  const how =
    channel === 'call' ? ' I will ring you.' : channel === 'text' ? ' I will text you.' : '';
  return {
    ok: true,
    draft: { text, dueAtIso: dueAt.toISOString(), repeat, channel },
    readBack: `${lead}I'll remind you ${whenWords(dueAt, repeat, now)}: ${text}.${how} Shall I set that?`,
  };
}

/** A sentence read without the model, as a request for `proposeReminder`. */
export function requestFromPhrase(phrase: ReminderPhrase): ReminderRequest {
  return {
    text: phrase.text,
    dueAtIso: phrase.dueAt.toISOString(),
    repeat: phrase.repeat,
    channel: phrase.channel,
  };
}

/** The yes: the draft becomes a reminder, and Ozi says so. */
export async function keepDraft(
  ctx: ReminderContext,
  account: ReminderAccount,
  draft: ReminderDraft,
): Promise<{ reminder: Reminder | null; words: string }> {
  try {
    const reminder = await createReminder(ctx, account, {
      text: draft.text,
      dueAt: new Date(draft.dueAtIso),
      repeat: draft.repeat,
      channel: draft.channel,
      createdVia: 'voice',
    });
    return {
      reminder,
      words: `Done. I'll remind you ${whenWords(reminder.dueAt, reminder.repeat, ctx.now())}: ${reminderText(reminder)}.`,
    };
  } catch (failure) {
    return {
      reminder: null,
      words:
        `I couldn't set that reminder. ${failure instanceof Error ? failure.message : ''}`.trim(),
    };
  }
}

/** "You have two reminders: tomorrow at 10 in the morning, call the bank; …" */
export async function remindersSpoken(
  ctx: ReminderContext,
  account: ReminderAccount,
): Promise<string> {
  const now = ctx.now();
  const waiting = (await listReminders(ctx, account)).filter((row) => row.status === 'scheduled');
  if (waiting.length === 0) return 'You have no reminders waiting.';
  const few = waiting.slice(0, 5).map((row) => reminderWords(row, now));
  const more = waiting.length - few.length;
  return `You have ${waiting.length === 1 ? 'one reminder' : `${waiting.length} reminders`}: ${few.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;
}

/**
 * "Cancel my reminder": the next one waiting, read back for a yes; or every one when "all" was
 * said. Null when there is nothing to cancel.
 */
export async function proposeCancel(
  ctx: ReminderContext,
  account: ReminderAccount,
  all: boolean,
): Promise<{ ids: string[]; readBack: string } | null> {
  const now = ctx.now();
  const waiting = (await listReminders(ctx, account)).filter((row) => row.status === 'scheduled');
  if (waiting.length === 0) return null;
  if (all && waiting.length > 1) {
    return {
      ids: waiting.map((row) => row.id),
      readBack: `I'll cancel all ${waiting.length} of your reminders. Shall I go ahead?`,
    };
  }
  const next = waiting[0]!;
  return {
    ids: [next.id],
    readBack: `I'll cancel your reminder ${reminderWords(next, now)}. Shall I go ahead?`,
  };
}

export async function cancelMany(
  ctx: ReminderContext,
  account: ReminderAccount,
  ids: string[],
): Promise<{ words: string }> {
  let count = 0;
  for (const id of ids) {
    try {
      const row = await cancelReminder(ctx, account, id);
      if (row.status === 'cancelled') count += 1;
    } catch {
      // Already gone: nothing to cancel.
    }
  }
  return {
    words:
      count === 0
        ? 'That reminder had already gone.'
        : count === 1
          ? 'Cancelled. That reminder will not come.'
          : `Cancelled. Those ${count} reminders will not come.`,
  };
}

/* ------------------------------------------------------------------ the sweep */

export type DeliveredVia = 'notification' | 'text' | 'call' | 'inbox' | 'held';

/** The account's own phone, for a text or a call. The owner's is OWNER_ALERT_PHONE. */
async function phoneFor(ctx: ReminderContext, reminder: Reminder): Promise<string | null> {
  if (reminder.accountKind === 'owner') return ctx.env.ownerAlertPhone ?? null;
  if (reminder.accountKind === 'staff') {
    const member = await ctx.repository.staffMembers.findById(reminder.accountId);
    return member?.isOwner ? (ctx.env.ownerAlertPhone ?? null) : null;
  }
  const account = await findAccount(ctx, reminder.accountKind, reminder.accountId);
  return account?.phone ?? null;
}

/** The account's devices for notifications. */
async function devicesFor(ctx: ReminderContext, reminder: Reminder): Promise<PushSubscription[]> {
  if (!ctx.sendPush) return [];
  const { pushSubscriptions } = ctx.repository;
  switch (reminder.accountKind) {
    case 'shopper':
      return pushSubscriptions.listForShopper(reminder.accountId);
    case 'runner':
      return pushSubscriptions.listForRunner(reminder.accountId);
    case 'staff':
    case 'owner':
      return pushSubscriptions.listForStaff(reminder.accountId);
    default:
      return [];
  }
}

const PAGE_FOR: Record<ReminderAccountKind, string> = {
  shopper: '/settings',
  runner: '/runner/home',
  partner: '/partner',
  organisation: '/organisation',
  staff: '/staff',
  owner: '/staff',
};

async function sendNotification(
  ctx: ReminderContext,
  reminder: Reminder,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  const send = ctx.sendPush;
  if (!send) return false;
  let sent = false;
  for (const device of await devicesFor(ctx, reminder)) {
    try {
      const result = await send(device, {
        title: `${ctx.config.assistantName} reminder`,
        body: reminderText(reminder),
        url: PAGE_FOR[reminder.accountKind],
        tag: `reminder-${reminder.id}`,
      });
      if (result === 'gone') {
        await ctx.repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
      } else sent = true;
    } catch (failure) {
      log?.warn({ err: failure, reminderId: reminder.id }, 'A reminder notification did not go.');
    }
  }
  return sent;
}

async function sendText(
  ctx: ReminderContext,
  reminder: Reminder,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  if (!ctx.sendText) return false;
  const phone = await phoneFor(ctx, reminder);
  if (!phone) return false;
  try {
    await ctx.sendText(phone, textWords(ctx, reminder));
    return true;
  } catch (failure) {
    log?.warn({ err: failure, reminderId: reminder.id }, 'A reminder text did not go.');
    return false;
  }
}

export function reminderWebhookBase(ctx: Pick<AppContext, 'env'>): string {
  return `${ctx.env.primaryOrigin ?? ''}/api/webhooks/twilio/reminders`;
}

async function placeCall(
  ctx: ReminderContext,
  reminder: Reminder,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  if (!ctx.placeCall || !ctx.env.primaryOrigin) return false;
  const phone = await phoneFor(ctx, reminder);
  if (!phone) return false;
  const base = reminderWebhookBase(ctx);
  try {
    await ctx.placeCall(
      phone,
      `${base}/voice?reminder=${encodeURIComponent(reminder.id)}`,
      `${base}/status?reminder=${encodeURIComponent(reminder.id)}`,
    );
    return true;
  } catch (failure) {
    log?.warn({ err: failure, reminderId: reminder.id }, 'A reminder call could not be placed.');
    return false;
  }
}

/** Delivers one reminder by its channel, falling back as the ruling says. */
async function deliver(
  ctx: ReminderContext,
  reminder: Reminder,
  quiet: boolean,
  log?: FastifyBaseLogger,
): Promise<DeliveredVia> {
  if (reminder.channel === 'call') {
    if (await placeCall(ctx, reminder, log)) return 'call';
    if (await sendText(ctx, reminder, log)) return 'text';
    if (await sendNotification(ctx, reminder, log)) return 'notification';
    return 'inbox';
  }
  if (reminder.channel === 'text') {
    if (await sendText(ctx, reminder, log)) return 'text';
    if (await sendNotification(ctx, reminder, log)) return 'notification';
    return 'inbox';
  }
  if (await sendNotification(ctx, reminder, log)) return 'notification';
  // No device: a text if a phone is held, unless it is quiet; otherwise it waits on the screen.
  if (!quiet && (await sendText(ctx, reminder, log))) return 'text';
  return 'inbox';
}

/**
 * Every reminder that is due, sent once by its channel. Running it again sends nothing twice:
 * each row is marked before anything goes. Quiet hours hold a text or a call that was not set for
 * them, and never the owner's. A repeating reminder moves on to its next time.
 */
export async function sweepReminders(
  ctx: ReminderContext,
  log?: FastifyBaseLogger,
): Promise<{ sent: number; held: number; via: Record<DeliveredVia, number> }> {
  const at = ctx.now();
  const via: Record<DeliveredVia, number> = {
    notification: 0,
    text: 0,
    call: 0,
    inbox: 0,
    held: 0,
  };
  let sent = 0;
  let held = 0;
  const { quietFrom, quietUntil } = ctx.config.reminders;
  const quiet = inQuietHours(at, quietFrom, quietUntil);
  for (const reminder of await ctx.repository.reminders.listDue(at)) {
    try {
      const byPhone = reminder.channel === 'text' || reminder.channel === 'call';
      if (quiet && byPhone && !reminder.setInQuiet && reminder.accountKind !== 'owner') {
        await ctx.repository.reminders.update(reminder.id, {
          dueAt: nextAllowedAt(at, quietFrom, quietUntil),
        });
        held += 1;
        via.held += 1;
        continue;
      }
      // Marked first, so a second sweep running at the same moment finds nothing to send.
      const marked = await ctx.repository.reminders.update(
        reminder.id,
        reminder.repeat === 'none'
          ? { status: 'sent', sentAt: at }
          : { sentAt: at, dueAt: nextDue(reminder.dueAt, reminder.repeat, at) },
      );
      const how = await deliver(ctx, { ...marked, text: reminder.text }, quiet, log);
      via[how] += 1;
      sent += 1;
    } catch (failure) {
      log?.warn({ err: failure, reminderId: reminder.id }, 'A reminder could not be sent.');
    }
  }
  return { sent, held, via };
}

/** The next time after `at` a repeating reminder is due, so a late sweep never sends twice. */
function nextDue(dueAt: Date, repeat: ReminderRepeat, at: Date): Date {
  let next = nextOccurrence(dueAt, repeat);
  for (let guard = 0; guard < 400 && next.getTime() <= at.getTime(); guard += 1) {
    next = nextOccurrence(next, repeat);
  }
  return next;
}

/* ------------------------------------------------------------------ for the screen */

export interface ReminderView {
  id: string;
  text: string;
  dueAt: string;
  whenWords: string;
  repeat: ReminderRepeat;
  channel: ReminderChannel;
  status: Reminder['status'];
  sentAt: string | null;
  heardAt: string | null;
}

export function reminderView(reminder: Reminder, now: Date): ReminderView {
  return {
    id: reminder.id,
    text: reminderText(reminder),
    dueAt: reminder.dueAt.toISOString(),
    whenWords: whenWords(reminder.dueAt, reminder.repeat, now),
    repeat: reminder.repeat,
    channel: reminder.channel,
    status: reminder.status,
    sentAt: reminder.sentAt?.toISOString() ?? null,
    heardAt: reminder.heardAt?.toISOString() ?? null,
  };
}

/** For the owner's tools: every reminder waiting, with ids, and when in words. */
export async function remindersForVoice(
  ctx: ReminderContext,
  account: ReminderAccount,
): Promise<unknown> {
  const now = ctx.now();
  const rows = await listReminders(ctx, account);
  return {
    waiting: rows
      .filter((row) => row.status === 'scheduled')
      .map((row) => ({
        id: row.id,
        words: reminderText(row),
        when: ukWhenWords(row.dueAt, now),
        repeat: row.repeat,
        how: row.channel,
      })),
    recentlySent: rows
      .filter((row) => row.status !== 'scheduled')
      .slice(0, 5)
      .map((row) => ({ words: reminderText(row), status: row.status })),
  };
}
