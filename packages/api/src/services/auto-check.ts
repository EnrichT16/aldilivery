/**
 * The automatic check (ruling 74, Anthony, 22 October 2026: "approve them automatically… if
 * anyone is not clear, call me").
 *
 * - **Runner documents.** When a Runner sends a photo, the language model reads it: whether it is
 *   what was asked for, whether it is readable, the name on it, any expiry date, for a DBS
 *   certificate whether anything is recorded, for a face photo whether it is a clear, real face,
 *   and how sure it is. When the whole application is in, the names are compared across the
 *   documents and with the account, and, only if the Runner agreed, the face photo with the
 *   photo on their ID. Documents are approved automatically ONLY when every check is clearly
 *   fine. Nothing is ever refused automatically (UK GDPR Article 22): anything unclear, expired,
 *   mismatched, or with something recorded on the DBS becomes a matter on Ozi's desk, and Ozi
 *   rings the owner with the reason in one sentence. A share code cannot be checked by the model,
 *   so it always goes to the owner, to check on GOV.UK.
 * - **Ozi Ambassador applicants' documents** (30 October 2026) are read the same way: the photo
 *   ID, the back of a card and the proof of address (also whether it is dated within the last
 *   three months). Clear ones are marked checked; unclear ones go to the owner and to staff.
 *   Nobody is ever approved as an Ambassador automatically. The face photo (31 October 2026) is
 *   compared with the photo on the ID by the same comparison as a Runner's, and only when the
 *   applicant said yes to the separate question; with a no, or no answer, nothing reads the face
 *   and staff see "Check by a person: face not compared automatically". Nobody is declined for
 *   saying no.
 * - **Shop products.** Clear ones are approved automatically. Clearly restricted ones are refused
 *   automatically only by the existing rule lists (things never brought, excluded services, the
 *   most one product may cost): a rule, not a judgement. Doubtful ones go to the owner.
 * - **Without the language model key nothing is automatic**: everything becomes a matter.
 *
 * Every automatic decision is written in the audit log as "The automatic check", with its
 * reasons. The model's maker is named nowhere.
 */

import type { FastifyBaseLogger } from 'fastify';

import {
  addressDateRecent,
  FACE_BY_EYE_WORDS,
  FACE_BY_PERSON_WORDS,
  excludedServiceKind,
  excludedServiceWords,
  formatPence,
  productAllowed,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { AmbassadorDocument, RunnerDocument } from '../domain.js';
import {
  READABLE_IMAGES,
  type CheckedDocumentKind,
  type DocumentFile,
  type DocumentReading,
  type ReceiptImage,
} from '../lib/language-model.js';
import { NEVER_FOUND } from '../lib/restricted.js';
import { documentsNeeded } from '../routes/runner-account.js';
import {
  askOwner,
  AUTOMATIC,
  auditAutomatic,
  settleMattersFor,
  ukDate,
  type DeskContext,
} from './owner-desk.js';
import { decideAmbassadorDocument, documentSpoken } from './ambassador-applications.js';
import { decidePartnerProduct, withdrawPartnerProduct } from './partner-products.js';
import { findAccount } from './referrals.js';
import { decideRunnerDocument, KIND_SPOKEN } from './runner-documents.js';

type CheckContext = DeskContext & Pick<AppContext, 'backgroundChecks'>;

/**
 * Runs a check in the background on the real server, so nobody waits for the model; in the
 * tests (and wherever `backgroundChecks` is off) it is awaited, so each step can be proved.
 */
export async function checkInBackground(
  ctx: Pick<AppContext, 'backgroundChecks'>,
  log: FastifyBaseLogger | undefined,
  work: () => Promise<unknown>,
): Promise<void> {
  const run = work().catch((failure: unknown) => {
    log?.error({ err: failure }, 'The automatic check failed.');
  });
  if (!ctx.backgroundChecks) await run;
}

function readable(contentType: string | null): contentType is ReceiptImage['mediaType'] {
  return (READABLE_IMAGES as readonly string[]).includes(contentType ?? '');
}

/** The document as the check reads it: a photo, or the PDF it was emailed as. */
function fileOf(
  document: Pick<RunnerDocument | AmbassadorDocument, 'image' | 'contentType'>,
): DocumentFile | null {
  if (document.image && document.contentType === 'application/pdf') {
    return { data: Buffer.from(document.image).toString('base64'), mediaType: 'application/pdf' };
  }
  return photoOf(document);
}

function photoOf(
  document: Pick<RunnerDocument | AmbassadorDocument, 'image' | 'contentType'>,
): ReceiptImage | null {
  if (!document.image || !readable(document.contentType)) return null;
  return {
    data: Buffer.from(document.image).toString('base64'),
    mediaType: document.contentType,
  };
}

/** The words of a name, for comparing: lower case, letters only. */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((word) => word.length > 1);
}

/**
 * Whether a name read on a document is the account's name: the first and last of the account's
 * names both appear on it, in any order (documents print "SURNAME, FORENAMES" and middle names).
 */
export function namesMatch(accountName: string, documentName: string): boolean {
  const account = nameWords(accountName);
  const onDocument = new Set(nameWords(documentName));
  if (account.length === 0 || onDocument.size === 0) return false;
  const first = account[0] as string;
  const last = account[account.length - 1] as string;
  return onDocument.has(first) && onDocument.has(last);
}

/** Kinds of document that carry the holder's name. */
const NAMED = new Set<RunnerDocument['kind']>([
  'right_to_work',
  'dbs',
  'driving_licence_front',
  'insurance',
]);

/**
 * What stops a document being approved automatically, in plain words for the owner's ear. Empty
 * means every check was clearly fine.
 */
export function documentConcerns(
  document: Pick<RunnerDocument, 'kind' | 'expiresOn'>,
  reading: DocumentReading,
  accountName: string,
  today: string,
  confidence: number,
): string[] {
  const concerns: string[] = [];
  if (!reading.kindMatches) concerns.push('it does not look like the document that was asked for');
  if (!reading.readable) concerns.push('it is not clear enough to read');
  if (reading.expiresOn !== null && reading.expiresOn < today) concerns.push('it has expired');
  if (document.kind === 'insurance') {
    const given = document.expiresOn ? document.expiresOn.toISOString().slice(0, 10) : null;
    if (reading.expiresOn === null) concerns.push('the date it runs out cannot be read');
    else if (given !== null && given !== reading.expiresOn) {
      concerns.push('the date on it is not the date the Runner gave');
    }
  }
  if (NAMED.has(document.kind)) {
    if (reading.nameOnDocument === null) concerns.push('no name can be read on it');
    else if (!namesMatch(accountName, reading.nameOnDocument)) {
      concerns.push('the name on it does not match the name on the account');
    }
  }
  if (document.kind === 'dbs') {
    if (reading.dbsRecordsSomething === true) concerns.push('something is recorded on it');
    else if (reading.dbsRecordsSomething !== false) {
      concerns.push('it cannot be told whether anything is recorded on it');
    }
  }
  if (document.kind === 'face_photo' && reading.clearRealFace !== true) {
    concerns.push('it is not clearly a photo of a real face');
  }
  if (concerns.length === 0 && reading.confidence < confidence) {
    concerns.push(
      reading.concern
        ? `the automatic check is not sure: ${reading.concern.replace(/\.$/, '').toLowerCase()}`
        : 'the automatic check is not sure enough about it',
    );
  }
  return concerns;
}

function sentence(concerns: string[]): string {
  const list =
    concerns.length <= 1
      ? (concerns[0] ?? '')
      : `${concerns.slice(0, -1).join(', ')} and ${concerns[concerns.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/* ------------------------------------------------------------------ Runner documents */

/** Reads one Runner document and approves it, waits for the rest, or asks the owner. */
export async function checkRunnerDocument(
  ctx: CheckContext,
  documentId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { repository } = ctx;
  const document = await repository.runnerDocuments.findById(documentId);
  if (!document || document.status !== 'submitted') return;
  const runner = await repository.runners.findById(document.runnerId);
  if (!runner) return;
  const at = ctx.now();
  const what = KIND_SPOKEN[document.kind];
  const target = `document=${document.id}`;

  const toOwner = async (reason: string, name: string | null = null): Promise<void> => {
    await repository.runnerDocuments.update(document.id, {
      checkedAt: at,
      checkPassed: false,
      checkNote: reason,
      checkName: name,
    });
    await askOwner(
      ctx,
      {
        kind: 'runner_document',
        subjectId: document.id,
        summary: `Runner ${runner.name}'s ${what} needs you. ${reason}`,
        options: 'decide',
      },
      log,
    );
    await auditAutomatic(ctx, target, `Not approved; asked the owner. ${what}: ${reason}`);
  };

  if (document.shareCode && !document.image) {
    await toOwner(
      document.kind === 'right_to_work'
        ? 'It is a share code, which the automatic check cannot verify. Please check it on GOV.UK.'
        : 'It is a DBS share code, which the automatic check cannot verify. Please check it on the DBS update service.',
    );
    return;
  }
  if (!ctx.brain?.checkDocument) {
    await toOwner('The automatic check is not switched on, so a person needs to look at it.');
    return;
  }
  const photo = fileOf(document);
  if (!photo) {
    await toOwner('The photo is in a kind the automatic check cannot read.');
    return;
  }
  const today = ukDate(at);
  const reading = await ctx.brain.checkDocument({
    kind: document.kind,
    photo,
    accountName: runner.name,
    today,
  });
  if (!reading) {
    await toOwner('The automatic check could not read it.');
    return;
  }
  const concerns = documentConcerns(
    document,
    reading,
    runner.name,
    today,
    ctx.config.ownerDesk.checkConfidence,
  );
  if (concerns.length > 0) {
    await toOwner(sentence(concerns), reading.nameOnDocument);
    return;
  }
  await repository.runnerDocuments.update(document.id, {
    checkedAt: at,
    checkPassed: true,
    checkNote: null,
    checkName: reading.nameOnDocument,
  });
  await auditAutomatic(
    ctx,
    target,
    `${what}: every check clearly fine (confidence ${reading.confidence.toFixed(2)}); waiting for the rest of the application.`,
  );
  await checkApplication(ctx, runner.id, log);
}

/**
 * The whole application, once every document it needs is in: names compared across documents
 * and with the account, and the face photo with the photo on the ID (only with the Runner's
 * consent). All clear: every document read and passed is approved automatically.
 */
export async function checkApplication(
  ctx: CheckContext,
  runnerId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { repository } = ctx;
  const runner = await repository.runners.findById(runnerId);
  if (!runner) return;
  const documents = await repository.runnerDocuments.listForRunner(runnerId);
  const latest = new Map<RunnerDocument['kind'], RunnerDocument>();
  for (const document of documents)
    if (!latest.has(document.kind)) latest.set(document.kind, document);
  const needed = documentsNeeded(runner.travelModes);
  const current = needed.map((kind) => latest.get(kind));
  if (current.some((document) => !document || document.status === 'rejected')) return;
  const inHand = current as RunnerDocument[];
  const waiting = inHand.filter((document) => document.status === 'submitted');
  if (waiting.length === 0) return;
  // Anything already with the owner, or not read yet, holds the rest until it is decided.
  if (waiting.some((document) => document.checkPassed !== true)) return;

  const toOwner = async (reason: string): Promise<void> => {
    await askOwner(
      ctx,
      {
        kind: 'runner_application',
        subjectId: runner.id,
        summary: `Runner ${runner.name}'s documents each passed the automatic check, but ${reason}`,
        options: 'decide',
        again: true,
      },
      log,
    );
    await auditAutomatic(
      ctx,
      `runner=${runner.id}`,
      `Application not approved; asked the owner: ${reason}`,
    );
  };

  // The names, across the documents and with the account.
  const named = inHand.filter((document) => document.checkName);
  if (named.some((document) => !namesMatch(runner.name, document.checkName as string))) {
    await toOwner('the names on them do not all match the name on the account.');
    return;
  }

  // The face, with the photo on the ID, only with the Runner's agreement.
  const face = latest.get('face_photo');
  const passport = latest.get('right_to_work');
  const id = passport?.image ? passport : latest.get('driving_licence_front');
  const comparing =
    face?.image && id?.image && (waiting.includes(face) || waiting.includes(id))
      ? { face, id }
      : null;
  if (comparing) {
    if (!runner.faceMatchConsentAt) {
      await toOwner(
        'they did not agree to the automatic face comparison, so please compare the face photo with the photo on their ID yourself.',
      );
      return;
    }
    const facePhoto = photoOf(comparing.face);
    const idPhoto = photoOf(comparing.id);
    const reading =
      facePhoto && idPhoto && ctx.brain?.checkDocument
        ? await ctx.brain.checkDocument({
            kind: 'face_photo',
            photo: facePhoto,
            idPhoto,
            accountName: runner.name,
            today: ukDate(ctx.now()),
          })
        : null;
    if (reading?.samePerson === false) {
      await toOwner('the face photo and the photo on the ID do not appear to be the same person.');
      return;
    }
    if (
      !reading ||
      reading.samePerson !== true ||
      reading.confidence < ctx.config.ownerDesk.checkConfidence
    ) {
      await toOwner(
        'the automatic check could not be sure the face photo and the ID show the same person.',
      );
      return;
    }
  }

  for (const document of waiting) {
    const decided = await decideRunnerDocument(ctx, document, {
      decision: 'accept',
      by: AUTOMATIC,
      note: 'Approved by the automatic check.',
    });
    await settleMattersFor(ctx, 'runner_document', decided.id, 'automatic', AUTOMATIC);
    await auditAutomatic(
      ctx,
      `document=${decided.id}`,
      `Approved: ${KIND_SPOKEN[decided.kind]}. Every check clearly fine${comparing ? ', names match and the face matches the ID' : ', names match'}.`,
    );
  }
  await settleMattersFor(ctx, 'runner_application', runner.id, 'automatic', AUTOMATIC);
}

/* ------------------------------------------------------------------ Ambassador documents */

/** Which document the check is told to expect, for each Ambassador document and photo ID. */
function ambassadorAsked(document: AmbassadorDocument): CheckedDocumentKind | null {
  switch (document.kind) {
    case 'photo_id_front':
      return document.idType === 'driving_licence'
        ? 'ambassador_driving_licence'
        : document.idType === 'residence_card'
          ? 'ambassador_residence_card'
          : 'ambassador_passport';
    case 'photo_id_back':
      return 'ambassador_card_back';
    case 'proof_of_address':
      return 'ambassador_proof_of_address';
    case 'face_photo':
      return 'face_photo';
    case 'share_code':
      return null;
  }
}

/**
 * What stops an Ambassador's document being marked checked automatically (30 October 2026), the
 * same checks as a Runner's: the kind asked for, readable, in date, the name matching the
 * account, a clear real face; and for a proof of address, dated within the last
 * `addressWithinMonths` months. Empty means every check was clearly fine.
 */
export function ambassadorDocumentConcerns(
  document: Pick<AmbassadorDocument, 'kind'>,
  reading: DocumentReading,
  accountName: string,
  today: string,
  confidence: number,
  addressWithinMonths: number,
): string[] {
  const concerns: string[] = [];
  if (!reading.kindMatches) concerns.push('it does not look like the document that was asked for');
  if (!reading.readable) concerns.push('it is not clear enough to read');
  if (reading.expiresOn !== null && reading.expiresOn < today) concerns.push('it has expired');
  if (document.kind === 'photo_id_front' || document.kind === 'proof_of_address') {
    if (reading.nameOnDocument === null) concerns.push('no name can be read on it');
    else if (!namesMatch(accountName, reading.nameOnDocument)) {
      concerns.push('the name on it does not match the name on the account');
    }
  }
  if (document.kind === 'proof_of_address') {
    const issued = reading.issuedOn ?? null;
    if (issued === null) concerns.push('the date it was issued cannot be read');
    else if (!addressDateRecent(issued, today, addressWithinMonths)) {
      concerns.push(`it is not dated within the last ${addressWithinMonths} months`);
    }
  }
  if (document.kind === 'face_photo' && reading.clearRealFace !== true) {
    concerns.push('it is not clearly a photo of a real face');
  }
  if (concerns.length === 0 && reading.confidence < confidence) {
    concerns.push(
      reading.concern
        ? `the automatic check is not sure: ${reading.concern.replace(/\.$/, '').toLowerCase()}`
        : 'the automatic check is not sure enough about it',
    );
  }
  return concerns;
}

/**
 * Reads one document an Ambassador applicant sent, as a Runner's is read: clearly fine, it is
 * marked checked; anything unclear goes to staff on the Ambassadors page and to the owner's desk.
 * Nothing is refused automatically, and nobody is ever approved as an Ambassador by this: a person
 * presses "Approve" after the chat.
 */
export async function checkAmbassadorDocument(
  ctx: CheckContext,
  documentId: string,
  log?: FastifyBaseLogger,
): Promise<void> {
  const document = await ctx.repository.ambassadorDocuments.findById(documentId);
  if (!document || document.status !== 'submitted') return;
  if (document.kind === 'face_photo') {
    await checkAmbassadorFace(ctx, document, log);
    return;
  }
  await readAmbassadorDocument(ctx, document, log);
  // A face photo waiting for the photo ID to compare with is compared now.
  if (document.kind === 'photo_id_front') {
    const face = (await ctx.repository.ambassadorDocuments.listForAgreement(document.agreementId))
      .filter((one) => !one.erasedAt)
      .find((one) => one.kind === 'face_photo');
    if (face && face.status === 'submitted' && face.checkedAt === null) {
      await checkAmbassadorFace(ctx, face, log);
    }
  }
}

/**
 * An Ambassador applicant's face photo (Anthony, 31 October 2026). A face is special category
 * data, so it is compared with the photo on their ID automatically only after a clear yes to the
 * separate question, using the same comparison as a Runner's (no other service). With a no, or no
 * answer, nothing reads it: it waits for a person, marked "Check by a person: face not compared
 * automatically". With a yes but nothing to compare with yet, it waits for the ID; with no
 * automatic check switched on, or an ID that is a PDF, staff compare it by eye.
 */
async function checkAmbassadorFace(
  ctx: CheckContext,
  document: AmbassadorDocument,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { repository, config } = ctx;
  const agreement = await repository.ambassadors.findAgreementById(document.agreementId);
  const account = await findAccount(ctx, document.accountKind, document.accountId);
  if (!agreement || !account) return;
  const at = ctx.now();
  const target = `ambassador-document=${document.id}`;
  const forPerson = async (note: string): Promise<void> => {
    await repository.ambassadorDocuments.update(document.id, {
      checkedAt: at,
      checkPassed: false,
      checkNote: `${note}.`,
      checkName: null,
      checkIssuedOn: null,
    });
    await auditAutomatic(ctx, target, `Not compared automatically: ${note}.`);
  };
  if (agreement.faceCompareConsent !== true) {
    await forPerson(FACE_BY_PERSON_WORDS);
    return;
  }
  const id = (await repository.ambassadorDocuments.listForAgreement(document.agreementId))
    .filter((one) => !one.erasedAt && one.kind === 'photo_id_front' && one.status !== 'rejected')
    .at(0);
  // Nothing to compare with yet: it is compared when the photo ID comes.
  if (!id?.image) return;
  const facePhoto = photoOf(document);
  const idPhoto = photoOf(id);
  if (!ctx.brain?.checkDocument || !facePhoto || !idPhoto) {
    await forPerson(FACE_BY_EYE_WORDS);
    return;
  }
  const reading = await ctx.brain.checkDocument({
    kind: 'face_photo',
    photo: facePhoto,
    idPhoto,
    accountName: account.name,
    today: ukDate(at),
  });
  const reason =
    reading?.samePerson === false
      ? 'the face photo and the photo on the ID do not appear to be the same person.'
      : !reading ||
          reading.samePerson !== true ||
          reading.clearRealFace !== true ||
          reading.confidence < config.ownerDesk.checkConfidence
        ? 'the automatic check could not be sure the face photo and the ID show the same person.'
        : null;
  if (reason) {
    await repository.ambassadorDocuments.update(document.id, {
      checkedAt: at,
      checkPassed: false,
      checkNote: `Compared with their consent: ${reason}`,
      checkName: null,
      checkIssuedOn: null,
    });
    await askOwner(
      ctx,
      {
        kind: 'ambassador_document',
        subjectId: document.id,
        summary: `Ambassador applicant ${account.name}'s face photo needs you: ${reason}`,
        options: 'decide',
      },
      log,
    );
    await auditAutomatic(ctx, target, `Not marked checked; asked the owner. Face photo: ${reason}`);
    return;
  }
  await repository.ambassadorDocuments.update(document.id, {
    checkedAt: at,
    checkPassed: true,
    checkNote: null,
    checkName: null,
    checkIssuedOn: null,
  });
  const decided = await decideAmbassadorDocument(
    ctx,
    { ...document, checkPassed: true },
    {
      decision: 'accept',
      by: AUTOMATIC,
      note: 'Compared with the photo ID by the automatic check, with their consent.',
    },
    log,
  );
  await settleMattersFor(ctx, 'ambassador_document', decided.id, 'automatic', AUTOMATIC);
  await auditAutomatic(
    ctx,
    target,
    `Marked checked: face photo. Compared with the photo ID, with their consent (confidence ${reading!.confidence.toFixed(2)}).`,
  );
}

/** Reads one of an Ambassador applicant's documents other than the face photo. */
async function readAmbassadorDocument(
  ctx: CheckContext,
  document: AmbassadorDocument,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { repository, config } = ctx;
  const account = await findAccount(ctx, document.accountKind, document.accountId);
  if (!account) return;
  const at = ctx.now();
  const what = documentSpoken(document);
  const target = `ambassador-document=${document.id}`;

  const toOwner = async (reason: string, reading: DocumentReading | null = null) => {
    await repository.ambassadorDocuments.update(document.id, {
      checkedAt: at,
      checkPassed: false,
      checkNote: reason,
      checkName: reading?.nameOnDocument ?? null,
      checkIssuedOn: reading?.issuedOn ?? null,
    });
    await askOwner(
      ctx,
      {
        kind: 'ambassador_document',
        subjectId: document.id,
        summary: `Ambassador applicant ${account.name}'s ${what} needs you. ${reason}`,
        options: 'decide',
      },
      log,
    );
    await auditAutomatic(ctx, target, `Not marked checked; asked the owner. ${what}: ${reason}`);
  };

  const asked = ambassadorAsked(document);
  if (asked === null || (document.shareCode && !document.image)) {
    await toOwner(
      'It is a Home Office share code, which the automatic check cannot verify. Please check it on GOV.UK.',
    );
    return;
  }
  if (!ctx.brain?.checkDocument) {
    await toOwner('The automatic check is not switched on, so a person needs to look at it.');
    return;
  }
  const photo = fileOf(document);
  if (!photo) {
    await toOwner('The photo is in a kind the automatic check cannot read.');
    return;
  }
  const today = ukDate(at);
  const reading = await ctx.brain.checkDocument({
    kind: asked,
    photo,
    accountName: account.name,
    today,
  });
  if (!reading) {
    await toOwner('The automatic check could not read it.');
    return;
  }
  const concerns = ambassadorDocumentConcerns(
    document,
    reading,
    account.name,
    today,
    config.ownerDesk.checkConfidence,
    config.ambassador.addressWithinMonths,
  );
  if (concerns.length > 0) {
    await toOwner(sentence(concerns), reading);
    return;
  }
  await repository.ambassadorDocuments.update(document.id, {
    checkedAt: at,
    checkPassed: true,
    checkNote: null,
    checkName: reading.nameOnDocument,
    checkIssuedOn: reading.issuedOn ?? null,
  });
  const decided = await decideAmbassadorDocument(
    ctx,
    { ...document, checkPassed: true },
    { decision: 'accept', by: AUTOMATIC, note: 'Checked by the automatic check.' },
    log,
  );
  await settleMattersFor(ctx, 'ambassador_document', decided.id, 'automatic', AUTOMATIC);
  await auditAutomatic(
    ctx,
    target,
    `Marked checked: ${what}. Every check clearly fine (confidence ${reading.confidence.toFixed(2)}).`,
  );
}

/**
 * After a person decided a document in the Documents tab: what Ozi was to ring about for it is
 * settled, and the rest of the application may now be complete for the automatic check.
 */
export async function afterDocumentDecided(
  ctx: CheckContext,
  document: RunnerDocument,
  log?: FastifyBaseLogger,
): Promise<void> {
  await settleMattersFor(
    ctx,
    'runner_document',
    document.id,
    'panel',
    document.reviewedBy ?? 'Staff',
  );
  await checkInBackground(ctx, log, () => checkApplication(ctx, document.runnerId, log));
}

/* ------------------------------------------------------------------ shop products */

/** A shop's product or service, as it was sent or changed: approved, refused by rule, or asked. */
export async function checkPartnerProduct(
  ctx: CheckContext,
  productId: string,
  log?: FastifyBaseLogger,
  options: { edited?: boolean } = {},
): Promise<void> {
  const { repository, config } = ctx;
  const product = await repository.partnerProducts.findById(productId);
  if (!product || (product.status !== 'pending' && product.status !== 'approved')) return;
  if (product.status === 'approved' && !options.edited) return;
  const shop = await repository.partnerShops.findById(product.partnerShopId);
  if (!shop) return;
  const at = ctx.now();
  const money = formatPence(product.pricePence, config.store.currencySymbol);
  const isService = shop.kind === 'service';
  const target = `product=${product.id}`;

  // The rule lists first: a rule, not a judgement, so it may refuse by itself.
  const words = `${product.name} ${product.tags}`;
  const excluded = isService
    ? excludedServiceKind(words, config.extras.partners.excludedServiceKinds)
    : null;
  const rule = NEVER_FOUND.test(words)
    ? `${config.productName} never brings alcohol, tobacco, medicines, cash or anything age restricted.`
    : excluded
      ? excludedServiceWords(excluded, config.productName)
      : !isService && !productAllowed(product.pricePence, config.fees)
        ? `No single product may cost more than ${formatPence(config.fees.maximumProductPence, config.store.currencySymbol)}.`
        : null;
  if (rule) {
    if (product.status === 'pending')
      await decidePartnerProduct(ctx, product, { approve: false, note: rule });
    else await withdrawPartnerProduct(ctx, product, rule);
    await repository.partnerProducts.update(product.id, { checkedAt: at, checkNote: null });
    await auditAutomatic(ctx, target, `Refused by the rule lists: ${product.name}. ${rule}`);
    return;
  }

  const toOwner = async (reason: string): Promise<void> => {
    await repository.partnerProducts.update(product.id, { checkedAt: at, checkNote: reason });
    await askOwner(
      ctx,
      {
        kind: 'partner_product',
        subjectId: product.id,
        summary: `${shop.name} ${options.edited ? 'changed the price of' : 'added'} ${product.name}, ${isService ? 'from ' : ''}${money}. ${reason}`,
        options: 'decide',
        again: options.edited === true,
      },
      log,
    );
    await auditAutomatic(ctx, target, `Not approved; asked the owner: ${reason}`);
  };

  // A price the label did not show is only an estimate (ruling 75): the owner approves it.
  if (product.priceEstimated) {
    await toOwner('Its price is an estimate, because the label showed none. Approve the estimate?');
    return;
  }

  if (!ctx.brain?.checkProduct) {
    // A price change was never checked by a person before; without the model it goes live as it
    // always did. A new product waits for the owner.
    if (options.edited) return;
    await toOwner('The automatic check is not switched on, so a person needs to look at it.');
    return;
  }
  const photo =
    product.photo && readable(product.photoType)
      ? { data: Buffer.from(product.photo).toString('base64'), mediaType: product.photoType }
      : undefined;
  const reading = await ctx.brain.checkProduct({
    name: product.name,
    tags: product.tags,
    pricePence: product.pricePence,
    isService,
    ...(photo ? { photo } : {}),
  });
  if (!reading) {
    await toOwner('The automatic check could not look at it.');
    return;
  }
  const concerns: string[] = [];
  if (reading.verdict === 'restricted') concerns.push('it may be something we do not sell');
  if (reading.verdict === 'unsure') concerns.push('it is not clear what it is');
  if (reading.offensive) concerns.push('it may be offensive');
  if (reading.photoMatches === false) concerns.push('the photo may not match the name');
  if (!reading.priceSensible) concerns.push('the price may not be right');
  if (concerns.length === 0 && reading.confidence < config.ownerDesk.checkConfidence) {
    concerns.push('the automatic check is not sure enough about it');
  }
  if (concerns.length > 0) {
    await toOwner(`The automatic check was not sure: ${sentence(concerns).toLowerCase()}`);
    return;
  }
  if (product.status === 'pending') {
    await decidePartnerProduct(ctx, product, {
      approve: true,
      note: 'Approved by the automatic check.',
    });
  }
  await repository.partnerProducts.update(product.id, { checkedAt: at, checkNote: null });
  await settleMattersFor(ctx, 'partner_product', product.id, 'automatic', AUTOMATIC);
  await auditAutomatic(
    ctx,
    target,
    `${options.edited ? 'Change approved' : 'Approved'}: ${product.name}, ${money}. Allowed, price sensible${photo ? ', photo matches' : ''} (confidence ${reading.confidence.toFixed(2)}).`,
  );
}

/**
 * One pass when the server starts: documents and products already waiting, never read, are
 * checked now, so a Runner who sent everything before this was built is not left waiting.
 */
export async function checkWaiting(
  ctx: CheckContext,
  log?: FastifyBaseLogger,
): Promise<{
  documents: number;
  products: number;
}> {
  let documents = 0;
  let products = 0;
  for (const document of await ctx.repository.runnerDocuments.listSubmitted()) {
    if (document.checkedAt !== null) continue;
    await checkRunnerDocument(ctx, document.id, log).catch((failure: unknown) =>
      log?.error({ err: failure }, 'A waiting document could not be checked.'),
    );
    documents += 1;
  }
  // Ambassador applicants' documents too (30 October 2026).
  for (const document of await ctx.repository.ambassadorDocuments.listSubmitted()) {
    if (document.checkedAt !== null) continue;
    await checkAmbassadorDocument(ctx, document.id, log).catch((failure: unknown) =>
      log?.error({ err: failure }, 'A waiting Ambassador document could not be checked.'),
    );
    documents += 1;
  }
  for (const product of await ctx.repository.partnerProducts.listPending()) {
    if (product.checkedAt !== null) continue;
    await checkPartnerProduct(ctx, product.id, log).catch((failure: unknown) =>
      log?.error({ err: failure }, 'A waiting product could not be checked.'),
    );
    products += 1;
  }
  return { documents, products };
}
