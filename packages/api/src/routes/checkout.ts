/**
 * Checkout insights (Anthony, 30 October 2026): why people do not pay.
 *
 * - The Confirm page tells us when a Shopper reaches it, with the breakdown it showed them
 *   (`POST /checkout/viewed`). Paying is recorded where every order is recorded as paid.
 * - A Shopper who leaves without paying, or presses back, may be asked once, and never more than
 *   once a day (`checkoutInsights.askOncePerHours`), a small optional question: "Can we ask what
 *   stopped you?" (`POST /checkout/why/ask`, which says whether to ask and notes that it did). A
 *   tap records the answer (`POST /checkout/why`); skipping is fine and records nothing more.
 * - Nobody is texted or emailed about a checkout they left: no marketing without consent.
 * - The Checkout insights page for staff (`GET /staff/checkout-insights`), for the founder and
 *   the operations manager, gated like the other staff pages.
 *
 * No card details, names or addresses: people are one-way codes, places postcode districts.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import { CHECKOUT_REASONS } from '../domain.js';
import { ConflictError } from '../errors.js';
import { personKey, recordCheckoutReason, recordCheckoutViewed } from '../lib/analytics.js';
import { staffActor } from '../lib/staff.js';
import { checkoutInsights, REASON_WORDS } from '../services/checkout-insights.js';

/** The question, as the Shopper sees and hears it. */
export const WHY_QUESTION = 'Can we ask what stopped you?';

const pence = z.number().int().min(0).max(10_000_000);

export async function registerCheckoutRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, env, now } = app.ctx;
  const settings = config.checkoutInsights;

  app.post('/checkout/viewed', async (request) => {
    const session = requireSession(request, 'shopper');
    const body = z
      .object({
        goodsPence: pence,
        itemChargesPence: pence,
        feePence: pence,
        totalPence: pence,
        restaurant: z.boolean().default(false),
        /** The delivery address or postcode; only its district is kept. */
        area: z.string().trim().max(300).optional(),
        noRunnerWarning: z.boolean().default(false),
        channel: z.enum(['web', 'voice']).default('web'),
      })
      .parse(request.body ?? {});
    await recordCheckoutViewed(app.ctx, {
      shopperId: session.accountId,
      goodsPence: body.goodsPence,
      itemChargesPence: body.itemChargesPence,
      feePence: body.feePence,
      totalPence: body.totalPence,
      restaurant: body.restaurant,
      area: body.area ?? null,
      noRunnerWarning: body.noRunnerWarning,
      channel: body.channel,
    });
    return { recorded: true };
  });

  /** This Shopper's question rows since a moment: asked (no answer) and answered. */
  async function askedSince(shopperId: string, since: Date) {
    const key = personKey(shopperId, env.authTokenSecret);
    return (await repository.analytics.list({ since, kind: 'checkout_reason' })).filter(
      (event) => event.shopperKey === key,
    );
  }

  function answers() {
    return CHECKOUT_REASONS.map((answer) => ({ answer, label: REASON_WORDS[answer] }));
  }

  /**
   * Whether to ask "Can we ask what stopped you?" now. Asked at most once in
   * `askOncePerHours`: when it is asked, that is noted, so it is not asked again until then.
   */
  app.post('/checkout/why/ask', async (request) => {
    const session = requireSession(request, 'shopper');
    const at = now();
    const since = new Date(at.getTime() - settings.askOncePerHours * 3_600_000);
    if ((await askedSince(session.accountId, since)).length > 0) {
      return { ask: false, question: WHY_QUESTION, answers: answers() };
    }
    await repository.analytics.record({
      at,
      kind: 'checkout_reason',
      shopperKey: personKey(session.accountId, env.authTokenSecret),
      runnerKey: null,
      shop: null,
      area: null,
      toArea: null,
      ageBand: null,
      viaOrganisation: false,
      itemCount: 0,
      goodsPence: 0,
      categories: '',
      query: null,
      travelMode: null,
      answer: null,
    });
    return { ask: true, question: WHY_QUESTION, answers: answers() };
  });

  /** A tapped answer. Only once for each time the question was asked. */
  app.post('/checkout/why', async (request) => {
    const session = requireSession(request, 'shopper');
    const body = z
      .object({
        answer: z.enum(CHECKOUT_REASONS),
        restaurant: z.boolean().default(false),
        totalPence: pence.optional(),
        area: z.string().trim().max(300).optional(),
      })
      .parse(request.body ?? {});
    const since = new Date(now().getTime() - settings.askOncePerHours * 3_600_000);
    const rows = await askedSince(session.accountId, since);
    if (rows.length === 0 || rows.some((row) => row.answer)) {
      throw new ConflictError('Thank you, we have your answer already.');
    }
    await recordCheckoutReason(app.ctx, session.accountId, body.answer, {
      restaurant: body.restaurant,
      totalPence: body.totalPence ?? null,
      area: body.area ?? null,
    });
    return { recorded: true, message: 'Thank you. That helps us get our prices right.' };
  });

  /**
   * The Checkout insights page, for a chosen period of `checkoutInsights.periodsDays` (7, 30 or
   * 90 days): the founder and the operations manager.
   */
  app.get('/staff/checkout-insights', async (request) => {
    await staffActor(request, 'insights');
    const { days } = z
      .object({
        days: z.coerce
          .number()
          .int()
          .refine((value) => settings.periodsDays.includes(value), {
            message: `Please choose ${settings.periodsDays.join(', ')} days.`,
          })
          .default(settings.periodsDays[1] ?? settings.periodsDays[0]!),
      })
      .parse(request.query ?? {});
    const at = now();
    const since = new Date(at.getTime() - days * 24 * 3_600_000);
    // Payments a little after the period's views still count for them.
    const events = (
      await Promise.all(
        (['checkout_viewed', 'checkout_paid', 'checkout_reason'] as const).map((kind) =>
          repository.analytics.list({ since, kind }),
        ),
      )
    ).flat();
    return {
      ...checkoutInsights(events, days, settings, config.store.currencySymbol),
      periods: settings.periodsDays,
    };
  });
}
