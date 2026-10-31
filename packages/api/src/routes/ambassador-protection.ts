/**
 * Protections against Ambassadors misusing the Ozi name (Anthony, 31 October 2026); the rules are
 * in services/ambassador-protection.ts.
 *
 * Public, for anybody, limited per internet address:
 * - `GET /ambassador/check/:code`: the "Check an Ambassador" page's answer. First name, whether
 *   active, the day approved, and whether a face photo can be shown. Never a surname or a number.
 * - `GET /ambassador/check/:code/photo`: the face photo, only while they are active.
 * - `POST /ambassador/check/:code/report`: "Report it", a matter on Ozi's desk.
 *
 * For a Shop Partner, signed in on its own device:
 * - `GET /partner/ambassador`: the payment warning, the three-line breakdown, its Ambassador, and
 *   "Were you promised anything…" when it is due.
 * - `POST /partner/ambassador/confirm`, `/resend` and `/refuse`: confirming, with the code sent to
 *   its own phone, that an Ambassador signed it up, or saying they did not.
 * - `POST /partner/ambassador/report`: "Report an Ambassador".
 * - `POST /partner/ambassador/promise`: Yes or No, with a short note for a Yes.
 *
 * For staff: the shares held for a check, Release and Cancel (the `ambassadors` area), and the
 * "Check this business" links (the `partners` area).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import {
  answerPromise,
  businessCheck,
  cancelHeldShare,
  checkPhoto,
  confirmClaim,
  heldShares,
  partnerProtectionView,
  publicCheck,
  refuseClaim,
  releaseHeldShare,
  reportFromBusiness,
  reportFromCheck,
  resendClaimCode,
  tenMinuteLimit,
} from '../services/ambassador-protection.js';

/** The internet address DigitalOcean's front door saw, or the connection's own. */
function addressOf(request: FastifyRequest): string {
  const given = request.headers['do-connecting-ip'];
  return (Array.isArray(given) ? given[0] : given) ?? request.ip;
}

const codeParams = z.object({ code: z.string().trim().min(1).max(20) });

export async function registerAmbassadorProtectionRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;
  const settings = config.ambassadorProtection;
  const limit = tenMinuteLimit(now);

  /* ------------------------------------------------------------------ public */

  app.get('/ambassador/check/:code', async (request, reply) => {
    limit(`check ${addressOf(request)}`, settings.checksPerTenMinutes);
    const { code } = codeParams.parse(request.params);
    void reply.header('cache-control', 'no-store');
    return publicCheck(app.ctx, code);
  });

  app.get('/ambassador/check/:code/photo', async (request, reply) => {
    limit(`check ${addressOf(request)}`, settings.checksPerTenMinutes);
    const { code } = codeParams.parse(request.params);
    const photo = await checkPhoto(app.ctx, code);
    if (!photo) throw new NotFoundError('photo');
    void reply.header('content-type', photo.contentType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(photo.image));
  });

  app.post('/ambassador/check/:code/report', async (request) => {
    limit(`report ${addressOf(request)}`, settings.reportsPerTenMinutes);
    const { code } = codeParams.parse(request.params);
    const body = z
      .object({ note: z.string().trim().max(1000).default('') })
      .parse(request.body ?? {});
    return reportFromCheck(app.ctx, code, body.note, request.log);
  });

  /* ------------------------------------------------------------------ the business */

  async function myShop(request: FastifyRequest) {
    const user = await businessActor(request, 'partner');
    const shop = user.partnerShopId
      ? await repository.partnerShops.findById(user.partnerShopId)
      : null;
    if (!shop) throw new NotFoundError('partner shop');
    return shop;
  }

  app.get('/partner/ambassador', async (request) => {
    return partnerProtectionView(app.ctx, await myShop(request));
  });

  app.post('/partner/ambassador/confirm', async (request) => {
    const shop = await myShop(request);
    const body = z
      .object({
        code: z
          .string({ required_error: 'Please type the code from the text.' })
          .trim()
          .min(4, 'Please type the code from the text.')
          .max(12),
      })
      .parse(request.body ?? {});
    const result = await confirmClaim(app.ctx, shop, body.code);
    return {
      ...result,
      view: await partnerProtectionView(
        app.ctx,
        (await repository.partnerShops.findById(shop.id))!,
      ),
    };
  });

  app.post('/partner/ambassador/resend', async (request) => {
    return resendClaimCode(app.ctx, await myShop(request), request.log);
  });

  app.post('/partner/ambassador/refuse', async (request) => {
    return refuseClaim(app.ctx, await myShop(request), request.log);
  });

  app.post('/partner/ambassador/report', async (request) => {
    const shop = await myShop(request);
    const body = z
      .object({
        note: z
          .string({ required_error: 'Please say what happened.' })
          .trim()
          .min(3, 'Please say what happened.')
          .max(1000),
        who: z.string().trim().max(80).default(''),
      })
      .parse(request.body ?? {});
    return reportFromBusiness(app.ctx, shop, body, request.log);
  });

  app.post('/partner/ambassador/promise', async (request) => {
    const shop = await myShop(request);
    const body = z
      .object({
        answer: z.enum(['yes', 'no'], {
          errorMap: () => ({ message: 'Please answer Yes or No.' }),
        }),
        note: z.string().trim().max(1000).default(''),
      })
      .parse(request.body ?? {});
    return answerPromise(app.ctx, shop, body.answer, body.note, request.log);
  });

  /* ------------------------------------------------------------------ staff */

  app.get('/staff/ambassador-protection/held', async (request) => {
    await staffActor(request, 'ambassadors');
    return { held: await heldShares(app.ctx) };
  });

  const byBody = z.object({ by: z.string().trim().min(1, 'Please say who it was.').max(80) });
  const idParams = z.object({ id: z.string().min(1).max(60) });

  app.post('/staff/ambassador-protection/held/:id/release', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = idParams.parse(request.params);
    const body = byBody.parse(request.body ?? {});
    return releaseHeldShare(app.ctx, id, decidedBy(actor, body.by));
  });

  app.post('/staff/ambassador-protection/held/:id/cancel', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = idParams.parse(request.params);
    const body = byBody.parse(request.body ?? {});
    return cancelHeldShare(app.ctx, id, decidedBy(actor, body.by));
  });

  /** "Check this business": links only, never called by the service. */
  app.get('/staff/partners/:id/check', async (request) => {
    await staffActor(request, 'partners');
    const { id } = idParams.parse(request.params);
    const shop = await repository.partnerShops.findById(id);
    if (!shop) throw new NotFoundError('partner shop');
    const claims = await repository.ambassadorClaims.listForShop(shop.id);
    return {
      ...businessCheck(app.ctx, shop),
      // Who brought it in first, and when (31 October 2026).
      ambassadorConfirmedAt: shop.ambassadorConfirmedAt,
      claims: claims.map((claim) => ({
        id: claim.id,
        ambassadorKind: claim.ambassadorKind,
        ambassadorId: claim.ambassadorId,
        status: claim.status,
        createdAt: claim.createdAt,
        confirmedAt: claim.confirmedAt,
        refusedReason: claim.refusedReason,
      })),
    };
  });
}
