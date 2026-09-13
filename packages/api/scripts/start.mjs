/**
 * Starting Aldilivery in production.
 *
 * Two steps, in this order and no other: bring the database schema up to date, then start
 * the server. A server that starts before its migrations have run answers requests against
 * a schema that is not there yet, and the first thing it does wrong is the thing a Shopper
 * sees.
 *
 * If `DATABASE_URL` is not set there is no database to migrate, so that step is skipped and
 * the server starts on its in-memory store, which says so loudly in the log. In production
 * `readEnv` refuses to start at all without a database, so this skip only ever happens on a
 * developer's machine.
 *
 * The migration step itself — clearing a failed migration record, and trying again when the
 * managed database is not ready yet — lives in `src/lib/migrations.ts`, where it is
 * typechecked and proved by tests. This file only supplies the real ways of running a
 * command, writing a line and waiting.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(import.meta.url);
const apiRoot = dirname(dirname(here));
const serverEntry = join(apiRoot, 'dist', 'index.js');
const migrationsModule = join(apiRoot, 'dist', 'lib', 'migrations.js');

/**
 * Run the Prisma CLI on this same Node binary rather than through a `.bin` shim. The shim
 * is a shell script on Linux and a batch file on Windows, and spawning it portably means
 * handing the command to a shell. Resolving the module and running it directly needs no
 * shell at all, so nothing here depends on which platform it is.
 */
function prismaEntry() {
  try {
    return createRequire(here).resolve('prisma/build/index.js');
  } catch {
    return null;
  }
}

function run(args, what) {
  const result = spawnSync(process.execPath, args, {
    cwd: apiRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(`Could not ${what}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Could not ${what}. The step above exited with ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(serverEntry)) {
  console.error('There is no built server at dist/index.js. Run the build before the start script.');
  process.exit(1);
}

if (process.env.DATABASE_URL) {
  const prisma = prismaEntry();
  if (!prisma) {
    console.error(
      'DATABASE_URL is set but the Prisma command line is not installed, so the migrations cannot be applied. Install dependencies without pruning and try again.',
    );
    process.exit(1);
  }

  const { applyMigrations } = await import(pathToFileURL(migrationsModule).href);

  console.log('Applying database migrations.');

  const outcome = await applyMigrations({
    /**
     * Output is captured rather than inherited, because the migration logic has to read it
     * to find the name of a migration the database has recorded as failed. It is echoed
     * afterwards so nothing is hidden from the deployment log.
     */
    run: (args) => {
      const result = spawnSync(process.execPath, [prisma, ...args], {
        cwd: apiRoot,
        encoding: 'utf8',
        shell: false,
      });
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? (result.error ? result.error.message : '');
      if (stdout.trim()) console.log(stdout.trimEnd());
      if (stderr.trim()) console.error(stderr.trimEnd());
      return { status: result.error ? 1 : result.status, stdout, stderr };
    },
    log: (message) => console.log(message),
    wait: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  });

  if (!outcome.applied) {
    console.error(
      `The database could not be migrated after ${outcome.attemptsUsed} attempts. The last thing that went wrong was: ${outcome.lastFailure}. The server has not been started, because it must never answer a request against a schema it cannot vouch for. Nothing has been deleted.`,
    );
    process.exit(1);
  }

  if (outcome.rolledBack.length > 0) {
    console.log(
      `Cleared the failed record for ${outcome.rolledBack.join(', ')} and applied the migrations successfully.`,
    );
  }
} else {
  console.log('No DATABASE_URL is set, so there are no migrations to apply.');
}

run([serverEntry], 'start the server');
