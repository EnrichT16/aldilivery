/**
 * Ozi's desk (ruling 74, Anthony, 22 October 2026): Ozi phones the owner about anything that
 * needs him.
 *
 * Anything that needs a person becomes a matter, at the moment it happens, through one function,
 * `askOwner`: a Runner document or a shop product the automatic check could not approve, a new
 * shop waiting, an organisation asking to work with us, a complaint, low or written feedback, a
 * pay-back or a till total waiting for a person, a Runner's SOS (urgent), a Finds It request, and
 * everything on the admin panel's "Needs you now" page, which the sweep uses as its checklist so
 * nothing is missed (`reconcileWithNeedsYou`).
 *
 * The sweep (`sweepOwnerDesk`, every minute from index.ts) rings OWNER_ALERT_PHONE, exactly as
 * Anthony asked: up to `ownerDesk.callsInARow` calls `minutesBetweenCalls` apart; after the last
 * unanswered one it waits `hoursBetweenCascades`, then another run of calls, until he answers and
 * every open matter is decided or put to later. New matters join a run already going. A text goes
 * with the first call of each run, as a backup. No calls in quiet hours (UK time) unless a matter
 * is urgent. Matters put to later come back `laterAfterMinutes` later, unless decided in the
 * admin panel first. A voicemail never counts as picked up (Twilio's machine detection).
 *
 * The keypad does what the admin panel would, through the same service functions, and every
 * decision is written in the audit log as the owner's, by phone.
 *
 * In the app first (ruling 79, Anthony, 23 October 2026): each attempt first rings the owner in
 * the app, with a notification on every device where he allowed Ozi to ring him and, if the admin
 * panel is open, a full-screen incoming call. Not answered there within `ownerDesk.appRingSeconds`,
 * the same attempt rings OWNER_ALERT_PHONE as before (`fallBackToPhone`). No device and no panel
 * open: straight to the phone. Answered in the app, Ozi says the same things, and his choices go
 * through `decideMatter` exactly as the keypad's do, recorded as decided in the app.
 */

import type { FastifyBaseLogger } from 'fastify';

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  Order,
  ProblemReport,
  OwnerCall,
  OwnerMatter,
  OwnerMatterKind,
  OwnerMatterOptions,
  OwnerMatterVia,
  PushSubscription,
  RunnerDocument,
} from '../domain.js';
import { ApiError } from '../errors.js';
import { orderReference } from '../routes/runner-account.js';
import { countWords, needsYouItems, type NeedsYouItems } from './needs-you.js';
import { decidePartnerProduct, withdrawPartnerProduct } from './partner-products.js';
import { decideRunnerDocument, KIND_SPOKEN } from './runner-documents.js';

export type DeskContext = Pick<
  AppContext,
  'repository' | 'config' | 'env' | 'now' | 'sendText' | 'placeCall' | 'brain' | 'backgroundChecks'
> &
  Partial<Pick<AppContext, 'sendPush'>>;

export interface AskOwnerInput {
  kind: OwnerMatterKind;
  subjectId: string;
  /** One or two sentences, said aloud. Never a card number or a customer's phone number. */
  summary: string;
  options: OwnerMatterOptions;
  urgent?: boolean;
  /**
   * Ask again even if a matter about this was settled before: a product changed after it was
   * approved, a Runner's application checked again.
   */
  again?: boolean;
  /** For an email (ruling 76): who it is from and its subject, for the admin panel only. */
  email?: { from: string; subject: string };
}

/** A call still marked ringing after this long lost its status callback: treated as unanswered. */
const STALE_CALL_MS = 10 * 60_000;

/**
 * Anything that could be a telephone or card number (nine digits or more, with or without spaces
 * or dashes) and any email address is taken out of what Ozi says: a summary is read aloud.
 */
export function spokenSafe(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'an email address')
    .replace(/\+?\d(?:[\s-]?\d){8,}/g, 'a number')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/** The one way a matter is made. Never throws: the event that caused it carries on regardless. */
export async function askOwner(
  ctx: Pick<AppContext, 'repository'>,
  input: AskOwnerInput,
  log?: FastifyBaseLogger,
): Promise<OwnerMatter | null> {
  try {
    const summary = spokenSafe(input.summary);
    const existing = await ctx.repository.ownerDesk.findMattersFor(input.kind, input.subjectId);
    const unsettled = existing.find((row) => row.status === 'open' || row.status === 'later');
    if (unsettled) {
      return unsettled.summary === summary
        ? unsettled
        : ctx.repository.ownerDesk.updateMatter(unsettled.id, { summary });
    }
    if (existing.length > 0 && !input.again) return existing[0] ?? null;
    return await ctx.repository.ownerDesk.createMatter({
      kind: input.kind,
      subjectId: input.subjectId,
      summary,
      options: input.options,
      urgent: input.urgent ?? false,
      ...(input.email
        ? {
            emailFrom: input.email.from.slice(0, 200),
            emailSubject: input.email.subject.slice(0, 300),
          }
        : {}),
    });
  } catch (failure) {
    log?.error({ err: failure, kind: input.kind }, 'A matter for the owner could not be kept.');
    return null;
  }
}

/* ------------------------------------------------------------------ UK time */

function ukParts(at: Date): { year: number; month: number; day: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
  };
}

function clockMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Whether it is quiet hours in the UK: between `from` and `until`, across midnight if need be. */
export function inQuietHours(at: Date, from: string, until: string): boolean {
  const now = ukParts(at).minutes;
  const start = clockMinutes(from);
  const end = clockMinutes(until);
  if (start === end) return false;
  return start > end ? now >= start || now < end : now >= start && now < end;
}

/** The UK date of a moment, as YYYY-MM-DD. */
export function ukDate(at: Date): string {
  const { year, month, day } = ukParts(at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `laterCallAt` ("09:00", UK time) on the UK day after `at`. */
export function nextDayAt(at: Date, hhmm: string): Date {
  const { year, month, day } = ukParts(at);
  const minutes = clockMinutes(hhmm);
  // That clock time as if UK time were UTC, then corrected by the UK's offset on that day.
  const guess = Date.UTC(year, month - 1, day + 1, Math.floor(minutes / 60), minutes % 60);
  const offset = ukParts(new Date(guess)).minutes - minutes;
  const offsetMinutes = ((offset + 720 + 1440) % 1440) - 720;
  return new Date(guess - offsetMinutes * 60_000);
}

/* ------------------------------------------------------------------ the audit log */

async function auditEntry(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  entry: {
    actorName: string;
    action: string;
    target: string;
    detail: string;
    actorId?: string | null;
    ip?: string;
  },
): Promise<void> {
  await ctx.repository.audit.record({
    at: ctx.now(),
    actorId: entry.actorId ?? null,
    actorName: entry.actorName,
    actorRole: entry.action === 'automatic-check' ? 'automatic' : 'owner',
    action: entry.action,
    target: entry.target,
    detail: entry.detail.slice(0, 500),
    ip: entry.ip ?? '',
  });
}

/** Every automatic decision in the audit log, as "the automatic check", with its reasons. */
export async function auditAutomatic(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  target: string,
  detail: string,
): Promise<void> {
  await auditEntry(ctx, { actorName: AUTOMATIC, action: 'automatic-check', target, detail });
}

/** The name on every automatic decision. Never the maker of the model behind it. */
export const AUTOMATIC = 'The automatic check';

/* ------------------------------------------------------------------ still needed? */

/** Whether the thing a matter is about still needs a person: if not, it settles itself. */
async function stillNeedsOwner(ctx: DeskContext, matter: OwnerMatter): Promise<boolean> {
  const { repository } = ctx;
  const order = async (): Promise<Order | null> => repository.orders.findById(matter.subjectId);
  switch (matter.kind) {
    case 'sos': {
      const sos = await repository.sos.findById(matter.subjectId);
      return sos !== null && sos.endedAt === null;
    }
    case 'runner_document': {
      const document = await repository.runnerDocuments.findById(matter.subjectId);
      return document?.status === 'submitted';
    }
    case 'runner_application': {
      const documents = await repository.runnerDocuments.listForRunner(matter.subjectId);
      return documents.some((document) => document.status === 'submitted');
    }
    case 'partner_product': {
      const product = await repository.partnerProducts.findById(matter.subjectId);
      return (
        product !== null &&
        (product.status === 'pending' ||
          (product.status === 'approved' && product.checkNote !== null))
      );
    }
    case 'partner_shop': {
      const shop = await repository.partnerShops.findById(matter.subjectId);
      return shop?.status === 'pending';
    }
    case 'problem': {
      const report = await repository.problems.findById(matter.subjectId);
      return report?.status === 'open';
    }
    case 'pay_back':
      return (await order())?.reimbursementStatus === 'waiting';
    case 'till_case':
      return (await order())?.tillStatus === 'needs_person';
    case 'bank_transfer': {
      const found = await order();
      return found?.status === 'confirmed' && found.paidBy === 'bank';
    }
    case 'waiting_order': {
      const found = await order();
      return (
        found !== null &&
        found.runnerId === null &&
        found.splitAt === null &&
        (found.status === 'paid' || found.status === 'offered')
      );
    }
    case 'find_it': {
      const request = await repository.findRequests.findById(matter.subjectId);
      return request?.status === 'looking';
    }
    case 'organisation_enquiry': {
      const enquiry = (await repository.organisationEnquiries.list()).find(
        (row) => row.id === matter.subjectId,
      );
      return enquiry !== undefined && !enquiry.handled;
    }
    case 'message_approval': {
      // A staff member's message waiting for the owner's yes (ruling 77).
      const message = await repository.companyContact.findMessage(matter.subjectId);
      return message?.status === 'held';
    }
    case 'scheduled_payment': {
      // A booked order's payment that could not be taken (ruling 78): until it is paid or over.
      const found = await order();
      return found?.status === 'confirmed' && found.chargePlan === 'scheduled';
    }
    case 'shopper_feedback':
    case 'email':
    case 'account_message':
    case 'scheduled_today':
      return true;
  }
}

/**
 * Brings the desk up to date: matters put to later whose day has come are open again, and
 * matters whose thing was dealt with elsewhere (in the admin panel's own tabs, or by itself) are
 * settled, so Ozi never rings about something already done.
 */
export async function tidyMatters(ctx: DeskContext): Promise<OwnerMatter[]> {
  const at = ctx.now();
  const kept: OwnerMatter[] = [];
  for (const matter of await ctx.repository.ownerDesk.listUnsettled()) {
    if (!(await stillNeedsOwner(ctx, matter))) {
      await ctx.repository.ownerDesk.updateMatter(matter.id, {
        status: 'handled',
        decision: 'settled',
        decidedVia: 'automatic',
        decidedBy: 'Dealt with elsewhere',
        decidedAt: at,
      });
      continue;
    }
    if (matter.status === 'later' && matter.laterUntil && matter.laterUntil <= at) {
      kept.push(
        await ctx.repository.ownerDesk.updateMatter(matter.id, {
          status: 'open',
          laterUntil: null,
        }),
      );
      continue;
    }
    kept.push(matter);
  }
  return kept;
}

/** Settles whatever is waiting about one thing, once a person decided it somewhere else. */
export async function settleMattersFor(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  kind: OwnerMatterKind,
  subjectId: string,
  via: OwnerMatterVia,
  by: string,
): Promise<void> {
  for (const matter of await ctx.repository.ownerDesk.findMattersFor(kind, subjectId)) {
    if (matter.status !== 'open' && matter.status !== 'later') continue;
    await ctx.repository.ownerDesk.updateMatter(matter.id, {
      status: 'handled',
      decision: 'settled',
      decidedVia: via,
      decidedBy: by,
      decidedAt: ctx.now(),
    });
  }
}

/* ------------------------------------------------------------------ deciding */

export type DeskChoice = 'approve' | 'decline' | 'acknowledge' | 'later';

export interface DeskOutcome {
  matter: OwnerMatter;
  /** What Ozi says straight after the key, or the panel shows. */
  words: string;
}

/**
 * Carries out the owner's choice on a matter, by phone or in the admin panel: the same action
 * the panel's own tabs take, through the same service functions, written in the audit log.
 */
export async function decideMatter(
  ctx: DeskContext,
  matter: OwnerMatter,
  choice: DeskChoice,
  via: Exclude<OwnerMatterVia, 'automatic'>,
  by: string,
  log?: FastifyBaseLogger,
  /** Who in the admin panel, and from where, for the audit log. */
  seen: { actorId?: string | null; ip?: string } = {},
): Promise<DeskOutcome> {
  const { repository } = ctx;
  const at = ctx.now();
  const target = `${matter.kind}=${matter.subjectId}`;
  const how =
    via === 'phone'
      ? 'by phone'
      : via === 'app'
        ? "on Ozi's call in the app"
        : 'in the admin panel';
  const audit = (entry: { actorName: string; action: string; target: string; detail: string }) =>
    auditEntry(ctx, { ...entry, ...seen });

  if (choice === 'later') {
    const updated = await repository.ownerDesk.updateMatter(matter.id, {
      status: 'later',
      laterUntil: new Date(at.getTime() + ctx.config.ownerDesk.laterAfterMinutes * 60_000),
    });
    await audit({
      actorName: by,
      action: 'owner-desk.later',
      target,
      detail: `Put to later ${how}: ${matter.summary}`,
    });
    const after = ctx.config.ownerDesk.laterAfterMinutes;
    const when = after === 60 ? 'in an hour' : `in ${after} minutes`;
    return { matter: updated, words: `Left for later. I will ask you again ${when}.` };
  }

  // Acknowledge-only matters: 1 means "I have heard it", whichever word the screen sent.
  const decision = matter.options === 'acknowledge' ? 'acknowledge' : choice;
  if (decision === 'acknowledge' && matter.options === 'decide') {
    // A decision is needed; "heard it" alone leaves it open.
    return { matter, words: 'This one needs approve or decline.' };
  }

  try {
    if (decision !== 'acknowledge') {
      const named = via === 'phone' ? `${by}, by phone` : via === 'app' ? `${by}, in the app` : by;
      await carryOut(ctx, matter, decision, named, log);
    }
  } catch (failure) {
    if (failure instanceof ApiError && (failure.statusCode === 409 || failure.statusCode === 404)) {
      const updated = await repository.ownerDesk.updateMatter(matter.id, {
        status: 'handled',
        decision: 'settled',
        decidedVia: 'automatic',
        decidedBy: 'Dealt with elsewhere',
        decidedAt: at,
      });
      return { matter: updated, words: 'That one had already been dealt with.' };
    }
    if (failure instanceof ApiError) {
      return { matter, words: `That could not be done: ${failure.message}` };
    }
    throw failure;
  }

  const updated = await repository.ownerDesk.updateMatter(matter.id, {
    status: decision === 'acknowledge' ? 'handled' : 'decided',
    decision,
    decidedVia: via,
    decidedBy: by,
    decidedAt: at,
    laterUntil: null,
  });
  await audit({
    actorName: by,
    action: 'owner-desk.decided',
    target,
    detail: `${decision === 'approve' ? 'Approved' : decision === 'decline' ? 'Declined' : 'Heard'} ${how}: ${matter.summary}`,
  });
  return {
    matter: updated,
    words:
      decision === 'approve' ? 'Approved.' : decision === 'decline' ? 'Declined.' : 'Thank you.',
  };
}

/** What approving or declining each kind of matter does: the admin panel's own actions. */
async function carryOut(
  ctx: DeskContext,
  matter: OwnerMatter,
  decision: 'approve' | 'decline',
  by: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { repository } = ctx;
  const approve = decision === 'approve';
  const decidedBy = by;
  switch (matter.kind) {
    case 'runner_document': {
      const document = await repository.runnerDocuments.findById(matter.subjectId);
      if (!document) throw new ApiError(404, 'not_found', 'The document is gone.');
      const decided = await decideRunnerDocument(ctx, document, {
        decision: approve ? 'accept' : 'reject',
        by: decidedBy,
        note: approve ? null : declineNote(document),
      });
      // The rest of the application may now be complete (the automatic check, ruling 74).
      const { checkApplication } = await import('./auto-check.js');
      await checkApplication(ctx, decided.runnerId, log);
      return;
    }
    case 'runner_application': {
      const waiting = (await repository.runnerDocuments.listForRunner(matter.subjectId)).filter(
        (document) => document.status === 'submitted',
      );
      if (waiting.length === 0) throw new ApiError(409, 'conflict', 'Already decided.');
      for (const document of waiting) {
        await decideRunnerDocument(ctx, document, {
          decision: approve ? 'accept' : 'reject',
          by: decidedBy,
          note: approve
            ? null
            : 'When your documents were checked together, they did not match each other. Please send them again, or ask us.',
        });
      }
      return;
    }
    case 'partner_product': {
      const product = await repository.partnerProducts.findById(matter.subjectId);
      if (!product) throw new ApiError(404, 'not_found', 'The product is gone.');
      if (product.status === 'approved') {
        // A change the automatic check doubted: keep it as it is, or take it off.
        if (approve) {
          await repository.partnerProducts.update(product.id, {
            checkNote: null,
            priceEstimated: false,
          });
        } else await withdrawPartnerProduct(ctx, product, 'Taken off after a change was checked.');
        return;
      }
      await decidePartnerProduct(ctx, product, {
        approve,
        note: approve ? null : 'Not approved when it was checked.',
      });
      // Approving an estimated price (ruling 75) is approving the estimate.
      if (approve && product.priceEstimated) {
        await repository.partnerProducts.update(product.id, { priceEstimated: false });
      }
      return;
    }
    case 'partner_shop': {
      const shop = await repository.partnerShops.findById(matter.subjectId);
      if (!shop) throw new ApiError(404, 'not_found', 'The shop is gone.');
      if (shop.status !== 'pending') throw new ApiError(409, 'conflict', 'Already decided.');
      await repository.partnerShops.update(shop.id, {
        status: approve ? 'approved' : 'removed',
        approvedAt: approve ? (shop.approvedAt ?? ctx.now()) : shop.approvedAt,
        ...(approve ? {} : { active: false }),
      });
      return;
    }
    case 'message_approval': {
      // The owner's yes sends a staff member's held message, authorised by the desk (ruling 77).
      const { releaseHeldMessage, declineHeldMessage } = await import('./company-contact.js');
      if (approve) await releaseHeldMessage(ctx, matter.subjectId, by, log);
      else await declineHeldMessage(ctx, matter.subjectId, by);
      return;
    }
    default:
      // Everything else only needs to be heard; its own tab is where it is done.
      return;
  }
}

/** What a Runner is told when the owner declines a document: the check's own reason, if any. */
function declineNote(document: RunnerDocument): string {
  return document.checkNote
    ? `Not accepted: ${document.checkNote.replace(/\.$/, '')}. Please send it again.`
    : 'Not accepted when it was checked. Please send it again, clear and in date.';
}

/* ------------------------------------------------------------------ what Ozi says */

/** What each kind of matter is waiting for, in a sentence, for the checklist pass. */
export function matterWords(ctx: Pick<AppContext, 'config'>) {
  const money = (pence: number): string => formatPence(pence, ctx.config.store.currencySymbol);
  return {
    sos: (runnerName: string): string =>
      `Urgent. Runner ${runnerName} pressed SOS. A text with where they are has gone to your phone. If you cannot reach them, call 999.`,
    waitingOrder: (order: Order): string =>
      `Order ${orderReference(order.id)} has waited more than ${ctx.config.dispatch.splitAfterMinutes} minutes with no Runner.`,
    bankTransfer: (order: Order): string =>
      `A bank transfer order of ${money(order.totalEstimatePence)} is waiting for the money to arrive. Please check the Payments tab when it does.`,
    payBack: (order: Order): string =>
      `Paying a Runner back ${money(order.reimbursementPence ?? 0)} for the shopping on order ${orderReference(order.id)} is waiting for you to approve in the Payments tab${order.reimbursementReason ? `, because of ${order.reimbursementReason}` : ''}.`,
    tillCase: (order: Order): string =>
      `The till total for order ${orderReference(order.id)} needs a person${order.tillReason ? `, because of ${order.tillReason}` : ''}. It is on the Payments tab.`,
    document: (runnerName: string, document: RunnerDocument): string =>
      `Runner ${runnerName}'s ${KIND_SPOKEN[document.kind]} is waiting to be checked.`,
  };
}

/** A complaint or problem, in a sentence or two: who, which order, what, and any refund asked. */
export async function problemSummary(
  ctx: Pick<AppContext, 'repository' | 'config'>,
  report: ProblemReport,
): Promise<string> {
  const order = await ctx.repository.orders.findById(report.orderId);
  let who = report.reportedBy === 'shopper' ? 'A Shopper' : 'A Runner';
  if (report.reportedBy === 'shopper' && order) {
    const shopper = await ctx.repository.shoppers.findById(order.shopperId);
    if (shopper) who = shopper.displayName;
  } else if (report.reportedBy === 'runner' && order?.runnerId) {
    const runner = await ctx.repository.runners.findById(order.runnerId);
    if (runner) who = `Runner ${runner.name}`;
  }
  const what = report.summary.trim().replace(/\s+/g, ' ');
  const short = what.length > 160 ? `${what.slice(0, 157)}…` : what;
  const refund =
    report.refundRequestedPence > 0
      ? ` They ask for ${formatPence(report.refundRequestedPence, ctx.config.store.currencySymbol)} back.`
      : '';
  return `${who} reported a problem with order ${orderReference(report.orderId)}: ${short.replace(/[.!?…]?$/, '.')}${refund}`;
}

/**
 * The "Needs you now" page as a checklist: anything on it with no matter yet gets one, so
 * nothing on that page is missed by Ozi's calls. Typed by the page's own keys.
 */
export async function reconcileWithNeedsYou(
  ctx: DeskContext,
  log?: FastifyBaseLogger,
): Promise<void> {
  const items: NeedsYouItems = await needsYouItems(ctx);
  const words = matterWords(ctx);
  const { repository } = ctx;
  const ask = (input: AskOwnerInput) => askOwner(ctx, input, log);
  const at = ctx.now();

  const handlers: { [Key in keyof NeedsYouItems]: (rows: NeedsYouItems[Key]) => Promise<void> } = {
    sos: async (rows) => {
      for (const sos of rows) {
        const runner = await repository.runners.findById(sos.runnerId);
        await ask({
          kind: 'sos',
          subjectId: sos.id,
          summary: words.sos(runner?.name ?? 'a Runner'),
          options: 'acknowledge',
          urgent: true,
        });
      }
    },
    'waiting-orders': async (rows) => {
      for (const order of rows) {
        await ask({
          kind: 'waiting_order',
          subjectId: order.id,
          summary: words.waitingOrder(order),
          options: 'acknowledge',
        });
      }
    },
    'bank-transfers': async (rows) => {
      for (const order of rows) {
        await ask({
          kind: 'bank_transfer',
          subjectId: order.id,
          summary: words.bankTransfer(order),
          options: 'acknowledge',
        });
      }
    },
    'pay-backs': async (rows) => {
      for (const order of rows) {
        await ask({
          kind: 'pay_back',
          subjectId: order.id,
          summary: words.payBack(order),
          options: 'acknowledge',
        });
      }
    },
    problems: async (rows) => {
      for (const report of rows) {
        await ask({
          kind: 'problem',
          subjectId: report.id,
          summary: await problemSummary(ctx, report),
          options: 'acknowledge',
        });
      }
    },
    documents: async (rows) => {
      const { checkRunnerDocument } = await import('./auto-check.js');
      for (const document of rows) {
        // Read and passed, waiting for the rest of the application: nothing for the owner yet.
        if (document.checkPassed === true) continue;
        if (document.checkedAt === null) {
          // Not read yet. Just sent and being read in the background: leave it a while.
          if (ctx.brain && at.getTime() - document.createdAt.getTime() < 15 * 60_000) continue;
          await checkRunnerDocument(ctx, document.id, log);
          continue;
        }
        if ((await repository.ownerDesk.findMattersFor('runner_document', document.id)).length > 0)
          continue;
        const runner = await repository.runners.findById(document.runnerId);
        await ask({
          kind: 'runner_document',
          subjectId: document.id,
          summary: words.document(runner?.name ?? 'a Runner', document),
          options: 'decide',
        });
      }
    },
  };

  for (const key of Object.keys(handlers) as Array<keyof NeedsYouItems>) {
    try {
      await (handlers[key] as (rows: unknown) => Promise<void>)(items[key]);
    } catch (failure) {
      log?.error({ err: failure, key }, 'A "Needs you now" item could not be put on the desk.');
    }
  }
}

/* ------------------------------------------------------------------ ringing */

/** The webhooks for the owner's calls, on our own server (routes/owner-desk.ts). */
export function deskWebhookBase(ctx: Pick<AppContext, 'env'>): string {
  return `${ctx.env.primaryOrigin ?? ''}/api/webhooks/twilio/owner-desk`;
}

/** What is open now, urgent first, then oldest first: the order Ozi reads them in. */
export function inReadingOrder(matters: readonly OwnerMatter[]): OwnerMatter[] {
  return matters
    .filter((matter) => matter.status === 'open')
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
}

export type SweepResult =
  | { called: true; call: OwnerCall }
  | {
      called: false;
      reason: 'not-set-up' | 'nothing-open' | 'quiet-hours' | 'ringing' | 'waiting';
    };

/**
 * Decides whether to ring the owner now, and rings. Driven every minute by index.ts; safe to run
 * as often as anyone likes, because everything it decides comes from the calls already placed.
 */
export async function sweepOwnerDesk(
  ctx: DeskContext,
  log?: FastifyBaseLogger,
): Promise<SweepResult> {
  await reconcileWithNeedsYou(ctx, log);
  const unsettled = await tidyMatters(ctx);
  // An attempt that rang in the app long enough goes on to the phone (ruling 79).
  await fallBackToPhone(ctx, log);
  const phone = ctx.env.ownerAlertPhone;
  const app = await inAppReach(ctx);
  if (!canRingPhone(ctx) && !app.reachable) {
    return { called: false, reason: 'not-set-up' };
  }
  const open = inReadingOrder(unsettled);
  if (open.length === 0) return { called: false, reason: 'nothing-open' };

  const desk = ctx.config.ownerDesk;
  const at = ctx.now();
  const urgentOpen = open.some((matter) => matter.urgent);
  if (
    inQuietHours(at, desk.quietFrom, desk.quietUntil) &&
    !(urgentOpen && desk.urgentInQuietHours)
  ) {
    return { called: false, reason: 'quiet-hours' };
  }

  let latest = await latestRealCall(ctx);
  if (latest && latest.status === 'app_ringing') {
    // Still ringing in the app: the phone comes after, from `fallBackToPhone`.
    return { called: false, reason: 'ringing' };
  }
  if (latest && latest.status === 'placed') {
    if (at.getTime() - (latest.phonePlacedAt ?? latest.placedAt).getTime() < STALE_CALL_MS) {
      return { called: false, reason: 'ringing' };
    }
    latest = await ctx.repository.ownerDesk.updateCall(latest.id, {
      status: 'unanswered',
      endedAt: at,
    });
  }

  let cascade = 1;
  let attempt = 1;
  if (latest) {
    const ended = (latest.endedAt ?? latest.answeredAt ?? latest.placedAt).getTime();
    // An urgent matter that arrived after the last call is rung about at once.
    const urgentNew = open.some((matter) => matter.urgent && matter.createdAt > latest.placedAt);
    let waitMinutes: number;
    if (latest.status === 'answered') {
      // He picked up. Something he has not heard yet: soon. Only what he heard and left: later.
      const unheard = open.some(
        (matter) => matter.lastReadAt === null || matter.lastReadAt < latest.placedAt,
      );
      waitMinutes = unheard ? desk.minutesBetweenCalls : desk.hoursBetweenCascades * 60;
      cascade = latest.cascade + 1;
    } else if (latest.attempt < desk.callsInARow) {
      waitMinutes = desk.minutesBetweenCalls;
      cascade = latest.cascade;
      attempt = latest.attempt + 1;
    } else {
      waitMinutes = desk.hoursBetweenCascades * 60;
      cascade = latest.cascade + 1;
    }
    if (at.getTime() < ended + waitMinutes * 60_000 && !urgentNew) {
      return { called: false, reason: 'waiting' };
    }
  }

  // In the app first when he can be rung there (ruling 79); otherwise straight to the phone.
  const appRing = app.reachable;
  const call = await ctx.repository.ownerDesk.createCall({
    cascade,
    attempt,
    placedAt: at,
    status: appRing ? 'app_ringing' : 'placed',
    answeredAt: null,
    endedAt: null,
    matterCount: open.length,
    appRingUntil: appRing ? new Date(at.getTime() + desk.appRingSeconds * 1000) : null,
    phonePlacedAt: appRing ? null : at,
    answeredVia: null,
    test: false,
  });
  for (const matter of open) {
    await ctx.repository.ownerDesk.updateMatter(matter.id, {
      callAttempts: matter.callAttempts + 1,
      lastCalledAt: at,
    });
  }
  if (attempt === 1 && ctx.sendText && phone) {
    // A text with the first call of each run, as a backup. How many, never what.
    const count = countWords(open.length);
    await ctx
      .sendText(
        phone,
        `${ctx.config.productName}: ${ctx.config.assistantName} is ringing you about ${count} ${open.length === 1 ? 'thing that needs' : 'things that need'} you. ${open.length === 1 ? 'It is' : 'They are'} also on the Needs you now page of the admin panel.`,
      )
      .catch((failure: unknown) => {
        log?.warn({ err: failure }, 'The text to the owner with the call did not go.');
      });
  }
  if (appRing) {
    await ringInApp(ctx, call, app.devices, log);
    return { called: true, call };
  }
  return { called: true, call: await dialOwner(ctx, call, log) };
}

/* ------------------------------------------------------------------ in the app first (ruling 79) */

/** The admin panel asks every few seconds while the owner has it open; this long, and it is shut. */
const PANEL_OPEN_MS = 15_000;
/** When the owner's admin panel last asked whether Ozi is ringing, for each running server. */
const panelSeen = new WeakMap<object, Date>();

/** The owner's admin panel is open: it asked just now whether Ozi is ringing. */
export function ownerPanelSeen(ctx: Pick<AppContext, 'repository' | 'now'>): void {
  panelSeen.set(ctx.repository, ctx.now());
}

export function ownerPanelOpen(ctx: Pick<AppContext, 'repository' | 'now'>): boolean {
  const seen = panelSeen.get(ctx.repository);
  return seen !== undefined && ctx.now().getTime() - seen.getTime() < PANEL_OPEN_MS;
}

/** Whether Ozi can ring the owner's phone at all: his number, Twilio's voice and our address. */
export function canRingPhone(ctx: Pick<AppContext, 'env' | 'placeCall'>): boolean {
  return Boolean(ctx.env.ownerAlertPhone && ctx.placeCall && ctx.env.primaryOrigin);
}

/** Every device where the owner allowed Ozi to ring him in the app. */
export async function ownerDevices(
  ctx: Pick<AppContext, 'repository'> & Partial<Pick<AppContext, 'sendPush'>>,
): Promise<PushSubscription[]> {
  if (!ctx.sendPush) return [];
  const owners = (await ctx.repository.staffMembers.list()).filter(
    (member) => member.isOwner && member.active,
  );
  const devices: PushSubscription[] = [];
  for (const owner of owners) {
    devices.push(...(await ctx.repository.pushSubscriptions.listForStaff(owner.id)));
  }
  return devices;
}

/** Whether the owner can be rung in the app now: a device for notifications, or the panel open. */
export async function inAppReach(
  ctx: Pick<AppContext, 'repository' | 'now'> & Partial<Pick<AppContext, 'sendPush'>>,
): Promise<{ reachable: boolean; devices: PushSubscription[]; panelOpen: boolean }> {
  const devices = await ownerDevices(ctx);
  const panelOpen = ownerPanelOpen(ctx);
  return { reachable: devices.length > 0 || panelOpen, devices, panelOpen };
}

/** The newest call that counts in the rounds: never a test from My settings. */
async function latestRealCall(ctx: Pick<AppContext, 'repository'>): Promise<OwnerCall | undefined> {
  return (await ctx.repository.ownerDesk.latestCalls(20)).find((call) => !call.test);
}

/**
 * "Ozi is calling, Mr. Anthony": a notification on each of his devices. The admin panel, if
 * open, shows the incoming call by itself. Never a word of what the matters are.
 */
async function ringInApp(
  ctx: DeskContext,
  call: OwnerCall,
  devices: readonly PushSubscription[],
  log?: FastifyBaseLogger,
): Promise<void> {
  const send = ctx.sendPush;
  if (!send) return;
  const title = `${ctx.config.assistantName} is calling, ${ctx.config.owner.spokenName}`;
  const body = call.test
    ? 'A test call. Open the admin panel to answer.'
    : 'Open the admin panel to answer.';
  for (const device of devices) {
    try {
      const result = await send(device, { title, body, url: '/staff', tag: 'ozi-desk-call' });
      if (result === 'gone') {
        await ctx.repository.pushSubscriptions.deleteByEndpoint(device.endpoint);
      }
    } catch (failure) {
      log?.warn({ err: failure }, "A notification of Ozi's call to the owner did not go.");
    }
  }
}

/** Rings OWNER_ALERT_PHONE for this attempt, from our Twilio number. */
async function dialOwner(
  ctx: DeskContext,
  call: OwnerCall,
  log?: FastifyBaseLogger,
): Promise<OwnerCall> {
  const at = ctx.now();
  const phone = ctx.env.ownerAlertPhone;
  if (!phone || !ctx.placeCall || !ctx.env.primaryOrigin) {
    // Rung in the app only, and not answered there: an unanswered attempt.
    return ctx.repository.ownerDesk.updateCall(call.id, { status: 'unanswered', endedAt: at });
  }
  const placed = await ctx.repository.ownerDesk.updateCall(call.id, {
    status: 'placed',
    phonePlacedAt: at,
  });
  const base = deskWebhookBase(ctx);
  try {
    await ctx.placeCall(
      phone,
      `${base}/voice?call=${encodeURIComponent(call.id)}`,
      `${base}/status?call=${encodeURIComponent(call.id)}`,
      { machineDetection: true },
    );
  } catch (failure) {
    log?.warn({ err: failure }, 'Ozi could not ring the owner.');
    return ctx.repository.ownerDesk.updateCall(call.id, { status: 'failed', endedAt: at });
  }
  return placed;
}

/**
 * Any attempt still ringing in the app after `appRingSeconds` goes on to the phone, the same
 * attempt (ruling 79). If everything was dealt with meanwhile, it simply ends. Run with the sweep
 * and every few seconds from index.ts, so the phone rings about half a minute after the app.
 */
export async function fallBackToPhone(
  ctx: DeskContext,
  log?: FastifyBaseLogger,
): Promise<OwnerCall[]> {
  const at = ctx.now();
  const rung: OwnerCall[] = [];
  for (const call of await ctx.repository.ownerDesk.latestCalls(20)) {
    if (call.status !== 'app_ringing') continue;
    if (call.appRingUntil && call.appRingUntil > at) continue;
    const stillOpen =
      call.test || inReadingOrder(await ctx.repository.ownerDesk.listUnsettled()).length > 0;
    if (!stillOpen) {
      await ctx.repository.ownerDesk.updateCall(call.id, { status: 'unanswered', endedAt: at });
      continue;
    }
    rung.push(await dialOwner(ctx, call, log));
  }
  return rung;
}

/**
 * "Test Ozi's call" in My settings: a test ring in the app, then the phone if it is not answered,
 * exactly as a real call goes; never counted in the rounds of calls, and nothing is decided.
 */
export async function testOwnerCall(
  ctx: DeskContext,
  log?: FastifyBaseLogger,
): Promise<{ call: OwnerCall; inApp: boolean; phone: boolean }> {
  const at = ctx.now();
  const app = await inAppReach(ctx);
  const phone = canRingPhone(ctx);
  const call = await ctx.repository.ownerDesk.createCall({
    cascade: 0,
    attempt: 0,
    placedAt: at,
    status: app.reachable ? 'app_ringing' : 'placed',
    answeredAt: null,
    endedAt: null,
    matterCount: 0,
    appRingUntil: app.reachable
      ? new Date(at.getTime() + ctx.config.ownerDesk.appRingSeconds * 1000)
      : null,
    phonePlacedAt: app.reachable ? null : at,
    answeredVia: null,
    test: true,
  });
  if (app.reachable) {
    await ringInApp(ctx, call, app.devices, log);
    return { call, inApp: true, phone };
  }
  return { call: await dialOwner(ctx, call, log), inApp: false, phone };
}

/** What is ringing the owner in the app right now, newest first; null when nothing is. */
export async function ringingInApp(
  ctx: Pick<AppContext, 'repository' | 'now'>,
): Promise<OwnerCall | null> {
  const at = ctx.now();
  return (
    (await ctx.repository.ownerDesk.latestCalls(20)).find(
      (call) =>
        call.status === 'app_ringing' && (call.appRingUntil === null || call.appRingUntil > at),
    ) ?? null
  );
}

/** Twilio's word on how a call to the owner went (its status callback). */
export async function recordCallStatus(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  callId: string,
  status: string,
): Promise<OwnerCall | null> {
  const call = await ctx.repository.ownerDesk.findCall(callId);
  if (!call) return null;
  const at = ctx.now();
  if (['queued', 'initiated', 'ringing', 'in-progress'].includes(status)) return call;
  if (status === 'completed') {
    // Completed after being answered by him, or by a voicemail: it stays what it was. Completed
    // without ever asking us what to say: nobody picked up.
    return ctx.repository.ownerDesk.updateCall(call.id, {
      status: call.status === 'placed' ? 'unanswered' : call.status,
      endedAt: call.endedAt ?? at,
    });
  }
  // no-answer, busy, failed, canceled.
  return ctx.repository.ownerDesk.updateCall(call.id, {
    status: status === 'failed' ? 'failed' : call.status === 'answered' ? 'answered' : 'unanswered',
    endedAt: call.endedAt ?? at,
  });
}
