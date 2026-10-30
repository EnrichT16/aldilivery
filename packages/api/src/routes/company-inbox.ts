/**
 * The company inbox and staff calls (ruling 77, Anthony, 23 October 2026).
 *
 * For every account (a Shopper or a Runner signed in, a Shop Partner or an organisation with its
 * own sign-in): its messages from the company, how many are unread, a reply, and a call from the
 * company to answer. For staff, in the admin panel's Messages tab: the threads with unread counts,
 * sending (with a message code, unless the owner or an authoriser sends), asking Ozi's desk for
 * approval, codes, calling, and the messages and calls log.
 *
 * Accounts never message each other here: every thread is between the company and one account.
 * Nobody's telephone number is in anything these routes answer.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { InboxAccountKind, InboxMessage, ReferralVoucher, StaffCall } from '../domain.js';
import {
  ApiError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from '../errors.js';
import { recordAudit } from '../lib/audit.js';
import { businessActor } from '../lib/business.js';
import type { CallProvider } from '../lib/livekit.js';
import {
  isViewerRole,
  STAFF_ROLES,
  isStaffRole,
  staffActor,
  type StaffActor,
} from '../lib/staff.js';
import {
  ACCOUNT_KINDS,
  NOT_SET_UP,
  RECORDED_NOTICE,
  accountIdentity,
  accountReply,
  accountWord,
  activeCallCode,
  answeredInApp,
  enterCallCode,
  findAccount,
  finishStaffCall,
  holdStaffMessage,
  isAuthoriser,
  issueCode,
  ownAccountOnly,
  ringAccountPhone,
  sendStaffMessage,
  settleMissedCall,
  staffIdentity,
  startStaffCall,
  useMessageCode,
  type ContactAccount,
} from '../services/company-contact.js';
import {
  accountSeen,
  accountVoucherView,
  answerVoucherRing,
  ringingVoucher,
  voucherUsed,
  vouchersRead,
} from '../services/vouchers.js';

/** A pass into a room lasts long enough to connect, not for ever. */
const TOKEN_SECONDS = 10 * 60;
/** A recording's link plays for five minutes, then stops working. */
const PLAYBACK_SECONDS = 5 * 60;

const kindSchema = z.enum(['shopper', 'runner', 'partner', 'organisation'], {
  errorMap: () => ({
    message: 'Please say which kind of account: Shopper, Runner, Shop Partner or organisation.',
  }),
});

const textSchema = z
  .string()
  .trim()
  .min(1, 'Please write the message first.')
  .max(2000, 'That message is too long. Please keep it under 2,000 characters.');

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export async function registerCompanyInboxRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const { repository, config, now } = ctx;
  const contact = repository.companyContact;

  function provider(): CallProvider {
    if (!ctx.calls) {
      throw new UnavailableError('Calls are not switched on yet. Please send a message instead.');
    }
    return ctx.calls;
  }

  /* ---------------------------------------------------------------- the account's side */

  /** Who is asking: a Shopper or Runner signed in, or a partner shop or organisation. */
  async function inboxAccount(
    request: FastifyRequest,
  ): Promise<{ account: ContactAccount; senderName: string }> {
    if (request.headers['x-business-token']) {
      const user = await businessActor(request);
      const kind: InboxAccountKind = user.kind === 'partner' ? 'partner' : 'organisation';
      const id = user.kind === 'partner' ? user.partnerShopId : user.organisationId;
      const account = id ? await findAccount(ctx, kind, id) : null;
      if (!account) throw new NotFoundError('account');
      return { account, senderName: user.name };
    }
    const session = requireSession(request);
    const account = await findAccount(ctx, session.role, session.accountId);
    if (!account) throw new NotFoundError('account');
    return { account, senderName: account.name };
  }

  /**
   * What the account sees of a message: who from, never a staff code or what authorised it. A
   * referral voucher's message carries the voucher itself, its code in full, for this person
   * alone (30 October 2026).
   */
  function accountView(message: InboxMessage, vouchers: readonly ReferralVoucher[] = []) {
    const voucher = vouchers.find((row) => row.messageId === message.id && row.erasedAt === null);
    return {
      id: message.id,
      from: message.fromStaff ? 'company' : 'you',
      fromName: message.fromStaff
        ? `${firstName(message.senderName)}, ${config.productName}`
        : message.senderName,
      text: message.text,
      sentAt: message.sentAt,
      readAt: message.fromStaff ? message.readAt : null,
      voucher: voucher ? accountVoucherView(ctx, voucher) : null,
    };
  }

  /** This account's sent vouchers. */
  function vouchersOf(account: ContactAccount): Promise<ReferralVoucher[]> {
    return repository.vouchers.listFor(account.kind, account.id);
  }

  async function accountMessages(account: ContactAccount): Promise<InboxMessage[]> {
    const thread = await contact.findThread(account.kind, account.id);
    if (!thread) return [];
    return (await contact.listMessages(thread.id)).filter((message) => message.status === 'sent');
  }

  function unreadOf(messages: InboxMessage[]): number {
    return messages.filter((message) => message.fromStaff && message.readAt === null).length;
  }

  /** A call from the company that is ringing or live for this account. */
  async function currentCall(account: ContactAccount): Promise<StaffCall | null> {
    const [latest] = await contact.listCallsFor(account.kind, account.id);
    if (!latest || latest.status === 'ended') return null;
    const settled = await settleMissedCall(ctx, latest);
    return settled.status === 'ended' ? null : settled;
  }

  function accountCallView(call: StaffCall) {
    return {
      id: call.id,
      status: call.status,
      from: config.productName,
      words: `${config.productName} is calling.`,
      notice: RECORDED_NOTICE,
    };
  }

  app.get('/inbox', async (request) => {
    const { account } = await inboxAccount(request);
    accountSeen(ctx, account.kind, account.id);
    const messages = await accountMessages(account);
    const vouchers = await vouchersOf(account);
    return {
      productName: config.productName,
      messages: messages.map((message) => accountView(message, vouchers)),
      unread: unreadOf(messages),
    };
  });

  /**
   * For the main pages' count, and a call ringing: cheap enough to ask every half minute. Ozi
   * ringing about an unopened voucher comes here too (30 October 2026), and asking means the app
   * is open, so a reminder may ring in it.
   */
  app.get('/inbox/unread', async (request) => {
    const { account } = await inboxAccount(request);
    accountSeen(ctx, account.kind, account.id);
    const call = await currentCall(account);
    return {
      unread: unreadOf(await accountMessages(account)),
      call: call ? accountCallView(call) : null,
      ozi: await ringingVoucher(ctx, account),
    };
  });

  app.post('/inbox/read', async (request) => {
    const { account } = await inboxAccount(request);
    const at = now();
    for (const message of await accountMessages(account)) {
      if (message.fromStaff && message.readAt === null) {
        await contact.updateMessage(message.id, { readAt: at });
      }
    }
    // A voucher message read is a voucher opened: no more reminders (30 October 2026).
    await vouchersRead(ctx, account);
    return { unread: 0 };
  });

  /** "I've used it": the person's own word, as Amazon cannot tell us (30 October 2026). */
  app.post('/inbox/vouchers/:id/used', async (request) => {
    const { account } = await inboxAccount(request);
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const voucher = await voucherUsed(ctx, account, id);
    return {
      voucher: accountVoucherView(ctx, voucher),
      words: 'Thank you. We have noted that you have used your voucher.',
    };
  });

  /** Ozi's reminder ring about a voucher, answered in the app or turned down. */
  app.post('/inbox/vouchers/:id/ring/:answer', async (request) => {
    const { account } = await inboxAccount(request);
    const { id, answer } = z
      .object({ id: z.string().min(1).max(60), answer: z.enum(['answer', 'decline']) })
      .parse(request.params);
    return answerVoucherRing(ctx, account, id, answer === 'answer');
  });

  app.post('/inbox/reply', async (request, reply) => {
    const { account, senderName } = await inboxAccount(request);
    const { text } = z.object({ text: textSchema }).parse(request.body ?? {});
    const message = await accountReply(ctx, account, senderName, text, request.log);
    void reply.status(201);
    return {
      message: accountView(message),
      words: `Sent to ${config.productName}. We will reply here.`,
    };
  });

  app.get('/inbox/call', async (request) => {
    const { account } = await inboxAccount(request);
    accountSeen(ctx, account.kind, account.id);
    const call = await currentCall(account);
    return {
      call: call ? accountCallView(call) : null,
      ozi: call ? null : await ringingVoucher(ctx, account),
    };
  });

  async function accountCall(
    request: FastifyRequest,
  ): Promise<{ call: StaffCall; account: ContactAccount }> {
    const { account } = await inboxAccount(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const call = await contact.findCall(id);
    if (!call || call.accountKind !== account.kind || call.accountId !== account.id) {
      throw new NotFoundError('call');
    }
    return { call, account };
  }

  /** Answering in the app: a pass into the room, and "This call is recorded" first. */
  app.post('/inbox/call/:id/answer', async (request) => {
    const calls = provider();
    const { call, account } = await accountCall(request);
    const settled = await settleMissedCall(ctx, call);
    if (settled.status === 'ended') throw new ConflictError('That call has ended.');
    const live = await answeredInApp(ctx, settled, request.log);
    const token = await calls.issueToken({
      roomName: live.roomName,
      identity: accountIdentity(account.kind, account.id),
      name: account.name,
      ttlSeconds: TOKEN_SECONDS,
    });
    return {
      call: accountCallView(live),
      join: { url: calls.url, token, roomName: live.roomName },
      notice: RECORDED_NOTICE,
    };
  });

  app.post('/inbox/call/:id/end', async (request) => {
    const { call } = await accountCall(request);
    if (call.status !== 'ended') {
      await ctx.calls?.endRoom(call.roomName).catch((failure: unknown) => {
        request.log.warn({ err: failure }, 'LiveKit could not close the room.');
      });
      await finishStaffCall(ctx, call, now(), request.log);
    }
    return { ended: true };
  });

  /* ---------------------------------------------------------------- the staff side */

  async function staff(request: FastifyRequest): Promise<StaffActor> {
    return staffActor(request, 'messages');
  }

  function staffMessageView(message: InboxMessage) {
    return {
      id: message.id,
      fromStaff: message.fromStaff,
      senderName: message.senderName,
      text: message.text,
      createdAt: message.createdAt,
      sentAt: message.sentAt,
      readAt: message.readAt,
      status: message.status,
      authorisedBy: message.authorisedBy,
      authorisedByName: message.authorisedByName,
    };
  }

  function staffCallView(call: StaffCall, playable: boolean) {
    return {
      id: call.id,
      status: call.status,
      staffName: call.staffName,
      accountKind: call.accountKind,
      accountWord: accountWord(call.accountKind),
      accountName: call.accountName,
      authorisedBy: call.authorisedBy,
      authorisedByName: call.authorisedByName,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
      durationSeconds: call.durationSeconds,
      phoneRung: call.phoneRung,
      recording: {
        status: call.recordingStatus,
        note: call.recordingNote,
        playable: playable && call.recordingKey !== null && call.recordingStatus === 'saved',
      },
    };
  }

  async function chosenAccount(kind: InboxAccountKind, id: string): Promise<ContactAccount> {
    const account = await findAccount(ctx, kind, id);
    if (!account) throw new NotFoundError('account');
    return account;
  }

  /** What this staff member may do: authorise, and whether today's call code is entered. */
  app.get('/staff/contact/me', async (request) => {
    const actor = await staff(request);
    const authoriser = await isAuthoriser(ctx, actor);
    const callCode = actor.id ? await activeCallCode(ctx, actor.id) : null;
    return {
      authoriser,
      ownAccount: actor.id !== null && !actor.viewOnly,
      callCodeActive: authoriser || callCode !== null,
      callCodeUntil: callCode?.expiresAt ?? null,
      callsOn: ctx.calls !== null,
      phoneOn: Boolean(ctx.calls?.dialPhone),
      recordingOn: ctx.recorder !== null,
      recordingNote: ctx.recorder ? null : NOT_SET_UP,
      messageCodeMinutes: config.companyContact.messageCodeMinutes,
    };
  });

  /** Finding an account to message or call, by name. Never a number in what comes back. */
  app.get('/staff/contact/accounts', async (request) => {
    await staff(request);
    const query = z
      .object({ kind: kindSchema, q: z.string().trim().max(80).optional() })
      .parse(request.query ?? {});
    const needle = (query.q ?? '').toLowerCase();
    const matches = (name: string): boolean => needle === '' || name.toLowerCase().includes(needle);
    let found: Array<{ id: string; name: string }> = [];
    if (query.kind === 'shopper') {
      if (needle.length >= 2) {
        found = (await repository.admin.searchShoppers(needle, 40))
          .filter(
            (shopper) => !shopper.erasedAt && matches(`${shopper.displayName} ${shopper.handle}`),
          )
          .map((shopper) => ({ id: shopper.id, name: shopper.displayName }));
      }
    } else if (query.kind === 'runner') {
      found = (await repository.runners.listAll())
        .filter((runner) => !runner.erasedAt && matches(runner.name))
        .map((runner) => ({ id: runner.id, name: runner.name }));
    } else if (query.kind === 'partner') {
      found = (await repository.partnerShops.list())
        .filter((shop) => matches(shop.name))
        .map((shop) => ({ id: shop.id, name: shop.name }));
    } else {
      found = (await repository.organisations.list())
        .filter((organisation) => matches(organisation.name))
        .map((organisation) => ({ id: organisation.id, name: organisation.name }));
    }
    return {
      accounts: found
        .slice(0, 20)
        .map((row) => ({ ...row, kind: query.kind, word: accountWord(query.kind) })),
    };
  });

  /** The staff members a code can be issued to: for the owner and authorisers. */
  app.get('/staff/contact/staff', async (request) => {
    const actor = await staff(request);
    if (!(await isAuthoriser(ctx, actor))) {
      throw new ForbiddenError('Only the owner, or someone he lets authorise, issues codes.');
    }
    const team = (await repository.staffMembers.list()).filter(
      (member) => member.active && !isViewerRole(member.role),
    );
    return {
      staff: team.map((member) => ({
        id: member.id,
        name: member.name,
        title: member.isOwner
          ? 'Founder and owner'
          : isStaffRole(member.role)
            ? STAFF_ROLES[member.role].title
            : member.role,
        authoriser: member.isOwner || member.canAuthorise,
      })),
    };
  });

  /** Issues a message code or a day's call code. The code is shown once and never kept. */
  app.post('/staff/contact/codes', async (request, reply) => {
    const actor = await staff(request);
    const body = z
      .object({ staffId: z.string().min(1), kind: z.enum(['message', 'call']) })
      .parse(request.body ?? {});
    const issued = await issueCode(ctx, actor, body.staffId, body.kind);
    await recordAudit(request, {
      action: 'contact.code-issued',
      target: `staff=${body.staffId}`,
      detail: `A ${body.kind} code for ${issued.staffName}, good until ${issued.expiresAt.toISOString()}.`,
    });
    void reply.status(201);
    const until = issued.expiresAt.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: '2-digit',
    });
    return {
      code: issued.code,
      expiresAt: issued.expiresAt,
      message:
        body.kind === 'message'
          ? `A message code for ${issued.staffName}: ${issued.code.split('').join(' ')}. It sends one message, only for them, until ${until}. It is shown only once.`
          : `Today's call code for ${issued.staffName}: ${issued.code.split('').join(' ')}. Once they enter it, it is good for their calls until midnight. It is shown only once.`,
    };
  });

  /** Entering the day's call code, once. */
  app.post('/staff/contact/call-code', async (request) => {
    const actor = await staff(request);
    const me = ownAccountOnly(actor);
    const { code } = z.object({ code: z.string().max(20) }).parse(request.body ?? {});
    const entered = await enterCallCode(ctx, me.id, code);
    if (!entered) {
      throw new ApiError(403, 'code_wrong', 'That call code is not right, or it has run out.');
    }
    await recordAudit(request, {
      action: 'contact.call-code-entered',
      target: `staff=${me.id}`,
      detail: `Issued by ${entered.issuedByName}; good until midnight.`,
    });
    return {
      callCodeActive: true,
      callCodeUntil: entered.expiresAt,
      message: 'Your call code is in. You can call until midnight.',
    };
  });

  /** The threads, newest first, with how many replies staff have not read yet. */
  app.get('/staff/messages', async (request) => {
    await staff(request);
    const threads = await contact.listThreads();
    const rows = [];
    let totalUnread = 0;
    for (const thread of threads) {
      const account = await findAccount(ctx, thread.accountKind, thread.accountId);
      const messages = await contact.listMessages(thread.id);
      const unread = messages.filter(
        (message) => !message.fromStaff && message.readAt === null,
      ).length;
      totalUnread += unread;
      const last = messages[messages.length - 1];
      rows.push({
        id: thread.id,
        accountKind: thread.accountKind,
        accountId: thread.accountId,
        accountWord: accountWord(thread.accountKind),
        accountName: account?.name ?? 'Closed account',
        lastMessageAt: thread.lastMessageAt,
        lastFromAccount: last ? !last.fromStaff : false,
        unread,
        held: messages.filter((message) => message.status === 'held').length,
      });
    }
    return { threads: rows, unread: totalUnread };
  });

  /** One thread, every message both ways; opening it marks the account's replies read. */
  app.get('/staff/messages/:threadId', async (request) => {
    await staff(request);
    const { threadId } = z.object({ threadId: z.string().min(1) }).parse(request.params);
    const thread = await contact.findThreadById(threadId);
    if (!thread) throw new NotFoundError('conversation');
    const account = await findAccount(ctx, thread.accountKind, thread.accountId);
    const at = now();
    const messages = await contact.listMessages(thread.id);
    for (const message of messages) {
      if (!message.fromStaff && message.readAt === null) {
        await contact.updateMessage(message.id, { readAt: at });
      }
    }
    return {
      thread: {
        id: thread.id,
        accountKind: thread.accountKind,
        accountId: thread.accountId,
        accountWord: accountWord(thread.accountKind),
        accountName: account?.name ?? 'Closed account',
      },
      messages: messages.map(staffMessageView),
    };
  });

  const sendSchema = z.object({
    accountKind: kindSchema,
    accountId: z.string().min(1),
    text: textSchema,
    code: z.string().max(20).optional(),
  });

  /**
   * Sending a message. The owner and authorisers send at once; everyone else needs a message code
   * issued to them, used once. Without a valid one, nothing is sent.
   */
  app.post('/staff/messages/send', async (request, reply) => {
    const actor = await staff(request);
    const me = ownAccountOnly(actor);
    const body = sendSchema.parse(request.body ?? {});
    const account = await chosenAccount(body.accountKind, body.accountId);
    let authorisedBy: 'self' | 'code' = 'self';
    let authorisedByName = me.name;
    if (!(await isAuthoriser(ctx, actor))) {
      if (!body.code || body.code.trim() === '') {
        throw new ApiError(
          403,
          'code_needed',
          'A message code is needed to send this. Please type the code you were given, or press Ask for a code. Nothing was sent.',
          { canAsk: true },
        );
      }
      const used = await useMessageCode(ctx, me.id, body.code);
      if (!used) {
        await recordAudit(request, {
          action: 'inbox.refused',
          target: `${account.kind}=${account.id}`,
          detail: `A message to ${accountWord(account.kind)} ${account.name} was refused: the code was not right, used, or out of date.`,
        });
        throw new ApiError(
          403,
          'code_wrong',
          'That code is not right, has been used, or has run out. Nothing was sent.',
          { canAsk: true },
        );
      }
      authorisedBy = 'code';
      authorisedByName = used.issuedByName;
    }
    const sent = await sendStaffMessage(
      ctx,
      { staff: me, account, text: body.text, authorisedBy, authorisedByName },
      request.log,
    );
    await recordAudit(request, {
      action: 'inbox.sent',
      target: `${account.kind}=${account.id}`,
      detail: `To ${accountWord(account.kind)} ${account.name}; ${authorisedBy === 'code' ? `with a code from ${authorisedByName}` : 'as an authoriser'}; told by ${sent.notifiedBy === 'push' ? 'notification' : sent.notifiedBy === 'text' ? 'text, without the message' : 'nothing (no notifications or number)'}.`,
    });
    void reply.status(201);
    return {
      message: staffMessageView(sent.message),
      notifiedBy: sent.notifiedBy,
      words: `Sent to ${account.name}.`,
    };
  });

  /** No code: ask Ozi's desk. The message waits; the owner's yes sends it. */
  app.post('/staff/messages/ask', async (request, reply) => {
    const actor = await staff(request);
    const me = ownAccountOnly(actor);
    const body = sendSchema.omit({ code: true }).parse(request.body ?? {});
    const account = await chosenAccount(body.accountKind, body.accountId);
    const held = await holdStaffMessage(ctx, { staff: me, account, text: body.text }, request.log);
    await recordAudit(request, {
      action: 'inbox.asked',
      target: `${account.kind}=${account.id}`,
      detail: `Asked the owner to approve a message to ${accountWord(account.kind)} ${account.name}.`,
    });
    void reply.status(201);
    return {
      message: staffMessageView(held),
      words: `${config.assistantName} will ask the owner. If he approves, it is sent to ${account.name} straight away.`,
    };
  });

  /* ---------------------------------------------------------------- staff calls */

  async function staffCall(request: FastifyRequest, actor: StaffActor): Promise<StaffCall> {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const call = await contact.findCall(id);
    if (!call) throw new NotFoundError('call');
    if (call.staffId !== actor.id && !(await isAuthoriser(ctx, actor))) {
      throw new NotFoundError('call');
    }
    return call;
  }

  /**
   * Calling an account. The owner and authorisers call at once; everyone else needs today's call
   * code, entered once (here or on its own) and good until midnight, UK time.
   */
  app.post('/staff/calls', async (request, reply) => {
    const calls = provider();
    const actor = await staff(request);
    const me = ownAccountOnly(actor);
    const body = z
      .object({
        accountKind: kindSchema,
        accountId: z.string().min(1),
        code: z.string().max(20).optional(),
        ringPhone: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const account = await chosenAccount(body.accountKind, body.accountId);
    let authorisedBy: 'self' | 'code' = 'self';
    let authorisedByName: string | null = me.name;
    if (!(await isAuthoriser(ctx, actor))) {
      let code = await activeCallCode(ctx, me.id);
      if (!code && body.code && body.code.trim() !== '') {
        code = await enterCallCode(ctx, me.id, body.code);
        if (!code) {
          throw new ApiError(
            403,
            'code_wrong',
            'That call code is not right, or it has run out. Nobody was called.',
          );
        }
      }
      if (!code) {
        throw new ApiError(
          403,
          'call_code_needed',
          "Today's call code is needed before you call. Please type it, or ask the owner for one. Nobody was called.",
        );
      }
      authorisedBy = 'code';
      authorisedByName = code.issuedByName;
    }
    let call = await startStaffCall(
      ctx,
      { staff: me, account, authorisedBy, authorisedByName },
      request.log,
    );
    const token = await calls.issueToken({
      roomName: call.roomName,
      identity: staffIdentity(me.id),
      name: `${firstName(me.name)}, ${config.productName}`,
      ttlSeconds: TOKEN_SECONDS,
    });
    if (body.ringPhone) {
      call = await ringAccountPhone(ctx, call, request.log);
    }
    await recordAudit(request, {
      action: 'call.started',
      target: `${account.kind}=${account.id} call=${call.id}`,
      detail: `Called ${accountWord(account.kind)} ${account.name}${call.phoneRung ? ' on their phone' : ' in the app'}; ${authorisedBy === 'code' ? `with today's call code from ${authorisedByName ?? 'an authoriser'}` : 'as an authoriser'}.`,
    });
    void reply.status(201);
    return {
      call: staffCallView(call, false),
      join: { url: calls.url, token, roomName: call.roomName },
      notice: RECORDED_NOTICE,
      phoneAvailable: Boolean(calls.dialPhone && account.phone),
      words: `Calling ${account.name}. ${RECORDED_NOTICE}${call.phoneRung ? ' Their phone is ringing; they see the company number, never yours.' : ''}`,
    };
  });

  app.get('/staff/calls/:id', async (request) => {
    const actor = await staff(request);
    const call = await settleMissedCall(ctx, await staffCall(request, actor));
    return { call: staffCallView(call, await isAuthoriser(ctx, actor)) };
  });

  /** Not answered in the app: ring their own phone, from the company's number. */
  app.post('/staff/calls/:id/phone', async (request) => {
    const actor = await staff(request);
    const call = await staffCall(request, actor);
    if (call.status === 'ended') throw new ConflictError('That call has ended.');
    const rung = await ringAccountPhone(ctx, call, request.log);
    await recordAudit(request, {
      action: 'call.phone',
      target: `call=${call.id}`,
      detail: `Rang ${accountWord(call.accountKind)} ${call.accountName}'s phone from the company number.`,
    });
    return {
      call: staffCallView(rung, false),
      words: `Ringing ${call.accountName}'s phone. They see the company number, never yours. ${RECORDED_NOTICE} Please tell them so when they answer.`,
    };
  });

  app.post('/staff/calls/:id/end', async (request) => {
    const actor = await staff(request);
    const call = await staffCall(request, actor);
    let ended = call;
    if (call.status !== 'ended') {
      await ctx.calls?.endRoom(call.roomName).catch((failure: unknown) => {
        request.log.warn({ err: failure }, 'LiveKit could not close the room.');
      });
      ended = await finishStaffCall(ctx, call, now(), request.log);
    }
    await recordAudit(request, {
      action: 'call.ended',
      target: `call=${call.id}`,
      detail: `${ended.answeredAt ? `Answered; ${ended.durationSeconds} seconds` : 'Not answered'}.`,
    });
    return { call: staffCallView(ended, await isAuthoriser(ctx, actor)) };
  });

  /** A recording, for the owner and authorisers only, through a link good for five minutes. */
  app.get('/staff/calls/:id/recording', async (request) => {
    const actor = await staff(request);
    if (!(await isAuthoriser(ctx, actor))) {
      throw new ForbiddenError('Only the owner, or someone he lets authorise, plays recordings.');
    }
    const call = await staffCall(request, actor);
    if (!ctx.recorder || !call.recordingKey || call.recordingStatus !== 'saved') {
      throw new NotFoundError('recording');
    }
    await recordAudit(request, {
      action: 'call.recording-played',
      target: `call=${call.id}`,
      detail: `The recording of ${call.staffName}'s call to ${accountWord(call.accountKind)} ${call.accountName}.`,
    });
    return {
      url: ctx.recorder.playbackUrl(call.recordingKey, PLAYBACK_SECONDS),
      expiresInSeconds: PLAYBACK_SECONDS,
    };
  });

  /**
   * The messages and calls log: every message and call by staff, with the date and time, who,
   * to whom, and whether a code or the desk authorised it. The owner and authorisers see all of
   * it; everyone else sees their own.
   */
  app.get('/staff/contact/log', async (request) => {
    const actor = await staff(request);
    const authoriser = await isAuthoriser(ctx, actor);
    const mine = (staffId: string | null): boolean =>
      authoriser || (actor.id !== null && staffId === actor.id);
    const threadAccounts = new Map<string, { kind: InboxAccountKind; name: string }>();
    const entries: Array<Record<string, unknown> & { at: Date }> = [];
    for (const message of await contact.listStaffMessages(500)) {
      if (!mine(message.staffId)) continue;
      let to = threadAccounts.get(message.threadId);
      if (!to) {
        const thread = await contact.findThreadById(message.threadId);
        const account = thread
          ? await findAccount(ctx, thread.accountKind, thread.accountId)
          : null;
        to = { kind: thread?.accountKind ?? 'shopper', name: account?.name ?? 'Closed account' };
        threadAccounts.set(message.threadId, to);
      }
      entries.push({
        kind: 'message',
        id: message.id,
        at: message.createdAt,
        staffName: message.senderName,
        recipientKind: to.kind,
        recipientWord: accountWord(to.kind),
        recipientName: to.name,
        status: message.status,
        sentAt: message.sentAt,
        readAt: message.readAt,
        authorisedBy: message.authorisedBy,
        authorisedByName: message.authorisedByName,
      });
    }
    for (const call of await contact.listCalls(500)) {
      if (!mine(call.staffId)) continue;
      entries.push({
        ...staffCallView(call, authoriser),
        kind: 'call',
        at: call.startedAt,
        recipientKind: call.accountKind,
        recipientWord: accountWord(call.accountKind),
        recipientName: call.accountName,
        answered: call.answeredAt !== null,
      });
    }
    entries.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { entries, everyone: authoriser, kinds: ACCOUNT_KINDS };
  });
}
