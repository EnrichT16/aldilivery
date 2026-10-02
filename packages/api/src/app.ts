/**
 * Building the Fastify application.
 *
 * Everything the routes need — configuration, data access, the payments gateway and the
 * clock — is passed in here rather than imported by the routes themselves. That is what
 * lets the test suite build a whole, real application, with no database, no network and a
 * clock it controls, and prove the rules against it.
 */

import { timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { StoreConfig } from '@aldilivery/core';

import type { Repository } from './data/repository.js';
import type { AccountRole } from './domain.js';
import { ApiError, ForbiddenError, UnauthorisedError } from './errors.js';
import type { Env } from './env.js';
import type { PaymentsGateway } from './lib/payments.js';
import type { SendPush } from './lib/push.js';
import type { SendText } from './lib/sms.js';
import { verifySession } from './lib/tokens.js';
import { gitCommit } from './lib/version.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerBasketRoutes } from './routes/basket.js';
import { registerCatalogueRoutes } from './routes/catalogue.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerQuestionRoutes } from './routes/questions.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerPaymentMethodRoutes } from './routes/payment-methods.js';
import { registerPayoutRoutes } from './routes/payouts.js';
import { registerAddressRoutes } from './routes/addresses.js';
import { registerPushRoutes } from './routes/push.js';
import { registerSetRoutes } from './routes/sets.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

export interface AppContext {
  config: StoreConfig;
  repository: Repository;
  payments: PaymentsGateway;
  env: Env;
  /** The commit this process was built from, or null if nothing could say. */
  gitCommit: string | null;
  /** Injected so tests can control time, and so nothing calls `new Date()` in a handler. */
  now: () => Date;
  /**
   * Where a one time code goes. `sms` sends it with Twilio. `log` writes it to the server log,
   * which is only ever right in development. `off` means neither: a production server with
   * no Twilio account set up, where writing codes to the log would let anybody who can read
   * the log sign in as anybody. The sign-in screen says it is not switched on yet.
   */
  codeDelivery: 'sms' | 'log' | 'off';
  /**
   * Offer an order to a Runner the moment it is paid for, and sweep for lapsed offers every
   * `offerSweepSeconds`. On in the real server. Off unless asked for in the tests, which
   * drive offers by hand so that each step can be checked.
   */
  autoOffer: boolean;
  /** Pay the Runner the moment an order is delivered. On in the real server, off in tests. */
  autoPayout: boolean;
  deliverCode: (phone: string, code: string) => Promise<void>;
  /**
   * Web Push, for notifications on a Shopper's devices. Null when no key pair is set up: the
   * Your order page still shows everything, it just cannot reach a closed page.
   */
  sendPush: SendPush | null;
  /** The public half of the key pair, which a browser needs in order to subscribe. */
  pushPublicKey: string | null;
  /**
   * Sending a text to an account's own phone, for notices that must reach the owner even
   * without notifications switched on — such as the home address changing. Null without Twilio.
   */
  sendText: SendText | null;
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

export interface BuildAppOptions extends Partial<
  Pick<
    AppContext,
    | 'now'
    | 'deliverCode'
    | 'gitCommit'
    | 'codeDelivery'
    | 'autoOffer'
    | 'autoPayout'
    | 'sendPush'
    | 'pushPublicKey'
    | 'sendText'
  >
> {
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
    // `??` would be wrong here: null is a deliberate answer, meaning "nothing knows which
    // commit this is", and the tests pin it to exactly that.
    gitCommit: 'gitCommit' in options ? (options.gitCommit ?? null) : gitCommit(),
    now: options.now ?? (() => new Date()),
    codeDelivery: options.codeDelivery ?? (options.env.isProduction ? 'off' : 'log'),
    autoOffer: options.autoOffer ?? true,
    autoPayout: options.autoPayout ?? true,
    deliverCode:
      options.deliverCode ??
      (async (phone, code) => {
        app.log.info({ phone }, `One time code for ${phone} is ${code}`);
      }),
    sendPush: options.sendPush ?? null,
    pushPublicKey: options.sendPush ? (options.pushPublicKey ?? null) : null,
    sendText: options.sendText ?? null,
  };

  app.decorate('ctx', ctx);
  app.decorateRequest('session', undefined);

  // The browser origins allowed to call this API. In production this is exactly the site
  // the web app is served from, named in `ALLOWED_ORIGIN`, and nothing else.
  const allowAnyOrigin = options.env.allowedOrigins.includes('*');
  await app.register(cors, {
    origin: allowAnyOrigin ? true : options.env.allowedOrigins,
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
        error: {
          code: 'bad_request',
          message: 'Some of that was not quite right. Please try again.',
        },
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

  /**
   * Every route, mounted twice: once at the root and once under `/api`.
   *
   * On App Platform the API is served at `/api` and the platform strips that prefix before
   * the request arrives, so the server sees `/health`. That is how it is deployed today and
   * it works. But the prefix being stripped is a setting on somebody else's dashboard, one
   * checkbox away from not being true, and the failure it causes is silent in the worst way:
   * `/api/health` falls through to the web app's catch-all and answers 200 with an HTML page,
   * so the API looks like it is missing rather than misrouted.
   *
   * Answering on both paths costs one extra registration and removes the whole class of
   * problem. `/health` keeps working for the platform's own health check, which polls the
   * container directly and never goes through the router.
   */
  const routes = async (instance: FastifyInstance): Promise<void> => {
    await registerRoutesOn(instance);
  };

  await app.register(routes);
  await app.register(routes, { prefix: '/api' });

  return app;
}

/**
 * Everything the API answers. Registered against whichever prefix it is handed, so that the
 * same routes exist at the root and under `/api`.
 */
async function registerRoutesOn(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  /**
   * The health check the platform polls. It must stay cheap: no database call, no network
   * call, and nothing that could make a healthy process look dead. `commit` is null rather
   * than absent when nothing could tell us which commit this is.
   */
  app.get('/health', async () => ({
    status: 'ok',
    commit: ctx.gitCommit,
    ok: true,
    product: ctx.config.productName,
    assistant: ctx.config.assistantName,
    dataBackend: ctx.env.dataBackend,
    // Asked of the gateway that is actually in use, never inferred from configuration.
    paymentsMode: ctx.payments.mode,
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
    fees: {
      standardDeliveryPence: ctx.config.fees.standardDeliveryPence,
      maximumGoodsPence: ctx.config.fees.maximumGoodsPence,
    },
    accessibility: ctx.config.accessibility,
    recurringOrders: ctx.config.recurringOrders,
    payments: {
      /**
       * `rehearsal` means no card can be charged and the screens say so. The publishable
       * key is null rather than absent when it is missing, so the card screen can tell the
       * difference between "not configured" and "did not load".
       */
      mode: ctx.payments.mode,
      publishableKey: ctx.env.stripePublishableKey ?? null,
      supportedCardRegions: ctx.config.payments.supportedCardRegions,
    },
    /** Whether a code can be sent, so the sign-in screen can say so before anybody tries. */
    signIn: { byText: ctx.codeDelivery !== 'off' },
    /** Null when notifications are not set up, so the page does not offer them. */
    push: { publicKey: ctx.pushPublicKey },
  }));

  await registerAuthRoutes(app);
  await registerAccountRoutes(app);
  await registerCatalogueRoutes(app);
  await registerBasketRoutes(app);
  await registerPaymentMethodRoutes(app);
  await registerPushRoutes(app);
  await registerAddressRoutes(app);
  await registerQuestionRoutes(app);
  await registerOrderRoutes(app);
  await registerJobRoutes(app);
  await registerPayoutRoutes(app);
  await registerSetRoutes(app);
  await registerWebhookRoutes(app);
}

/**
 * For the few routes that belong to the server itself rather than to anybody signed in:
 * offering an order to a Runner, and paying a Runner out.
 *
 * Until 27 Sep 2026 both answered anybody at all. Neither could do more than should happen
 * anyway — the offer follows the queue and refuses unpaid orders, and a payout needs a
 * delivered order and cannot be paid twice — but they are the server's to call, not the
 * internet's. They now need the `STAFF_API_KEY` in an `x-staff-key` header. With no key set,
 * which is how production runs today, they refuse everybody: offers happen by themselves
 * now, and payouts wait for Stripe Connect.
 */
export function requireStaff(request: FastifyRequest, staffKey: string | undefined): void {
  const given = request.headers['x-staff-key'];
  const value = Array.isArray(given) ? given[0] : given;
  const ok =
    staffKey !== undefined &&
    value !== undefined &&
    value.length === staffKey.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(staffKey));
  if (!ok) throw new ForbiddenError('That is only for the server itself.');
}

/** Require a signed-in account, optionally of a particular kind. */
export function requireSession(request: FastifyRequest, role?: AccountRole): Session {
  if (!request.session) throw new UnauthorisedError();
  if (role && request.session.role !== role) {
    throw new UnauthorisedError(
      role === 'runner' ? 'That part is for Runners.' : 'That part is for Shoppers.',
    );
  }
  return request.session;
}
