/**
 * Applying to be an Ozi Ambassador (Anthony, 30 October 2026). The founder wants to know and trust
 * every Ambassador, so becoming one is no longer instant: a person applies, and is approved only
 * after their documents are checked and they have had a short chat with the founder.
 *
 * 1. They read and agree to the Ambassador terms: APPLIED.
 * 2. They send a photo ID (front, and back for a card), a proof of address dated within the last
 *    `addressWithinMonths` months, and a photo of their face; a Home Office share code if they
 *    are not British, if they like: DOCUMENTS SENT.
 * 3. The automatic check, or staff, accept each document: DOCUMENTS CHECKED.
 * 4. Staff record the chat with the founder: CHAT DONE.
 * 5. The founder or staff press "Approve": APPROVED. Nothing is ever approved by itself.
 *
 * Or DECLINED, with a reason the person sees, or SUSPENDED. Ambassadors who opted in before this
 * keep their link and their earnings as before, as DOCUMENTS NEEDED: the Toolkit and withdrawals
 * wait until they are approved.
 *
 * Every figure is in `ambassador` in config/store.json.
 */

export const AMBASSADOR_STATUSES = [
  'applied',
  'documents_sent',
  'documents_checked',
  'chat_done',
  'approved',
  'declined',
  'suspended',
  'documents_needed',
] as const;
export type AmbassadorStatus = (typeof AMBASSADOR_STATUSES)[number];

/** Each status, in the words the person and staff see. */
export const AMBASSADOR_STATUS_WORDS: Record<AmbassadorStatus, string> = {
  applied: 'Applied',
  documents_sent: 'Documents sent',
  documents_checked: 'Documents checked',
  chat_done: 'Chat done',
  approved: 'Approved',
  declined: 'Declined',
  suspended: 'Suspended',
  documents_needed: 'Documents needed',
};

/** Only an approved Ambassador has the Toolkit and can withdraw. */
export function ambassadorApproved(status: AmbassadorStatus | null | undefined): boolean {
  return status === 'approved';
}

/**
 * Whether their "Introduce a business" link ties a new business to them: an approved
 * Ambassador's, and a grandfathered one's (documents needed), whose link keeps working as before.
 */
export function ambassadorLinkWorks(status: AmbassadorStatus | null | undefined): boolean {
  return status === 'approved' || status === 'documents_needed';
}

/** Whether they are still applying, so they may send documents. */
export function ambassadorApplying(status: AmbassadorStatus | null | undefined): boolean {
  return (
    status === 'applied' ||
    status === 'documents_sent' ||
    status === 'documents_checked' ||
    status === 'chat_done' ||
    status === 'documents_needed'
  );
}

/** The kinds of document an applicant sends. */
export const AMBASSADOR_DOCUMENT_KINDS = [
  'photo_id_front',
  'photo_id_back',
  'proof_of_address',
  'face_photo',
  'share_code',
] as const;
export type AmbassadorDocumentKind = (typeof AMBASSADOR_DOCUMENT_KINDS)[number];

/** The photo IDs accepted: a passport, a driving licence or a biometric residence card. */
export const AMBASSADOR_ID_TYPES = ['passport', 'driving_licence', 'residence_card'] as const;
export type AmbassadorIdType = (typeof AMBASSADOR_ID_TYPES)[number];

export const AMBASSADOR_ID_WORDS: Record<AmbassadorIdType, string> = {
  passport: 'Passport',
  driving_licence: 'Driving licence',
  residence_card: 'Biometric residence card',
};

/** The proofs of address accepted. */
export const AMBASSADOR_ADDRESS_TYPES = ['utility_bill', 'bank_letter', 'council_tax'] as const;
export type AmbassadorAddressType = (typeof AMBASSADOR_ADDRESS_TYPES)[number];

export const AMBASSADOR_ADDRESS_WORDS: Record<AmbassadorAddressType, string> = {
  utility_bill: 'A utility bill',
  bank_letter: 'A bank letter or statement',
  council_tax: 'A council tax letter',
};

export const AMBASSADOR_DOCUMENT_WORDS: Record<AmbassadorDocumentKind, string> = {
  photo_id_front: 'Your photo ID, the front',
  photo_id_back: 'Your photo ID, the back',
  proof_of_address: 'Your proof of address',
  face_photo: 'A photo of your face',
  share_code: 'Your Home Office share code',
};

/**
 * The documents still needed: the front of the ID, the back too for a card (a driving licence or
 * a residence card, not a passport), the proof of address and the face photo. The share code is
 * optional, so it is never needed.
 */
export function ambassadorDocumentsNeeded(
  idType: AmbassadorIdType | null,
): AmbassadorDocumentKind[] {
  const needed: AmbassadorDocumentKind[] = ['photo_id_front'];
  if (idType !== 'passport') needed.push('photo_id_back');
  needed.push('proof_of_address', 'face_photo');
  return needed;
}

/**
 * Whether a proof of address dated `issuedOn` (YYYY-MM-DD) is within the last `months` months of
 * `today` (YYYY-MM-DD), and not dated in the future.
 */
export function addressDateRecent(issuedOn: string, today: string, months: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || issuedOn > today) return false;
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCMonth(earliest.getUTCMonth() - months);
  return issuedOn >= earliest.toISOString().slice(0, 10);
}

/** "Ada" from "Ada Obi": the first name a flyer says, "Your Ambassador: Ada". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}
