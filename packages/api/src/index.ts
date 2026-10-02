/**
 * Starting the API.
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
import { livekitProvider } from './lib/livekit.js';
import { webPushSender } from './lib/push.js';
import { codeMessage, twilioSender } from './lib/sms.js';
import { sweepOffers } from './services/dispatch.js';
import { sweepPayouts } from './services/pay-runner.js';

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

  // Sign-in codes. Twilio when all three settings are real; the log in development; and in
  // production without Twilio, nowhere — see `codeDelivery` in app.ts for why not the log.
  const twilioReady =
    env.otpDelivery === 'sms' && env.twilioAccountSid && env.twilioAuthToken && env.twilioFrom;
  const sendText = twilioReady
    ? twilioSender({
        accountSid: env.twilioAccountSid as string,
        authToken: env.twilioAuthToken as string,
        from: env.twilioFrom as string,
      })
    : undefined;
  const webOrigin = env.primaryOrigin;

  // Notifications. The push services want somebody to contact about our messages: the
  // address given, or else the site itself when it is served over https.
  const vapidSubject =
    env.vapidSubject ?? (webOrigin?.startsWith('https://') ? webOrigin : undefined);
  const pushReady = env.vapidPublicKey && env.vapidPrivateKey && vapidSubject;
  const push = pushReady
    ? {
        sendPush: webPushSender({
          publicKey: env.vapidPublicKey as string,
          privateKey: env.vapidPrivateKey as string,
          subject: vapidSubject,
        }),
        pushPublicKey: env.vapidPublicKey as string,
      }
    : {};

  // In-app calls, through LiveKit, when all three settings are real.
  const calls =
    env.livekitUrl && env.livekitApiKey && env.livekitApiSecret
      ? livekitProvider({
          url: env.livekitUrl,
          apiKey: env.livekitApiKey,
          apiSecret: env.livekitApiSecret,
        })
      : null;

  const app = await buildApp({
    config,
    calls,
    repository,
    payments,
    env,
    logger: true,
    ...push,
    ...(sendText ? { sendText } : {}),
    ...(sendText
      ? {
          codeDelivery: 'sms' as const,
          deliverCode: (phone: string, code: string) =>
            sendText(
              phone,
              codeMessage({
                productName: config.productName,
                code,
                minutes: Math.round(env.otpTtlSeconds / 60),
                origin: webOrigin,
              }),
            ),
        }
      : {}),
  });

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

  if (!calls) {
    app.log.info(
      'In-app calls are off: LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not all set.',
    );
  }

  if (!pushReady) {
    app.log.info(
      "Notifications are off: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not both set. A Runner's question still appears on the Your order page.",
    );
  }

  if (env.dataBackend === 'memory') {
    app.log.warn(
      'Running with an in-memory database. Nothing is saved when this process stops. Set DATABASE_URL for a real one.',
    );
  }

  if (startupSeed?.seeded) {
    app.log.info(
      `The catalogue was empty, so it was filled with ${startupSeed.catalogueItems} everyday grocery items. No Shopper and no Runner was created: those are real people, and the right to work and criminal record checks behind them are done by a person, never by a seed.`,
    );
  } else if (
    startupSeed &&
    !startupSeed.seeded &&
    startupSeed.reason === 'not-community-catalogue'
  ) {
    app.log.warn(
      'The catalogue is empty and was not filled, because the catalogue source is not community and seeded price estimates must not be labelled as though a supermarket supplied them.',
    );
  }

  if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
    app.log.warn(
      'Running in payments rehearsal mode. No money moves and no card is ever charged. Set STRIPE_SECRET_KEY for the real thing.',
    );
  }

  if (!sendText) {
    app.log.warn(
      env.isProduction
        ? 'Signing in by text is switched off: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are not all set, or OTP_DELIVERY is not sms. Nobody can sign back in on another device until they are.'
        : 'Sign-in codes are written to this log rather than sent, because Twilio is not set up. Fine for development.',
    );
  }

  // Every few seconds: move offers whose sixty seconds have run out on to the next Runner, and
  // offer any paid order that nobody has yet. A sweep that fails is logged and tried again.
  const sweep = setInterval(() => {
    sweepOffers(app.ctx, (orderId, failure) => {
      app.log.warn({ orderId, err: failure }, 'Could not offer a waiting order');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The offer sweep failed');
    });
  }, 10_000);
  sweep.unref();

  // Every minute: pay any delivered order whose Runner can now be paid — somebody who finished
  // setting up their account after delivering, or a transfer Stripe refused the first time.
  const paySweep = setInterval(() => {
    sweepPayouts(app.ctx, (orderId, failure) => {
      app.log.warn({ orderId, err: failure }, 'Could not pay a Runner yet');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The payout sweep failed');
    });
  }, 60_000);
  paySweep.unref();

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(sweep);
    clearInterval(paySweep);
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
