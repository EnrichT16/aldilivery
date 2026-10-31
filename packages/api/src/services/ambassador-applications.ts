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
 * Declined, suspended and removed (Anthony, 31 October 2026):
 *
 * - A declined applicant was never approved, so has no earnings. They may apply again
 *   `ambassador.reapplyAfterMonths` (6) after the decline; before then the API says the date.
 * - A suspended Ambassador keeps what they earned from real, completed orders, held (no
 *   withdrawal) while suspended. Staff end a suspension one of two ways: "Lift" (back as they
 *   were, everything held released), or "Remove for fraud": the unpaid part of the shares from
 *   the businesses staff mark (or all of them) is cancelled, and they may never apply again.
 * - The face photo is compared with the photo on the ID automatically only with a separate,
 *   clear yes (a face is special category data); with a no, a person checks it.
 *
 * How long the documents are kept (the same day): an approved Ambassador's while they are one;
 * a declined applicant's ID, proof of address and face photo `declinedDocumentsDeleteAfterDays`
 * (30) after the decline, with a short note (name, the name on the ID, a date of birth if held,
 * the date and the reason) kept `declinedNoteKeptMonths` (12) and then removed; somebody removed
 * for fraud, their documents `documentsKeptMonths` (12) after, and the note barring them stays.
 * Swept by `sweepAmbassadorRetention`, on the same timer as the no-Runner refunds. Everything
 * goes at once with the account.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  addMonths,
  daysAfter,
  FACE_BY_PERSON_WORDS,
  FACE_CONSENT_QUESTION,
  formatPence,
  longDate,
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
import type {
  AmbassadorAgreement,
  AmbassadorDocument,
  AmbassadorEntry,
  AmbassadorNote,
  ReferralKind,
} from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { HELD_WORDS, reapplyFrom } from './ambassadors.js';
import { ensureCheckCode } from './ambassador-protection.js';
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
  // A removed file counts for nothing: somebody applying again sends new documents.
  for (const document of documents)
    if (!document.erasedAt && !latest.has(document.kind)) latest.set(document.kind, document);
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
export function documentName(
  document: Pick<AmbassadorDocument, 'kind' | 'idType' | 'addressType'>,
) {
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
    message = `Your Ambassador account is suspended.${agreement.decisionReason ? ` ${agreement.decisionReason}` : ''} ${HELD_WORDS} Please contact us.`;
  } else if (status === 'removed') {
    message =
      'You were removed as an Ozi Ambassador, so you cannot apply again. If anything is still owed to you, we will contact you.';
  } else if (needed.length === 0) {
    message = agreement.chatDoneAt
      ? 'Thank you for the chat. The founder will approve your application soon.'
      : CHAT_WORDS;
  } else if (status === 'documents_needed') message = DOCUMENTS_NEEDED_WORDS;
  else message = 'Thank you for applying. Next, please send your documents.';
  const from = await reapplyFrom(ctx, agreement);
  if (status === 'declined') {
    message += from
      ? ` You can apply again from ${longDate(from)}.`
      : ' You can apply again now if you wish.';
  }
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
    // The separate yes or no about comparing faces (31 October 2026).
    faceConsentQuestion: FACE_CONSENT_QUESTION,
    faceConsent: agreement.faceCompareConsent,
    faceConsentAt: agreement.faceCompareConsentAt,
    canApplyAgain: status === 'declined' && from === null,
    applyAgainFrom: from,
    held: status === 'suspended',
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
 * The separate yes or no to comparing their face photo with the photo on their ID (Anthony,
 * 31 October 2026), kept with the moment. Asked while applying; it may be changed until they are
 * decided. Nobody is declined for saying no: a person checks the face instead. A face photo
 * already sent and still waiting is looked at again under the new answer.
 */
export async function setFaceConsent(
  ctx: Context,
  agreement: AmbassadorAgreement,
  consent: boolean,
): Promise<{ agreement: AmbassadorAgreement; faceToCheck: string | null }> {
  if (!ambassadorApplying(agreement.status)) {
    throw new ConflictError('Your application is not waiting for this. Please contact us.');
  }
  const updated = await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    faceCompareConsent: consent,
    faceCompareConsentAt: ctx.now(),
  });
  const face = latestByKind(
    await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id),
  ).get('face_photo');
  if (!face || face.status !== 'submitted') return { agreement: updated, faceToCheck: null };
  if (face.checkedAt !== null) {
    await ctx.repository.ambassadorDocuments.update(face.id, {
      checkedAt: null,
      checkPassed: null,
      checkNote: null,
    });
  }
  return { agreement: updated, faceToCheck: face.id };
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
    if (code.length < 6)
      throw new BadRequestError('Please type the share code. It is 9 letters and numbers.');
    if (code.length > 20)
      throw new BadRequestError('That share code is too long. Please check it.');
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
    if (image.length === 0)
      throw new BadRequestError('That file was empty. Please choose another.');
    if (isPdf && image.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestError('That file is not a PDF. Please choose another.');
    }
    if (image.length > MAX_BYTES) {
      throw new BadRequestError(
        'That file is too large. Please choose one under 6 MB, or take a photo.',
      );
    }
  }
  if (input.kind === 'photo_id_front' && !input.idType) {
    throw new BadRequestError(
      'Please say which photo ID it is: a passport, driving licence or residence card.',
    );
  }
  if (input.kind === 'proof_of_address' && !input.addressType) {
    throw new BadRequestError(
      'Please say what the letter is: a utility bill, a bank letter or a council tax letter.',
    );
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
    idType:
      input.kind === 'photo_id_front' || input.kind === 'photo_id_back'
        ? (current.idType ?? input.idType ?? null)
        : null,
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
    faceCheck: faceCheckWords(agreement),
  };
}

/** How the face is checked, as staff see it: by a person unless they said yes (31 October 2026). */
export function faceCheckWords(agreement: Pick<AmbassadorAgreement, 'faceCompareConsent'>): string {
  if (agreement.faceCompareConsent === true) {
    return 'They agreed to the automatic face comparison';
  }
  return agreement.faceCompareConsent === false
    ? FACE_BY_PERSON_WORDS
    : `${FACE_BY_PERSON_WORDS} (they have not answered the question yet)`;
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
    // Suspend, Lift and Remove for fraud (31 October 2026).
    canSuspend: !['suspended', 'removed', 'declined'].includes(agreement.status),
    canDecline: canDecline(agreement),
    canLift: agreement.status === 'suspended',
    canRemoveForFraud: agreement.status === 'suspended',
    faceCompareConsent: agreement.faceCompareConsent,
    faceCompareConsentAt: agreement.faceCompareConsentAt,
    businesses: await businessesOf(ctx, agreement),
    identityMatches: await identityMatches(ctx, agreement, documents),
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
  if (agreement.status === 'suspended') {
    return agreement.approvedAt !== null && (agreement.suspendedFrom ?? 'approved') === 'approved';
  }
  return ambassadorApplying(agreement.status) && agreement.chatDoneAt !== null;
}

/**
 * Decline is for an application, never for somebody already approved: they are suspended, then
 * lifted or removed for fraud.
 */
function canDecline(agreement: AmbassadorAgreement): boolean {
  if (agreement.status === 'suspended') return agreement.approvedAt === null;
  return ambassadorApplying(agreement.status);
}

/** The businesses tied to them, with what is still unpaid from each: for "Remove for fraud". */
async function businessesOf(ctx: ReferralContext, agreement: AmbassadorAgreement) {
  const entries = await ctx.repository.ambassadors.listFor(
    agreement.accountKind,
    agreement.accountId,
  );
  const unpaid = unpaidByEntry(entries);
  return (await ctx.repository.partnerShops.list())
    .filter(
      (shop) =>
        shop.ambassadorKind === agreement.accountKind && shop.ambassadorId === agreement.accountId,
    )
    .map((shop) => ({
      id: shop.id,
      name: shop.name,
      unpaidPence: entries
        .filter((entry) => entry.partnerShopId === shop.id)
        .reduce((total, entry) => total + (unpaid.get(entry.id) ?? 0), 0),
    }));
}

/** The words of a name, for comparing: lower case, letters only, in any order. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .sort()
    .join(' ');
}

/**
 * Notes kept after an application was declined or somebody removed for fraud whose account is
 * this one, or whose name matches this applicant's or the name read on their ID: for staff, to
 * catch an application under a false identity.
 */
async function identityMatches(
  ctx: ReferralContext,
  agreement: AmbassadorAgreement,
  documents: readonly AmbassadorDocument[],
) {
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  const names = new Set(
    [account?.name ?? '', ...documents.map((document) => document.checkName ?? '')]
      .map(nameKey)
      .filter((key) => key !== ''),
  );
  return (await ctx.repository.ambassadorNotes.list())
    .filter(
      (note) =>
        (note.accountKind === agreement.accountKind && note.accountId === agreement.accountId) ||
        names.has(nameKey(note.name)) ||
        (note.nameOnId !== null && names.has(nameKey(note.nameOnId))),
    )
    .map((note) => ({
      id: note.id,
      kind: note.kind,
      words: `${note.kind === 'fraud' ? 'Removed for fraud' : 'Declined'} on ${longDate(note.at)}: ${note.name}${note.nameOnId ? ` (name on the ID: ${note.nameOnId})` : ''}${note.dateOfBirth ? `, born ${note.dateOfBirth}` : ''}. Reason: ${note.reason}`,
    }));
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
    suspendedFrom: null,
  });
  // Their code for the public check page and every printed QR code (31 October 2026).
  await ensureCheckCode(ctx, agreement);
  await settleMattersFor(ctx, 'ambassador_application', agreement.id, 'panel', by);
  return { message: `${await nameOf(ctx, agreement)} is approved as an Ozi Ambassador, by ${by}.` };
}

/**
 * "Decline", with a reason the person sees (31 October 2026): they may apply again
 * `reapplyAfterMonths` later; their ID, proof of address and face photo go
 * `declinedDocumentsDeleteAfterDays` after, and a short note is kept `declinedNoteKeptMonths`.
 */
export async function declineAmbassador(
  ctx: Context,
  agreementId: string,
  by: string,
  reason: string,
  dateOfBirth: string | null = null,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status === 'declined') throw new ConflictError('They are already declined.');
  if (!canDecline(agreement)) {
    throw new ConflictError(
      agreement.status === 'removed'
        ? 'They were removed for fraud.'
        : 'They were approved before, so they are not declined. Suspend them instead, then lift the suspension or remove them for fraud.',
    );
  }
  const at = ctx.now();
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'declined',
    decidedAt: at,
    decidedBy: by,
    decisionReason: reason,
    stoppedAt: at,
    suspendedFrom: null,
  });
  const rates = ctx.config.ambassador;
  await keepNote(
    ctx,
    agreement,
    'declined',
    reason,
    dateOfBirth,
    addMonths(at, rates.declinedNoteKeptMonths),
  );
  await settleMattersFor(ctx, 'ambassador_application', agreement.id, 'panel', by);
  return {
    message: `${await nameOf(ctx, agreement)} is declined, by ${by}. They see the reason, and may apply again from ${longDate(addMonths(at, rates.reapplyAfterMonths))}.`,
  };
}

/** The short note kept after a decline or a removal for fraud (31 October 2026). */
async function keepNote(
  ctx: Context,
  agreement: AmbassadorAgreement,
  kind: AmbassadorNote['kind'],
  reason: string,
  dateOfBirth: string | null,
  deleteAfter: Date | null,
): Promise<void> {
  const documents = await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id);
  const nameOnId =
    documents.find((document) => document.kind === 'photo_id_front' && document.checkName)
      ?.checkName ?? null;
  await ctx.repository.ambassadorNotes.create({
    agreementId: agreement.id,
    accountKind: agreement.accountKind,
    accountId: agreement.accountId,
    kind,
    name: (await findAccount(ctx, agreement.accountKind, agreement.accountId))?.name ?? 'Not known',
    nameOnId,
    dateOfBirth,
    reason,
    at: ctx.now(),
    deleteAfter,
  });
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
  if (agreement.status === 'removed') throw new ConflictError('They were removed for fraud.');
  const at = ctx.now();
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'suspended',
    decidedAt: at,
    decidedBy: by,
    decisionReason: reason,
    stoppedAt: at,
    suspendedFrom: agreement.status,
  });
  return {
    message: `${await nameOf(ctx, agreement)} is suspended, by ${by}. Their earnings are held until the suspension is lifted.`,
  };
}

/**
 * "Lift the suspension" (Anthony, 31 October 2026): back as they were, with everything they
 * earned released in full, nothing taken off.
 */
export async function liftSuspension(
  ctx: Context,
  agreementId: string,
  by: string,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status !== 'suspended') throw new ConflictError('They are not suspended.');
  const back: AmbassadorStatus =
    agreement.suspendedFrom ?? (agreement.approvedAt ? 'approved' : 'applied');
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: back,
    decidedAt: ctx.now(),
    decidedBy: by,
    decisionReason: null,
    stoppedAt: null,
    suspendedFrom: null,
  });
  if (back !== 'approved') await refreshApplication(ctx, agreement.id, log);
  return {
    message: `${await nameOf(ctx, agreement)}'s suspension is lifted, by ${by}. Everything they earned is released.`,
  };
}

/**
 * How much of each share and bonus is still unpaid: what they were paid, and refunds taken off,
 * cover the oldest earnings first.
 */
export function unpaidByEntry(entries: readonly AmbassadorEntry[]): Map<string, number> {
  let covered = entries
    .filter((entry) => entry.kind === 'payment' || entry.kind === 'deduction')
    .reduce((total, entry) => total + entry.amountPence, 0);
  const unpaid = new Map<string, number>();
  for (const entry of [...entries].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (entry.kind !== 'share' && entry.kind !== 'bonus') continue;
    const paid = Math.min(covered, entry.amountPence);
    covered -= paid;
    unpaid.set(entry.id, entry.amountPence - paid);
  }
  return unpaid;
}

/**
 * "Remove for fraud" (Anthony, 31 October 2026), only to end a suspension: the unpaid part of
 * every share and bonus from the businesses staff mark as fraudulent (or from all of them) is
 * cancelled, with when and why kept on each line; any withdrawal waiting is refused; they earn
 * nothing more; and a note bars them from ever applying again.
 */
export async function removeForFraud(
  ctx: Context,
  agreementId: string,
  input: { by: string; reason: string; shops: string[] | 'all'; dateOfBirth?: string | null },
): Promise<{ message: string; cancelledPence: number }> {
  const agreement = await agreementFor(ctx, agreementId);
  if (agreement.status === 'removed') throw new ConflictError('They are already removed.');
  if (agreement.status !== 'suspended') {
    throw new ConflictError('Please suspend them first. Removal for fraud ends a suspension.');
  }
  const { accountKind: kind, accountId: id } = agreement;
  if (input.shops !== 'all' && input.shops.length === 0) {
    throw new BadRequestError(
      'Please mark the businesses that were fraudulent, or choose all of them.',
    );
  }
  const at = ctx.now();
  for (const withdrawal of await ctx.repository.ambassadors.listWithdrawalsFor(kind, id)) {
    if (withdrawal.status !== 'waiting_approval') continue;
    await ctx.repository.ambassadors.updateWithdrawal(withdrawal.id, {
      status: 'refused',
      decidedAt: at,
      decidedBy: input.by,
    });
  }
  const entries = await ctx.repository.ambassadors.listFor(kind, id);
  const unpaid = unpaidByEntry(entries);
  const marked = input.shops === 'all' ? null : new Set(input.shops);
  let cancelledPence = 0;
  for (const entry of entries) {
    const left = unpaid.get(entry.id) ?? 0;
    if (left <= 0) continue;
    if (marked && !(entry.partnerShopId && marked.has(entry.partnerShopId))) continue;
    await ctx.repository.ambassadors.updateEntry(entry.id, {
      amountPence: entry.amountPence - left,
      cancelledPence: entry.cancelledPence + left,
      cancelledAt: at,
      cancelReason: `Removed for fraud: ${input.reason}`,
    });
    cancelledPence += left;
  }
  await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    status: 'removed',
    decidedAt: at,
    decidedBy: input.by,
    decisionReason: input.reason,
    stoppedAt: at,
    suspendedFrom: null,
  });
  await keepNote(ctx, agreement, 'fraud', input.reason, input.dateOfBirth ?? null, null);
  const money = formatPence(cancelledPence, ctx.config.store.currencySymbol);
  return {
    message: `${await nameOf(ctx, agreement)} is removed for fraud, by ${input.by}. ${money} of unpaid shares cancelled. They can never apply again.`,
    cancelledPence,
  };
}

/* ------------------------------------------------------------------ retention */

export interface AmbassadorRetentionReport {
  /** Files and share codes removed. */
  documentsRemoved: number;
  /** Declined notes past their 12 months, removed. A fraud bar never goes. */
  notesRemoved: number;
  /** Declined applications whose reason was cleared after the 12 months. */
  reasonsCleared: number;
}

/**
 * The retention rules (Anthony, 31 October 2026), safe to run as often as wanted: running it
 * again removes nothing more.
 *
 * - Declined: the ID, proof of address and face photo (and any share code), and the chat notes,
 *   `declinedDocumentsDeleteAfterDays` (30) after the decline; the reason they were given,
 *   `declinedNoteKeptMonths` (12) after.
 * - Removed for fraud, or stopped any other way: the documents `documentsKeptMonths` (12) after.
 * - Approved, suspended or still applying: kept.
 * - The notes: a declined note `declinedNoteKeptMonths` after it was made; a fraud bar stays.
 */
export async function sweepAmbassadorRetention(
  ctx: Pick<AppContext, 'repository' | 'now'> & Partial<Pick<AppContext, 'config'>>,
): Promise<AmbassadorRetentionReport> {
  const rates = ctx.config?.ambassador;
  const keptMonths = rates?.documentsKeptMonths ?? 12;
  const declinedDays = rates?.declinedDocumentsDeleteAfterDays ?? 30;
  const noteMonths = rates?.declinedNoteKeptMonths ?? 12;
  const at = ctx.now();
  const due = (when: Date) => when.getTime() <= at.getTime();
  const report: AmbassadorRetentionReport = {
    documentsRemoved: 0,
    notesRemoved: 0,
    reasonsCleared: 0,
  };
  for (const agreement of await ctx.repository.ambassadors.listAgreements()) {
    const kind = agreement.accountKind as ReferralKind;
    if (agreement.status === 'declined') {
      const declinedAt = agreement.decidedAt ?? agreement.stoppedAt;
      if (!declinedAt) continue;
      if (due(daysAfter(declinedAt, declinedDays))) {
        report.documentsRemoved += await ctx.repository.ambassadorDocuments.eraseFor(
          kind,
          agreement.accountId,
          at,
        );
        if (!agreement.documentsRemovedAt || agreement.chatNotes !== '') {
          await ctx.repository.ambassadors.updateAgreement(agreement.id, {
            documentsRemovedAt: agreement.documentsRemovedAt ?? at,
            chatNotes: '',
          });
        }
      }
      if (due(addMonths(declinedAt, noteMonths)) && agreement.decisionReason !== null) {
        await ctx.repository.ambassadors.updateAgreement(agreement.id, { decisionReason: null });
        report.reasonsCleared += 1;
      }
      continue;
    }
    if (agreement.status === 'approved' || agreement.status === 'suspended') continue;
    if (!agreement.stoppedAt || !due(addMonths(agreement.stoppedAt, keptMonths))) continue;
    report.documentsRemoved += await ctx.repository.ambassadorDocuments.eraseFor(
      kind,
      agreement.accountId,
      at,
    );
    if (!agreement.documentsRemovedAt) {
      await ctx.repository.ambassadors.updateAgreement(agreement.id, { documentsRemovedAt: at });
    }
  }
  report.notesRemoved = await ctx.repository.ambassadorNotes.deleteDue(at);
  return report;
}
