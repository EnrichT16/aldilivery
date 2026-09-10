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
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const apiRoot = dirname(dirname(here));
const serverEntry = join(apiRoot, 'dist', 'index.js');

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
  console.log('Applying database migrations.');
  run([prisma, 'migrate', 'deploy'], 'apply the database migrations');
} else {
  console.log('No DATABASE_URL is set, so there are no migrations to apply.');
}

run([serverEntry], 'start the server');
