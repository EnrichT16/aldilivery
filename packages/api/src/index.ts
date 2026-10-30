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
import { seedOnStartup, seedShopsOnStartup, type StartupSeedOutcome } from './data/startup-seed.js';
import { readEnv } from './env.js';
import { rehearsalGateway, stripeGateway, type PaymentsGateway } from './lib/payments.js';
import { livekitRecorder, recordingStorageFrom } from './lib/call-recording.js';
import { livekitProvider } from './lib/livekit.js';
import { loadShopsSeed } from './lib/shops-seed.js';
import { oluomaVoice } from './lib/oluoma-voice.js';
import { languageModel } from './lib/language-model.js';
import { openPrices } from './lib/open-prices.js';
import { postcodesIo } from './lib/postcodes.js';
import { webPushSender } from './lib/push.js';
import { callScript, codeMessage, senderName, twilioCaller, twilioSender } from './lib/sms.js';
import { twilioDialler } from './lib/twilio-voice.js';
import { sweepAllocations } from './services/allocate.js';
import { sweepOffers } from './services/dispatch.js';
import { sweepScheduled } from './services/scheduled.js';
import { sweepPayouts } from './services/pay-runner.js';
import { sweepReimbursements } from './services/reimburse.js';
import { sweepCards } from './services/runner-card.js';
import { sweepRetention } from './services/retention.js';
import { settleShopReviews } from './services/shop-of-the-month.js';
import { sweepSets } from './services/set-runner.js';
import { sweepAreas } from './services/areas.js';
import { sweepReferralLevels } from './services/referrals.js';
import { sweepInsuranceReminders } from './services/insurance.js';
import { sweepDeposits } from './services/runner-leaving.js';
import { sweepPlans } from './services/plans.js';
import { refreshPrices } from './services/prices.js';
import { checkWaiting } from './services/auto-check.js';
import { fallBackToPhone, sweepOwnerDesk } from './services/owner-desk.js';
import { sweepEmail } from './services/email-desk.js';
import { imapMailbox, mailboxSettings, smtpMailer } from './lib/mailbox.js';

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
  // The shops Ozi lists itself (ruling 65), only when there are none at all.
  const shopsSeed = await seedShopsOnStartup(repository, loadShopsSeed(env.storeConfigPath));

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
        fallbackFrom: senderName(config.productName),
      })
    : undefined;
  const webOrigin = env.primaryOrigin;

  // Codes spoken by an automatic phone call, for landlines: Twilio, from a number that can call.
  const callReady = env.twilioAccountSid && env.twilioAuthToken && env.twilioVoiceFrom;
  const callCode = callReady
    ? twilioCaller(
        {
          accountSid: env.twilioAccountSid as string,
          authToken: env.twilioAuthToken as string,
          from: env.twilioVoiceFrom as string,
        },
        (code) =>
          callScript({
            productName: config.productName,
            code,
            minutes: Math.round(env.otpTtlSeconds / 60),
          }),
      )
    : undefined;
  // Ozi ringing back a telephone caller who was cut off (ruling 28), from the same number.
  const placeCall = callReady
    ? twilioDialler({
        accountSid: env.twilioAccountSid as string,
        authToken: env.twilioAuthToken as string,
        from: env.twilioVoiceFrom as string,
      })
    : undefined;

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
          sipTrunkId: env.livekitSipTrunkId,
        })
      : null;

  // Recording staff calls (ruling 77): LiveKit Egress into S3-compatible storage, when LiveKit and
  // all five RECORDING_S3_* settings are real. The secret is never logged.
  const storage = recordingStorageFrom(env);
  const recorder =
    calls && storage && env.livekitUrl && env.livekitApiKey && env.livekitApiSecret
      ? livekitRecorder(
          { url: env.livekitUrl, apiKey: env.livekitApiKey, apiSecret: env.livekitApiSecret },
          storage,
        )
      : null;

  // Oluoma Voice (ruling 53), when both settings are real. The key never leaves this server.
  const voice =
    env.oluomaVoiceUrl && env.oluomaVoiceKey
      ? oluomaVoice({ url: env.oluomaVoiceUrl, key: env.oluomaVoiceKey })
      : null;

  // The language model behind Ozi (ruling 69), when the key is real. The key never leaves
  // this server, and the provider is named nowhere a person can see.
  const brain = env.languageModelKey
    ? languageModel({ apiKey: env.languageModelKey, model: env.languageModelName, config })
    : null;

  const app = await buildApp({
    config,
    calls,
    recorder,
    voice,
    brain,
    // The open price database (ruling 72), which asks every app to say who it is.
    openPrices: openPrices({
      userAgent: `${config.productName}/1.0 (${config.contact.email})`,
    }),
    lookUpPrices: true,
    // Postcodes become places with postcodes.io when saved (Anthony, 30 October 2026); no key.
    findPostcode: postcodesIo(),
    // The automatic check (ruling 74) runs in the background: nobody waits for it.
    backgroundChecks: true,
    repository,
    payments,
    env,
    logger: true,
    ...push,
    ...(sendText ? { sendText } : {}),
    ...(placeCall ? { placeCall } : {}),
    ...(callCode ? { callDelivery: 'call' as const, callCode } : {}),
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

  if (calls && !recorder) {
    app.log.info(
      'Staff calls are not recorded: RECORDING_S3_ENDPOINT, RECORDING_S3_BUCKET, RECORDING_S3_KEY, RECORDING_S3_SECRET and RECORDING_S3_REGION are not all set.',
    );
  }

  if (!brain) {
    app.log.info(
      'The language model is off: LANGUAGE_MODEL_KEY is not set. The phrase book and the shopping parser work alone.',
    );
  } else {
    app.log.info(`The language model is on behind ${config.assistantName}.`);
  }

  if (!voice) {
    app.log.info(
      "Oluoma Voice is off: OLUOMA_VOICE_URL and OLUOMA_VOICE_KEY are not both set. The app uses the phone's own speech.",
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

  if (shopsSeed.seeded) {
    app.log.info(
      `There were no shops, so ${shopsSeed.shops} well-known local shops from config/shops-seed.json were listed by ${config.assistantName}, each with no products of its own and an invitation to its owner to claim it.`,
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
  // Jobs the office sent to a chosen Runner come first (ruling 80): ones that ran out go to the
  // backup or back to the queue, and a Runner whose hands are free is offered their next.
  const sweep = setInterval(() => {
    sweepAllocations(app.ctx, (id, failure) => {
      app.log.warn({ id, err: failure }, 'Could not move on a job the office sent');
    })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The office jobs sweep failed');
      })
      .then(() =>
        sweepOffers(app.ctx, (orderId, failure) => {
          app.log.warn({ orderId, err: failure }, 'Could not offer a waiting order');
        }),
      )
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The offer sweep failed');
      });
  }, 10_000);
  sweep.unref();

  // Every minute: orders booked for a later day (ruling 78). A payment at the day and time the
  // Shopper chose, tried again every hour after a refusal; an order still unpaid at its offer
  // time held, with the Shopper and the owner told; the Shopper's reminders; and the owner's
  // one morning summary on Ozi's desk. Offering them on the day is the offer sweep's, above.
  let bookedRunning = false;
  const bookedSweep = setInterval(() => {
    if (bookedRunning) return;
    bookedRunning = true;
    sweepScheduled(app.ctx, app.log)
      .then((report) => {
        if (report.charged + report.held + report.reminded > 0 || report.summary) {
          app.log.info(report, 'Booked order sweep');
        }
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The booked order sweep failed');
      })
      .finally(() => {
        bookedRunning = false;
      });
  }, 60_000);
  bookedSweep.unref();

  // Every minute: pay any delivered order whose Runner can now be paid — somebody who finished
  // setting up their account after delivering, or a transfer Stripe refused the first time.
  const paySweep = setInterval(() => {
    sweepPayouts(app.ctx, (orderId, failure) => {
      app.log.warn({ orderId, err: failure }, 'Could not pay a Runner yet');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The payout sweep failed');
    });
    // And any pay-back for the shopping that is owed (ruling 55), on the same terms.
    sweepReimbursements(app.ctx, (orderId, failure) => {
      app.log.warn({ orderId, err: failure }, 'Could not pay a Runner back yet');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The pay-back sweep failed');
    });
    // And any Runner spending card left switched on with no order in hand: frozen.
    sweepCards(app.ctx, (runnerId, failure) => {
      app.log.warn({ runnerId, err: failure }, 'Could not freeze a spending card yet');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The spending card sweep failed');
    });
    // And the cool bag deposit of a Runner who has left, once their account is ready.
    sweepDeposits(app.ctx, (runnerId, failure) => {
      app.log.warn({ runnerId, err: failure }, 'Could not pay a cool bag deposit back yet');
    }).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The cool bag deposit sweep failed');
    });
  }, 60_000);
  paySweep.unref();

  // Every minute: regular orders (Rule Five). The notice thirty minutes before, by notification
  // or text, then, if the Shopper did not say the skip word, the order itself; once only for
  // each occurrence, however often this runs.
  let setsRunning = false;
  const setSweep = setInterval(() => {
    if (setsRunning) return;
    setsRunning = true;
    sweepSets(app.ctx, app.log)
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The regular order sweep failed');
      })
      .finally(() => {
        setsRunning = false;
      });
  }, 60_000);
  setSweep.unref();

  // Every minute: Shoppers warned there was no Runner in their area are texted once when one
  // joins there (Anthony, 30 October 2026), never in the quiet hours.
  let areasRunning = false;
  const areaSweep = setInterval(() => {
    if (areasRunning) return;
    areasRunning = true;
    sweepAreas(app.ctx, app.log)
      .then((texted) => {
        if (texted > 0)
          app.log.info({ texted }, 'Shoppers texted that a Runner has joined in their area');
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The area sweep failed');
      })
      .finally(() => {
        areasRunning = false;
      });
  }, 60_000);
  areaSweep.unref();

  // Every hour: remove closed accounts whose seven days are up, and anything kept longer than
  // the privacy page says (services/retention.ts).
  const retentionSweep = setInterval(() => {
    sweepRetention(app.ctx, app.log)
      .then((report) => {
        app.log.info(report, 'Retention sweep');
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The retention sweep failed');
      });
    // Review points (ruling 70): earned once their days are up, void if the order was refunded.
    settleShopReviews(app.ctx, app.log)
      .then((report) => {
        app.log.info(report, 'Shop review sweep');
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The shop review sweep failed');
      });
  }, 3_600_000);
  retentionSweep.unref();
  // Every hour: insurance reminders for Runners who drive, and driving paused once it has run
  // out (ruling 14). Each reminder goes once, so the hour it lands in does not matter.
  const insuranceSweep = setInterval(() => {
    sweepInsuranceReminders(app.ctx, app.log).catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The insurance reminder sweep failed');
    });
  }, 3_600_000);
  insuranceSweep.unref();
  // Every hour: the monthly plans (ruling 58). Renewals only for plans the Shopper chose to
  // renew, the free-month reminder about three days before it ends, Plus check-ins and the
  // Family and Carer weekly summary. Each goes once, so the hour it lands in does not matter.
  const planSweep = setInterval(() => {
    sweepPlans(app.ctx, app.log)
      .then((report) => app.log.info(report, 'Plan sweep'))
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The plan sweep failed');
      });
  }, 3_600_000);
  planSweep.unref();
  // Every hour: anybody who has reached a new referral reward level is kept, and the owner told
  // once on Ozi's desk (Anthony, 30 October 2026). A level is also checked the moment a delivery
  // makes somebody active, so the hour this lands in does not matter.
  const referralSweep = setInterval(() => {
    sweepReferralLevels(app.ctx, app.log)
      .then((reached) => {
        if (reached > 0) app.log.info({ reached }, 'Referral levels reached');
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The referral level sweep failed');
      });
  }, 3_600_000);
  referralSweep.unref();
  // Every six hours: a few things whose price is only an estimate, or a month old, are looked
  // up again in the open price database or, failing that, by one web search (ruling 72).
  const priceSweep = setInterval(() => {
    refreshPrices(app.ctx, app.log)
      .then((report) => app.log.info(report, 'Price sweep'))
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, 'The price sweep failed');
      });
  }, 6 * 3_600_000);
  priceSweep.unref();

  // Once at start: Runner documents and shop products already waiting, never read by the
  // automatic check, are checked now (ruling 74), so nobody who sent them earlier is left out.
  checkWaiting(app.ctx, app.log)
    .then((report) => app.log.info(report, 'The automatic check looked at what was waiting'))
    .catch((failure: unknown) => {
      app.log.error({ err: failure }, 'The automatic check of what was waiting failed');
    });

  // Every minute: Ozi's desk (ruling 74). Anything that needs the owner, and whether to ring
  // him now: three calls in a row two minutes apart, an hour, then three again, until every
  // matter is decided or put to later; no calls in quiet hours unless urgent.
  if (!env.ownerAlertPhone || !placeCall || !env.primaryOrigin) {
    app.log.info(
      "Ozi's desk will not ring the owner's phone: OWNER_ALERT_PHONE, the Twilio voice number and ALLOWED_ORIGIN are not all set. Ozi can still ring him in the app, and matters still show on the Needs you now page.",
    );
  }
  let deskRunning = false;
  const deskSweep = setInterval(() => {
    if (deskRunning) return;
    deskRunning = true;
    sweepOwnerDesk(app.ctx, app.log)
      .then((result) => {
        if (result.called) app.log.info({ attempt: result.call.attempt }, 'Ozi rang the owner');
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, "The owner's desk sweep failed");
      })
      .finally(() => {
        deskRunning = false;
      });
  }, 60_000);
  deskSweep.unref();

  // Every five seconds: a call ringing the owner in the app for `ownerDesk.appRingSeconds`
  // without an answer goes on to his phone, the same attempt (ruling 79).
  let fallbackRunning = false;
  const deskFallback = setInterval(() => {
    if (fallbackRunning) return;
    fallbackRunning = true;
    fallBackToPhone(app.ctx, app.log)
      .then((rung) => {
        if (rung.length > 0) app.log.info("Ozi's call was not answered in the app: rang the phone");
      })
      .catch((failure: unknown) => {
        app.log.error({ err: failure }, "Ringing the owner's phone after the app failed");
      })
      .finally(() => {
        fallbackRunning = false;
      });
  }, 5_000);
  deskFallback.unref();

  // Every five minutes: the business mailbox (ruling 76), on the company's own mail host. New
  // emails are sorted: important ones go on Ozi's desk, spam, newsletters and notices are only
  // marked as read, and simple customer questions are answered only if EMAIL_AUTO_REPLY is on.
  // The password and the emails' words are never written to this log.
  const mail = mailboxSettings(env);
  let emailSweep: ReturnType<typeof setInterval> | null = null;
  if (!mail) {
    app.log.info(
      'Ozi is not reading the business mailbox: EMAIL_IMAP_HOST, EMAIL_IMAP_USER and EMAIL_IMAP_PASSWORD are not all set.',
    );
  } else {
    const mailbox = imapMailbox(mail);
    const mailer = mail.smtp ? smtpMailer({ ...mail, smtp: mail.smtp }, config.productName) : null;
    app.log.info(
      {
        host: mail.imap.host,
        port: mail.imap.port,
        replies: mail.autoReply && mailer ? 'on' : 'off',
      },
      `${config.assistantName} reads the business mailbox every five minutes.`,
    );
    let emailRunning = false;
    const readMail = (): void => {
      if (emailRunning) return;
      emailRunning = true;
      sweepEmail(
        app.ctx,
        { mailbox, mailer, autoReply: mail.autoReply, ownAddress: mail.user },
        app.log,
      )
        .then((report) => {
          if (report.read > 0 || report.failed > 0) app.log.info(report, 'Email sweep');
        })
        .catch((failure: unknown) => {
          app.log.error(
            { err: failure instanceof Error ? failure.message : 'unknown' },
            'The business mailbox could not be read',
          );
        })
        .finally(() => {
          emailRunning = false;
        });
    };
    emailSweep = setInterval(readMail, 5 * 60_000);
    emailSweep.unref();
    setTimeout(readMail, 30_000).unref();
  }

  const shutdown = async (signal: string): Promise<void> => {
    clearInterval(sweep);
    clearInterval(bookedSweep);
    clearInterval(deskSweep);
    clearInterval(deskFallback);
    if (emailSweep) clearInterval(emailSweep);
    clearInterval(paySweep);
    clearInterval(setSweep);
    clearInterval(retentionSweep);
    clearInterval(insuranceSweep);
    clearInterval(planSweep);
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
