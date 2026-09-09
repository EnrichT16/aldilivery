/**
 * Building the Fastify application.
 *
 * Everything the routes need — configuration, data access, the payments gateway and the
 * clock — is passed in here rather than imported by the routes themselves. That is what
 * lets the test suite build a whole, real application, with no database, no network and a
 * clock it controls, and prove the rules against it.
 */

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { StoreConfig } from '@aldilivery/core';

import type { Repository } from './data/repository.js';
import type { AccountRole } from './domain.js';
import { ApiError, UnauthorisedError } from './errors.js';
import type { Env } from './env.js';
import type { PaymentsGateway } from './lib/payments.js';
import { verifySession } from './lib/tokens.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerBasketRoutes } from './routes/basket.js';
import { registerCatalogueRoutes } from './routes/catalogue.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerPaymentMethodRoutes } from './routes/payment-methods.js';
import { registerPayoutRoutes } from './routes/payouts.js';
import { registerSetRoutes } from './routes/sets.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

export interface AppContext {
  config: StoreConfig;
  repository: Repository;
  payments: PaymentsGateway;
  env: Env;
  /** Injected so tests can control time, and so nothing calls `new Date()` in a handler. */
  now: () => Date;
  /**
   * Where a one time code goes. In development it is written to the log. Sending it by SMS
   * is a later phase; this phase builds no telephony.
   */
  deliverCode: (phone: string, code: string) => Promise<void>;
}

export interface Session {
  accountId: string;
  role: AccountRole;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    session?: Session;
  }
}

export interface BuildAppOptions extends Partial<Pick<AppContext, 'now' | 'deliverCode'>> {
  config: StoreConfig;
  repository: Repository;
  payments: PaymentsGateway;
  env: Env;
  logger?: boolean;
}

/** Read and verify the bearer token, if there is one. Never throws. */
export function readSession(request: FastifyRequest, secret: string, now: Date): Session | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const claims = verifySession(header.slice('Bearer '.length).trim(), secret, now);
  return claims ? { accountId: claims.accountId, role: claims.role } : null;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // The Stripe webhook needs the exact bytes it was sent in order to verify the
    // signature, so JSON parsing keeps the raw body around.
    bodyLimit: 1_048_576,
  });

  const ctx: AppContext = {
    config: options.config,
    repository: options.repository,
    payments: options.payments,
    env: options.env,
    now: options.now ?? (() => new Date()),
    deliverCode:
      options.deliverCode ??
      (async (phone, code) => {
        app.log.info({ phone }, `One time code for ${phone} is ${code}`);
      }),
  };

  app.decorate('ctx', ctx);
  app.decorateRequest('session', undefined);

  await app.register(cors, {
    origin: options.env.webOrigin === '*' ? true : [options.env.webOrigin],
    credentials: true,
  });

  // Keep the raw body for signature verification on the Stripe webhook only.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.addHook('onRequest', async (request) => {
    const session = readSession(request, ctx.env.authTokenSecret, ctx.now());
    if (session) request.session = session;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send(error.toResponse());
      return;
    }
    // A request that does not fit its schema is the Shopper's mistake or the client's, not
    // a fault at our end, and it must never read as one. The first problem is reported in
    // the words the schema author chose, because those words were written for a person.
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const authored =
        first && !/^(Required|Expected|Invalid|String must|Number must)/.test(first.message);
      void reply.status(400).send({
        error: {
          code: 'bad_request',
          message: authored
            ? (first?.message as string)
            : 'Some of that was not quite right. Please check it and try again.',
          ...(first ? { details: { field: first.path.join('.') } } : {}),
        },
      });
      return;
    }
    if ((error as { validation?: unknown }).validation) {
      void reply.status(400).send({
        error: { code: 'bad_request', message: 'Some of that was not quite right. Please try again.' },
      });
      return;
    }
    request.log.error({ err: error }, 'Unhandled error');
    void reply.status(500).send({
      error: {
        code: 'server_error',
        message: 'Something went wrong at our end. Nothing has been charged.',
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({
      error: { code: 'not_found', message: 'There is nothing at that address.' },
    });
  });

  app.get('/health', async () => ({
    ok: true,
    product: ctx.config.productName,
    assistant: ctx.config.assistantName,
    dataBackend: ctx.env.dataBackend,
    paymentsMode: ctx.env.stripeSecretKey ? 'stripe' : 'rehearsal',
  }));

  /** The public facing configuration the web app is allowed to know about. */
  app.get('/config', async () => ({
    productName: ctx.config.productName,
    assistantName: ctx.config.assistantName,
    tagline: ctx.config.tagline,
    telephone: ctx.config.contact.telephonePlaceholder,
    telephoneIsPlaceholder: ctx.config.contact.telephoneIsPlaceholder,
    store: {
      displayName: ctx.config.store.displayName,
      currencySymbol: ctx.config.store.currencySymbol,
      catalogueSource: ctx.config.store.catalogueSource,
    },
    brand: ctx.config.brand,
    fees: { bands: ctx.config.fees.bands, maximumGoodsPence: ctx.config.fees.maximumGoodsPence },
    accessibility: ctx.config.accessibility,
    recurringOrders: ctx.config.recurringOrders,
  }));

  await registerAuthRoutes(app);
  await registerAccountRoutes(app);
  await registerCatalogueRoutes(app);
  await registerBasketRoutes(app);
  await registerPaymentMethodRoutes(app);
  await registerOrderRoutes(app);
  await registerJobRoutes(app);
  await registerPayoutRoutes(app);
  await registerSetRoutes(app);
  await registerWebhookRoutes(app);

  return app;
}

/** Require a signed-in account, optionally of a particular kind. */
export function requireSession(request: FastifyRequest, role?: AccountRole): Session {
  if (!request.session) throw new UnauthorisedError();
  if (role && request.session.role !== role) {
    throw new UnauthorisedError(
      role === 'runner'
        ? 'That part is for Runners.'
        : 'That part is for Shoppers.',
    );
  }
  return request.session;
}
