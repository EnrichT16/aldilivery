/**
 * Deciding a Runner's document: the one place it is done, whoever decides (ruling 74). Staff in
 * the Documents tab, the owner on Ozi's call with the keypad, and the automatic check (which only
 * ever accepts) all come through `decideRunnerDocument`, so what follows a decision is the same
 * each time: the photo is removed (apart from an accepted face photo, which the Shopper sees at
 * the door), the record of the check is written, and a licence or insurance switches driving on.
 */

import type { AppContext } from '../app.js';
import type { RunnerDocument, RunnerDocumentKind } from '../domain.js';
import { ConflictError } from '../errors.js';
import { recordRunnerCheck } from './runner-checks.js';

export const KIND_WORDS: Record<RunnerDocumentKind, string> = {
  face_photo: 'A photo of your face',
  right_to_work: 'Your right to work in the UK',
  dbs: 'Your DBS certificate',
  driving_licence_front: 'The front of your driving licence',
  driving_licence_back: 'The back of your driving licence',
  insurance: 'Your motor insurance certificate',
};

/** The same, for the owner's ear: "their DBS certificate". */
export const KIND_SPOKEN: Record<RunnerDocumentKind, string> = {
  face_photo: 'face photo',
  right_to_work: 'right to work',
  dbs: 'DBS certificate',
  driving_licence_front: 'driving licence, front',
  driving_licence_back: 'driving licence, back',
  insurance: 'motor insurance certificate',
};

export interface DocumentDecision {
  decision: 'accept' | 'reject';
  /** The name recorded as having decided. */
  by: string;
  note?: string | null;
  expiresOn?: Date | null;
}

export async function decideRunnerDocument(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  document: RunnerDocument,
  input: DocumentDecision,
): Promise<RunnerDocument> {
  const { repository } = ctx;
  if (document.status !== 'submitted') throw new ConflictError('That has already been decided.');
  const at = ctx.now();
  const expiresOn = input.expiresOn ?? document.expiresOn;
  const accept = input.decision === 'accept';

  const decided = await repository.runnerDocuments.update(document.id, {
    status: accept ? 'accepted' : 'rejected',
    reviewNote: input.note ?? null,
    reviewedBy: input.by,
    reviewedAt: at,
    expiresOn,
    // Kept only until decided, apart from the face photo the Shopper sees at the door.
    ...(document.kind === 'face_photo' && accept ? {} : { image: null, contentType: null }),
  });

  if (accept) {
    const evidence = `${KIND_WORDS[document.kind]}, ${document.shareCode ? `share code ending ${document.shareCode.slice(-4)}` : 'photo'}, seen in the app`;
    if (document.kind === 'right_to_work' || document.kind === 'dbs') {
      await recordRunnerCheck(repository, {
        runnerId: document.runnerId,
        kind: document.kind === 'right_to_work' ? 'right_to_work' : 'criminal_record',
        outcome: 'verified',
        evidence,
        checkedBy: input.by,
        note: input.note ?? '',
        checkedAt: at,
      });
    } else if (
      document.kind === 'driving_licence_front' ||
      document.kind === 'driving_licence_back'
    ) {
      const documents = await repository.runnerDocuments.listForRunner(document.runnerId);
      const bothSides = ['driving_licence_front', 'driving_licence_back'].every((kind) =>
        documents.some((d) => d.kind === kind && d.status === 'accepted'),
      );
      if (bothSides) {
        await repository.runners.update(document.runnerId, { drivingLicenceVerified: true });
      }
    } else if (document.kind === 'insurance') {
      await repository.runners.update(document.runnerId, { motorInsuranceUntil: expiresOn });
    }
  }
  return decided;
}
