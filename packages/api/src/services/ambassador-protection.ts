/**
 * Protections against Ambassadors misusing the Ozi name (Anthony, 31 October 2026). The words
 * and the pure rules are in packages/core/src/ambassador-protection.ts; this is what the service
 * does with them:
 *
 * 1. The welcome text, when a business joins: the payment warning, its real terms in brief, and how
 *    to report an Ambassador, to the business's own number, once (`sendWelcomeText`).
 * 2. The public "Check an Ambassador" page (`publicCheck`): each approved Ambassador's check code,
 *    which every printed QR code carries, shows only their first name, their face photo while they
 *    are active, whether they are active, and the day they were approved. Never a surname, a phone
 *    number or an email. A suspension or removal shows at once on paper already printed.
 * 3. The business confirms an Ambassador's sign-up with a code sent to its own phone, entered on its
 *    own device in its partner dashboard (`startClaim`, `confirmClaim`). The Ambassador earns
 *    nothing from it until then, and the first confirmed claim on a business wins; a later one is
 *    refused politely.
 * 4. Shares held for a person, and staff told, when the order's Shopper is the Ambassador or the
 *    business owner by card, phone, device or delivery address (`selfDealingReason`).
 * 5. "Were you promised anything that isn't in your agreement?", asked once about a week after a
 *    business joins through an Ambassador, in the dashboard and by text (`sweepAmbassadorFollowUps`).
 *
 * Every report becomes a matter on Ozi's desk (`askOwner`), which phones the founder.
 */

import { randomInt } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import {
  ambassadorApproved,
  businessCheckLinks,
  CHECK_CODE_ALPHABET,
  firstNameOf,
  formatPence,
  freeJoiningWords,
  longDate,
  notActiveWords,
  partnerCostLines,
  sameAddress,
  welcomeTextWords,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type {
  AmbassadorAgreement,
  AmbassadorClaim,
  AmbassadorEntry,
  Order,
  PartnerShop,
  ReferralKind,
  Shopper,
} from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from '../errors.js';
import { ukPhone } from '../lib/phone.js';
import { codesMatch, generateCode, hashCode } from '../lib/tokens.js';
import { inQuietHours, askOwner, settleMattersFor } from './owner-desk.js';
import { findAccount, samePerson, shopAsAccount } from './referrals.js';

type Ctx = Pick<AppContext, 'repository' | 'config' | 'now'>;
type TextCtx = Ctx & Partial<Pick<AppContext, 'sendText'>>;
type CodeCtx = TextCtx & Pick<AppContext, 'env' | 'deliverCode'>;

function money(ctx: Ctx, pence: number): string {
  return formatPence(pence, ctx.config.store.currencySymbol);
}

/** "Ada", never "Ada Obi": the most of anybody's name these pages ever show. */
async function firstNameFor(ctx: Ctx, kind: ReferralKind, id: string): Promise<string> {
  const account = await findAccount(ctx, kind, id);
  return account ? firstNameOf(account.name) : 'An Ambassador';
}

/* ------------------------------------------------------------------ 1. the welcome text */

/**
 * The welcome text, once, to the business's own number, when it joins (agrees to the terms).
 * Without a number, or without Twilio, nothing is sent and it is tried no more. Never throws.
 */
export async function sendWelcomeText(
  ctx: TextCtx,
  shop: PartnerShop,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  if (shop.welcomeTextSentAt || !ctx.sendText) return false;
  const to = ukPhone(shop.mobile || shop.telephone || '');
  if (!to) return false;
  const words = welcomeTextWords(
    ctx.config,
    { name: shop.name, kind: shop.kind, plan: shop.plan },
    (pence) => money(ctx, pence),
  );
  try {
    await ctx.repository.partnerShops.update(shop.id, { welcomeTextSentAt: ctx.now() });
    await ctx.sendText(to, words);
    return true;
  } catch (failure) {
    log?.warn({ err: failure, shopId: shop.id }, 'The welcome text to a business did not go.');
    return false;
  }
}

/* ------------------------------------------------------------------ 2. the public check page */

/** A check code nobody has yet: six letters and numbers that are easy to read out. */
async function newCheckCode(ctx: Pick<AppContext, 'repository'>): Promise<string> {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i += 1)
      code += CHECK_CODE_ALPHABET[randomInt(CHECK_CODE_ALPHABET.length)];
    if (!(await ctx.repository.ambassadors.findAgreementByCheckCode(code))) return code;
  }
}

/** Their check code, made the first time it is needed. */
export async function ensureCheckCode(
  ctx: Pick<AppContext, 'repository'>,
  agreement: AmbassadorAgreement,
): Promise<string> {
  if (agreement.checkCode) return agreement.checkCode;
  const code = await newCheckCode(ctx);
  await ctx.repository.ambassadors.updateAgreement(agreement.id, { checkCode: code });
  return code;
}

/** The accepted face photo an Ambassador sent, if it is still kept. */
async function facePhoto(ctx: Ctx, agreement: AmbassadorAgreement) {
  return (
    (await ctx.repository.ambassadorDocuments.listForAgreement(agreement.id)).find(
      (document) =>
        document.kind === 'face_photo' &&
        document.status === 'accepted' &&
        document.image !== null &&
        document.contentType !== null &&
        document.erasedAt === null,
    ) ?? null
  );
}

export type PublicCheck =
  | { known: false; code: string; words: string }
  | {
      known: true;
      code: string;
      active: boolean;
      firstName: string;
      approvedAt: Date | null;
      approvedWords: string | null;
      hasPhoto: boolean;
      words: string;
    };

/**
 * What anybody may see about a check code: the first name, whether they are active, the day they
 * were approved, and whether there is a face photo to show (only while active). Nothing else.
 */
export async function publicCheck(ctx: Ctx, typed: string): Promise<PublicCheck> {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  const settings = ctx.config.ambassadorProtection;
  const agreement = /^[A-Z2-9]{6}$/.test(code)
    ? await ctx.repository.ambassadors.findAgreementByCheckCode(code)
    : null;
  if (!agreement) return { known: false, code, words: settings.unknownCodeWords };
  const active = ambassadorApproved(agreement.status);
  const firstName = await firstNameFor(ctx, agreement.accountKind, agreement.accountId);
  return {
    known: true,
    code,
    active,
    firstName,
    approvedAt: agreement.approvedAt,
    approvedWords: agreement.approvedAt ? longDate(agreement.approvedAt) : null,
    hasPhoto: active && (await facePhoto(ctx, agreement)) !== null,
    words: active
      ? `${firstName} is an active Ambassador${agreement.approvedAt ? `, approved on ${longDate(agreement.approvedAt)}` : ''}.`
      : notActiveWords(ctx.config),
  };
}

/** The face photo for an active Ambassador's check code, or null. */
export async function checkPhoto(
  ctx: Ctx,
  typed: string,
): Promise<{ image: Uint8Array; contentType: string } | null> {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z2-9]{6}$/.test(code)) return null;
  const agreement = await ctx.repository.ambassadors.findAgreementByCheckCode(code);
  if (!agreement || !ambassadorApproved(agreement.status)) return null;
  const photo = await facePhoto(ctx, agreement);
  return photo?.image && photo.contentType
    ? { image: photo.image, contentType: photo.contentType }
    : null;
}

/** "Report it", from the public check page: a matter on Ozi's desk naming the Ambassador. */
export async function reportFromCheck(
  ctx: Ctx,
  typed: string,
  note: string,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const code = typed.toUpperCase().replace(/[\s-]/g, '');
  const agreement = /^[A-Z2-9]{6}$/.test(code)
    ? await ctx.repository.ambassadors.findAgreementByCheckCode(code)
    : null;
  if (!agreement) throw new NotFoundError('Ambassador');
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  const status = ambassadorApproved(agreement.status) ? 'active' : 'not active';
  await askOwner(
    ctx,
    {
      kind: 'ambassador_report',
      subjectId: `check:${agreement.id}:${ctx.now().getTime()}`,
      summary: `Somebody reported Ambassador ${account?.name ?? 'unknown'}, check code ${code}, who is ${status}.${note ? ` They said: ${note}` : ''}`,
      options: 'acknowledge',
    },
    log,
  );
  return { message: 'Thank you. We have told the founder, who will look into it.' };
}

/**
 * A simple count of how often one internet address did something in ten minutes, kept in memory
 * as the sign-in limits are: one server, and a restart forgetting who asked is harmless.
 */
export function tenMinuteLimit(now: () => Date) {
  const seen = new Map<string, number[]>();
  return (key: string, most: number): void => {
    const at = now().getTime();
    const recent = (seen.get(key) ?? []).filter((time) => at - time < 600_000);
    if (recent.length >= most) {
      throw new TooManyRequestsError(
        'Too many tries from here. Please wait ten minutes and try again.',
      );
    }
    recent.push(at);
    seen.set(key, recent);
    if (seen.size > 20_000) {
      for (const [k, times] of seen)
        if (times.every((time) => at - time >= 600_000)) seen.delete(k);
    }
  };
}

/* ------------------------------------------------------------------ 3. the business confirms */

/** Whether an Ambassador may earn from this business: confirmed, or from before confirmation. */
export function ambassadorMayEarn(
  shop: Pick<PartnerShop, 'ambassadorConfirmNeeded' | 'ambassadorConfirmedAt'>,
): boolean {
  return !shop.ambassadorConfirmNeeded || shop.ambassadorConfirmedAt !== null;
}

/** What a business or Ambassador is told when another Ambassador brought the business in first. */
export const FIRST_CLAIM_WORDS =
  'Thank you. Another Ambassador introduced this business to us first, so this introduction cannot be counted. Nothing changes for the business.';

/**
 * Another Ambassador's confirmed introduction of this business (the same listing, or one with the
 * same phone number or email), made before: the first confirmed claim wins.
 */
export async function earlierClaim(
  ctx: Pick<AppContext, 'repository'>,
  shop: PartnerShop,
  kind: ReferralKind,
  id: string,
): Promise<PartnerShop | null> {
  const owner = shopAsAccount(shop);
  for (const other of await ctx.repository.partnerShops.list()) {
    if (!other.ambassadorKind || !other.ambassadorId || !other.ambassadorConfirmedAt) continue;
    if (other.ambassadorKind === kind && other.ambassadorId === id) continue;
    if (other.id === shop.id || samePerson(owner, shopAsAccount(other))) return other;
  }
  return null;
}

/**
 * The text that goes with the code, from the business's own number's point of view: who signed it
 * up, and what to do. The code itself goes by the same one-time code text everybody gets.
 */
function claimTextWords(ctx: Ctx, shop: PartnerShop, firstName: string): string {
  return `${ctx.config.productName}: ${firstName}, an Ambassador, signed up ${shop.name}. If that is right, sign in to your partner dashboard on your own phone or computer and type the code we have just sent. ${freeJoiningWords(ctx.config)}`;
}

/** Makes and sends a new code for a waiting claim: true when it went. */
async function sendClaimCode(
  ctx: CodeCtx,
  claim: AmbassadorClaim,
  shop: PartnerShop,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  const to = ukPhone(shop.mobile);
  if (!to) return false;
  const code = generateCode(6);
  const at = ctx.now();
  await ctx.repository.ambassadorClaims.update(claim.id, {
    codeHash: hashCode(code, ctx.env.authTokenSecret),
    codeExpiresAt: new Date(
      at.getTime() + ctx.config.ambassadorProtection.confirmCodeMinutes * 60_000,
    ),
    codeSentAt: at,
    attempts: 0,
  });
  try {
    if (ctx.sendText) {
      await ctx.sendText(
        to,
        claimTextWords(
          ctx,
          shop,
          await firstNameFor(ctx, claim.ambassadorKind, claim.ambassadorId),
        ),
      );
    }
    await ctx.deliverCode(to, code);
    return true;
  } catch (failure) {
    log?.warn({ err: failure, shopId: shop.id }, 'A business confirmation code did not go.');
    return false;
  }
}

/**
 * An Ambassador signed this business up: their claim waits for the business to confirm with the
 * code sent to its own phone. Until then they earn nothing from it.
 */
export async function startClaim(
  ctx: CodeCtx,
  shop: PartnerShop,
  kind: ReferralKind,
  id: string,
  log?: FastifyBaseLogger,
): Promise<{ sent: boolean }> {
  await ctx.repository.partnerShops.update(shop.id, {
    ambassadorConfirmNeeded: true,
    ambassadorConfirmedAt: null,
  });
  const claim = await ctx.repository.ambassadorClaims.create({
    partnerShopId: shop.id,
    ambassadorKind: kind,
    ambassadorId: id,
  });
  return { sent: await sendClaimCode(ctx, claim, shop, log) };
}

/**
 * A business that joined by itself through an Ambassador's link or code, on its own device: its own
 * sign-up is the confirmation. Refused politely when another Ambassador's claim came first.
 */
export async function confirmOwnSignUp(
  ctx: Ctx,
  shop: PartnerShop,
  kind: ReferralKind,
  id: string,
): Promise<{ confirmed: boolean }> {
  const at = ctx.now();
  if (await earlierClaim(ctx, shop, kind, id)) {
    await ctx.repository.ambassadorClaims.create({
      partnerShopId: shop.id,
      ambassadorKind: kind,
      ambassadorId: id,
      status: 'refused',
      refusedReason: 'Another Ambassador introduced this business first.',
    });
    await ctx.repository.partnerShops.update(shop.id, { ambassadorKind: null, ambassadorId: null });
    return { confirmed: false };
  }
  await ctx.repository.ambassadorClaims.create({
    partnerShopId: shop.id,
    ambassadorKind: kind,
    ambassadorId: id,
    status: 'confirmed',
    confirmedAt: at,
  });
  await ctx.repository.partnerShops.update(shop.id, { ambassadorConfirmedAt: at });
  return { confirmed: true };
}

/** The claim on this business still waiting for its code, if any. */
async function waitingClaim(ctx: Pick<AppContext, 'repository'>, shop: PartnerShop) {
  return (
    (await ctx.repository.ambassadorClaims.listForShop(shop.id)).find(
      (claim) => claim.status === 'waiting',
    ) ?? null
  );
}

/**
 * The business types the code from its own phone, signed in on its own device: the Ambassador's
 * introduction is confirmed, with the moment, and they may earn from now. A later claim, after
 * another Ambassador's confirmed one, is refused politely.
 */
export async function confirmClaim(
  ctx: Ctx & Pick<AppContext, 'env'>,
  shop: PartnerShop,
  code: string,
): Promise<{ message: string; confirmed: boolean }> {
  const claim = await waitingClaim(ctx, shop);
  if (!claim) throw new ConflictError('There is nothing waiting to be confirmed.');
  const settings = ctx.config.ambassadorProtection;
  if (
    !claim.codeHash ||
    !claim.codeExpiresAt ||
    claim.codeExpiresAt.getTime() <= ctx.now().getTime()
  ) {
    throw new BadRequestError('That code has run out. Press "Send me a new code".');
  }
  if (claim.attempts >= settings.confirmCodeTries) {
    throw new TooManyRequestsError(
      'That code was tried too many times. Press "Send me a new code".',
    );
  }
  if (!codesMatch(code.replace(/\s/g, ''), claim.codeHash, ctx.env.authTokenSecret)) {
    await ctx.repository.ambassadorClaims.update(claim.id, { attempts: claim.attempts + 1 });
    throw new BadRequestError('That code was not right. Please try again.');
  }
  const at = ctx.now();
  if (await earlierClaim(ctx, shop, claim.ambassadorKind, claim.ambassadorId)) {
    await ctx.repository.ambassadorClaims.update(claim.id, {
      status: 'refused',
      codeHash: null,
      refusedReason: 'Another Ambassador introduced this business first.',
    });
    await ctx.repository.partnerShops.update(shop.id, { ambassadorKind: null, ambassadorId: null });
    return { confirmed: false, message: FIRST_CLAIM_WORDS };
  }
  await ctx.repository.ambassadorClaims.update(claim.id, {
    status: 'confirmed',
    confirmedAt: at,
    codeHash: null,
  });
  await ctx.repository.partnerShops.update(shop.id, {
    ambassadorKind: claim.ambassadorKind,
    ambassadorId: claim.ambassadorId,
    ambassadorConfirmedAt: at,
  });
  const name = await firstNameFor(ctx, claim.ambassadorKind, claim.ambassadorId);
  return {
    confirmed: true,
    message: `Thank you. You have confirmed that ${name} introduced your business.`,
  };
}

/** "Send me a new code": at most once a minute. */
export async function resendClaimCode(
  ctx: CodeCtx,
  shop: PartnerShop,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const claim = await waitingClaim(ctx, shop);
  if (!claim) throw new ConflictError('There is nothing waiting to be confirmed.');
  if (claim.codeSentAt && ctx.now().getTime() - claim.codeSentAt.getTime() < 60_000) {
    throw new TooManyRequestsError('Please wait a minute before asking for another code.');
  }
  const sent = await sendClaimCode(ctx, claim, shop, log);
  return {
    message: sent
      ? 'We have sent a new code to your business mobile.'
      : 'We could not send a code just now. Please try again later, or ring us.',
  };
}

/**
 * "This person did not sign us up": the claim is refused, the Ambassador is no longer tied to the
 * business, and the founder is told.
 */
export async function refuseClaim(
  ctx: Ctx,
  shop: PartnerShop,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const claim = await waitingClaim(ctx, shop);
  if (!claim) throw new ConflictError('There is nothing waiting to be confirmed.');
  await ctx.repository.ambassadorClaims.update(claim.id, {
    status: 'refused',
    codeHash: null,
    refusedReason: 'The business said this Ambassador did not sign it up.',
  });
  await ctx.repository.partnerShops.update(shop.id, { ambassadorKind: null, ambassadorId: null });
  const account = await findAccount(ctx, claim.ambassadorKind, claim.ambassadorId);
  await askOwner(
    ctx,
    {
      kind: 'ambassador_report',
      subjectId: `claim:${claim.id}`,
      summary: `${shop.name} says Ambassador ${account?.name ?? 'unknown'} did not sign it up. The introduction is not counted.`,
      options: 'acknowledge',
    },
    log,
  );
  return { message: 'Thank you. The introduction is not counted, and we have told the founder.' };
}

/* ------------------------------------------------------------------ the partner dashboard */

/** When "Were you promised anything" is due for this business, or null if it is not asked. */
function promiseDueAt(ctx: Ctx, shop: PartnerShop): Date | null {
  if (!shop.ambassadorKind || !shop.ambassadorId || !shop.ambassadorConfirmedAt) return null;
  if (shop.promiseAnsweredAt) return null;
  const days = ctx.config.ambassadorProtection.promisedAskAfterDays;
  return new Date(shop.ambassadorConfirmedAt.getTime() + days * 24 * 3_600_000);
}

function promiseDue(ctx: Ctx, shop: PartnerShop): boolean {
  const due = promiseDueAt(ctx, shop);
  return due !== null && due.getTime() <= ctx.now().getTime();
}

/** Everything the partner dashboard shows about joining being free, and its Ambassador. */
export async function partnerProtectionView(ctx: Ctx, shop: PartnerShop) {
  const settings = ctx.config.ambassadorProtection;
  const claim = await waitingClaim(ctx, shop);
  const tiedKind = claim?.ambassadorKind ?? shop.ambassadorKind;
  const tiedId = claim?.ambassadorId ?? shop.ambassadorId;
  return {
    freeJoiningWords: freeJoiningWords(ctx.config),
    costLines: partnerCostLines(ctx.config, (pence) => money(ctx, pence)),
    ambassador:
      tiedKind && tiedId
        ? {
            firstName: await firstNameFor(ctx, tiedKind, tiedId),
            confirmed: shop.ambassadorConfirmedAt !== null && claim === null,
            confirmedAt: claim ? null : shop.ambassadorConfirmedAt,
            waiting: claim !== null,
          }
        : null,
    promise: promiseDue(ctx, shop) ? { question: settings.promisedQuestion } : null,
  };
}

/** "Report an Ambassador", from the partner dashboard: a matter naming the Ambassador. */
export async function reportFromBusiness(
  ctx: Ctx,
  shop: PartnerShop,
  input: { note: string; who: string },
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  const name =
    shop.ambassadorKind && shop.ambassadorId
      ? ((await findAccount(ctx, shop.ambassadorKind, shop.ambassadorId))?.name ?? null)
      : null;
  const who = input.who.trim();
  await askOwner(
    ctx,
    {
      kind: 'ambassador_report',
      subjectId: `business:${shop.id}:${ctx.now().getTime()}`,
      summary: `${shop.name} reported ${who !== '' ? `an Ambassador, ${who}` : name ? `its Ambassador, ${name}` : 'an Ambassador'}.${who !== '' && name ? ` Its own Ambassador is ${name}.` : ''} They said: ${input.note}`,
      options: 'acknowledge',
    },
    log,
  );
  return { message: 'Thank you. We have told the founder, who will look into it.' };
}

/** Yes or No to "Were you promised anything…": a Yes is a matter naming the Ambassador. */
export async function answerPromise(
  ctx: Ctx,
  shop: PartnerShop,
  answer: 'yes' | 'no',
  note: string,
  log?: FastifyBaseLogger,
): Promise<{ message: string }> {
  if (shop.promiseAnsweredAt) throw new ConflictError('You have answered this already. Thank you.');
  if (!promiseDue(ctx, shop)) throw new ConflictError('There is no question waiting for you.');
  await ctx.repository.partnerShops.update(shop.id, {
    promiseAnswer: answer,
    promiseNote: answer === 'yes' ? note : null,
    promiseAnsweredAt: ctx.now(),
  });
  if (answer === 'no') return { message: 'Thank you for telling us.' };
  const name =
    shop.ambassadorKind && shop.ambassadorId
      ? ((await findAccount(ctx, shop.ambassadorKind, shop.ambassadorId))?.name ?? 'unknown')
      : 'unknown';
  await askOwner(
    ctx,
    {
      kind: 'ambassador_promise',
      subjectId: shop.id,
      summary: `${shop.name} says Ambassador ${name} promised something that is not in its agreement.${note ? ` They said: ${note}` : ''}`,
      options: 'acknowledge',
    },
    log,
  );
  return { message: 'Thank you for telling us. The founder will look into it.' };
}

/**
 * The text of "Were you promised anything…", once, when it is due, never in the quiet hours.
 * Returns how many were sent. Run on a timer by the server.
 */
export async function sweepAmbassadorFollowUps(
  ctx: TextCtx,
  log?: FastifyBaseLogger,
): Promise<number> {
  if (!ctx.sendText) return 0;
  const at = ctx.now();
  if (inQuietHours(at, ctx.config.areas.textQuietFrom, ctx.config.areas.textQuietUntil)) return 0;
  let sent = 0;
  for (const shop of await ctx.repository.partnerShops.list()) {
    if (shop.promiseTextSentAt || !promiseDue(ctx, shop)) continue;
    const to = ukPhone(shop.mobile);
    await ctx.repository.partnerShops.update(shop.id, { promiseTextSentAt: at });
    if (!to) continue;
    try {
      await ctx.sendText(
        to,
        `${ctx.config.productName}: ${ctx.config.ambassadorProtection.promisedQuestion} Please answer Yes or No in your partner dashboard.`,
      );
      sent += 1;
    } catch (failure) {
      log?.warn({ err: failure, shopId: shop.id }, 'A "were you promised" text did not go.');
    }
  }
  return sent;
}

/* ------------------------------------------------------------------ 4. fake orders */

function phonesOf(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => (value ? (ukPhone(value) ?? value.replace(/\D/g, '')) : ''))
    .filter((value) => value !== '');
}

/** Shoppers with any of these phone numbers. */
async function shoppersByPhone(ctx: Ctx, phones: string[]): Promise<Shopper[]> {
  const found = new Map<string, Shopper>();
  for (const phone of phones) {
    const shopper = await ctx.repository.shoppers.findByPhone(phone);
    if (shopper) found.set(shopper.id, shopper);
  }
  return [...found.values()];
}

async function addressesOf(ctx: Ctx, shoppers: Shopper[]): Promise<string[]> {
  const addresses: string[] = [];
  for (const shopper of shoppers) {
    addresses.push(shopper.deliveryAddress);
    for (const saved of await ctx.repository.savedAddresses.listForShopper(shopper.id)) {
      addresses.push(saved.address);
    }
  }
  return addresses;
}

/** The app's device ids seen with these Shoppers and any other accounts named. */
async function devicesOf(
  ctx: Ctx,
  shoppers: Shopper[],
  others: Array<{ kind: 'shopper' | 'runner' | 'partner'; id: string }> = [],
): Promise<Set<string>> {
  const devices = new Set<string>();
  const accounts = [
    ...shoppers.map((shopper) => ({ kind: 'shopper' as const, id: shopper.id })),
    ...others,
  ];
  for (const account of accounts) {
    for (const device of await ctx.repository.deviceSightings.listForAccount(
      account.kind,
      account.id,
    )) {
      devices.add(device);
    }
  }
  return devices;
}

async function cardsOf(
  ctx: Ctx & Partial<Pick<AppContext, 'payments'>>,
  shoppers: Shopper[],
): Promise<Set<string>> {
  const prints = new Set<string>();
  if (!ctx.payments) return prints;
  for (const shopper of shoppers) {
    for (const method of await ctx.repository.paymentMethods.listForShopper(shopper.id)) {
      try {
        const print = await ctx.payments.cardFingerprint(method.stripePaymentMethodId);
        if (print) prints.add(print);
      } catch {
        // Not known to Stripe: nothing to compare.
      }
    }
  }
  return prints;
}

/** The fingerprint of the card the order was paid with, or null. */
async function orderCard(
  ctx: Ctx & Partial<Pick<AppContext, 'payments'>>,
  order: Order,
): Promise<string | null> {
  if (!ctx.payments || !order.paymentMethodId) return null;
  // Kept as our own saved card's id or as Stripe's payment method itself.
  const saved = await ctx.repository.paymentMethods.findById(order.paymentMethodId);
  try {
    return await ctx.payments.cardFingerprint(
      saved?.stripePaymentMethodId ?? order.paymentMethodId,
    );
  } catch {
    return null;
  }
}

/**
 * Why a share on this order must wait for a person: the order's Shopper (or whoever paid) is the
 * Ambassador's own account, or has the Ambassador's or the business owner's phone number, card,
 * device or delivery address. Null for a real, distinct Shopper.
 */
export async function selfDealingReason(
  ctx: Ctx & Partial<Pick<AppContext, 'payments'>>,
  order: Order,
  shop: PartnerShop,
): Promise<string | null> {
  if (!shop.ambassadorKind || !shop.ambassadorId) return null;
  const kind = shop.ambassadorKind;
  const id = shop.ambassadorId;
  const buyers: Shopper[] = [];
  for (const shopperId of new Set([order.shopperId, order.payerShopperId ?? order.shopperId])) {
    const found = await ctx.repository.shoppers.findById(shopperId);
    if (found) buyers.push(found);
  }
  if (kind === 'shopper' && buyers.some((buyer) => buyer.id === id)) {
    return "The Shopper is the Ambassador's own account.";
  }
  const ambassador = await findAccount(ctx, kind, id);
  const ambassadorPhones = ambassador?.phones ?? [];
  const ownerPhones = shopAsAccount(shop).phones;
  const buyerPhones = phonesOf(buyers.map((buyer) => buyer.phone));
  if (buyerPhones.some((phone) => ambassadorPhones.includes(phone))) {
    return "The Shopper's phone number is the Ambassador's own.";
  }
  if (buyerPhones.some((phone) => ownerPhones.includes(phone))) {
    return "The Shopper's phone number is the business owner's.";
  }

  const ambassadorShoppers = (await shoppersByPhone(ctx, ambassadorPhones)).filter(
    (person) => !buyers.some((buyer) => buyer.id === person.id),
  );
  if (kind === 'shopper' && !ambassadorShoppers.some((person) => person.id === id)) {
    const own = await ctx.repository.shoppers.findById(id);
    if (own) ambassadorShoppers.push(own);
  }
  const ownerShoppers = (await shoppersByPhone(ctx, ownerPhones)).filter(
    (person) => !buyers.some((buyer) => buyer.id === person.id),
  );

  const ambassadorPlaces = await addressesOf(ctx, ambassadorShoppers);
  if (kind === 'partner') {
    const theirs = await ctx.repository.partnerShops.findById(id);
    if (theirs) ambassadorPlaces.push(`${theirs.address}, ${theirs.postcode}`);
  }
  if (ambassadorPlaces.some((place) => sameAddress(order.deliveryAddress, place))) {
    return "The delivery address is the Ambassador's own.";
  }
  const ownerPlaces = [
    `${shop.address}, ${shop.postcode}`,
    ...(await addressesOf(ctx, ownerShoppers)),
  ];
  if (ownerPlaces.some((place) => sameAddress(order.deliveryAddress, place))) {
    return "The delivery address is the business owner's.";
  }

  const buyerDevices = await devicesOf(ctx, buyers);
  if (buyerDevices.size > 0) {
    const theirs = await devicesOf(
      ctx,
      ambassadorShoppers,
      kind === 'runner' || kind === 'partner' ? [{ kind, id }] : [],
    );
    if ([...buyerDevices].some((device) => theirs.has(device))) {
      return "The Shopper's device is the Ambassador's own.";
    }
    // The owner's partner dashboard, signed in on the same phone, counts too.
    const owners = await devicesOf(ctx, ownerShoppers, [{ kind: 'partner', id: shop.id }]);
    if ([...buyerDevices].some((device) => owners.has(device))) {
      return "The Shopper's device is the business owner's.";
    }
  }

  const card = await orderCard(ctx, order);
  if (card) {
    if ((await cardsOf(ctx, ambassadorShoppers)).has(card)) {
      return "The Shopper's card is the Ambassador's own.";
    }
    if ((await cardsOf(ctx, ownerShoppers)).has(card)) {
      return "The Shopper's card is the business owner's.";
    }
  }
  return null;
}

/**
 * A share was held: the Ambassador is flagged, so every withdrawal waits for a person, and Ozi's
 * desk is told.
 */
export async function raiseHeldShare(
  ctx: Ctx,
  entry: AmbassadorEntry,
  shop: PartnerShop,
  log?: FastifyBaseLogger,
): Promise<void> {
  const agreement = await ctx.repository.ambassadors.findAgreement(
    entry.ambassadorKind,
    entry.ambassadorId,
  );
  if (agreement && !agreement.flaggedAt) {
    await ctx.repository.ambassadors.updateAgreement(agreement.id, {
      flaggedAt: ctx.now(),
      flagReason: `A share was held for a check: ${entry.heldReason ?? ''}`.trim(),
    });
  }
  const account = await findAccount(ctx, entry.ambassadorKind, entry.ambassadorId);
  await askOwner(
    ctx,
    {
      kind: 'ambassador_share_held',
      subjectId: entry.reference,
      summary: `A share for Ambassador ${account?.name ?? 'unknown'} on an order from ${shop.name} is held for a check. ${entry.heldReason ?? ''}`,
      options: 'acknowledge',
    },
    log,
  );
}

/** Every held share, for staff, newest first. */
export async function heldShares(ctx: Ctx) {
  const rows = [];
  for (const entry of (await ctx.repository.ambassadors.list()).filter((row) => row.heldAt)) {
    const account = await findAccount(ctx, entry.ambassadorKind, entry.ambassadorId);
    const shop = entry.partnerShopId
      ? await ctx.repository.partnerShops.findById(entry.partnerShopId)
      : null;
    rows.push({
      id: entry.id,
      ambassadorName: account?.name ?? 'Unknown',
      business: shop?.name ?? 'A business',
      orderId: entry.orderId,
      amountPence: entry.amountPence,
      amountWords: money(ctx, entry.amountPence),
      heldAt: entry.heldAt,
      reason: entry.heldReason ?? '',
    });
  }
  return rows.sort((a, b) => (b.heldAt?.getTime() ?? 0) - (a.heldAt?.getTime() ?? 0));
}

async function heldEntry(ctx: Ctx, entryId: string): Promise<AmbassadorEntry> {
  const entry = (await ctx.repository.ambassadors.list()).find((row) => row.id === entryId);
  if (!entry) throw new NotFoundError('share');
  if (!entry.heldAt) throw new ConflictError('That share is not held.');
  return entry;
}

/** Staff checked a held share and it is real: it counts again, as if never held. */
export async function releaseHeldShare(ctx: Ctx, entryId: string, by: string) {
  const entry = await heldEntry(ctx, entryId);
  await ctx.repository.ambassadors.updateEntry(entry.id, { heldAt: null, heldReason: null });
  await settleMattersFor(ctx, 'ambassador_share_held', entry.reference, 'panel', by);
  return { message: `The share of ${money(ctx, entry.amountPence)} is released, by ${by}.` };
}

/** Staff checked a held share and it is not real: cancelled, with the reason kept. */
export async function cancelHeldShare(ctx: Ctx, entryId: string, by: string) {
  const entry = await heldEntry(ctx, entryId);
  await ctx.repository.ambassadors.updateEntry(entry.id, {
    heldAt: null,
    amountPence: 0,
    cancelledAt: ctx.now(),
    cancelledPence: entry.amountPence,
    cancelReason: `Held for a check and cancelled by ${by}: ${entry.heldReason ?? ''}`.trim(),
  });
  await settleMattersFor(ctx, 'ambassador_share_held', entry.reference, 'panel', by);
  return { message: `The share of ${money(ctx, entry.amountPence)} is cancelled, by ${by}.` };
}

/**
 * The staff "Check this business" panel: links to the Companies House search and the Food
 * Standards Agency hygiene rating search, filled in with the name and postcode. Never called by us.
 */
export function businessCheck(ctx: Pick<AppContext, 'config'>, shop: PartnerShop) {
  return {
    name: shop.name,
    postcode: shop.postcode,
    ...businessCheckLinks(ctx.config.ambassadorProtection, shop),
  };
}
