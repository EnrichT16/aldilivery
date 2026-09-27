/**
 * Approving Runners.
 *
 * A Runner is offered no job until a person has seen two things: their right to work in the
 * United Kingdom, and a criminal record check. Those decisions are made by a person reading a
 * document, never by software, so this does not decide anything. It records what a person
 * decided, who they were, when, and what they saw — and only then sets the flag the job
 * offers read.
 *
 * It is run by hand, from the DigitalOcean console, through `scripts/runners.mjs`. Everything
 * it does is here rather than in the script so that it is typechecked and proved by tests
 * against the same repository interface the server uses.
 *
 * Nothing happens without `--yes`. Without it, every command says exactly what it would
 * record and stops, the same way the test-row clean-up script does.
 */

import type { Runner, RunnerCheck, RunnerCheckKind } from '../domain.js';
import type { Repository } from '../data/repository.js';
import { ukPhone } from '../lib/phone.js';

const KINDS: Record<string, RunnerCheckKind> = {
  'right-to-work': 'right_to_work',
  'criminal-record': 'criminal_record',
};

const KIND_NAMES: Record<RunnerCheckKind, string> = {
  right_to_work: 'Right to work',
  criminal_record: 'Criminal record check',
};

export function isApproved(runner: Runner): boolean {
  return runner.rightToWorkVerified && runner.criminalRecordCheckVerified;
}

/**
 * Record one decision and set the flag to match. A withdrawal also takes the Runner off
 * shift, so nobody who has just lost an approval is left holding a place in the queue.
 */
export async function recordRunnerCheck(
  repository: Repository,
  input: Omit<RunnerCheck, 'id'>,
): Promise<Runner> {
  await repository.runnerChecks.create(input);
  const verified = input.outcome === 'verified';
  const flag =
    input.kind === 'right_to_work'
      ? { rightToWorkVerified: verified }
      : { criminalRecordCheckVerified: verified };
  return repository.runners.update(input.runnerId, verified ? flag : { ...flag, available: false });
}

export interface CommandDeps {
  repository: Repository;
  now: () => Date;
  write: (line: string) => void;
}

/** Runs one command. Returns the exit code: 0 for done, 1 for a problem it explained. */
export async function runRunnersCommand(argv: string[], deps: CommandDeps): Promise<number> {
  const [command = 'list', ...rest] = argv;
  const options = parseOptions(rest);
  const { write } = deps;

  try {
    switch (command) {
      case 'list':
        return await list(deps);
      case 'history':
        return await history(options, deps);
      case 'approve':
        return await decide('verified', options, deps);
      case 'withdraw':
        return await decide('withdrawn', options, deps);
      default:
        write(`There is no command called "${command}".`);
        write(USAGE);
        return 1;
    }
  } catch (failure) {
    write(`Nothing was recorded. ${failure instanceof Error ? failure.message : String(failure)}`);
    return 1;
  }
}

export const USAGE = [
  'What this can do:',
  '  node packages/api/scripts/runners.mjs',
  '      lists every Runner, and which checks each one has passed.',
  '  node packages/api/scripts/runners.mjs history --phone 07700900123',
  '      shows every check ever recorded for one Runner.',
  '  node packages/api/scripts/runners.mjs approve --phone 07700900123 --check right-to-work --evidence "Share code checked on GOV.UK" --by "Your name"',
  '      records that you have seen a document. Use --check criminal-record for the other one.',
  '  node packages/api/scripts/runners.mjs withdraw --phone 07700900123 --check criminal-record --reason "Why" --by "Your name"',
  '      takes an approval back, and takes the Runner off shift.',
  'Nothing is recorded until you add --yes to the end.',
].join('\n');

function parseOptions(args: string[]): Record<string, string | true> {
  const options: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function text(options: Record<string, string | true>, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function findRunner(options: Record<string, string | true>, deps: CommandDeps) {
  const typed = text(options, 'phone');
  if (!typed) throw new Error('Say which Runner with --phone and their phone number.');
  const phone = ukPhone(typed);
  const runner =
    (phone ? await deps.repository.runners.findByPhone(phone) : null) ??
    (await deps.repository.runners.findByPhone(typed));
  if (!runner) throw new Error(`There is no Runner on ${typed}.`);
  return runner;
}

async function describeCheck(runner: Runner, kind: RunnerCheckKind, deps: CommandDeps) {
  const passed =
    kind === 'right_to_work' ? runner.rightToWorkVerified : runner.criminalRecordCheckVerified;
  if (!passed) return `${KIND_NAMES[kind]}: not yet.`;
  const checks = await deps.repository.runnerChecks.listForRunner(runner.id);
  const last = checks.filter((c) => c.kind === kind && c.outcome === 'verified').at(-1);
  return last
    ? `${KIND_NAMES[kind]}: seen on ${day(last.checkedAt)} by ${last.checkedBy} (${last.evidence}).`
    : `${KIND_NAMES[kind]}: passed, with no record of who checked it.`;
}

async function list(deps: CommandDeps): Promise<number> {
  const runners = await deps.repository.runners.listAll();
  if (runners.length === 0) {
    deps.write('There are no Runners yet.');
    return 0;
  }
  const waiting = runners.filter((r) => !isApproved(r)).length;
  deps.write(
    `${runners.length} Runner${runners.length === 1 ? '' : 's'}: ${runners.length - waiting} approved, ${waiting} waiting.`,
  );
  for (const runner of runners) {
    deps.write('');
    deps.write(
      `${runner.name}, ${runner.phone}, ${runner.vehicleType.replace('_', ' ')}, signed up ${day(runner.createdAt)}. ${isApproved(runner) ? 'Approved.' : 'Waiting.'}`,
    );
    deps.write(`  ${await describeCheck(runner, 'right_to_work', deps)}`);
    deps.write(`  ${await describeCheck(runner, 'criminal_record', deps)}`);
  }
  return 0;
}

async function history(options: Record<string, string | true>, deps: CommandDeps): Promise<number> {
  const runner = await findRunner(options, deps);
  const checks = await deps.repository.runnerChecks.listForRunner(runner.id);
  deps.write(`${runner.name}, ${runner.phone}. ${isApproved(runner) ? 'Approved.' : 'Waiting.'}`);
  if (checks.length === 0) {
    deps.write('No checks have been recorded.');
    return 0;
  }
  for (const check of checks) {
    const what = check.outcome === 'verified' ? 'seen' : 'withdrawn';
    deps.write(
      `  ${day(check.checkedAt)}: ${KIND_NAMES[check.kind]} ${what} by ${check.checkedBy}. ${check.evidence}${check.note ? ` Note: ${check.note}` : ''}`,
    );
  }
  return 0;
}

async function decide(
  outcome: 'verified' | 'withdrawn',
  options: Record<string, string | true>,
  deps: CommandDeps,
): Promise<number> {
  const runner = await findRunner(options, deps);

  const kindName = text(options, 'check');
  const kind = kindName ? KINDS[kindName] : undefined;
  if (!kind) {
    throw new Error(
      'Say which check with --check right-to-work or --check criminal-record. One at a time, because each needs its own evidence.',
    );
  }

  const checkedBy = text(options, 'by');
  if (!checkedBy) throw new Error('Say who made this check with --by and your name.');

  const evidence = text(options, outcome === 'verified' ? 'evidence' : 'reason');
  if (!evidence) {
    throw new Error(
      outcome === 'verified'
        ? 'Say what you saw with --evidence, for example "Share code checked on GOV.UK" or "Basic DBS certificate". Do not type the whole document number, only enough to find it again.'
        : 'Say why with --reason.',
    );
  }

  const summary =
    outcome === 'verified'
      ? `${KIND_NAMES[kind]} for ${runner.name} (${runner.phone}), seen by ${checkedBy}: ${evidence}.`
      : `${KIND_NAMES[kind]} for ${runner.name} (${runner.phone}) withdrawn by ${checkedBy}: ${evidence}.`;

  if (options['yes'] !== true) {
    deps.write(`This would record: ${summary}`);
    deps.write('Nothing has been recorded. Run it again with --yes on the end to go ahead.');
    return 0;
  }

  const updated = await recordRunnerCheck(deps.repository, {
    runnerId: runner.id,
    kind,
    outcome,
    evidence,
    checkedBy,
    note: text(options, 'note') ?? '',
    checkedAt: deps.now(),
  });

  deps.write(`Recorded: ${summary}`);
  if (outcome === 'withdrawn') {
    deps.write(`${runner.name} can no longer be offered jobs, and has been taken off shift.`);
  } else if (isApproved(updated)) {
    deps.write(`${runner.name} has passed both checks and can now be offered jobs when on shift.`);
  } else {
    const missing = updated.rightToWorkVerified ? 'criminal record check' : 'right to work';
    deps.write(`${runner.name} still needs the ${missing} before they can be offered any job.`);
  }
  return 0;
}
