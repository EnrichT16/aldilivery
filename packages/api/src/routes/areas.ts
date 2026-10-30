/**
 * Areas and where Runners are (Anthony, 30 October 2026). See services/areas.ts.
 *
 * Every area is open (Anthony, 30 October 2026): nothing here refuses anybody.
 *
 * - `GET /areas/check?postcode=`: the area of a postcode, its name, whether it has an approved
 *   Runner and whether it is paused. The confirmation screen asks it for the address an order is
 *   going to, to know whether to warn, gently, as the order is placed. Anybody may ask.
 * - `GET /me/area`: the same for the signed-in Shopper's home address, or `?postcode=` given.
 * - `POST /me/area/warned`: the screen showed the warning; the Shopper is texted once when a
 *   Runner joins there.
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
  noteWarned,
  openWords,
  runnerArea,
  setAreaPaused,
  type AreaState,
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

  /** What the screen is told about an area: never a refusal, only whether to warn. */
  function areaAnswer(state: AreaState) {
    return {
      area: state.area,
      name: state.name,
      hasRunner: state.hasRunner,
      paused: state.paused,
      warn: state.warn,
      words: openWords(config, state),
      ...(state.warn ? { warning: config.areas.noRunnerWords } : {}),
    };
  }

  /** The area of this postcode, and whether it has a Runner. A whole postcode, or its first half. */
  app.get('/areas/check', async (request) => {
    const { postcode } = z
      .object({ postcode: z.string().trim().min(1, NOT_A_POSTCODE).max(10) })
      .parse(request.query ?? {});
    const area = areaFor(config, postcode);
    if (!area) throw new BadRequestError(NOT_A_POSTCODE);
    return areaAnswer(await areaState(app.ctx, area));
  });

  async function shopperOf(request: Parameters<typeof requireSession>[0]) {
    const session = requireSession(request, 'shopper');
    const shopper = await repository.shoppers.findById(session.accountId);
    if (!shopper) throw new NotFoundError('account');
    return shopper;
  }

  /**
   * The signed-in Shopper's area: their home address's, or the postcode given (the address this
   * order goes to). { area, name, hasRunner, paused }, and whether to warn as they order.
   */
  app.get('/me/area', async (request) => {
    const shopper = await shopperOf(request);
    const { postcode } = z
      .object({ postcode: z.string().trim().max(10).optional() })
      .parse(request.query ?? {});
    const area = areaFor(config, postcode || shopper.deliveryAddress);
    if (!area) {
      return { area: null, name: null, hasRunner: null, paused: null, warn: false, words: null };
    }
    return areaAnswer(await areaState(app.ctx, area));
  });

  /** The warning was shown as they ordered: they are texted once when a Runner joins there. */
  app.post('/me/area/warned', async (request) => {
    const shopper = await shopperOf(request);
    const { address } = z
      .object({ address: z.string().trim().max(300).optional() })
      .parse(request.body ?? {});
    const state = await noteWarned(
      app.ctx,
      shopper,
      address || shopper.deliveryAddress,
      request.log,
    );
    return { noted: state?.warn === true };
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

  /**
   * Pause an area, or unpause it. Staff decide. A paused area still takes orders (Anthony, 30
   * October 2026): a Shopper ordering there is warned, as where there is no Runner.
   */
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
        ? `${state.name} is paused. Shoppers there can still order, and are warned as they do.`
        : `${state.name} is no longer paused.`,
    };
  });
}
