/**
 * Applying to be an Ozi Ambassador (Anthony, 30 October 2026): the statuses and what each one
 * unlocks, the documents needed for each kind of photo ID, and the three-month proof of address.
 */

import { describe, expect, it } from 'vitest';

import {
  addressDateRecent,
  AMBASSADOR_STATUS_WORDS,
  ambassadorApplying,
  ambassadorApproved,
  ambassadorDocumentsNeeded,
  ambassadorLinkWorks,
  firstNameOf,
} from '../src/ambassador-applications.js';

describe('an Ambassador application', () => {
  it('has the statuses the founder named, in plain words', () => {
    expect(Object.values(AMBASSADOR_STATUS_WORDS)).toEqual([
      'Applied',
      'Documents sent',
      'Documents checked',
      'Chat done',
      'Approved',
      'Declined',
      'Suspended',
      'Documents needed',
    ]);
  });

  it('unlocks the Toolkit and withdrawals only once approved; a grandfathered link keeps working', () => {
    expect(ambassadorApproved('approved')).toBe(true);
    for (const status of ['applied', 'chat_done', 'documents_needed', 'suspended'] as const) {
      expect(ambassadorApproved(status)).toBe(false);
    }
    expect(ambassadorLinkWorks('approved')).toBe(true);
    expect(ambassadorLinkWorks('documents_needed')).toBe(true);
    expect(ambassadorLinkWorks('applied')).toBe(false);
    expect(ambassadorLinkWorks('suspended')).toBe(false);
    expect(ambassadorLinkWorks('declined')).toBe(false);
    expect(ambassadorApplying('documents_needed')).toBe(true);
    expect(ambassadorApplying('declined')).toBe(false);
  });

  it('asks for the back of a card, but not of a passport', () => {
    expect(ambassadorDocumentsNeeded('passport')).toEqual([
      'photo_id_front',
      'proof_of_address',
      'face_photo',
    ]);
    expect(ambassadorDocumentsNeeded('driving_licence')).toEqual([
      'photo_id_front',
      'photo_id_back',
      'proof_of_address',
      'face_photo',
    ]);
    expect(ambassadorDocumentsNeeded('residence_card')).toContain('photo_id_back');
  });

  it('takes a proof of address dated within the last 3 months, never one from the future', () => {
    expect(addressDateRecent('2026-08-01', '2026-10-30', 3)).toBe(true);
    expect(addressDateRecent('2026-07-30', '2026-10-30', 3)).toBe(true);
    expect(addressDateRecent('2026-07-29', '2026-10-30', 3)).toBe(false);
    expect(addressDateRecent('2026-11-01', '2026-10-30', 3)).toBe(false);
    expect(addressDateRecent('not a date', '2026-10-30', 3)).toBe(false);
  });

  it('says the first name on a flyer', () => {
    expect(firstNameOf('  Ada Obi ')).toBe('Ada');
  });
});
