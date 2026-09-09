/**
 * Starting the Aldilivery API.
 *
 * Configuration is loaded and validated before the server binds a port. If `store.json`
 * contradicts an inviolable rule, the process exits here with a message naming the rule,
 * rather than starting and quietly doing the wrong thing.
 */

import { loadStoreConfig } from '@aldilivery/core/node';

import { buildApp } from './app.js';
import { memoryRepository } from './data/memory.js';
import { createPrismaClient, prismaRepository } from './data/prisma.js';
import type { Repository } from './data/repository.js';
import { seedRepository } from './data/seed-data.js';
import { readEnv } from './env.js';
import { rehearsalGateway, stripeGateway, type PaymentsGateway } from './lib/payments.js';

async function main(): Promise<void> {
  const env = readEnv();
  const config = loadStoreConfig(env.storeConfigPath);

  let repository: Repository;
  if (env.dataBackend === 'memory') {
    repository = memoryRepository();
    // Nothing is saved between runs in this mode, so there is something to look at from the
    // first second. A real database is seeded once, deliberately, with `pnpm db:seed`.
    await seedRepository(repository, config);
  } else {
    repository = prismaRepository(createPrismaClient(env.databaseUrl));
  }

  let payments: PaymentsGateway;
  if (env.stripeSecretKey && env.stripeWebhookSecret) {
    payments = stripeGateway(env.stripeSecretKey, env.stripeWebhookSecret);
  } else {
    payments = rehearsalGateway();
  }

  const app = await buildApp({ config, repository, payments, env, logger: true });

  app.log.info(
    {
      product: config.productName,
      assistant: config.assistantName,
      store: config.store.displayName,
      catalogueSource: config.store.catalogueSource.mode,
      dataBackend: env.dataBackend,
    },
    'Configuration loaded',
  );

  if (env.dataBackend === 'memory') {
    app.log.warn(
      'Running with an in-memory database. Nothing is saved when this process stops. Set DATABASE_URL and run docker compose up for a real one.',
    );
  }
  if (!env.stripeSecretKey) {
    app.log.warn(
      'Running in payments rehearsal mode. No money moves and no card is ever charged. Set STRIPE_SECRET_KEY for the real thing.',
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await repository.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.host, port: env.port });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
