/**
 * The private referral reward, for the owner alone (rulings 12 and 16). Under the Money area of
 * the admin panel, which only the owner's own account sees, signed in with the passcode. Nothing
 * about it is shown or said anywhere else in the app: it is not announced.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { decidedBy, staffActor } from '../lib/staff.js';
import { giveReward, tallyReferrals } from '../services/referral-reward.js';

export async function registerReferralRewardRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;

  app.get('/staff/referrals', async (request) => {
    await staffActor(request, 'money');
    return {
      rewardPence: config.runners.referralRewardPence,
      needed: config.runners.referralsForReward,
      referrers: await tallyReferrals(app.ctx),
      given: await repository.referralRewards.list(),
    };
  });

  app.post('/staff/referrals/reward', async (request) => {
    const actor = await staffActor(request, 'money');
    const body = z
      .object({
        referrer: z.string().regex(/^(shopper|runner):[A-Za-z0-9_-]{1,40}$/),
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
        /** Paid outside the app: how, so it can be found again. */
        byHand: z.object({ reference: z.string().trim().min(3).max(200) }).optional(),
      })
      .parse(request.body ?? {});
    return giveReward(app.ctx, {
      referrer: body.referrer,
      by: decidedBy(actor, body.by),
      byHand: body.byHand,
    });
  });
}
