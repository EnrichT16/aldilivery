/**
 * Seed the PostgreSQL database for local development.
 *
 *   pnpm db:seed
 *
 * The data itself lives in `src/data/seed-data.ts`, because the API uses the same data to
 * fill its in-memory backend when there is no database to talk to.
 */

import { loadStoreConfig } from '@aldilivery/core/node';

import { createPrismaClient, prismaRepository } from '../src/data/prisma.js';
import { seedRepository } from '../src/data/seed-data.js';
import { readEnv } from '../src/env.js';

async function main(): Promise<void> {
  const env = readEnv();
  const config = loadStoreConfig(env.storeConfigPath);
  const repository = prismaRepository(createPrismaClient(env.databaseUrl));

  console.log(
    `Seeding ${config.productName} (catalogue source: ${config.store.catalogueSource.mode})…`,
  );

  const result = await seedRepository(repository, config);

  if (result.alreadySeeded) {
    console.log('The catalogue already has rows. Nothing to do.');
  } else {
    console.log(
      `Added ${result.catalogueItems} catalogue items (one of them age restricted, on purpose), ` +
        `${result.shoppers} Shopper and ${result.runners} Runners.`,
    );
    console.log(
      `Each Runner will be paid ${config.fees.runnerPaymentPence}p on every completed order.`,
    );
  }

  await repository.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
