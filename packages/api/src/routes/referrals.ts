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
  AMBASSADOR_ADDRESS_TYPES,
  AMBASSADOR_DOCUMENT_KINDS,
  AMBASSADOR_ID_TYPES,
  AMBASSADOR_STATUS_WORDS,
  AMBASSADOR_TERMS_VERSION,
  ambassadorApproved,
  ambassadorLinkWorks,
  COUNTER_CARD_WAIT_WORDS,
  counterCardsAllowed,
  firstNameOf,
  rewardWords,
  shareWords,
  TERMS_CHANGED_WORDS,
} from '@aldilivery/core';

import type { ReferralKind } from '../domain.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorisedError } from '../errors.js';
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
  HELD_WORDS,
  markAmbassadorPaid,
  refuseWithdrawal,
  requestWithdrawal,
  withdrawalWords,
  ambassadorTermsChanged,
} from '../services/ambassadors.js';
import {
  approveAmbassador,
  declineAmbassador,
  decideAmbassadorDocument,
  liftSuspension,
  myApplication,
  publicAmbassadorDocument,
  recordChat,
  removeForFraud,
  sendAmbassadorDocument,
  setFaceConsent,
  staffApplication,
  staffApplications,
  suspendAmbassador,
} from '../services/ambassador-applications.js';
import { checkAmbassadorDocument, checkInBackground } from '../services/auto-check.js';
import { sendVoucher, staffVoucherView } from '../services/vouchers.js';
import {
  findAccount,
  markRewardGiven,
  markTold,
  myReferrals,
  referralLink,
  referralLog,
  referrerDetail,
  REFERRAL_KINDS,
} from '../services/referrals.js';

/** Who is asking about their own referrals: a business sign-in first, then a session. */
export async function whoAsks(
  request: FastifyRequest,
): Promise<{ kind: ReferralKind; id: string }> {
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
    // Applications (Anthony, 30 October 2026): the link only for an approved Ambassador, or a
    // grandfathered one's, which keeps working; the Toolkit and withdrawals only once approved.
    const status = agreement?.status ?? null;
    const linkWorks = ambassadorLinkWorks(status);
    const approved = ambassadorApproved(status);
    const application = agreement ? await myApplication(app.ctx, agreement) : null;
    return {
      referrals,
      ambassador: {
        // Applied, at least: they chose to be one and agreed to the terms.
        joined: agreement !== null,
        status,
        statusWords: status ? AMBASSADOR_STATUS_WORDS[status] : null,
        approved,
        applicationMessage: application?.message ?? null,
        homePath: '/ambassador/home',
        applyPath: '/ambassador/apply',
        agreedAt: agreement?.agreedAt ?? null,
        termsVersion: AMBASSADOR_TERMS_VERSION,
        // Agreed to older terms (30 October 2026): asked to agree again; withdrawals wait.
        termsChanged: ambassadorTermsChanged(agreement),
        termsChangedWords: ambassadorTermsChanged(agreement) ? TERMS_CHANGED_WORDS : null,
        link: linkWorks ? ambassadorLink(env.primaryOrigin ?? '', account) : null,
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
          // The Ambassador dashboard's "My businesses" (30 October 2026): what each has earned.
          earnedPence: business.earnedPence,
        })),
        earnedPence: summary.earnedPence,
        pendingPence: summary.pendingPence,
        availablePence: summary.availablePence,
        paidPence: summary.paidPence,
        deductions: summary.deductions.map((line) => ({ at: line.at, words: line.words })),
        // Suspended (31 October 2026): what they earned is kept, held until the suspension ends.
        held: status === 'suspended',
        heldWords: status === 'suspended' ? HELD_WORDS : null,
        canApplyAgain: application?.canApplyAgain ?? false,
        canWithdraw:
          agreement !== null && approved && !ambassadorTermsChanged(agreement) && summary.payable,
        bankReady: agreement ? await ambassadorBankReady(app.ctx, kind, id) : false,
        withdrawals: withdrawals.slice(0, 5).map((row) => ({
          id: row.id,
          requestedAt: row.requestedAt,
          words: withdrawalWords(row, symbol),
        })),
      },
    };
  });

  /**
   * Applying to be an Ozi Ambassador, step one: agreeing to the Ambassador terms, kept with the
   * version (Anthony, 30 October 2026). No link yet: that comes once they are approved, after
   * their documents and a chat. Agreeing again to new terms keeps how far they have got.
   */
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
    const agreement = await becomeAmbassador(app.ctx, kind, id, body.termsVersion);
    const linkWorks = ambassadorLinkWorks(agreement.status);
    return {
      link: linkWorks ? ambassadorLink(env.primaryOrigin ?? '', account) : null,
      application: await myApplication(app.ctx, agreement),
      message: ambassadorApproved(agreement.status)
        ? 'Thank you. You have agreed to the Ozi Ambassador terms.'
        : linkWorks
          ? 'Thank you. You have agreed to the Ozi Ambassador terms. Your link keeps working.'
          : 'Thank you for applying to be an Ozi Ambassador. Next, please send your documents.',
    };
  });

  /** Their own application: its status, what is still needed and what they have sent. */
  app.get('/ambassador/application', async (request) => {
    const { kind, id } = await whoAsks(request);
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    return { application: agreement ? await myApplication(app.ctx, agreement) : null };
  });

  /**
   * The separate yes or no to comparing their face photo with the photo on their ID (Anthony,
   * 31 October 2026), kept with the moment. A face photo already waiting is looked at again.
   */
  app.post('/ambassador/face-consent', async (request) => {
    const { kind, id } = await whoAsks(request);
    const body = z
      .object({
        consent: z.boolean({
          required_error: 'Please answer yes or no.',
          invalid_type_error: 'Please answer yes or no.',
        }),
      })
      .parse(request.body ?? {});
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    if (!agreement) {
      throw new BadRequestError('Please read and agree to the Ozi Ambassador terms first.');
    }
    const { agreement: updated, faceToCheck } = await setFaceConsent(
      app.ctx,
      agreement,
      body.consent,
    );
    if (faceToCheck) {
      await checkInBackground(app.ctx, request.log, () =>
        checkAmbassadorDocument(app.ctx, faceToCheck, request.log),
      );
    }
    const current = (await ambassadorAgreement(app.ctx, kind, id)) ?? updated;
    return {
      application: await myApplication(app.ctx, current),
      message: body.consent
        ? 'Thank you. We will compare your face photo with the photo on your ID.'
        : 'Thank you. A person will check your face photo instead, in your chat with the founder.',
    };
  });

  /**
   * Step two: a document, sent from the phone as a Runner's are (routes/runner-account.ts): a
   * photo, or for a document a PDF, or a Home Office share code. Read by the automatic check in
   * the background.
   */
  app.post('/ambassador/documents', { bodyLimit: 9 * 1024 * 1024 }, async (request, reply) => {
    const { kind, id } = await whoAsks(request);
    const body = z
      .object({
        kind: z.enum(AMBASSADOR_DOCUMENT_KINDS),
        idType: z.enum(AMBASSADOR_ID_TYPES).optional(),
        addressType: z.enum(AMBASSADOR_ADDRESS_TYPES).optional(),
        image: z
          .string()
          .max(9 * 1024 * 1024)
          .optional(),
        contentType: z.string().max(40).optional(),
        shareCode: z.string().trim().max(20).optional(),
      })
      .parse(request.body ?? {});
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    if (!agreement) {
      throw new BadRequestError('Please read and agree to the Ozi Ambassador terms first.');
    }
    const document = await sendAmbassadorDocument(app.ctx, agreement, body, request.log);
    await checkInBackground(app.ctx, request.log, () =>
      checkAmbassadorDocument(app.ctx, document.id, request.log),
    );
    const latest = (await app.ctx.repository.ambassadorDocuments.findById(document.id)) ?? document;
    const current = (await ambassadorAgreement(app.ctx, kind, id)) ?? agreement;
    void reply.status(201);
    return {
      document: publicAmbassadorDocument(latest),
      application: await myApplication(app.ctx, current),
      message: 'Thank you. We will check it and let you know.',
    };
  });

  /**
   * The Ambassador Toolkit (Anthony, 30 October 2026), for approved Ambassadors only: their own
   * links for each kind of material (the business link for business materials, their referral
   * link for Shopper and Runner materials), their first name for "Your Ambassador: <first name>",
   * and the businesses they introduced, each with its shop page for a counter card and sticker.
   */
  app.get('/ambassador/toolkit', async (request) => {
    const { kind, id } = await whoAsks(request);
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    if (!agreement || !ambassadorApproved(agreement.status)) {
      throw new ForbiddenError(
        agreement?.status === 'documents_needed'
          ? 'The Ambassador Toolkit opens once your documents are checked and you have had a short chat with us.'
          : 'The Ambassador Toolkit is for approved Ozi Ambassadors.',
      );
    }
    const account = await findAccount(app.ctx, kind, id);
    if (!account) throw new UnauthorisedError('Please sign in.');
    const origin = env.primaryOrigin ?? '';
    const via = `${kind}-${encodeURIComponent(account.code)}`;
    const shops = (await app.ctx.repository.partnerShops.list()).filter(
      (shop) => shop.ambassadorKind === kind && shop.ambassadorId === id,
    );
    return {
      cardsWaitWords: COUNTER_CARD_WAIT_WORDS,
      name: account.name,
      firstName: firstNameOf(account.name),
      businessLink: ambassadorLink(origin, account),
      shopperLink: referralLink(origin, account),
      runnerLink: `${origin}/runner/sign-up?via=${via}`,
      businesses: shops.map((shop) => ({
        id: shop.id,
        name: shop.name,
        approved: shop.status === 'approved',
        statusWords:
          shop.status === 'approved'
            ? 'Approved'
            : shop.status === 'pending'
              ? 'Waiting for approval'
              : 'Removed',
        // Counter cards and window stickers only for a business that signed the partner
        // agreement in the app (Anthony, 31 October 2026); for any other, no shop link to print.
        cardsAllowed: counterCardsAllowed(shop),
        shopLink: counterCardsAllowed(shop) ? `${origin}/shops/${shop.id}` : null,
        agreementReference: shop.agreementReference,
      })),
    };
  });

  /**
   * One business's counter card or window sticker (Anthony, 31 October 2026): its name and the
   * QR link to its shop page, given only to the approved Ambassador who introduced it, and only
   * once it has signed the partner agreement in the app. Refused otherwise, with the reason.
   */
  app.get('/ambassador/cards/:shopId', async (request) => {
    const { kind, id } = await whoAsks(request);
    const agreement = await ambassadorAgreement(app.ctx, kind, id);
    if (!agreement || !ambassadorApproved(agreement.status)) {
      throw new ForbiddenError('The Ambassador Toolkit is for approved Ozi Ambassadors.');
    }
    const { shopId } = z.object({ shopId: z.string().min(1).max(60) }).parse(request.params);
    const shop = await app.ctx.repository.partnerShops.findById(shopId);
    if (!shop || shop.ambassadorKind !== kind || shop.ambassadorId !== id) {
      throw new NotFoundError('business');
    }
    if (!counterCardsAllowed(shop)) throw new ForbiddenError(COUNTER_CARD_WAIT_WORDS);
    return {
      id: shop.id,
      name: shop.name,
      shopLink: `${env.primaryOrigin ?? ''}/shops/${shop.id}`,
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

  /* ---------------------------------------------------------------- staff: applications */

  /**
   * The Ambassadors page (Anthony, 30 October 2026), for the founder and the operations manager:
   * every application by status; each one with its documents, the checks, "Chat done" with notes,
   * and Approve, Decline (with a reason the person sees) and Suspend.
   */
  app.get('/staff/ambassador-applications', async (request) => {
    await staffActor(request, 'ambassadors');
    return { groups: await staffApplications(app.ctx) };
  });

  const applicationParams = z.object({ id: z.string().min(1).max(60) });

  app.get('/staff/ambassador-applications/:id', async (request) => {
    await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    return { application: await staffApplication(app.ctx, id) };
  });

  /** "Show photo" or "Show PDF": the document's file, never kept by the browser. */
  app.get('/staff/ambassador-documents/:id/file', async (request, reply) => {
    await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const document = await app.ctx.repository.ambassadorDocuments.findById(id);
    if (!document?.image || !document.contentType) throw new NotFoundError('file');
    void reply.header('content-type', document.contentType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(document.image));
  });

  /** Accepting or turning down one document, with a reason for turning it down. */
  app.post('/staff/ambassador-documents/:id/review', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = z
      .object({
        decision: z.enum(['accept', 'reject']),
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
        note: z.string().trim().max(500).optional(),
      })
      .parse(request.body ?? {});
    const document = await app.ctx.repository.ambassadorDocuments.findById(id);
    if (!document) throw new NotFoundError('document');
    if (body.decision === 'reject' && !body.note) {
      throw new BadRequestError('Please say why, so they know what to send instead.');
    }
    const decided = await decideAmbassadorDocument(
      app.ctx,
      document,
      { decision: body.decision, by: decidedBy(actor, body.by), note: body.note ?? null },
      request.log,
    );
    return { document: publicAmbassadorDocument(decided) };
  });

  const byBody = z.object({ by: z.string().trim().min(1, 'Please say who it was.').max(80) });

  app.post('/staff/ambassador-applications/:id/chat-done', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = byBody
      .extend({ notes: z.string().trim().max(2000).default('') })
      .parse(request.body ?? {});
    return recordChat(app.ctx, id, decidedBy(actor, body.by), body.notes);
  });

  app.post('/staff/ambassador-applications/:id/approve', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = byBody.parse(request.body ?? {});
    return approveAmbassador(app.ctx, id, decidedBy(actor, body.by));
  });

  const reasonBody = byBody.extend({
    reason: z.string().trim().min(1, 'Please give the reason they will see.').max(500),
  });
  /** A date of birth from their ID, kept on the short note only if staff have it. */
  const dateOfBirth = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please give the date of birth as a date, or leave it empty.')
    .optional()
    .or(z.literal('').transform(() => undefined));

  app.post('/staff/ambassador-applications/:id/decline', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = reasonBody.extend({ dateOfBirth }).parse(request.body ?? {});
    return declineAmbassador(
      app.ctx,
      id,
      decidedBy(actor, body.by),
      body.reason,
      body.dateOfBirth ?? null,
    );
  });

  /** Ending a suspension (31 October 2026): lifted, with everything held released. */
  app.post('/staff/ambassador-applications/:id/lift', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = byBody.parse(request.body ?? {});
    return liftSuspension(app.ctx, id, decidedBy(actor, body.by), request.log);
  });

  /**
   * Ending a suspension (31 October 2026): removed for fraud. The unpaid shares from the
   * businesses marked (or all of them) are cancelled, and they may never apply again.
   */
  app.post('/staff/ambassador-applications/:id/remove-for-fraud', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = reasonBody
      .extend({
        shops: z.union([z.literal('all'), z.array(z.string().min(1).max(60)).max(500)], {
          errorMap: () => ({
            message: 'Please mark the businesses that were fraudulent, or choose all of them.',
          }),
        }),
        dateOfBirth,
      })
      .parse(request.body ?? {});
    const result = await removeForFraud(app.ctx, id, {
      by: decidedBy(actor, body.by),
      reason: body.reason,
      shops: body.shops,
      dateOfBirth: body.dateOfBirth ?? null,
    });
    await recordAudit(request, {
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: 'ambassadors.removed-for-fraud',
      target: `ambassador-application=${id}`,
      detail: result.message,
    });
    return { message: result.message };
  });

  app.post('/staff/ambassador-applications/:id/suspend', async (request) => {
    const actor = await staffActor(request, 'ambassadors');
    const { id } = applicationParams.parse(request.params);
    const body = reasonBody.parse(request.body ?? {});
    return suspendAmbassador(app.ctx, id, decidedBy(actor, body.by), body.reason);
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
