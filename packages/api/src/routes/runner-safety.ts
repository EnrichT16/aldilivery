/**
 * Keeping Runners safe (docs/BUILD_PROMPT.md, Section M; ruling 14).
 *
 * - The SOS button: start, keep the location up to date, and end. See services/sos.ts.
 * - The private page behind the link texted to the owner, which needs no sign-in, only the long
 *   random code in the link, and stops working when the link expires.
 * - The admin panel's list of every SOS still on, for staff who look after problems.
 * - What a Runner's page says about their motor insurance (services/insurance.ts).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Runner, RunnerSos } from '../domain.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import { insuranceNotice } from '../services/insurance.js';
import {
  CALL_999,
  endSos,
  hashLinkCode,
  mapsLink,
  sosPage,
  startSos,
  updateSosLocation,
} from '../services/sos.js';
import { orderReference } from './runner-account.js';

const whereabouts = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMetres: z.number().min(0).max(100_000).optional(),
});

function publicSos(sos: RunnerSos) {
  return {
    id: sos.id,
    on: sos.endedAt === null,
    startedAt: sos.startedAt,
    endedAt: sos.endedAt,
    located: sos.latitude !== null,
    locationAt: sos.locationAt,
    alerted: sos.alertSentAt !== null,
  };
}

export async function registerRunnerSafetyRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;

  async function me(request: Parameters<typeof requireSession>[0]): Promise<Runner> {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    return runner;
  }

  /** Press SOS. A location is sent when the phone gives one; it can follow a moment later. */
  app.post('/runners/me/sos', async (request, reply) => {
    const runner = await me(request);
    const body = z.object({ location: whereabouts.optional() }).parse(request.body ?? {});
    const result = await startSos(app.ctx, runner, body.location ?? null, request.log);
    void reply.status(result.alreadyOn ? 200 : 201);
    return {
      sos: publicSos(result.sos),
      call999: CALL_999,
      message: result.alerted
        ? `We have been told, with where you are. ${CALL_999}`
        : `We could not text anybody just now, but the SOS is on the staff screen. ${CALL_999}`,
    };
  });

  /** Where they are now, every few seconds while the SOS is on. */
  app.post('/runners/me/sos/location', async (request) => {
    const runner = await me(request);
    const where = whereabouts.parse(request.body ?? {});
    const sos = await repository.sos.findActiveForRunner(runner.id);
    if (!sos) throw new ConflictError('There is no SOS on.');
    return { sos: publicSos(await updateSosLocation(app.ctx, sos, where)) };
  });

  app.get('/runners/me/sos', async (request) => {
    const runner = await me(request);
    const sos = await repository.sos.findActiveForRunner(runner.id);
    return { sos: sos ? publicSos(sos) : null, call999: CALL_999 };
  });

  /** "I am safe now." The private link stops working an hour later. */
  app.post('/runners/me/sos/end', async (request) => {
    const runner = await me(request);
    const sos = await repository.sos.findActiveForRunner(runner.id);
    if (!sos) return { sos: null, message: 'There was no SOS on.' };
    const ended = await endSos(app.ctx, sos, `${runner.name}, the Runner`);
    return {
      sos: publicSos(ended),
      message: 'The SOS is off. We are glad you are safe. Tell us what happened when you can.',
    };
  });

  /** The private live-location page, for whoever has the link texted to the owner. */
  app.get('/sos/:code', async (request, reply) => {
    const { code } = z.object({ code: z.string().min(20).max(100) }).parse(request.params);
    const sos = await repository.sos.findByLinkCodeHash(hashLinkCode(code));
    const at = now();
    void reply.header('cache-control', 'no-store');
    void reply.header('x-robots-tag', 'noindex, nofollow');
    if (!sos || sos.linkExpiresAt.getTime() <= at.getTime()) {
      void reply.status(404).header('content-type', 'text/html; charset=utf-8');
      return '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Link ended</title></head><body><p>This link has ended, or was never right.</p></body></html>';
    }
    const runner = await repository.runners.findById(sos.runnerId);
    void reply.header('content-type', 'text/html; charset=utf-8');
    return sosPage({
      productName: config.productName,
      runnerName: runner?.name ?? 'A Runner',
      sos,
      at,
    });
  });

  /** For staff: every SOS still on, and those in the last day, newest first. */
  app.get('/staff/sos', async (request) => {
    await staffActor(request, 'problems');
    const at = now();
    const rows = await repository.sos.listSince(new Date(at.getTime() - 24 * 3600 * 1000));
    return {
      sos: await Promise.all(
        rows.map(async (sos) => {
          const runner = await repository.runners.findById(sos.runnerId);
          return {
            ...publicSos(sos),
            runner: runner
              ? { name: runner.name, runnerId: runner.referralCode, phone: runner.phone }
              : null,
            reference: sos.orderId ? orderReference(sos.orderId) : null,
            latitude: sos.latitude,
            longitude: sos.longitude,
            accuracyMetres: sos.accuracyMetres,
            mapsLink:
              sos.latitude !== null && sos.longitude !== null
                ? mapsLink(sos.latitude, sos.longitude)
                : null,
            endedBy: sos.endedBy,
            alertProblem: sos.alertProblem,
          };
        }),
      ),
    };
  });

  app.post('/staff/sos/:id/end', async (request) => {
    const actor = await staffActor(request, 'problems');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ by: z.string().trim().min(1, 'Please say who decided.').max(80) })
      .parse(request.body ?? {});
    const sos = await repository.sos.findById(id);
    if (!sos) throw new NotFoundError('SOS');
    if (sos.endedAt) throw new ConflictError('That SOS is already over.');
    const ended = await endSos(app.ctx, sos, decidedBy(actor, body.by));
    return { sos: publicSos(ended), message: 'Marked as over.' };
  });

  /** What their page says about their motor insurance, if anything (ruling 14). */
  app.get('/runners/me/insurance', async (request) => {
    const runner = await me(request);
    return { insurance: insuranceNotice(runner, now(), config.runners.insuranceReminderDays) };
  });
}
