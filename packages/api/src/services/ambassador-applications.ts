/**
 * Applying to be an Ozi Ambassador (Anthony, 30 October 2026). The founder wants to know and trust
 * every Ambassador, so the instant opt-in is replaced by an application:
 *
 * 1. They read and agree to the Ambassador terms (the tick and the version, as before): APPLIED.
 * 2. They send their documents from the phone, as a Runner does: a photo ID (a passport, driving
 *    licence or biometric residence card), the front and, for a card, the back; a proof of address
 *    dated within the last 3 months (a utility bill, a bank or council tax letter), a photo or a
 *    PDF; a photo of their face; and, if they are not British and wish, a Home Office share code.
 *    Once every one needed is in: DOCUMENTS SENT, and the owner is told on Ozi's desk "<name> has
 *    applied to be an Ozi Ambassador; documents are ready."
 * 3. The automatic check reads each one as it reads a Runner's (auto-check.ts): clear ones are
 *    marked checked; unclear ones go to staff on the Ambassadors page and to the owner's desk.
 *    Once every one needed is accepted: DOCUMENTS CHECKED.
 * 4. "We'll contact you to have a short chat before you start." Staff record "Chat done", with
 *    notes: CHAT DONE.
 * 5. The founder or the operations manager press "Approve": APPROVED. Nothing is ever approved
 *    without a person pressing it. Or "Decline", with a reason the person sees, or "Suspend".
 *
 * Only an APPROVED Ambassador has their Ambassador link, the Toolkit and withdrawals. Those who
 * opted in before applications began are DOCUMENTS NEEDED: their link keeps working and their
 * earnings keep coming in as before, but the Toolkit and withdrawals wait until they are approved.
 * They stay "documents needed" while they apply, so their link never stops on the way.
 *
 * The ID and address documents are kept while the person is an Ambassador and for
 * `ambassador.documentsKeptMonths` (12) after they stop or are declined (retention.ts), and go with
 * the account when it is removed.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  AMBASSADOR_ADDRESS_WORDS,
  AMBASSADOR_DOCUMENT_WORDS,
  AMBASSADOR_ID_WORDS,
  AMBASSADOR_STATUS_WORDS,
  AMBASSADOR_STATUSES,
  ambassadorApplying,
  ambassadorApproved,
  ambassadorDocumentsNeeded,
  type AmbassadorAddressType,
  type AmbassadorDocumentKind,
  type AmbassadorIdType,
  type AmbassadorStatus,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { AmbassadorAgreement, AmbassadorDocument, ReferralKind } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { askOwner, settleMattersFor } from './owner-desk.js';
import { findAccount, KIND_WORDS, type ReferralContext } from './referrals.js';

type Context = Pick<AppContext, 'repository' | 'config' | 'now'> & Partial<Pick<AppContext, 'env'>>;

/** What the person is told once their documents are in. */
export const CHAT_WORDS = "We'll contact you to have a short chat before you start.";

/** What a grandfathered Ambassador is told, plainly (Anthony, 30 October 2026). */
export const DOCUMENTS_NEEDED_WORDS =
  'Your Ambassador link keeps working and your earnings keep adding up, as before. To use the Ambassador Toolkit and to withdraw your earnings, we now need to check your documents and have a short chat with you. Please send your documents.';

/** A photo, or a PDF for a document (never for a face). */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const PDF = 'application/pdf';
const MAX_BYTES = 6 * 1024 * 1024;

/** The latest of each kind, newest first in, so the first found is the latest. */
function latestByKind(
  documents: readonly AmbassadorDocument[],
): Map<AmbassadorDocumentKind, AmbassadorDocument> {
  const latest = new Map<AmbassadorDocumentKind, AmbassadorDocument>();
  for (const document of documents) if (!latest.has(document.kind)) latest.set(document.kind, document);
  return latest;
}

/** The documents still needed: never sent, or sent and turned down. */
export function documentsStillNeeded(
  agreement: Pick<AmbassadorAgreement, 'idType'>,
  documents: readonly AmbassadorDocument[],
): AmbassadorDocumentKind[] {
  const latest = latestByKind(documents);
  return ambassadorDocumentsNeeded(agreement.idType).filter((kind) => {
    const found = latest.get(kind);
    return !found || found.status === 'rejected';
  });
}

/** The words for a document, as the person sees it: "Your photo ID, the front (Passport)". */
export function documentName(document: Pick<AmbassadorDocument, 'kind' | 'idType' | 'addressType'>) {
  const base = AMBASSADOR_DOCUMENT_WORDS[document.kind];
  if (document.idType) return `${base} (${AMBASSADOR_ID_WORDS[document.idType]})`;
  if (document.addressType) return `${base} (${AMBASSADOR_ADDRESS_WORDS[document.addressType]})`;
  return base;
}

/** The same, for the owner's ear: "photo ID, the front". */
export function documentSpoken(document: Pick<AmbassadorDocument, 'kind'>): string {
  const words: Record<AmbassadorDocumentKind, string> = {
    photo_id_front: 'photo ID, the front',
    photo_id_back: 'photo ID, the back',
    proof_of_address: 'proof of address',
    face_photo: 'face photo',
    share_code: 'Home Office share code',
  };
  return words[document.kind];
}

/** A document as the person sees it: never the file, never a share code. */
export function publicAmbassadorDocument(document: AmbassadorDocument) {
  return {
    id: document.id,
    kind: document.kind,
    name: documentName(document),
    status: document.status,
    reviewNote: document.reviewNote,
    sentAs: document.shareCode
      ? 'share code'
      : document.contentType === PDF
        ? 'PDF'
        : document.erasedAt
          ? 'removed'
          : 'photo',
    createdAt: document.createdAt,
  };
}

/** How far a grandfathered Ambassador has got: they stay "documents needed" all the way. */
function stageWords(agreement: AmbassadorAgreement): string {
  if (agreement.status !== 'documents_needed') return AMBASSADOR_STATUS_WORDS[agreement.status];
  if (agreement.chatDoneAt) return 'Documents needed: chat done';
  if (agreement.documentsCheckedAt) return 'Documents needed: documents checked';
  if (agreement.documentsSentAt) return 'Documents needed: documents sent';
  return AMBASSADOR_STATUS_WORDS.documents_needed;
}

/** What the person sees of their own application. */
export async function myApplication(ctx: Context, agreement: AmbassadorAgreement) {
  const documents = await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id);
  const needed = documentsStillNeeded(agreement, documents);
  const status = agreement.status;
  let message = '';
  if (status === 'approved') message = 'You are an approved Ozi Ambassador.';
  else if (status === 'declined') {
    message = `Your application was not approved.${agreement.decisionReason ? ` ${agreement.decisionReason}` : ''}`;
  } else if (status === 'suspended') {
    message = `Your Ambassador account is suspended.${agreement.decisionReason ? ` ${agreement.decisionReason}` : ''} Please contact us.`;
  } else if (needed.length === 0) {
    message = agreement.chatDoneAt
      ? 'Thank you for the chat. The founder will approve your application soon.'
      : CHAT_WORDS;
  } else if (status === 'documents_needed') message = DOCUMENTS_NEEDED_WORDS;
  else message = 'Thank you for applying. Next, please send your documents.';
  return {
    status,
    statusWords: stageWords(agreement),
    idType: agreement.idType,
    stillNeeded: needed.map((kind) => ({ kind, name: AMBASSADOR_DOCUMENT_WORDS[kind] })),
    documents: documents.map(publicAmbassadorDocument),
    documentsIn: needed.length === 0,
    chatDone: agreement.chatDoneAt !== null,
    reason: status === 'declined' || status === 'suspended' ? agreement.decisionReason : null,
    approved: ambassadorApproved(status),
    message,
  };
}

/* ------------------------------------------------------------------ documents */

export interface DocumentInput {
  kind: AmbassadorDocumentKind;
  idType?: AmbassadorIdType;
  addressType?: AmbassadorAddressType;
  image?: string;
  contentType?: string;
  shareCode?: string;
}

/**
 * Keeps one document from the applicant, refusing anything that is not a photo (or, for a
 * document, a PDF). Choosing the kind of photo ID with the front sets which documents are needed.
 */
export async function sendAmbassadorDocument(
  ctx: Context,
  agreement: AmbassadorAgreement,
  input: DocumentInput,
  log?: FastifyBaseLogger,
): Promise<AmbassadorDocument> {
  if (!ambassadorApplying(agreement.status)) {
    throw new ConflictError(
      agreement.status === 'approved'
        ? 'You are already approved. There is nothing more to send.'
        : 'Your application is closed. Please contact us.',
    );
  }
  let image: Buffer | null = null;
  let shareCode: string | null = null;
  if (input.kind === 'share_code') {
    const code = (input.shareCode ?? '').toUpperCase().replace(/\s+/g, '');
    if (code.length < 6) throw new BadRequestError('Please type the share code. It is 9 letters and numbers.');
    if (code.length > 20) throw new BadRequestError('That share code is too long. Please check it.');
    shareCode = code;
  } else {
    if (!input.image) throw new BadRequestError('Please send a photo.');
    const isPdf = input.contentType === PDF && input.kind !== 'face_photo';
    if (!input.contentType || !(isPdf || IMAGE_TYPES.includes(input.contentType))) {
      throw new BadRequestError(
        input.kind === 'face_photo' ? 'Please send a photo.' : 'Please send a photo or a PDF.',
      );
    }
    image = Buffer.from(input.image, 'base64');
    if (image.length === 0) throw new BadRequestError('That file was empty. Please choose another.');
    if (isPdf && image.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestError('That file is not a PDF. Please choose another.');
    }
    if (image.length > MAX_BYTES) {
      throw new BadRequestError('That file is too large. Please choose one under 6 MB, or take a photo.');
    }
  }
  if (input.kind === 'photo_id_front' && !input.idType) {
    throw new BadRequestError('Please say which photo ID it is: a passport, driving licence or residence card.');
  }
  if (input.kind === 'proof_of_address' && !input.addressType) {
    throw new BadRequestError('Please say what the letter is: a utility bill, a bank letter or a council tax letter.');
  }
  let current = agreement;
  if (input.kind === 'photo_id_front' && input.idType && input.idType !== agreement.idType) {
    current = await ctx.repository.ambassadors.updateAgreement(agreement.id, {
      idType: input.idType,
    });
  }
  const document = await ctx.repository.ambassadorDocuments.create({
    agreementId: current.id,
    accountKind: current.accountKind,
    accountId: current.accountId,
    kind: input.kind,
    idType: input.kind === 'photo_id_front' || input.kind === 'photo_id_back' ? (current.idType ?? input.idType ?? null) : null,
    addressType: input.kind === 'proof_of_address' ? (input.addressType ?? null) : null,
    image,
    contentType: image ? (input.contentType ?? null) : null,
    shareCode,
    createdAt: ctx.now(),
  });
  await refreshApplication(ctx, current.id, log);
  return document;
}

/**
 * Brings an application's status up to date with its documents: every one needed in, DOCUMENTS
 * SENT (and the owner told, once); every one needed accepted, DOCUMENTS CHECKED. A grandfathered
 * Ambassador stays "documents needed", with the moments kept. Never moves anybody to approved.
 */
export async function refreshApplication(
  ctx: Context,
  agreementId: string,
  log?: FastifyBaseLogger,
): Promise<AmbassadorAgreement> {
  const agreement = await ctx.repository.ambassadors.findAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Ambassador application');
  if (!ambassadorApplying(agreement.status)) return agreement;
  const documents = await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id);
  const latest = latestByKind(documents);
  const needed = ambassadorDocumentsNeeded(agreement.idType).map((kind) => latest.get(kind));
  const allIn = needed.every((document) => document && document.status !== 'rejected');
  const allChecked = needed.every((document) => document?.status === 'accepted');
  const at = ctx.now();
  const patch: Partial<AmbassadorAgreement> = {};
  const grandfathered = agreement.status === 'documents_needed';
  if (allIn && !agreement.documentsSentAt) patch.documentsSentAt = at;
  if (!allIn && agreement.documentsSentAt) patch.documentsSentAt = null;
  if (allChecked && !agreement.documentsCheckedAt) patch.documentsCheckedAt = at;
  if (!allChecked && agreement.documentsCheckedAt) patch.documentsCheckedAt = null;
  if (!grandfathered && agreement.status !== 'chat_done') {
    const status: AmbassadorStatus = allChecked
      ? 'documents_checked'
      : allIn
        ? 'documents_sent'
        : 'applied';
    if (status !== agreement.status) patch.status = status;
  }
  if (Object.keys(patch).length === 0) return agreement;
  const updated = await ctx.repository.ambassadors.updateAgreement(agreement.id, patch);
  if (patch.documentsSentAt) await tellOwnerDocumentsIn(ctx, updated, log);
  return updated;
}

/** The owner's desk: "<name> has applied to be an Ozi Ambassador; documents are ready." */
async function tellOwnerDocumentsIn(
  ctx: Context,
  agreement: AmbassadorAgreement,
  log?: FastifyBaseLogger,
): Promise<void> {
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  await askOwner(
    ctx,
    {
      kind: 'ambassador_application',
      subjectId: agreement.id,
      summary: `${account?.name ?? 'Somebody'} has applied to be an Ozi Ambassador; documents are ready.`,
      options: 'acknowledge',
    },
    log,
  );
}

/**
 * Accepting or turning down one document: by the automatic check (which only ever accepts), on
 * the staff Ambassadors page, or by the owner on Ozi's desk. The application follows.
 */
export async function decideAmbassadorDocument(
  ctx: Context,
  document: AmbassadorDocument,
  input: { decision: 'accept' | 'reject'; by: string; note?: string | null },
  log?: FastifyBaseLogger,
): Promise<AmbassadorDocument> {
  if (document.status !== 'submitted') throw new ConflictError('That has already been decided.');
  const decided = await ctx.repository.ambassadorDocuments.update(document.id, {
    status: input.decision === 'accept' ? 'accepted' : 'rejected',
    reviewNote: input.note ?? null,
    reviewedBy: input.by,
    reviewedAt: ctx.now(),
  });
  await settleMattersFor(ctx, 'ambassador_document', document.id, 'panel', input.by);
  await refreshApplication(ctx, document.agreementId, log);
  return decided;
}

/* ------------------------------------------------------------------ staff */

/** One application, as the staff Ambassadors page lists it. */
async function staffRow(ctx: ReferralContext, agreement: AmbassadorAgreement) {
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  const documents = await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id);
  return {
    id: agreement.id,
    kind: agreement.accountKind,
    kindWords: KIND_WORDS[agreement.accountKind],
    accountId: agreement.accountId,
    name: account?.name ?? 'Closed account',
    area: account?.area ?? 'Not known',
    status: agreement.status,
    statusWords: stageWords(agreement),
    agreedAt: agreement.agreedAt,
    documentsSentAt: agreement.documentsSentAt,
    documentsCheckedAt: agreement.documentsCheckedAt,
    chatDoneAt: agreement.chatDoneAt,
    waitingDocuments: documents.filter((document) => document.status === 'submitted').length,
  };
}

/** Every application, for staff, grouped by status in the order they move through. */
export async function staffApplications(ctx: ReferralContext) {
  const rows: Array<Awaited<ReturnType<typeof staffRow>>> = [];
  for (const agreement of await ctx.repository.ambassadors.listAgreements()) {
    rows.push(await staffRow(ctx, agreement));
  }
  return AMBASSADOR_STATUSES.map((status) => ({
    status,
    words: AMBASSADOR_STATUS_WORDS[status],
    applications: rows.filter((row) => row.status === status),
  }));
}

/** One application in full, for staff: each document with its checks, the chat, the decision. */
export async function staffApplication(ctx: ReferralContext, agreementId: string) {
  const agreement = await ctx.repository.ambassadors.findAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Ambassador application');
  const documents = await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id);
  return {
    ...(await staffRow(ctx, agreement)),
    termsVersion: agreement.termsVersion,
    idType: agreement.idType,
    chatDoneBy: agreement.chatDoneBy,
    chatNotes: agreement.chatNotes,
    decidedAt: agreement.decidedAt,
    decidedBy: agreement.decidedBy,
    decisionReason: agreement.decisionReason,
    approvedAt: agreement.approvedAt,
    stillNeeded: documentsStillNeeded(agreement, documents).map((kind) => ({
      kind,
      name: AMBASSADOR_DOCUMENT_WORDS[kind],
    })),
    canRecordChat: ambassadorApplying(agreement.status) && agreement.documentsCheckedAt !== null,
    canApprove: canApprove(agreement),
    documents: documents.map((document) => ({
      ...publicAmbassadorDocument(document),
      shareCode: document.shareCode,
      hasFile: document.image !== null,
      contentType: document.contentType,
      checkedAt: document.checkedAt,
      checkPassed: document.checkPassed,
      checkNote: document.checkNote,
      checkName: document.checkName,
      checkIssuedOn: document.checkIssuedOn,
      reviewedBy: document.reviewedBy,
      reviewedAt: document.reviewedAt,
    })),
  };
}

/** Approve only after the chat, or to lift a suspension of somebody approved before. */
function canApprove(agreement: AmbassadorAgreement): boolean {
  if (agreement.status === 'suspended') return agreement.approvedAt !== null;
  return ambassadorApplying(agreement.status) && agreement.chatDoneAt !== null;
}

async function agreementFor(ctx: Context, agreementId: string): Promise<AmbassadorAgreement> {
  const agreement = await ctx.repository.ambassadors.findAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Ambassador application');
  return agreement;
}

async function nameOf(ctx: Context, agreement: AmbassadorAgreement): Promise<string> {
  return (await findAccount(ctx, agreement.accountKind, agreement.accountId))?.name ?? 'They';
}

/** "Chat done": the short chat with the founder, after the documents are checked, with notes. */
export async function recordChat(
  ctx: Context,
  agreementId: string,
  by: string,
  notes: string,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (!ambassadorApplying(agreement.status)) {
    throw new ConflictError('This application is not waiting for a chat.');
  }
  if (!agreement.documentsCheckedAt) {
    throw new ConflictError('Please check their documents first. The chat comes after.');
  }
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    chatDoneAt: ctx.now(),
    chatDoneBy: by,
    chatNotes: notes,
    ...(agreement.status === 'documents_needed' ? {} : { status: 'chat_done' as const }),
  });
  return { message: `The chat with ${await nameOf(ctx, agreement)} is recorded, by ${by}.` };
}

/** "Approve": only ever pressed by a person, after the documents and the chat. */
export async function approveAmbassador(
  ctx: Context,
  agreementId: string,
  by: string,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status === 'approved') throw new ConflictError('They are already approved.');
  if (!canApprove(agreement)) {
    throw new ConflictError(
      agreement.documentsCheckedAt
        ? 'Please record the chat with the founder first.'
        : 'Please check their documents and have the chat first.',
    );
  }
  const at = ctx.now();
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'approved',
    decidedAt: at,
    decidedBy: by,
    decisionReason: null,
    approvedAt: agreement.approvedAt ?? at,
    stoppedAt: null,
  });
  await settleMattersFor(ctx, 'ambassador_application', agreement.id, 'panel', by);
  return { message: `${await nameOf(ctx, agreement)} is approved as an Ozi Ambassador, by ${by}.` };
}

/** "Decline", with a reason the person sees. Their documents go 12 months later. */
export async function declineAmbassador(
  ctx: Context,
  agreementId: string,
  by: string,
  reason: string,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status === 'declined') throw new ConflictError('They are already declined.');
  const at = ctx.now();
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'declined',
    decidedAt: at,
    decidedBy: by,
    decisionReason: reason,
    stoppedAt: at,
  });
  await settleMattersFor(ctx, 'ambassador_application', agreement.id, 'panel', by);
  return { message: `${await nameOf(ctx, agreement)} is declined, by ${by}. They see the reason.` };
}

/** "Suspend": the link, the Toolkit and withdrawals stop until approved again. */
export async function suspendAmbassador(
  ctx: Context,
  agreementId: string,
  by: string,
  reason: string,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status === 'suspended') throw new ConflictError('They are already suspended.');
  if (agreement.status === 'declined') throw new ConflictError('They were declined.');
  const at = ctx.now();
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'suspended',
    decidedAt: at,
    decidedBy: by,
    decisionReason: reason,
    stoppedAt: at,
  });
  return { message: `${await nameOf(ctx, agreement)} is suspended, by ${by}.` };
}

/* ------------------------------------------------------------------ retention */

/**
 * The retention rule (30 October 2026): the ID and address documents of somebody who stopped
 * being an Ambassador, or was declined, more than `documentsKeptMonths` ago are removed. Gives
 * how many files went.
 */
export async function removeOldAmbassadorDocuments(
  ctx: Pick<AppContext, 'repository' | 'now'> & Partial<Pick<AppContext, 'config'>>,
): Promise<number> {
  const months = ctx.config?.ambassador.documentsKeptMonths ?? 12;
  const at = ctx.now();
  const cutoff = new Date(at);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  let removed = 0;
  for (const agreement of await ctx.repository.ambassadors.listAgreements()) {
    if (!agreement.stoppedAt || agreement.stoppedAt.getTime() > cutoff.getTime()) continue;
    if (agreement.status === 'approved') continue;
    removed += await ctx.repository.ambassadorDocuments.eraseFor(
      agreement.accountKind as ReferralKind,
      agreement.accountId,
      at,
    );
  }
  return removed;
}
