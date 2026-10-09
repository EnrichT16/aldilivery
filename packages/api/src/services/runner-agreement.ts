/**
 * Agreeing to the Runner agreement before the first job (ruling 55, 9 October 2026).
 *
 * The agreement says what a Runner is paid, how they are paid back for the shopping, the cool
 * bag deposit and the small recovery after a person's decision. That recovery is only lawful
 * if it was agreed in writing before the work (docs/LEGAL_REVIEW.md), so the agreement is
 * recorded with the date, the version and how it was given (a tick on the screen, or a spoken
 * yes), and no job can be accepted, or is even offered, until the current version is agreed.
 */

import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';
import { z } from 'zod';

import type { Runner } from '../domain.js';
import { BadRequestError } from '../errors.js';

export const agreementSchema = z.object({
  accepted: z.literal(true, {
    errorMap: () => ({ message: 'Please say you agree to the Runner agreement.' }),
  }),
  /** The version the Runner was shown, so an old page cannot agree to a newer agreement. */
  version: z.string().trim().min(1).max(40),
  channel: z.enum(['button', 'voice']).default('button'),
});

export type AgreementInput = z.infer<typeof agreementSchema>;

/** Whether this Runner has agreed to the agreement as it stands today. */
export function hasAgreed(
  runner: Pick<Runner, 'agreementAcceptedAt' | 'agreementVersion'>,
): boolean {
  return (
    runner.agreementAcceptedAt !== null && runner.agreementVersion === RUNNER_AGREEMENT_VERSION
  );
}

/** What is written on the Runner's account when they agree. */
export function agreementRecord(
  input: AgreementInput,
  at: Date,
): Pick<Runner, 'agreementAcceptedAt' | 'agreementVersion' | 'agreementChannel'> {
  if (input.version !== RUNNER_AGREEMENT_VERSION) {
    throw new BadRequestError(
      'The Runner agreement has changed since this page was opened. Please read it again and agree to the new version.',
    );
  }
  return {
    agreementAcceptedAt: at,
    agreementVersion: input.version,
    agreementChannel: input.channel,
  };
}

export const AGREE_FIRST =
  'Please read and agree to the Runner agreement before you take a job. It is on your Runner page.';
