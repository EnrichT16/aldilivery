/**
 * Referral links, reward levels and Ozi Ambassadors (Anthony, 30 October 2026).
 *
 * For each person, on their own dashboard: `/referrals/me` gives their referral link, how many
 * joined through it and how many are active, their progress and the levels, what they have
 * earned, and their Ambassador link with their introduced businesses and what they have earned
 * and been paid. Never who joined, and never a shop's orders. A Shopper or Runner is known by
 * their session, a shop partner or organisation by their business sign-in.
 *
 * For staff, on the Referrals page (the `referrals` area: the founder and the operations manager
 * by default): the referral log, each person's referrals, "Mark reward given", and the
 * Ambassadors with what is pending, available, paid and taken off, "Mark paid" (only what is
 * available), withdrawals waiting for approval, and flagging.
 *
 * An Ambassador's withdrawals (ruled 30 October 2026): `/ambassador/bank` hands back a one-time
 * link to Stripe's own form for their bank details, as a Runner's payout set-up does, and
 * `/ambassador/withdraw` asks for what is available to go to their bank.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AMBASSADOR_TERMS_VERSION, rewardWords, shareWords } from '@aldilivery/core';

import type { ReferralKind } from '../domain.js';
import { BadRequestError, UnauthorisedError } from '../errors.js';
import { businessActor } from '../lib/business.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import {
  ambassadorAgreement,
  ambassadorBankReady,
  ambassadorBankSetup,
  ambassadorLink,
  ambassadorLog,
  ambassadorSummary,
  approveWithdrawal,
  becomeAmbassador,
  flagAmbassador,
  markAmbassadorPaid,
  refuseWithdrawal,
  requestWithdrawal,
  withdrawalWords,
} from '../services/ambassadors.js';
import {
  findAccount,
  markRewardGiven,
  markTold,
  myReferrals,
  referralLog,
  referrerDetail,
  REFERRAL_KINDS,
} from '../services/referrals.js';

/** Who is asking about their own referrals: a business sign-in first, then a session. */
async function whoAsks(request: FastifyRequest): Promise<{ kind: ReferralKind; id: string }> {
  if (request.headers['x-business-token']) {
    const user = await businessActor(request);
    if (user.kind === 'partner' && user.partnerShopId) {
      return { kind: 'partner', id: user.partnerShopId };
    }
    if (user.kind === 'organisation' && user.organisationId) {
      return { kind: 'organisation', id: user.organisationId };
    }
  }
  const session = request.session;
  if (session?.role === 'shopper') return { kind: 'shopper', id: session.accountId };
  if (session?.role === 'runner') return { kind: 'runner', id: session.accountId };
  throw new UnauthorisedError('Please sign in to see your referral link.');
}

const personParams = z.object({
  kind: z.enum(REFERRAL_KINDS as [ReferralKind, ...ReferralKind[]]),
  id: z.string().min(1).max(60),
});

export async function registerReferralRoutes(app: FastifyInstance): Promise<void> {
  const { config, env } = app.ctx;

  app.get('/referrals/me', async (request) => {
    const { kind, id } = await whoAsks(request);
    const account = await findAccount(app.ctx, kind, id);
    if (!account) throw new UnauthorisedError('Please sign in to see your referral link.');
    const referrals = await myReferrals(app.ctx, kind, id, request.log);
    const summary = await ambassadorSummary(app.ctx, kind, id);
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    const symbol = config.store.currencySymbol;
    const rates = config.ambassador;
    const withdrawals = agreement
      ? await app.ctx.repository.ambassadors.listWithdrawalsFor(kind, id)
      : [];
    return {
      referrals,
      ambassador: {
        // An Ambassador only once they have chosen to be one and agreed to the terms.
        joined: agreement !== null,
        agreedAt: agreement?.agreedAt ?? null,
        termsVersion: AMBASSADOR_TERMS_VERSION,
        link: agreement ? ambassadorLink(env.primaryOrigin ?? '', account) : null,
        termsPath: '/ambassador/terms',
        profitShareWords: shareWords(rates.profitShare),
        branchShareWords: shareWords(rates.profitShare * rates.branchShareFactor),
        planShareWords: shareWords(rates.planShare),
        months: rates.months,
        holdDays: rates.holdDays,
        payoutMinimumWords: rewardWords(rates.payoutMinimumPence, symbol),
        // Only the name and whether it is approved: never a shop's orders.
        businesses: summary.businesses.map((business) => ({
          name: business.name,
          approved: business.approved,
        })),
        earnedPence: summary.earnedPence,
        pendingPence: summary.pendingPence,
        availablePence: summary.availablePence,
        paidPence: summary.paidPence,
        deductions: summary.deductions.map((line) => ({ at: line.at, words: line.words })),
        canWithdraw: agreement !== null && summary.payable,
        bankReady: agreement ? await ambassadorBankReady(app.ctx, kind, id) : false,
        withdrawals: withdrawals.slice(0, 5).map((row) => ({
          id: row.id,
          requestedAt: row.requestedAt,
          words: withdrawalWords(row, symbol),
        })),
      },
    };
  });

  /** "Become an Ozi Ambassador": agreeing to the Ambassador terms, kept with the version. */
  app.post('/ambassador/join', async (request) => {
    const { kind, id } = await whoAsks(request);
    const body = z
      .object({
        termsAgreed: z.literal(true, {
          errorMap: () => ({ message: 'Please tick to agree to the Ozi Ambassador terms.' }),
        }),
        termsVersion: z.string().trim().min(1).max(40),
      })
      .parse(request.body ?? {});
    const account = await findAccount(app.ctx, kind, id);
    if (!account) throw new UnauthorisedError('Please sign in to see your referral link.');
    await becomeAmbassador(app.ctx, kind, id, body.termsVersion);
    return {
      link: ambassadorLink(env.primaryOrigin ?? '', account),
      message: `Welcome, you are now an Ozi Ambassador. Your Introduce a business link is ready to share.`,
    };
  });

  /**
   * Where their withdrawals go: a one-time link to Stripe's own form. The bank details go straight
   * to Stripe and never through the service (as `/runners/me/payouts/setup`).
   */
  app.post('/ambassador/bank', async (request) => {
    const { kind, id } = await whoAsks(request);
    const origin = request.headers.origin;
    const allowed = env.allowedOrigins.filter((one) => one !== '*');
    const webOrigin =
      typeof origin === 'string' && (env.allowedOrigins.includes('*') || allowed.includes(origin))
        ? origin
        : allowed[0];
    if (!webOrigin) {
      throw new BadRequestError('We do not know where to send you back to. Please tell us.');
    }
    return ambassadorBankSetup(app.ctx, kind, id, webOrigin);
  });

  /** Everything available, at least the minimum, to their bank: sent, or waiting for a person. */
  app.post('/ambassador/withdraw', async (request) => {
    const { kind, id } = await whoAsks(request);
    const { withdrawal, message } = await requestWithdrawal(app.ctx, kind, id, request.log);
    return { status: withdrawal.status, amountPence: withdrawal.amountPence, message };
  });

  /** Ozi has said the news of a level reached: it is not said again. */
  app.post('/referrals/me/heard', async (request) => {
    const { kind, id } = await whoAsks(request);
    return { told: await markTold(app.ctx, kind, id) };
  });

  /* ---------------------------------------------------------------- staff */

  app.get('/staff/referrals', async (request) => {
    await staffActor(request, 'referrals');
    const { search } = z
      .object({ search: z.string().trim().max(80).default('') })
      .parse(request.query ?? {});
    return {
      levels: config.referrals.levels,
      minimumActivePercent: Math.round(config.referrals.minimumActiveShare * 100),
      givenAs: config.referrals.givenAs,
      ambassadorTerms: config.ambassador,
      referrers: await referralLog(app.ctx, search, request.log),
      ambassadors: await ambassadorLog(app.ctx, search),
    };
  });

  app.get('/staff/referrals/:kind/:id', async (request) => {
    await staffActor(request, 'referrals');
    const { kind, id } = personParams.parse(request.params);
    return referrerDetail(app.ctx, kind, id);
  });

  app.post('/staff/referrals/levels/:id/given', async (request) => {
    const actor = await staffActor(request, 'referrals');
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const body = z
      .object({ by: z.string().trim().min(1, 'Please say who gave it.').max(80) })
      .parse(request.body ?? {});
    return markRewardGiven(app.ctx, id, decidedBy(actor, body.by));
  });

  app.post('/staff/ambassadors/:kind/:id/paid', async (request) => {
    const actor = await staffActor(request, 'referrals');
    const { kind, id } = personParams.parse(request.params);
    const body = z
      .object({ by: z.string().trim().min(1, 'Please say who paid it.').max(80) })
      .parse(request.body ?? {});
    return markAmbassadorPaid(app.ctx, kind, id, decidedBy(actor, body.by));
  });

  app.post('/staff/ambassadors/withdrawals/:id/approve', async (request) => {
    const actor = await staffActor(request, 'referrals');
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const body = z
      .object({ by: z.string().trim().min(1, 'Please say who approved it.').max(80) })
      .parse(request.body ?? {});
    return approveWithdrawal(app.ctx, id, decidedBy(actor, body.by), request.log);
  });

  app.post('/staff/ambassadors/withdrawals/:id/refuse', async (request) => {
    const actor = await staffActor(request, 'referrals');
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const body = z
      .object({ by: z.string().trim().min(1, 'Please say who refused it.').max(80) })
      .parse(request.body ?? {});
    return refuseWithdrawal(app.ctx, id, decidedBy(actor, body.by));
  });

  /** Flagged: every withdrawal of theirs waits for a person to approve it. */
  app.post('/staff/ambassadors/:kind/:id/flag', async (request) => {
    await staffActor(request, 'referrals');
    const { kind, id } = personParams.parse(request.params);
    const body = z
      .object({ flagged: z.boolean(), reason: z.string().trim().max(300).default('') })
      .parse(request.body ?? {});
    return flagAmbassador(app.ctx, kind, id, body.flagged, body.reason);
  });
}
