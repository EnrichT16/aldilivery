/**
 * Ozi's conversations (Anthony, 31 October 2026, ruling 83): who is speaking, the thread so far,
 * the daily limit on the language model, and the owner's desk by voice.
 *
 * Who is speaking is decided here from the sign-in the request carries, never from anything in
 * its body: the owner (his own account, signed in with his passcode), staff, a Shop Partner or an
 * organisation, a Runner, a Shopper, or a visitor who is not signed in.
 *
 * The owner's decisions follow Rule One exactly: the model may only propose one, which is checked
 * and read back in the server's own words; it is carried out only on a clear yes in his very next
 * turn, through the same `decideMatter` as the keypad and the admin panel, and written in the
 * audit log as his, by voice. Anything else in that turn, or a no, and nothing is done.
 *
 * Ruling 85 (31 October 2026) adds his staff, his emails and how Ozi reaches him: reading answers
 * at once; every change (switching staff, marking emails heard, a reply, his alert choices) is a
 * decision in exactly the same way, read back in fixed words and done only on his clear yes,
 * through the same service functions as the admin panel (services/owner-voice.ts).
 */

import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

import type { AppContext } from '../app.js';
import { NotFoundError } from '../errors.js';
import { areaSummaries } from '../services/areas.js';
import { needsYouItems } from '../services/needs-you.js';
import {
  decideMatter,
  inReadingOrder,
  type DeskContext,
  type DeskOutcome,
} from '../services/owner-desk.js';
import { KIND_SPOKEN } from '../services/runner-documents.js';
import {
  alertPreferencesForVoice,
  carryOutOwnerAction,
  listEmailsForVoice,
  listStaffForVoice,
  proposeOwnerAction,
  readEmailForVoice,
} from '../services/owner-voice.js';
import { businessActor } from './business.js';
import {
  HISTORY_TURNS,
  type DeskVoiceChoice,
  type OwnerAction,
  type OwnerTools,
  type PastTurn,
  type Speaker,
} from './language-model.js';
import { conversationKey } from './ozi-memory.js';
import type { PhraseAccount } from './phrases.js';
import { staffActor } from './staff.js';

function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return first === '' ? null : first.slice(0, 40);
}

function has(request: FastifyRequest, name: string): boolean {
  const value = request.headers[name];
  return typeof value === 'string' ? value !== '' : Array.isArray(value) && value.length > 0;
}

export interface Identity {
  /** Whose phrase book answers. */
  account: PhraseAccount;
  /** Who is speaking, for the model and for Ozi's memory. */
  speaker: Speaker;
  /** Whose daily allowance of model turns this counts against. */
  allowanceKey: string;
}

/**
 * Who is speaking, from the credentials alone (31 October 2026). A sign-in that does not check
 * out is refused exactly as before; no sign-in at all is a visitor, answered from the Shopper's
 * book.
 */
export async function whoIsSpeaking(request: FastifyRequest): Promise<Identity> {
  const { repository } = request.server.ctx;
  if (has(request, 'x-staff-token') || has(request, 'x-staff-key')) {
    const actor = await staffActor(request);
    if (actor.isOwner) {
      return {
        account: 'owner',
        speaker: { kind: 'owner', firstName: null },
        allowanceKey: 'owner',
      };
    }
    return {
      account:
        actor.role === 'family' ? 'family' : actor.role === 'investor' ? 'investor' : 'staff',
      speaker: { kind: 'staff', firstName: firstNameOf(actor.name) },
      allowanceKey: `staff:${actor.id ?? actor.name}`,
    };
  }
  if (has(request, 'x-business-token')) {
    const user = await businessActor(request);
    const kind = user.kind === 'partner' ? 'partner' : 'organisation';
    return {
      account: kind,
      speaker: { kind, firstName: firstNameOf(user.name) },
      allowanceKey: `business:${user.id}`,
    };
  }
  const session = request.session;
  if (session?.role === 'runner') {
    const runner = await repository.runners.findById(session.accountId).catch(() => null);
    return {
      account: 'runner',
      speaker: { kind: 'runner', firstName: firstNameOf(runner?.name) },
      allowanceKey: `runner:${session.accountId}`,
    };
  }
  if (session?.role === 'shopper') {
    const shopper = await repository.shoppers.findById(session.accountId).catch(() => null);
    if (shopper) {
      return {
        account: 'shopper',
        speaker: { kind: 'shopper', firstName: firstNameOf(shopper.displayName) },
        allowanceKey: `shopper:${shopper.id}`,
      };
    }
  }
  return {
    account: 'shopper',
    speaker: { kind: 'visitor', firstName: null },
    allowanceKey: `visitor:${request.ip ?? ''}`,
  };
}

/** The conversation's latest turns, oldest first, from Ozi's memory (the same one-way code). */
export async function recentTurns(
  ctx: Pick<AppContext, 'repository' | 'env'>,
  conversation: string,
): Promise<PastTurn[]> {
  try {
    const rows = await ctx.repository.memory.listConversation(
      conversationKey(ctx.env.authTokenSecret, conversation),
      HISTORY_TURNS,
    );
    return rows.map((row) => ({ heard: row.heard, said: row.said }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ the daily limit */

/**
 * Model turns taken today by each account (31 October 2026), so one account cannot run up the
 * bill: at most `ozi.maxModelTurnsPerDay` a UK day, the owner without limit. Kept in memory, per
 * server: a restart starts the day's count again, which errs on the side of answering.
 */
export class ModelTurns {
  private day = '';
  private readonly counts = new Map<string, number>();

  /** Counts one turn and says whether it may go to the model. */
  take(key: string, limit: number, at: Date, unlimited = false): boolean {
    if (unlimited) return true;
    const today = at.toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) return false;
    this.counts.set(key, used + 1);
    return true;
  }
}

const TURNS = new WeakMap<object, ModelTurns>();
/** The one count of model turns for a server, shared by the app's route and the telephone. */
export function modelTurnsOf(ctx: object): ModelTurns {
  let found = TURNS.get(ctx);
  if (!found) {
    found = new ModelTurns();
    TURNS.set(ctx, found);
  }
  return found;
}

/** What Ozi says once the day's model turns are used up. */
export const SIMPLER_TODAY =
  'I\'ve talked a lot today, so for the rest of the day I\'ll carry on with my simpler helper. I can still take your shopping, and you can say "person" at any time.';

/* ------------------------------------------------------------------ the owner's yes */

/** A decision on a desk matter, or a change he asked for (ruling 85), waiting for his yes. */
export type PendingDecision =
  | { matterId: string; choice: DeskVoiceChoice; readBack: string; at: number }
  | { action: OwnerAction; readBack: string; at: number };

/** How long a read-back waits for his yes before it is forgotten. */
const PENDING_MS = 3 * 60_000;

/** One decision waiting for a yes, at most, for each conversation (Rule One). */
export class PendingDecisions {
  private readonly waiting = new Map<string, PendingDecision>();

  set(conversation: string, decision: PendingDecision): void {
    this.waiting.set(conversation, decision);
  }

  /** The decision waiting in this conversation, taken out: it is answered by this turn. */
  take(conversation: string, at: number): PendingDecision | null {
    const found = this.waiting.get(conversation);
    this.waiting.delete(conversation);
    if (!found || at - found.at > PENDING_MS) return null;
    return found;
  }
}

/**
 * A clear yes, and nothing else: "yes", "yes please", "go ahead", "do it". Anything with a no, a
 * not or a question in it is not a yes.
 */
export function isClearYes(text: string): boolean {
  const said = text
    .toLowerCase()
    .replace(/[.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (said === '' || /\?|\b(no|not|don'?t|do not|wait|stop|cancel|hold on|never)\b/.test(said)) {
    return false;
  }
  return /^(?:(?:ozi|ozzy|ozzie)\s+)?(?:yes|yeah|yep|yes please|yes do it|yes go ahead|go ahead|do it|confirm|confirmed|that'?s right|correct|please do)(?:\s+(?:please|sir|thanks|thank you|ozi))*$/.test(
    said,
  );
}

/* ------------------------------------------------------------------ the owner's tools */

function startOfToday(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function choiceWords(choice: DeskVoiceChoice, acknowledgeOnly: boolean, laterMinutes: number) {
  if (choice === 'later') {
    return `put this to later, and ask you again in ${laterMinutes === 60 ? 'an hour' : `${laterMinutes} minutes`}`;
  }
  if (acknowledgeOnly) return 'mark this as heard';
  return choice === 'approve' ? 'approve this' : 'decline this';
}

/** The owner's desk tools for the model: reading, and proposing one decision for his yes. */
export function ownerTools(ctx: DeskContext & Pick<AppContext, 'mailboxes'>): OwnerTools {
  const { repository, config } = ctx;
  return {
    async needsYou() {
      const matters = inReadingOrder(await repository.ownerDesk.listUnsettled());
      const items = await needsYouItems(ctx);
      return {
        matters: matters.slice(0, 25).map((matter) => ({
          id: matter.id,
          kind: matter.kind,
          subjectId: matter.subjectId,
          summary: matter.summary,
          needs: matter.options === 'decide' ? 'approve or decline' : 'only to be heard',
          urgent: matter.urgent,
          status: matter.status,
          waitingSince: matter.createdAt.toISOString(),
        })),
        moreMatters: Math.max(0, matters.length - 25),
        needsYouNow: {
          sos: items.sos.length,
          ordersWaitingForARunner: items['waiting-orders'].length,
          bankTransfersToCheck: items['bank-transfers'].length,
          runnerPayBacksToApprove: items['pay-backs'].length,
          problemsToDecide: items.problems.length,
          runnerDocumentsToReview: items.documents.length,
        },
      };
    },
    async todaySummary() {
      const at = ctx.now();
      const since = startOfToday(at);
      const orders = (await repository.admin.listOrders({ since, limit: 100_000 })).filter(
        (order) => order.status !== 'draft' && !order.isDemo && !order.splitParentId,
      );
      const money = await repository.income.list({ since });
      const taken = money.filter((row) => row.amountPence > 0);
      const refunds = money.filter((row) => row.amountPence < 0);
      const runnersWaiting = new Set(
        (await repository.runnerDocuments.listSubmitted()).map((document) => document.runnerId),
      ).size;
      const partnersWaiting = (await repository.partnerShops.list()).filter(
        (shop) => shop.status === 'pending',
      ).length;
      const noRunner = (await areaSummaries(ctx))
        .filter((area) => !area.hasRunner)
        .map((area) => ({
          area: area.name,
          shoppers: area.shoppers,
          ordersToday: area.ordersToday,
        }));
      const byStatus: Record<string, number> = {};
      for (const order of orders) byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;
      return {
        currency: config.store.currency,
        ordersToday: orders.length,
        ordersByStatus: byStatus,
        moneyTakenPence: taken.reduce((sum, row) => sum + row.amountPence, 0),
        paymentsTaken: taken.length,
        refundsPence: -refunds.reduce((sum, row) => sum + row.amountPence, 0),
        refunds: refunds.length,
        runnersWaitingForApproval: runnersWaiting,
        partnersWaitingForApproval: partnersWaiting,
        areasWithNoRunner: noRunner.slice(0, 15),
        moreAreasWithNoRunner: Math.max(0, noRunner.length - 15),
      };
    },
    async readApplication(kind, id) {
      if (kind === 'runner') {
        const runner = await repository.runners.findById(id);
        if (!runner) return { found: false };
        const documents = await repository.runnerDocuments.listForRunner(id);
        return {
          found: true,
          firstName: firstNameOf(runner.name),
          travelModes: runner.travelModes,
          rightToWorkVerified: runner.rightToWorkVerified,
          criminalRecordCheckVerified: runner.criminalRecordCheckVerified,
          facePhotoAccepted: runner.facePhotoAcceptedAt !== null,
          joined: runner.createdAt.toISOString().slice(0, 10),
          documents: documents.map((document) => ({
            what: KIND_SPOKEN[document.kind],
            status: document.status,
            note: document.checkNote ?? document.reviewNote ?? null,
            expiresOn: document.expiresOn?.toISOString().slice(0, 10) ?? null,
          })),
        };
      }
      const shop = await repository.partnerShops.findById(id);
      if (!shop) return { found: false };
      return {
        found: true,
        name: shop.name,
        kind: shop.kind,
        status: shop.status,
        about: shop.about.slice(0, 400),
        town: shop.address.split(',').slice(-2).join(',').trim().slice(0, 80),
        joined: shop.createdAt.toISOString().slice(0, 10),
        signedUpByAnAmbassador: Boolean(shop.agreementReference),
      };
    },
    async propose(matterId, choice) {
      const matter = await repository.ownerDesk.findMatter(matterId);
      if (!matter || (matter.status !== 'open' && matter.status !== 'later')) {
        return { ok: false, why: 'That matter is not open on the desk.' };
      }
      const what = choiceWords(
        choice,
        matter.options === 'acknowledge',
        config.ownerDesk.laterAfterMinutes,
      );
      return {
        ok: true,
        readBack: `To be sure, ${config.owner.spokenName}: I will ${what}. ${matter.summary} Shall I go ahead? Say yes, or no.`,
      };
    },
    // His staff, his emails and how Ozi reaches him (ruling 85).
    listStaff: () => listStaffForVoice(ctx),
    listEmails: (filter) => listEmailsForVoice(ctx, filter),
    readEmail: (id) => readEmailForVoice(ctx, id),
    getAlertPreferences: () => alertPreferencesForVoice(ctx),
    proposeAction: (request) => proposeOwnerAction(ctx, request),
  };
}

/**
 * His clear yes: the decision carried out through `decideMatter`, exactly as the keypad's and the
 * panel's, recorded in the audit log as the owner's, by voice.
 */
export async function carryOutDecision(
  ctx: DeskContext & Pick<AppContext, 'mailboxes'>,
  pending: PendingDecision,
  log?: FastifyBaseLogger,
  seen: { actorId?: string | null; ip?: string } = {},
): Promise<{ words: string }> {
  if ('action' in pending) {
    // A change he asked for (ruling 85): the same service functions as the admin panel.
    const owner = seen.actorId ? await ctx.repository.staffMembers.findById(seen.actorId) : null;
    return carryOutOwnerAction(ctx, pending.action, {
      actorId: seen.actorId ?? null,
      name: owner?.name ?? ctx.config.owner.spokenName,
      ...(seen.ip !== undefined ? { ip: seen.ip } : {}),
    });
  }
  return carryOutMatterDecision(ctx, pending, log, seen);
}

async function carryOutMatterDecision(
  ctx: DeskContext,
  pending: Extract<PendingDecision, { matterId: string }>,
  log?: FastifyBaseLogger,
  seen: { actorId?: string | null; ip?: string } = {},
): Promise<DeskOutcome> {
  const matter = await ctx.repository.ownerDesk.findMatter(pending.matterId);
  if (!matter) throw new NotFoundError('matter');
  if (matter.status !== 'open' && matter.status !== 'later') {
    return { matter, words: 'That one had already been dealt with.' };
  }
  return decideMatter(ctx, matter, pending.choice, 'voice', ctx.config.owner.spokenName, log, seen);
}
