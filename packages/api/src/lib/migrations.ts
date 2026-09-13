/**
 * Applying database migrations at startup, on a managed database that may not be ready yet.
 *
 * The first DigitalOcean deployment failed with Prisma error P3009. The managed database was
 * still being provisioned when the first attempt ran, the attempt was interrupted part way
 * through, and Prisma wrote a row into `_prisma_migrations` recording `20260909000000_init`
 * as failed. From then on every later `migrate deploy` refused to do anything at all, which
 * is the correct and deliberate behaviour: Prisma will not apply new migrations on top of a
 * database whose state it cannot vouch for, because guessing there means guessing about
 * somebody's data.
 *
 * Getting out of it needs two things that this module does.
 *
 * **Clear the failed record before deploying.** `prisma migrate resolve --rolled-back` tells
 * Prisma that the failed attempt did not take effect, so the migration may be tried again.
 * It edits one row in Prisma's own bookkeeping table and touches no table of ours. **Nothing
 * here ever deletes data.** There is no `migrate reset`, no `db push --force-reset` and no
 * `DROP` anywhere in this file, and there must never be: on a production database those
 * commands throw away real orders belonging to real people in exchange for a tidier error
 * message.
 *
 * **Try more than once.** A managed database is briefly unreachable while it is being
 * provisioned, promoted or moved, and a single failed connection at the wrong moment should
 * not take the whole service down when waiting ten seconds would have fixed it.
 *
 * Everything the outside world does — running a command, writing a log line, waiting — is
 * injected, so the whole of this can be proved without a database, without the Prisma command
 * line, and without anything actually waiting ten seconds.
 */

/** What a finished command tells us. A null status means it was killed by a signal. */
export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the Prisma command line with the given arguments. Never throws for a non-zero exit. */
export type PrismaRunner = (args: readonly string[]) => Promise<CommandResult> | CommandResult;

export interface MigrationDependencies {
  run: PrismaRunner;
  log: (message: string) => void;
  wait: (milliseconds: number) => Promise<void>;
  /** How many times to try the whole sequence. Five by default. */
  attempts?: number;
  /** How long to wait between attempts. Ten seconds by default. */
  waitMilliseconds?: number;
}

export interface MigrationOutcome {
  applied: boolean;
  attemptsUsed: number;
  /** Migrations that were recorded as failed and have been marked rolled back. */
  rolledBack: string[];
  /** The last thing that went wrong, in as few words as the tool gave us. */
  lastFailure: string | null;
}

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_WAIT_MILLISECONDS = 10_000;

/** `20260909000000_init` and anything else shaped like a Prisma migration folder name. */
const MIGRATION_NAME = /^\d{6,}_[A-Za-z0-9._-]+$/;

/** A line announcing that what follows, or what it quotes, has failed. */
const FAILURE_HEADING = /(migrations? (?:have|has) failed|failed migrations)/i;

/** Prisma names the migration in backticks: The `20260909000000_init` migration ... failed */
const QUOTED_FAILURE = /`([^`]+)`[^`\n]*?failed/gi;

/**
 * Read the names of migrations the database has recorded as failed.
 *
 * Prisma has worded this differently across versions, and the same information turns up both
 * in `migrate status` and in the P3009 error from `migrate deploy`, so both wordings are
 * read: a heading followed by bare migration names on their own lines, and the form that
 * quotes the name inline. Anything that does not look like a migration folder name is
 * ignored, because acting on a misread name is worse than missing one.
 */
export function parseFailedMigrations(output: string): string[] {
  const found = new Set<string>();
  const lines = output.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!FAILURE_HEADING.test(lines[index] ?? '')) continue;

    // The names follow the heading, one to a line, until something that is not a name.
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = (lines[next] ?? '').trim().replace(/^[-*]\s*/, '');
      if (candidate.length === 0) continue;
      if (!MIGRATION_NAME.test(candidate)) break;
      found.add(candidate);
    }
  }

  for (const match of output.matchAll(QUOTED_FAILURE)) {
    const candidate = match[1]?.trim();
    if (candidate && MIGRATION_NAME.test(candidate)) found.add(candidate);
  }

  return [...found];
}

/**
 * Lines Prisma prints on the way past that say nothing about what went wrong: the schema it
 * loaded, a deprecation warning, the box advertising a new version. Reporting one of these
 * as the reason a deployment failed sends whoever reads the log looking in the wrong place.
 */
const NOISE =
  /^(warn |info |debug |For more information|Prisma schema loaded|Datasource |Environment variables loaded|[┌│└├─]|Update available|npm i |This is a major update|Run the following)/i;

/** A line that is actually the failure: Prisma's own error codes look like P1001 or P3009. */
const REAL_ERROR = /^Error\b|\bP\d{4}\b/;

/**
 * The one line worth putting in a log message, out of everything the command printed.
 *
 * Prefers the line carrying the error, falls back to the first line that is not noise, and
 * only then to the exit code.
 */
export function firstMeaningfulLine(result: CommandResult): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const error = lines.find((line) => REAL_ERROR.test(line));
  if (error) return error;

  const plain = lines.find((line) => !NOISE.test(line));
  if (plain) return plain;

  return `the command exited with ${result.status}`;
}

/**
 * Bring the database schema up to date, clearing a failed migration record first if there is
 * one, and trying again if the database is not ready yet.
 */
export async function applyMigrations(
  dependencies: MigrationDependencies,
): Promise<MigrationOutcome> {
  const { run, log, wait } = dependencies;
  const attempts = dependencies.attempts ?? DEFAULT_ATTEMPTS;
  const waitMilliseconds = dependencies.waitMilliseconds ?? DEFAULT_WAIT_MILLISECONDS;

  const rolledBack: string[] = [];
  let lastFailure: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // `migrate status` exits non-zero whenever anything is pending or failed, which is the
    // ordinary case here rather than an error, so only its output is read and never its
    // exit code.
    const status = await run(['migrate', 'status']);
    const failed = parseFailedMigrations(`${status.stdout}\n${status.stderr}`);

    let resolveFailed = false;
    for (const name of failed) {
      log(
        `The migration ${name} is recorded in the database as having failed, so no further migration can be applied until that record is cleared. Marking it as rolled back, which changes only Prisma's own record of what has run and deletes no data, and then applying the migrations again.`,
      );

      const resolved = await run(['migrate', 'resolve', '--rolled-back', name]);
      if (resolved.status !== 0) {
        lastFailure = firstMeaningfulLine(resolved);
        resolveFailed = true;
        break;
      }
      if (!rolledBack.includes(name)) rolledBack.push(name);
    }

    if (!resolveFailed) {
      const deployed = await run(['migrate', 'deploy']);
      if (deployed.status === 0) {
        return { applied: true, attemptsUsed: attempt, rolledBack, lastFailure: null };
      }
      lastFailure = firstMeaningfulLine(deployed);
    }

    if (attempt < attempts) {
      const seconds = Math.round(waitMilliseconds / 1000);
      log(
        `The database could not be migrated on attempt ${attempt} of ${attempts}: ${lastFailure}. A managed database is sometimes briefly unreachable when it first starts, so waiting ${seconds} seconds and trying again.`,
      );
      await wait(waitMilliseconds);
    }
  }

  return { applied: false, attemptsUsed: attempts, rolledBack, lastFailure };
}
