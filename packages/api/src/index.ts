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
import { seedOnStartup, type StartupSeedOutcome } from './data/startup-seed.js';
import { readEnv } from './env.js';
import { rehearsalGateway, stripeGateway, type PaymentsGateway } from './lib/payments.js';

async function main(): Promise<void> {
  const env = readEnv();
  const config = loadStoreConfig(env.storeConfigPath);

  let repository: Repository;
  let startupSeed: StartupSeedOutcome | null = null;

  if (env.dataBackend === 'memory') {
    repository = memoryRepository();
    // Nothing is saved between runs in this mode, so there is something to look at from the
    // first second — including the people, who are thrown away when the process stops.
    await seedRepository(repository, config);
  } else {
    repository = prismaRepository(createPrismaClient(env.databaseUrl));
    // Migrations make tables, not rows. An empty catalogue is indistinguishable from a
    // broken shop, so fill it once. The catalogue only: never people. See startup-seed.ts.
    startupSeed = await seedOnStartup(repository, config, { enabled: env.seedOnStart });
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
      nodeEnv: env.nodeEnv,
      host: env.host,
      port: env.port,
      allowedOrigins: env.allowedOrigins,
      commit: app.ctx.gitCommit,
    },
    'Configuration loaded',
  );

  if (env.dataBackend === 'memory') {
    app.log.warn(
      'Running with an in-memory database. Nothing is saved when this process stops. Set DATABASE_URL for a real one.',
    );
  }

  if (startupSeed?.seeded) {
    app.log.info(
      `The catalogue was empty, so it was filled with ${startupSeed.catalogueItems} everyday grocery items. No Shopper and no Runner was created: those are real people, and the right to work and criminal record checks behind them are done by a person, never by a seed.`,
    );
  } else if (startupSeed && !startupSeed.seeded && startupSeed.reason === 'not-community-catalogue') {
    app.log.warn(
      'The catalogue is empty and was not filled, because the catalogue source is not community and seeded price estimates must not be labelled as though a supermarket supplied them.',
    );
  }

  if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
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
