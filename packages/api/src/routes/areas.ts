/**
 * Areas and where Runners are (Anthony, 30 October 2026). See services/areas.ts.
 *
 * - `GET /areas/check?postcode=`: whether we are running in that postcode's area, for anybody,
 *   signed in or not, so Ozi can answer "Say your postcode and I'll tell you whether we're
 *   running in your area yet" truthfully, and the address screen can say so before paying.
 * - `GET /me/area`: the same for the signed-in Shopper's home address.
 * - A Runner's home postcode, and where their phone says they are while on shift.
 * - For staff with the Areas tab: every area with its counts and status, and pausing one.
 */

import { tidyPostcode } from '@aldilivery/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Runner } from '../domain.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import {
  areaCalled,
  areaFor,
  areaState,
  areaSummaries,
  locateLater,
  runnerArea,
  runningWords,
  setAreaPaused,
} from '../services/areas.js';

const NOT_A_POSTCODE = 'That does not look like a UK postcode. Please say it again, like ME7 1AA.';

const postcodeSchema = z
  .string()
  .trim()
  .max(10)
  .transform((value, context) => {
    const tidy = tidyPostcode(value);
    if (tidy === '') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: NOT_A_POSTCODE });
      return z.NEVER;
    }
    return tidy;
  });

export async function registerAreaRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, now } = app.ctx;

  async function me(request: Parameters<typeof requireSession>[0]): Promise<Runner> {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    return runner;
  }

  /** Whether we are running where this postcode is. A whole postcode, or its first half. */
  app.get('/areas/check', async (request) => {
    const { postcode } = z
      .object({ postcode: z.string().trim().min(1, NOT_A_POSTCODE).max(10) })
      .parse(request.query ?? {});
    const area = areaFor(config, postcode);
    if (!area) throw new BadRequestError(NOT_A_POSTCODE);
    const state = await areaState(app.ctx, area);
    return {
      area: state.area,
      name: state.name,
      running: state.running,
      words: runningWords(config, state),
    };
  });

  /** Whether we are running at the signed-in Shopper's home address. */
  app.get('/me/area', async (request) => {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    const area = areaFor(config, shopper.deliveryAddress);
    if (!area) return { area: null, name: null, running: null, words: null };
    const state = await areaState(app.ctx, area);
    return {
      area: state.area,
      name: state.name,
      running: state.running,
      words: runningWords(config, state),
    };
  });

  /* ------------------------------------------------------------------ Runners */

  /**
   * The Runner's home postcode, which gives their area: they are only ever offered jobs there.
   * Asked at sign-up, and on their Runner page of anybody who signed up before it was.
   */
  app.put('/runners/me/home-postcode', async (request) => {
    const runner = await me(request);
    const { postcode } = z.object({ postcode: postcodeSchema }).parse(request.body ?? {});
    const updated = await repository.runners.update(runner.id, { homePostcode: postcode });
    locateLater(app.ctx, postcode, request.log);
    const area = runnerArea(config, updated);
    return {
      homePostcode: updated.homePostcode,
      area,
      message: `Thank you. You will be offered jobs in ${area ? areaCalled(config, area) : 'your area'}.`,
    };
  });

  /**
   * Where the Runner's phone says they are: every couple of minutes while on shift, and more often
   * while they have a job in hand. Kept with the time; never shared with a Shopper. Nothing is
   * kept while they are off shift with no job.
   */
  app.post('/runners/me/location', async (request) => {
    const runner = await me(request);
    const body = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .parse(request.body ?? {});
    const inHand = (await repository.orders.listForRunner(runner.id)).some((order) =>
      ['accepted', 'shopping', 'receipt_submitted', 'delivering'].includes(order.status),
    );
    if (!runner.available && !inHand) {
      return { kept: false, message: 'You are off shift, so where you are is not kept.' };
    }
    const at = now();
    await repository.runners.update(runner.id, {
      latitude: body.latitude,
      longitude: body.longitude,
      locationAt: at,
    });
    return { kept: true, locationAt: at };
  });

  /* ------------------------------------------------------------------ staff */

  app.get('/staff/areas', async (request) => {
    await staffActor(request, 'areas');
    return { areas: await areaSummaries(app.ctx) };
  });

  /** Pause an area, or let it run again. Staff decide; a paused area takes no orders. */
  app.post('/staff/areas/:area/pause', async (request) => {
    const actor = await staffActor(request, 'areas');
    const { area } = z.object({ area: z.string().trim().min(1).max(20) }).parse(request.params);
    const body = z
      .object({
        paused: z.boolean(),
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
      })
      .parse(request.body ?? {});
    const state = await setAreaPaused(app.ctx, area, body.paused, decidedBy(actor, body.by));
    return {
      area: state,
      message: body.paused
        ? `${state.name} is paused. Nobody there can order until it is unpaused.`
        : state.ready
          ? `${state.name} is running again.`
          : `${state.name} is no longer paused. It opens by itself once it has a Runner and a shop.`,
    };
  });
}
