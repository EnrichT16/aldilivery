/**
 * The company inbox and staff calls (ruling 77, Anthony, 23 October 2026).
 *
 * - **Messages.** The company (the owner and staff) can message any Shopper, Runner, Shop Partner
 *   or organisation, and they can reply. Accounts never message each other this way: every thread
 *   is between the company and one account. A new message tells the account by notification if
 *   they have them, otherwise by a text to their own number that says only that there is a
 *   message, never what it says. A reply becomes a matter on Ozi's desk, so the owner hears it.
 * - **Codes.** No staff member messages or calls at will. A message needs a message code (six
 *   digits, used once, for the staff member it was issued to, good for two hours); calls need a
 *   daily call code (six digits, entered once, good for that staff member's calls until midnight,
 *   UK time). The owner, and anyone he lets authorise, issue the codes and need none themselves.
 *   A staff member without a code can ask Ozi's desk instead: the owner's yes sends the message.
 *   Codes are kept only as keyed hashes, never as themselves, and never written to any log.
 * - **Calls.** Through the same LiveKit calls as orders: rung in the app, or on their own phone
 *   through LiveKit SIP from the company's number, never a staff member's own. Every staff call is
 *   logged, recorded when recording storage is set up, and both sides are told it is recorded.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import type {
  ContactAuthorisation,
  InboxAccountKind,
  InboxMessage,
  StaffCall,
  StaffCode,
  StaffCodeKind,
} from '../domain.js';
import { ApiError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../errors.js';
import type { CallWebhookEvent } from '../lib/livekit.js';
import { isViewerRole, type StaffActor } from '../lib/staff.js';
import { askOwner, nextDayAt, spokenSafe, ukDate } from './owner-desk.js';

type Ctx = Pick<AppContext, 'repository' | 'config' | 'env' | 'now'> &
  Partial<Pick<AppContext, 'sendPush' | 'sendText' | 'calls' | 'recorder'>>;

/** What both sides are told at the start of every staff call (UK law asks for it). */
export const RECORDED_NOTICE = 'This call is recorded.';
export const NOT_SET_UP = 'not recorded: recording storage not set up';

/** The only words a text about a message ever carries: never the message itself. */
export function messageNotice(productName: string): string {
  return `You have a new message from ${productName}. Open the app to read it.`;
}

export const ACCOUNT_KINDS: readonly InboxAccountKind[] = [
  'shopper',
  'runner',
  'partner',
  'organisation',
];

export function accountWord(kind: InboxAccountKind): string {
  return kind === 'shopper'
    ? 'Shopper'
    : kind === 'runner'
      ? 'Runner'
      : kind === 'partner'
        ? 'Shop Partner'
        : 'Organisation';
}

/** One account the company can talk to. The phone is used only to ring or text it. */
export interface ContactAccount {
  kind: InboxAccountKind;
  id: string;
  name: string;
  phone: string | null;
}

export async function findAccount(
  ctx: Pick<AppContext, 'repository'>,
  kind: InboxAccountKind,
  id: string,
): Promise<ContactAccount | null> {
  const { repository } = ctx;
  const usable = (phone: string | null | undefined): string | null =>
    phone && !phone.startsWith('closed:') && phone.trim() !== '' ? phone : null;
  switch (kind) {
    case 'shopper': {
      const shopper = await repository.shoppers.findById(id);
      if (!shopper || shopper.erasedAt) return null;
      return { kind, id, name: shopper.displayName, phone: usable(shopper.phone) };
    }
    case 'runner': {
      const runner = await repository.runners.findById(id);
      if (!runner || runner.erasedAt) return null;
      return { kind, id, name: runner.name, phone: usable(runner.phone) };
    }
    case 'partner': {
      const shop = await repository.partnerShops.findById(id);
      if (!shop) return null;
      return { kind, id, name: shop.name, phone: usable(shop.mobile || shop.telephone) };
    }
    case 'organisation': {
      const organisation = await repository.organisations.findById(id);
      if (!organisation) return null;
      return { kind, id, name: organisation.name, phone: usable(organisation.contactPhone) };
    }
  }
}

/** The first few words of a message, for Ozi's desk: never the whole of it, never a number. */
export function firstWords(text: string, count = 12): string {
  const words = text.trim().split(/\s+/);
  const start = words.slice(0, count).join(' ');
  return spokenSafe(words.length > count ? `${start}…` : start);
}

/* ------------------------------------------------------------------ who may authorise */

/** The owner, or a staff member he lets authorise. Never the staff key, which has no account. */
export async function isAuthoriser(
  ctx: Pick<AppContext, 'repository'>,
  actor: StaffActor,
): Promise<boolean> {
  if (actor.isOwner) return true;
  if (!actor.id || actor.viewOnly) return false;
  const member = await ctx.repository.staffMembers.findById(actor.id);
  return Boolean(member?.active && member.canAuthorise && !isViewerRole(member.role));
}

/** Messages and calls carry a staff member's own name, so the staff key cannot make them. */
export function ownAccountOnly(actor: StaffActor): { id: string; name: string } {
  if (!actor.id || actor.viewOnly) {
    throw new ForbiddenError(
      'Please sign in with your own staff account to message or call. Each message and call carries your own name.',
    );
  }
  return { id: actor.id, name: actor.name };
}

/* ------------------------------------------------------------------ codes */

const CODE_LABEL = 'staff-contact-code:';

/** A keyed hash: six digits are too few to keep as a plain hash. */
function codeHash(ctx: Pick<AppContext, 'env'>, code: string): string {
  return createHmac('sha256', `${CODE_LABEL}${ctx.env.authTokenSecret}`).update(code).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Wrong codes in a row a staff member may give before waiting. */
const WRONG_CODES = 5;
const WRONG_CODE_WAIT_MS = 15 * 60_000;
const wrongCodes = new Map<string, { count: number; since: number }>();

function checkTries(staffId: string, at: Date): void {
  const tries = wrongCodes.get(staffId);
  if (tries && at.getTime() - tries.since > WRONG_CODE_WAIT_MS) wrongCodes.delete(staffId);
  if ((wrongCodes.get(staffId)?.count ?? 0) >= WRONG_CODES) {
    throw new TooManyRequestsError(
      'Too many wrong codes. Please wait fifteen minutes, or ask for a new code.',
    );
  }
}

/**
 * Staff members locked out of message and call codes at this moment, and until when (ruling
 * 81): five wrong codes, then fifteen minutes.
 */
export function codeLockouts(at: Date): Array<{ staffId: string; until: Date }> {
  const out: Array<{ staffId: string; until: Date }> = [];
  for (const [staffId, tries] of wrongCodes) {
    const until = tries.since + WRONG_CODE_WAIT_MS;
    if (tries.count >= WRONG_CODES && until > at.getTime()) {
      out.push({ staffId, until: new Date(until) });
    }
  }
  return out;
}

/** Unlocks a staff member's message and call codes (ruling 81). True if they were locked. */
export function clearCodeLockout(staffId: string, at: Date): boolean {
  const locked = codeLockouts(at).some((row) => row.staffId === staffId);
  wrongCodes.delete(staffId);
  return locked;
}

function wrongTry(staffId: string, at: Date): void {
  const tries = wrongCodes.get(staffId);
  wrongCodes.set(staffId, {
    count: (tries?.count ?? 0) + 1,
    since: tries?.since ?? at.getTime(),
  });
}

/**
 * Issues a code for one staff member, by the owner or an authoriser. Gives the code back once;
 * only its hash is kept. A day's call code replaces any other call code they had.
 */
export async function issueCode(
  ctx: Ctx,
  issuer: StaffActor,
  staffId: string,
  kind: StaffCodeKind,
): Promise<{ code: string; expiresAt: Date; staffName: string }> {
  if (!(await isAuthoriser(ctx, issuer))) {
    throw new ForbiddenError('Only the owner, or someone he lets authorise, issues codes.');
  }
  const member = await ctx.repository.staffMembers.findById(staffId);
  if (!member || !member.active || isViewerRole(member.role)) {
    throw new NotFoundError('staff member');
  }
  const at = ctx.now();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt =
    kind === 'message'
      ? new Date(at.getTime() + ctx.config.companyContact.messageCodeMinutes * 60_000)
      : nextDayAt(at, '00:00');
  if (kind === 'call') {
    // One call code for each staff member each day: an earlier one stops.
    for (const earlier of await ctx.repository.companyContact.listCodesFor(staffId, 'call')) {
      if (earlier.expiresAt > at) {
        await ctx.repository.companyContact.updateCode(earlier.id, { expiresAt: at });
      }
    }
  }
  await ctx.repository.companyContact.createCode({
    kind,
    staffId,
    codeHash: codeHash(ctx, code),
    issuedById: issuer.id,
    issuedByName: issuer.name,
    createdAt: at,
    expiresAt,
    usedAt: null,
  });
  return { code, expiresAt, staffName: member.name };
}

/** Uses up a message code issued to this staff member, if it is right and still good. */
export async function useMessageCode(
  ctx: Ctx,
  staffId: string,
  given: string,
): Promise<StaffCode | null> {
  const at = ctx.now();
  checkTries(staffId, at);
  const code = given.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) {
    wrongTry(staffId, at);
    return null;
  }
  const hash = codeHash(ctx, code);
  const found = (await ctx.repository.companyContact.listCodesFor(staffId, 'message')).find(
    (row) => row.usedAt === null && row.expiresAt > at && sameHash(row.codeHash, hash),
  );
  if (!found) {
    wrongTry(staffId, at);
    return null;
  }
  wrongCodes.delete(staffId);
  return ctx.repository.companyContact.updateCode(found.id, { usedAt: at });
}

/** The day's call code, once entered: good for this staff member's calls until midnight. */
export async function activeCallCode(ctx: Ctx, staffId: string): Promise<StaffCode | null> {
  const at = ctx.now();
  return (
    (await ctx.repository.companyContact.listCodesFor(staffId, 'call')).find(
      (row) => row.usedAt !== null && row.expiresAt > at,
    ) ?? null
  );
}

/** Enters the day's call code. Good for the rest of the UK day once entered. */
export async function enterCallCode(
  ctx: Ctx,
  staffId: string,
  given: string,
): Promise<StaffCode | null> {
  const at = ctx.now();
  checkTries(staffId, at);
  const code = given.replace(/\s/g, '');
  const hash = codeHash(ctx, code);
  const found = /^\d{6}$/.test(code)
    ? (await ctx.repository.companyContact.listCodesFor(staffId, 'call')).find(
        (row) => row.expiresAt > at && sameHash(row.codeHash, hash),
      )
    : undefined;
  if (!found) {
    wrongTry(staffId, at);
    return null;
  }
  wrongCodes.delete(staffId);
  return found.usedAt ? found : ctx.repository.companyContact.updateCode(found.id, { usedAt: at });
}

/* ------------------------------------------------------------------ telling the account */

/**
 * Tells the account a message is waiting: by notification on a Shopper's devices if they have
 * any, otherwise by a text to their own number, saying only that there is a message.
 */
export async function notifyAccount(
  ctx: Ctx,
  account: ContactAccount,
  log?: FastifyBaseLogger,
): Promise<'push' | 'text' | 'none'> {
  const notice = messageNotice(ctx.config.productName);
  if (account.kind === 'shopper' && ctx.sendPush) {
    let sent = false;
    try {
      const devices = await ctx.repository.pushSubscriptions.listForShopper(account.id);
      for (const device of devices) {
        try {
          const result = await ctx.sendPush(device, {
            title: ctx.config.productName,
            body: notice,
            url: '/messages',
            tag: 'company-inbox',
          });
          if (result === 'gone') {
            await ctx.repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
          } else sent = true;
        } catch (failure) {
          log?.warn({ err: failure }, 'A message notification could not be sent.');
        }
      }
    } catch (failure) {
      log?.warn({ err: failure }, 'Message notifications could not be sent.');
    }
    if (sent) return 'push';
  }
  if (ctx.sendText && account.phone) {
    try {
      await ctx.sendText(account.phone, notice);
      return 'text';
    } catch (failure) {
      log?.warn({ err: failure, kind: account.kind }, 'The text about a message did not go.');
    }
  }
  return 'none';
}

/* ------------------------------------------------------------------ messages */

async function audit(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  entry: {
    actorId: string | null;
    actorName: string;
    actorRole: string;
    action: string;
    target: string;
    detail: string;
  },
): Promise<void> {
  try {
    await ctx.repository.audit.record({ at: ctx.now(), ip: '', ...entry });
  } catch {
    // The audit log never undoes what was done.
  }
}

export interface StaffSender {
  id: string;
  name: string;
}

/** Sends a staff member's message to an account, now. What authorised it is kept with it. */
export async function sendStaffMessage(
  ctx: Ctx,
  input: {
    staff: StaffSender;
    account: ContactAccount;
    text: string;
    authorisedBy: ContactAuthorisation;
    authorisedByName: string;
  },
  log?: FastifyBaseLogger,
): Promise<{ message: InboxMessage; notifiedBy: 'push' | 'text' | 'none' }> {
  const at = ctx.now();
  const thread = await ctx.repository.companyContact.openThread(
    input.account.kind,
    input.account.id,
  );
  const message = await ctx.repository.companyContact.addMessage({
    threadId: thread.id,
    fromStaff: true,
    staffId: input.staff.id,
    senderName: input.staff.name,
    text: input.text,
    createdAt: at,
    sentAt: at,
    readAt: null,
    status: 'sent',
    authorisedBy: input.authorisedBy,
    authorisedByName: input.authorisedByName,
  });
  await ctx.repository.companyContact.updateThread(thread.id, { lastMessageAt: at });
  const notifiedBy = await notifyAccount(ctx, input.account, log);
  return { message, notifiedBy };
}

/**
 * A staff member with no code asks Ozi's desk: the message is kept, held, and the owner is asked
 * "Staff member X asks to send a message to Runner Y: …". His yes sends it.
 */
export async function holdStaffMessage(
  ctx: Ctx,
  input: { staff: StaffSender; account: ContactAccount; text: string },
  log?: FastifyBaseLogger,
): Promise<InboxMessage> {
  const at = ctx.now();
  const thread = await ctx.repository.companyContact.openThread(
    input.account.kind,
    input.account.id,
  );
  const message = await ctx.repository.companyContact.addMessage({
    threadId: thread.id,
    fromStaff: true,
    staffId: input.staff.id,
    senderName: input.staff.name,
    text: input.text,
    createdAt: at,
    sentAt: null,
    readAt: null,
    status: 'held',
    authorisedBy: null,
    authorisedByName: null,
  });
  await askOwner(
    ctx,
    {
      kind: 'message_approval',
      subjectId: message.id,
      summary: `Staff member ${input.staff.name} asks to send a message to ${accountWord(input.account.kind)} ${input.account.name}: ${firstWords(input.text)}`,
      options: 'decide',
    },
    log,
  );
  return message;
}

/** The owner said yes on Ozi's desk: the held message goes now, authorised by the desk. */
export async function releaseHeldMessage(
  ctx: Ctx,
  messageId: string,
  by: string,
  log?: FastifyBaseLogger,
): Promise<InboxMessage> {
  const message = await ctx.repository.companyContact.findMessage(messageId);
  if (!message) throw new ApiError(404, 'not_found', 'The message is gone.');
  if (message.status !== 'held') throw new ApiError(409, 'conflict', 'Already decided.');
  const thread = await ctx.repository.companyContact.findThreadById(message.threadId);
  const account = thread ? await findAccount(ctx, thread.accountKind, thread.accountId) : null;
  if (!thread || !account) throw new ApiError(404, 'not_found', 'That account is gone.');
  const at = ctx.now();
  const sent = await ctx.repository.companyContact.updateMessage(message.id, {
    status: 'sent',
    sentAt: at,
    authorisedBy: 'desk',
    authorisedByName: by,
  });
  await ctx.repository.companyContact.updateThread(thread.id, { lastMessageAt: at });
  await notifyAccount(ctx, account, log);
  await audit(ctx, {
    actorId: null,
    actorName: by,
    actorRole: 'owner',
    action: 'inbox.approved',
    target: `message=${message.id}`,
    detail: `Approved ${message.senderName}'s message to ${accountWord(account.kind)} ${account.name}; it was sent.`,
  });
  return sent;
}

export async function declineHeldMessage(ctx: Ctx, messageId: string, by: string): Promise<void> {
  const message = await ctx.repository.companyContact.findMessage(messageId);
  if (!message) throw new ApiError(404, 'not_found', 'The message is gone.');
  if (message.status !== 'held') throw new ApiError(409, 'conflict', 'Already decided.');
  await ctx.repository.companyContact.updateMessage(message.id, {
    status: 'declined',
    authorisedByName: by,
  });
}

/** An account's reply: kept, and put on Ozi's desk for the owner to hear. */
export async function accountReply(
  ctx: Ctx,
  account: ContactAccount,
  senderName: string,
  text: string,
  log?: FastifyBaseLogger,
): Promise<InboxMessage> {
  const at = ctx.now();
  const thread = await ctx.repository.companyContact.openThread(account.kind, account.id);
  const message = await ctx.repository.companyContact.addMessage({
    threadId: thread.id,
    fromStaff: false,
    staffId: null,
    senderName,
    text,
    createdAt: at,
    sentAt: at,
    readAt: null,
    status: 'sent',
    authorisedBy: null,
    authorisedByName: null,
  });
  await ctx.repository.companyContact.updateThread(thread.id, { lastMessageAt: at });
  await askOwner(
    ctx,
    {
      kind: 'account_message',
      subjectId: message.id,
      summary: `${accountWord(account.kind)} ${account.name} replied to a message from ${ctx.config.productName}: ${firstWords(text)}`,
      options: 'acknowledge',
    },
    log,
  );
  return message;
}

/* ------------------------------------------------------------------ calls */

const ACCOUNT_PREFIX = 'account-';
const PHONE_PREFIX = 'phone-';

export function accountIdentity(kind: InboxAccountKind, id: string): string {
  return `${ACCOUNT_PREFIX}${kind}-${id}`;
}

function phoneIdentity(kind: InboxAccountKind, id: string): string {
  return `${PHONE_PREFIX}${kind}-${id}`;
}

export function staffIdentity(staffId: string): string {
  return `staff-${staffId}`;
}

/** A ringing call nobody answered in this long counts as missed. */
export const RING_MS = 2 * 60_000;

/** Starts a staff call: the room, the log entry, and a ring on a Shopper's devices. */
export async function startStaffCall(
  ctx: Ctx,
  input: {
    staff: StaffSender;
    account: ContactAccount;
    authorisedBy: ContactAuthorisation;
    authorisedByName: string | null;
  },
  log?: FastifyBaseLogger,
): Promise<StaffCall> {
  const at = ctx.now();
  const call = await ctx.repository.companyContact.createCall({
    roomName: `staff-call-${randomBytes(16).toString('hex')}`,
    staffId: input.staff.id,
    staffName: input.staff.name,
    accountKind: input.account.kind,
    accountId: input.account.id,
    accountName: input.account.name,
    authorisedBy: input.authorisedBy,
    authorisedByName: input.authorisedByName,
    status: 'ringing',
    startedAt: at,
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
    phoneRung: false,
    recordingStatus: ctx.recorder ? 'none' : 'not_recorded',
    recordingKey: null,
    egressId: null,
    recordingNote: ctx.recorder ? null : NOT_SET_UP,
  });
  if (input.account.kind === 'shopper' && ctx.sendPush) {
    const devices = await ctx.repository.pushSubscriptions
      .listForShopper(input.account.id)
      .catch(() => []);
    for (const device of devices) {
      await ctx
        .sendPush(device, {
          title: `${ctx.config.productName} is calling`,
          body: 'Open the app to answer.',
          url: '/messages',
          tag: `staff-call-${call.id}`,
        })
        .catch((failure: unknown) => {
          log?.warn({ err: failure }, 'The call notification could not be sent.');
        });
    }
  }
  return call;
}

/** The account answered, in the app or on the phone: the call is live, and recording starts. */
async function answered(
  ctx: Ctx,
  call: StaffCall,
  at: Date,
  log?: FastifyBaseLogger,
): Promise<StaffCall> {
  let updated = await ctx.repository.companyContact.updateCall(call.id, {
    status: 'live',
    answeredAt: at,
  });
  if (ctx.recorder && updated.recordingStatus === 'none') {
    const key = `calls/${ukDate(at)}/${call.id}-${randomBytes(8).toString('hex')}.ogg`;
    try {
      const { egressId } = await ctx.recorder.start({ roomName: call.roomName, key });
      updated = await ctx.repository.companyContact.updateCall(call.id, {
        recordingStatus: 'recording',
        recordingKey: key,
        egressId,
      });
    } catch (failure) {
      log?.warn({ err: failure, callId: call.id }, 'The call recording could not be started.');
      updated = await ctx.repository.companyContact.updateCall(call.id, {
        recordingStatus: 'failed',
        recordingNote: 'not recorded: the recording could not be started',
      });
    }
  }
  return updated;
}

/** Ends a staff call: how long it lasted, and its recording saved. Safe to call twice. */
export async function finishStaffCall(
  ctx: Ctx,
  call: StaffCall,
  at: Date,
  log?: FastifyBaseLogger,
): Promise<StaffCall> {
  if (call.status === 'ended') return call;
  const durationSeconds = call.answeredAt
    ? Math.max(0, Math.round((at.getTime() - call.answeredAt.getTime()) / 1000))
    : 0;
  let recordingStatus = call.recordingStatus;
  let recordingNote = call.recordingNote;
  if (call.recordingStatus === 'recording' && call.egressId && ctx.recorder) {
    await ctx.recorder.stop(call.egressId).catch((failure: unknown) => {
      // It stops by itself when the room closes.
      log?.info({ err: failure, callId: call.id }, 'The recording had already stopped.');
    });
    recordingStatus = 'saved';
  } else if (call.recordingStatus === 'none' && !call.answeredAt) {
    recordingStatus = 'not_recorded';
    recordingNote = 'not recorded: the call was not answered';
  }
  return ctx.repository.companyContact.updateCall(call.id, {
    status: 'ended',
    endedAt: at,
    durationSeconds,
    recordingStatus,
    recordingNote,
  });
}

/** A ringing call nobody answered in time is ended as missed, so it stops ringing. */
export async function settleMissedCall(ctx: Ctx, call: StaffCall): Promise<StaffCall> {
  if (call.status === 'ringing' && ctx.now().getTime() - call.startedAt.getTime() > RING_MS) {
    return finishStaffCall(ctx, call, ctx.now());
  }
  return call;
}

/** Rings the account's own phone into the call, from the company's number (ruling 63). */
export async function ringAccountPhone(
  ctx: Ctx,
  call: StaffCall,
  log?: FastifyBaseLogger,
): Promise<StaffCall> {
  const provider = ctx.calls;
  if (!provider?.dialPhone) {
    throw new ApiError(
      503,
      'unavailable',
      'Ringing a phone is not switched on yet. They can answer in the app.',
    );
  }
  const account = await findAccount(ctx, call.accountKind, call.accountId);
  if (!account?.phone) {
    throw new ApiError(409, 'conflict', 'There is no number on that account to ring.');
  }
  try {
    await provider.dialPhone({
      roomName: call.roomName,
      phone: account.phone,
      identity: phoneIdentity(account.kind, account.id),
      name: account.name,
    });
  } catch (failure) {
    log?.warn({ err: failure, callId: call.id }, 'The phone could not be rung.');
    throw new ApiError(
      503,
      'unavailable',
      'Their phone could not be rung just now. Please try again.',
    );
  }
  return ctx.repository.companyContact.updateCall(call.id, { phoneRung: true });
}

/**
 * LiveKit's signed record of a staff call: the account joining (answered), and the room closing.
 * Returns false when the room is not a staff call, so order calls carry on as they were.
 */
export async function handleStaffCallEvent(
  ctx: Ctx,
  event: CallWebhookEvent,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  if (!event.roomName) return false;
  const call = await ctx.repository.companyContact.findCallByRoomName(event.roomName);
  if (!call) return false;
  if (call.status === 'ended') return true;
  const identity = event.identity ?? '';
  if (
    event.event === 'participant_joined' &&
    !call.answeredAt &&
    (identity.startsWith(ACCOUNT_PREFIX) || identity.startsWith(PHONE_PREFIX))
  ) {
    await answered(ctx, call, event.at, log);
  } else if (event.event === 'room_finished') {
    const latest = (await ctx.repository.companyContact.findCall(call.id)) ?? call;
    await finishStaffCall(ctx, latest, event.at, log);
  }
  return true;
}

/** The account opened the call in the app: answered at once, if LiveKit has not said so yet. */
export async function answeredInApp(
  ctx: Ctx,
  call: StaffCall,
  log?: FastifyBaseLogger,
): Promise<StaffCall> {
  if (call.answeredAt || call.status === 'ended') return call;
  return answered(ctx, call, ctx.now(), log);
}

/* ------------------------------------------------------------------ recordings, kept 90 days */

/** Deletes recordings older than `companyContact.callRecordingDays`. Returns how many. */
export async function deleteOldRecordings(
  ctx: Pick<AppContext, 'repository' | 'now'> & Partial<Pick<AppContext, 'config' | 'recorder'>>,
  log?: FastifyBaseLogger,
): Promise<number> {
  const recorder = ctx.recorder;
  if (!recorder) return 0;
  const days = ctx.config?.companyContact.callRecordingDays ?? 90;
  const before = new Date(ctx.now().getTime() - days * 24 * 3600 * 1000);
  let removed = 0;
  for (const call of await ctx.repository.companyContact.listRecordingsStartedBefore(before)) {
    if (!call.recordingKey) continue;
    try {
      await recorder.remove(call.recordingKey);
      await ctx.repository.companyContact.updateCall(call.id, {
        recordingStatus: 'deleted',
        recordingKey: null,
        egressId: null,
        recordingNote: `deleted after ${days} days`,
      });
      removed += 1;
    } catch (failure) {
      log?.error({ err: failure, callId: call.id }, 'A call recording could not be deleted.');
    }
  }
  return removed;
}
