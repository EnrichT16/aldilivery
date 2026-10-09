/**
 * How a Runner pays at the till (Anthony, 9 October 2026): the spending card from Stripe
 * Issuing, recommended, or their own card, paid back straight away (ruling 55).
 * services/runner-card.ts has the rules; this is the Runner's side of them.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireSession } from '../app.js';
import type { Runner } from '../domain.js';
import { NotFoundError } from '../errors.js';
import { cardKey, cardView, choosePayMethod, setUpCard } from '../services/runner-card.js';

/** The internet address the Runner accepted the cardholder terms from, as Stripe asks. */
function addressOf(request: FastifyRequest): string {
  const given = request.headers['do-connecting-ip'];
  return (Array.isArray(given) ? given[0] : given) ?? request.ip;
}

const setupSchema = z.object({
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please read and accept the cardholder terms first.' }),
  }),
  address: z.object({
    line1: z.string().trim().min(1, 'Please give the first line of your address.').max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, 'Please give your town or city.').max(100),
    postcode: z
      .string()
      .trim()
      .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, 'Please give a UK postcode, like ME7 1AA.'),
  }),
  email: z.string().trim().email().max(200).optional(),
});

export async function registerRunnerCardRoutes(app: FastifyInstance): Promise<void> {
  const { repository } = app.ctx;

  async function me(request: FastifyRequest): Promise<Runner> {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    return runner;
  }

  /** Whether the card is switched on, how they pay now, and their card's last four digits. */
  app.get('/runners/me/card', async (request) => cardView(app.ctx, await me(request)));

  /** Choosing the card or their own card. */
  app.post('/runners/me/pay-method', async (request) => {
    const runner = await me(request);
    const { method } = z.object({ method: z.enum(['card', 'own']) }).parse(request.body);
    const chosen = await choosePayMethod(app.ctx, runner, method);
    return { ...cardView(app.ctx, chosen.runner), message: chosen.message };
  });

  /**
   * Accepting the cardholder terms and making the card. The address goes to Stripe for the card
   * and is not kept here; the acceptance is kept with its date and internet address.
   */
  app.post('/runners/me/card', async (request) => {
    const runner = await me(request);
    const input = setupSchema.parse(request.body);
    const userAgent = request.headers['user-agent'];
    const made = await setUpCard(app.ctx, runner, {
      address: {
        line1: input.address.line1,
        ...(input.address.line2 ? { line2: input.address.line2 } : {}),
        city: input.address.city,
        postcode: input.address.postcode.toUpperCase(),
      },
      ...(input.email ? { email: input.email } : {}),
      ip: addressOf(request),
      ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 300) } : {}),
    });
    return {
      ...cardView(app.ctx, made),
      message: `Your ${app.ctx.config.assistantName} card is ready, ending ${made.cardLast4 ?? ''}. It stays frozen until you take a job, and is loaded for each order.`,
    };
  });

  /**
   * A short-lived key for showing the card with Stripe Issuing Elements. The nonce comes from
   * Stripe.js in the Runner's browser; the card number goes from Stripe to that browser only.
   */
  app.post('/runners/me/card/key', async (request) => {
    const runner = await me(request);
    const { nonce } = z.object({ nonce: z.string().min(1).max(500) }).parse(request.body);
    return cardKey(app.ctx, runner, nonce);
  });
}
