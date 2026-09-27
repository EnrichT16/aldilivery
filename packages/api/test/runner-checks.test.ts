/**
 * Approving Runners: the tool Anthony runs from the DigitalOcean console.
 *
 * Until 27 Sep 2026 nothing could approve a Runner at all, so no order could ever be
 * delivered. These prove that a person's decision is recorded with who made it, when and on
 * the strength of what, that nothing happens without --yes, that each check is separate, and
 * that the job queue follows the result.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { isEligible } from '../src/services/allocation.js';
import { runRunnersCommand } from '../src/services/runner-checks.js';
import { buildTestApp, signUpRunner, type TestHarness } from './helpers.js';

let harness: TestHarness;
let output: string[];

beforeEach(async () => {
  harness = await buildTestApp();
  output = [];
});

function run(...argv: string[]) {
  return runRunnersCommand(argv, {
    repository: harness.repository,
    now: harness.now,
    write: (line) => output.push(line),
  });
}

async function newRunner(phone = '+447700900101') {
  const { runnerId } = await signUpRunner(harness, { phone, verified: false });
  return runnerId;
}

const APPROVE_RTW = [
  'approve',
  '--phone',
  '07700 900101',
  '--check',
  'right-to-work',
  '--evidence',
  'Share code checked on GOV.UK',
  '--by',
  'Anthony Ibe',
];
const APPROVE_DBS = [
  'approve',
  '--phone',
  '07700 900101',
  '--check',
  'criminal-record',
  '--evidence',
  'Basic DBS certificate ending 4417',
  '--by',
  'Anthony Ibe',
];

describe('listing Runners', () => {
  it('says so when there are none', async () => {
    expect(await run()).toBe(0);
    expect(output).toEqual(['There are no Runners yet.']);
  });

  it('shows who is waiting and which checks are missing', async () => {
    await newRunner();
    expect(await run('list')).toBe(0);
    expect(output.join('\n')).toContain('1 Runner: 0 approved, 1 waiting.');
    expect(output.join('\n')).toContain('Tomasz, +447700900101, car');
    expect(output.join('\n')).toContain('Right to work: not yet.');
    expect(output.join('\n')).toContain('Criminal record check: not yet.');
  });
});

describe('approving', () => {
  it('records nothing without --yes, and says what it would record', async () => {
    const id = await newRunner();
    expect(await run(...APPROVE_RTW)).toBe(0);

    expect(output[0]).toBe(
      'This would record: Right to work for Tomasz (+447700900101), seen by Anthony Ibe: Share code checked on GOV.UK.',
    );
    expect((await harness.repository.runners.findById(id))!.rightToWorkVerified).toBe(false);
    expect(await harness.repository.runnerChecks.listForRunner(id)).toEqual([]);
  });

  it('records who, when and what was seen, and sets only that check', async () => {
    const id = await newRunner();
    expect(await run(...APPROVE_RTW, '--yes')).toBe(0);

    const runner = (await harness.repository.runners.findById(id))!;
    expect(runner.rightToWorkVerified).toBe(true);
    expect(runner.criminalRecordCheckVerified).toBe(false);
    expect(await harness.repository.runnerChecks.listForRunner(id)).toEqual([
      expect.objectContaining({
        kind: 'right_to_work',
        outcome: 'verified',
        evidence: 'Share code checked on GOV.UK',
        checkedBy: 'Anthony Ibe',
        checkedAt: harness.now(),
      }),
    ]);
    expect(output.at(-1)).toBe(
      'Tomasz still needs the criminal record check before they can be offered any job.',
    );
  });

  it('makes a Runner eligible for jobs only once both checks are recorded', async () => {
    const id = await newRunner();
    await harness.repository.runners.update(id, { available: true });

    await run(...APPROVE_RTW, '--yes');
    expect(isEligible((await harness.repository.runners.findById(id))!)).toBe(false);

    await run(...APPROVE_DBS, '--yes');
    expect(isEligible((await harness.repository.runners.findById(id))!)).toBe(true);
    expect(output.at(-1)).toBe(
      'Tomasz has passed both checks and can now be offered jobs when on shift.',
    );
  });

  it('shows the approval in the list, with who checked it', async () => {
    await newRunner();
    await run(...APPROVE_RTW, '--yes');
    await run(...APPROVE_DBS, '--yes');
    output = [];

    await run('list');
    expect(output.join('\n')).toContain('1 Runner: 1 approved, 0 waiting.');
    expect(output.join('\n')).toContain(
      'Right to work: seen on 2026-09-09 by Anthony Ibe (Share code checked on GOV.UK).',
    );
  });

  it('insists on evidence, a name and one named check', async () => {
    await newRunner();
    const base = ['approve', '--phone', '07700 900101', '--yes'];

    expect(await run(...base, '--by', 'A', '--evidence', 'x')).toBe(1);
    expect(output.at(-1)).toMatch(/--check right-to-work or --check criminal-record/);

    expect(await run(...base, '--check', 'both', '--by', 'A', '--evidence', 'x')).toBe(1);
    expect(await run(...base, '--check', 'right-to-work', '--evidence', 'x')).toBe(1);
    expect(output.at(-1)).toMatch(/--by/);

    expect(await run(...base, '--check', 'right-to-work', '--by', 'A')).toBe(1);
    expect(output.at(-1)).toMatch(/--evidence/);

    expect(output.every((line) => !line.startsWith('Recorded'))).toBe(true);
  });

  it('says plainly when there is no such Runner', async () => {
    expect(await run(...APPROVE_RTW, '--yes')).toBe(1);
    expect(output.at(-1)).toBe('Nothing was recorded. There is no Runner on 07700 900101.');
  });
});

describe('withdrawing', () => {
  it('takes the approval back, takes the Runner off shift, and keeps the history', async () => {
    const id = await newRunner();
    await run(...APPROVE_RTW, '--yes');
    await run(...APPROVE_DBS, '--yes');
    await harness.repository.runners.update(id, { available: true });

    const code = await run(
      'withdraw',
      '--phone',
      '+44 7700 900101',
      '--check',
      'criminal-record',
      '--reason',
      'Certificate found to be for someone else',
      '--by',
      'Anthony Ibe',
      '--yes',
    );
    expect(code).toBe(0);

    const runner = (await harness.repository.runners.findById(id))!;
    expect(runner.criminalRecordCheckVerified).toBe(false);
    expect(runner.available).toBe(false);
    expect(isEligible(runner)).toBe(false);

    const checks = await harness.repository.runnerChecks.listForRunner(id);
    expect(checks.map((c) => `${c.kind} ${c.outcome}`)).toEqual([
      'right_to_work verified',
      'criminal_record verified',
      'criminal_record withdrawn',
    ]);

    output = [];
    await run('history', '--phone', '07700900101');
    expect(output.join('\n')).toContain(
      'Criminal record check withdrawn by Anthony Ibe. Certificate found to be for someone else',
    );
  });
});
