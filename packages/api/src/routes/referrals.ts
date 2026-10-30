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

import {
  AMBASSADOR_TERMS_VERSION,
  rewardWords,
  shareWords,
  TERMS_CHANGED_WORDS,
} from '@aldilivery/core';

import type { ReferralKind } from '../domain.js';
import { BadRequestError, NotFoundError, UnauthorisedError } from '../errors.js';
import { recordAudit } from '../lib/audit.js';
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
  ambassadorTermsChanged,
} from '../services/ambassadors.js';
import { sendVoucher, staffVoucherView } from '../services/vouchers.js';
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
        // Agreed to older terms (30 October 2026): asked to agree again; withdrawals wait.
        termsChanged: ambassadorTermsChanged(agreement),
        termsChangedWords: ambassadorTermsChanged(agreement) ? TERMS_CHANGED_WORDS : null,
        link: agreement ? ambassadorLink(env.primaryOrigin ?? '', account) : null,
        termsPath: '/ambassador/terms',
        // Anthony's final ruling (30 October 2026): what each kind of business earns them.
        profitShareWords: shareWords(rates.restaurantMarkupShare),
        branchShareWords: shareWords(rates.restaurantMarkupShare * rates.branchShareFactor),
        restaurantMarkupShareWords: shareWords(rates.restaurantMarkupShare),
        restaurantDiscountShareWords: shareWords(rates.restaurantDiscountShare),
        groceryItemChargeShareWords: shareWords(rates.groceryItemChargeShare),
        groceryMarkupShareWords: shareWords(rates.groceryMarkupShare),
        groceryDiscountShareWords: shareWords(rates.groceryDiscountShare),
        branchFactorWords: shareWords(rates.branchShareFactor),
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
        canWithdraw: agreement !== null && !ambassadorTermsChanged(agreement) && summary.payable,
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

  /** Each level's sent voucher, as staff see it on the list: never the code but its last four. */
  async function withVouchers<T extends { id: string }>(levels: T[]) {
    return Promise.all(
      levels.map(async (level) => {
        const voucher = await app.ctx.repository.vouchers.findByLevel(level.id);
        return { ...level, voucher: voucher ? staffVoucherView(voucher) : null };
      }),
    );
  }

  app.get('/staff/referrals', async (request) => {
    await staffActor(request, 'referrals');
    const { search } = z
      .object({ search: z.string().trim().max(80).default('') })
      .parse(request.query ?? {});
    const referrers = await referralLog(app.ctx, search, request.log);
    return {
      levels: config.referrals.levels,
      minimumActivePercent: Math.round(config.referrals.minimumActiveShare * 100),
      givenAs: config.referrals.givenAs,
      voucherLastsYears: config.referrals.voucherLastsYears,
      ambassadorTerms: config.ambassador,
      referrers: await Promise.all(
        referrers.map(async (row) => ({ ...row, levels: await withVouchers(row.levels) })),
      ),
      ambassadors: await ambassadorLog(app.ctx, search),
    };
  });

  app.get('/staff/referrals/:kind/:id', async (request) => {
    await staffActor(request, 'referrals');
    const { kind, id } = personParams.parse(request.params);
    const detail = await referrerDetail(app.ctx, kind, id);
    return { ...detail, levels: await withVouchers(detail.levels) };
  });

  /**
   * "Send voucher" (Anthony, 30 October 2026): the code staff pasted, and a link if they have
   * one, into the person's inbox. The audit hook writes it down with the code hidden.
   */
  app.post('/staff/referrals/levels/:id/voucher', async (request, reply) => {
    const actor = await staffActor(request, 'referrals');
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const body = z
      .object({
        code: z.string().trim().min(1, 'Please paste the voucher code.').max(60),
        link: z.string().trim().max(500).optional(),
        by: z.string().trim().max(80).optional(),
      })
      .parse(request.body ?? {});
    const by = decidedBy(actor, body.by && body.by !== '' ? body.by : actor.name);
    const sent = await sendVoucher(
      app.ctx,
      { levelId: id, code: body.code, link: body.link ?? null, actor, by },
      request.log,
    );
    // Written down here, so neither the code nor the link (which may carry it) is in the log.
    await recordAudit(request, {
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: 'referrals.voucher-sent',
      target: `level=${id}`,
      detail: `${sent.voucher.label} sent by ${by}`,
    });
    void reply.status(201);
    return { voucher: staffVoucherView(sent.voucher), message: sent.message };
  });

  /**
   * Opening a sent voucher's record: the code in full, for the staff member who opens it, and
   * written in the audit log that they did.
   */
  app.get('/staff/referrals/vouchers/:id', async (request) => {
    const actor = await staffActor(request, 'referrals');
    const { id } = z.object({ id: z.string().min(1).max(60) }).parse(request.params);
    const voucher = await app.ctx.repository.vouchers.findById(id);
    if (!voucher) throw new NotFoundError('voucher');
    await recordAudit(request, {
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: 'referrals.voucher-opened',
      target: `voucher=${voucher.id}`,
      detail: `${voucher.label} for ${voucher.accountKind} ${voucher.accountId}`,
    });
    return {
      voucher: { ...staffVoucherView(voucher), code: voucher.code, link: voucher.link },
    };
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
