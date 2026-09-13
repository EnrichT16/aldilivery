/**
 * Applying migrations on a managed database that may not be ready yet.
 *
 * The first DigitalOcean deployment failed with Prisma error P3009: the initial migration
 * was recorded as failed because the attempt was interrupted while the database was still
 * being provisioned, and from then on every deploy refused to do anything. These tests prove
 * the way out of that, and — just as importantly — that the way out never reaches for a
 * command that would throw somebody's data away.
 *
 * Nothing here runs Prisma, touches a database, or waits ten seconds. The command runner,
 * the log and the clock are all injected.
 */

import { describe, expect, it } from 'vitest';

import {
  applyMigrations,
  firstMeaningfulLine,
  parseFailedMigrations,
  DEFAULT_ATTEMPTS,
  type CommandResult,
} from '../src/lib/migrations.js';

const FAILED = '20260909000000_init';

function ok(stdout = ''): CommandResult {
  return { status: 0, stdout, stderr: '' };
}

function fail(stderr: string, status = 1): CommandResult {
  return { status, stdout: '', stderr };
}

/** What `prisma migrate status` says when a migration is recorded as failed. */
const STATUS_WITH_FAILURE = `
1 migration found in prisma/migrations

Following migration have failed:
${FAILED}

During development you can run prisma migrate dev to fix this.
`;

/** What `prisma migrate deploy` says when it refuses because of that record. */
const P3009 = `
Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied.
The \`${FAILED}\` migration started at 2026-09-12 21:04:11 UTC failed
`;

/**
 * A scripted Prisma. Each call is recorded, and the answer is whatever the queue says, so a
 * test can describe a database that fails twice and then works.
 */
function scriptedPrisma(answers: Array<(args: readonly string[]) => CommandResult>) {
  const calls: string[][] = [];
  let index = 0;

  return {
    calls,
    run: (args: readonly string[]): CommandResult => {
      calls.push([...args]);
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer ? answer(args) : ok();
    },
  };
}

/** A recorder for the injected log and clock. */
function recorder() {
  const lines: string[] = [];
  const waits: number[] = [];
  return {
    lines,
    waits,
    log: (message: string) => {
      lines.push(message);
    },
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  };
}

describe('reading which migrations the database has recorded as failed', () => {
  it('reads the name from the wording migrate status uses', () => {
    expect(parseFailedMigrations(STATUS_WITH_FAILURE)).toEqual([FAILED]);
  });

  it('reads the name out of the P3009 error from migrate deploy', () => {
    expect(parseFailedMigrations(P3009)).toEqual([FAILED]);
  });

  it('reads the other wording Prisma has used for the same thing', () => {
    const output = `The following migrations have failed:\n\n${FAILED}\n20260910120000_add_sets\n`;
    expect(parseFailedMigrations(output)).toEqual([FAILED, '20260910120000_add_sets']);
  });

  it('finds nothing in a healthy status, so nothing is resolved that did not fail', () => {
    const healthy = '1 migration found in prisma/migrations\n\nDatabase schema is up to date!';
    expect(parseFailedMigrations(healthy)).toEqual([]);
  });

  it('ignores anything that is not shaped like a migration name', () => {
    // Acting on a misread name is worse than missing one.
    const noisy = 'Following migrations have failed:\nsomething the tool said\n';
    expect(parseFailedMigrations(noisy)).toEqual([]);
  });

  it('names each failed migration once, however many times it is mentioned', () => {
    expect(parseFailedMigrations(`${STATUS_WITH_FAILURE}\n${P3009}`)).toEqual([FAILED]);
  });
});

/** What the Prisma command line really prints when it cannot reach the database. */
const UNREACHABLE = `Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "aldilivery", schema "public" at "db:25060"
warn The configuration property \`package.json#prisma\` is deprecated and will be removed in Prisma 7.
For more information, see: https://pris.ly/prisma-config

Error: P1001: Can't reach database server at \`db:25060\`

Please make sure your database server is running at \`db:25060\`.`;

describe('saying what went wrong', () => {
  it('reports the error, not the deprecation warning printed above it', () => {
    // Reporting the warning instead sends whoever reads the deployment log looking in
    // entirely the wrong place.
    const message = firstMeaningfulLine(fail(UNREACHABLE));

    expect(message).toContain('P1001');
    expect(message).toContain("Can't reach database server");
    expect(message).not.toContain('deprecated');
  });

  it('reports the P3009 code when that is the failure', () => {
    expect(firstMeaningfulLine(fail(P3009))).toContain('P3009');
  });

  it('skips the box advertising a new version of Prisma', () => {
    const noisy = fail(
      ['┌──────────────┐', '│ Update available │', '└──────────────┘', 'something real'].join('\n'),
    );
    expect(firstMeaningfulLine(noisy)).toBe('something real');
  });

  it('falls back to the exit code when the command said nothing at all', () => {
    expect(firstMeaningfulLine({ status: 137, stdout: '', stderr: '' })).toContain('137');
  });

  it('puts the real error into the sentence it logs between attempts', async () => {
    const prisma = scriptedPrisma([() => fail(UNREACHABLE)]);
    const log = recorder();

    await applyMigrations({
      run: prisma.run,
      log: log.log,
      wait: log.wait,
      attempts: 2,
      waitMilliseconds: 1,
    });

    const said = log.lines.join('\n');
    expect(said).toContain('P1001');
    expect(said).not.toContain('deprecated');
  });
});

describe('the ordinary case', () => {
  it('checks the status, then deploys, and does not resolve anything', async () => {
    const prisma = scriptedPrisma([() => ok('Database schema is up to date!'), () => ok()]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.attemptsUsed).toBe(1);
    expect(outcome.rolledBack).toEqual([]);
    expect(prisma.calls).toEqual([
      ['migrate', 'status'],
      ['migrate', 'deploy'],
    ]);
    expect(log.waits).toEqual([]);
  });

  it('does not treat a non-zero exit from migrate status as a failure', async () => {
    // `migrate status` exits non-zero whenever anything is pending, which is the ordinary
    // case on a first deployment rather than an error.
    const prisma = scriptedPrisma([
      () => fail('1 migration found\n\nDatabase schema is not up to date', 1),
      () => ok(),
    ]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.attemptsUsed).toBe(1);
  });
});

describe('P3009: a migration recorded as failed', () => {
  it('marks it rolled back and then deploys, in that order', async () => {
    const prisma = scriptedPrisma([
      () => ok(STATUS_WITH_FAILURE),
      () => ok(),
      () => ok(),
    ]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.rolledBack).toEqual([FAILED]);
    expect(prisma.calls).toEqual([
      ['migrate', 'status'],
      ['migrate', 'resolve', '--rolled-back', FAILED],
      ['migrate', 'deploy'],
    ]);
  });

  it('says so in a plain sentence, naming the migration and promising no data is lost', async () => {
    const prisma = scriptedPrisma([() => ok(STATUS_WITH_FAILURE), () => ok(), () => ok()]);
    const log = recorder();

    await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    const said = log.lines.join('\n');
    expect(said).toContain(FAILED);
    expect(said).toMatch(/rolled back/i);
    expect(said).toMatch(/deletes no data/i);
  });

  it('resolves every failed migration, not only the first', async () => {
    const two = `Following migrations have failed:\n${FAILED}\n20260910120000_add_sets\n`;
    const prisma = scriptedPrisma([() => ok(two), () => ok(), () => ok(), () => ok()]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.rolledBack).toEqual([FAILED, '20260910120000_add_sets']);
    expect(prisma.calls).toEqual([
      ['migrate', 'status'],
      ['migrate', 'resolve', '--rolled-back', FAILED],
      ['migrate', 'resolve', '--rolled-back', '20260910120000_add_sets'],
      ['migrate', 'deploy'],
    ]);
  });

  it('recovers when the failure only shows up in the P3009 from deploy', async () => {
    // The first status came back clean because the database was not reachable yet; the
    // deploy is what reported the failed record, and the next attempt acts on it.
    let call = 0;
    const prisma = scriptedPrisma([
      (args) => {
        call += 1;
        if (args[1] === 'status') return call === 1 ? ok('') : ok(STATUS_WITH_FAILURE);
        if (args[1] === 'resolve') return ok();
        return call <= 2 ? fail(P3009) : ok();
      },
    ]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.rolledBack).toEqual([FAILED]);
    expect(outcome.attemptsUsed).toBe(2);
  });
});

describe('a database that is not ready yet', () => {
  it('tries again after waiting, and succeeds when the database comes up', async () => {
    let call = 0;
    const prisma = scriptedPrisma([
      (args) => {
        if (args[1] === 'status') return fail("Can't reach database server");
        call += 1;
        return call < 3 ? fail("Can't reach database server at aldilivery-db:25060") : ok();
      },
    ]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.attemptsUsed).toBe(3);
    expect(log.waits).toEqual([10_000, 10_000]);
  });

  it('waits ten seconds between attempts, five attempts in all, then gives up', async () => {
    const prisma = scriptedPrisma([() => fail("Can't reach database server")]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(false);
    expect(outcome.attemptsUsed).toBe(DEFAULT_ATTEMPTS);
    expect(DEFAULT_ATTEMPTS).toBe(5);
    // Four waits, not five: there is no point waiting after the last attempt.
    expect(log.waits).toEqual([10_000, 10_000, 10_000, 10_000]);
    expect(outcome.lastFailure).toContain('reach database server');
  });

  it('tries again when it is the resolve itself that cannot reach the database', async () => {
    let call = 0;
    const prisma = scriptedPrisma([
      (args) => {
        if (args[1] === 'status') return ok(STATUS_WITH_FAILURE);
        if (args[1] === 'resolve') {
          call += 1;
          return call === 1 ? fail("Can't reach database server") : ok();
        }
        return ok();
      },
    ]);
    const log = recorder();

    const outcome = await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    expect(outcome.applied).toBe(true);
    expect(outcome.rolledBack).toEqual([FAILED]);
    expect(outcome.attemptsUsed).toBe(2);
  });

  it('does not deploy in an attempt whose resolve failed, so nothing runs on a half cleared record', async () => {
    const prisma = scriptedPrisma([
      (args) => {
        if (args[1] === 'status') return ok(STATUS_WITH_FAILURE);
        if (args[1] === 'resolve') return fail("Can't reach database server");
        return ok();
      },
    ]);
    const log = recorder();

    await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait, attempts: 1 });

    expect(prisma.calls.map((call) => call[1])).toEqual(['status', 'resolve']);
  });

  it('honours a shorter retry setting, so a test never really waits', async () => {
    const prisma = scriptedPrisma([() => fail('nope')]);
    const log = recorder();

    const outcome = await applyMigrations({
      run: prisma.run,
      log: log.log,
      wait: log.wait,
      attempts: 2,
      waitMilliseconds: 1,
    });

    expect(outcome.attemptsUsed).toBe(2);
    expect(log.waits).toEqual([1]);
  });
});

describe('nothing here can destroy data', () => {
  it('never runs a command that resets, drops or force pushes a schema', async () => {
    // The tempting fix for P3009 is `migrate reset`, which drops every table and everything
    // in them. On a production database that is somebody's orders. It must never appear.
    let call = 0;
    const prisma = scriptedPrisma([
      (args) => {
        if (args[1] === 'status') return ok(STATUS_WITH_FAILURE);
        if (args[1] === 'resolve') return ok();
        call += 1;
        return call < 2 ? fail(P3009) : ok();
      },
    ]);
    const log = recorder();

    await applyMigrations({ run: prisma.run, log: log.log, wait: log.wait });

    const everything = prisma.calls.flat().join(' ');
    expect(everything).not.toMatch(/reset/i);
    expect(everything).not.toMatch(/--force/i);
    expect(everything).not.toMatch(/\bdb\b\s+push/i);
    expect(everything).not.toMatch(/drop/i);

    // The only thing it is ever allowed to resolve is a rolled back record, never
    // `--applied`, which would tell Prisma a migration ran when it did not.
    for (const call of prisma.calls) {
      if (call[1] === 'resolve') expect(call).toContain('--rolled-back');
    }
  });
});
