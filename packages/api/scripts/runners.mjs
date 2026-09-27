/**
 * Approving Runners, from the DigitalOcean console.
 *
 * This file only connects to the database and hands over to `src/services/runner-checks.ts`,
 * where every rule is, and where the tests prove it. Run it with no arguments to see every
 * Runner and which checks they have passed; DEPLOY.md, "Approving a Runner", walks through
 * the rest in plain words.
 *
 * It uses the compiled server code in `dist`, which the deployment builds, so it runs on the
 * server exactly as the server itself does.
 *
 * Usage, from the repository root:
 *
 *   node packages/api/scripts/runners.mjs
 *   node packages/api/scripts/runners.mjs help
 */

import { createPrismaClient, prismaRepository } from '../dist/data/prisma.js';
import { runRunnersCommand, USAGE } from '../dist/services/runner-checks.js';

const argv = process.argv.slice(2);

if (argv[0] === 'help' || argv[0] === '--help') {
  console.log(USAGE);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set, so there is no database to work on. Run this from the api component in the DigitalOcean console, where it is already set.',
  );
  process.exit(1);
}

const repository = prismaRepository(createPrismaClient(process.env.DATABASE_URL));

try {
  const code = await runRunnersCommand(argv, {
    repository,
    now: () => new Date(),
    write: (line) => console.log(line),
  });
  process.exitCode = code;
} finally {
  await repository.disconnect();
}
