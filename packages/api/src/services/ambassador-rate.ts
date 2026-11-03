/**
 * An Ambassador's link in the owner's and staff's hands, and an individual rate (Anthony, 3
 * November 2026, ruling 94).
 *
 * A Runner approved as an Ambassador has introduced three businesses; the founder will speak to
 * them himself and wants them to sign up through her link, so the reward goes to her. So the
 * owner, and staff whose area covers Ambassadors, can see and send any approved Ambassador's
 * business sign-up link, check code, check link and QR code (`ambassadorLinks`), and text the link
 * to a business from Ozi (`textAmbassadorLink`): one text, in fixed words, through the same Twilio
 * sender as every other text, limited to `ambassador.linkTextsPerDay` a day for each member of
 * staff, written in the audit log as that person's action with the number, and the number kept
 * nowhere else. A pending or declined Ambassador has no link to send, and the words say so.
 *
 * The owner alone may grant one Ambassador an individual rate (`setAmbassadorRate`): said as a
 * percentage in place of the standard restaurant mark-up share ("3% where others earn 2%"), kept
 * as the multiplier on every percentage share (1.5), capped at
 * `ambassador.maxIndividualRatePercent`, and written in the audit log with the rate before and
 * after and who set it. It applies to new shares from that moment (services/ambassadors.ts keeps
 * each share's own multiplier); nothing already earned is ever worked out again. The Partner Plus
 * one-off and the prizes are unchanged by it.
 */

import {
  AMBASSADOR_STATUS_WORDS,
  ambassadorApproved,
  ambassadorLinkWorks,
  checkLink,
  firstNameOf,
  individualRateMultiplier,
  individualRatePercent,
  individualRateProblem,
  individualRateWords,
  linkAloud,
  standardRatePercent,
  ukStartOfDay,
} from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { AmbassadorAgreement } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from '../errors.js';
import { isUkMobile, NOT_A_UK_NUMBER, ukPhone } from '../lib/phone.js';
import { ambassadorLink } from './ambassadors.js';
import { ensureCheckCode } from './ambassador-protection.js';
import { findAccount, KIND_WORDS } from './referrals.js';

type Ctx = Pick<AppContext, 'repository' | 'config' | 'now'> &
  Partial<Pick<AppContext, 'env' | 'sendText'>>;

/** Who did it, as the audit log records them: in the panel or by voice. */
export interface ActingPerson {
  actorId: string | null;
  name: string;
  /** "owner" for the owner's own account, else their staff role. */
  role: string;
  via: 'panel' | 'voice';
  ip?: string;
}

/** The individual rate as people see it (ruling 94). */
export interface RateView {
  /** The rate as a percentage: 3 for "3%". */
  percent: number;
  standardPercent: number;
  /** The owner set one above the standard rate. */
  individual: boolean;
  multiplier: number;
  /** "3%, where the standard rate is 2%", or "the standard rate of 2%". */
  words: string;
  setAt: Date | null;
  setBy: string | null;
}

export function rateView(
  ctx: Pick<AppContext, 'config'>,
  agreement: AmbassadorAgreement,
): RateView {
  const settings = ctx.config.ambassador;
  const multiplier =
    Number.isFinite(agreement.shareMultiplier) && agreement.shareMultiplier > 0
      ? agreement.shareMultiplier
      : 1;
  return {
    percent: individualRatePercent(multiplier, settings),
    standardPercent: standardRatePercent(settings),
    individual: multiplier !== 1,
    multiplier,
    words: individualRateWords(multiplier, settings),
    setAt: agreement.rateSetAt,
    setBy: agreement.rateSetBy,
  };
}

/** "Your rate: 3%": the dashboard's line. */
export function yourRateWords(view: RateView): string {
  return `Your rate: ${view.percent}%`;
}

/** What the sign-up link does for a status whose link does not work: said plainly. */
function noLinkWords(name: string, status: AmbassadorAgreement['status']): string {
  const first = firstNameOf(name) || name;
  switch (status) {
    case 'declined':
      return `${first}'s application was not approved, so there is no link to send.`;
    case 'suspended':
      return `${first} is suspended, so their link does not work for now and there is nothing to send.`;
    case 'removed':
      return `${first} was removed as an Ambassador, so their link does not work and there is nothing to send.`;
    default:
      return `${first}'s application is still waiting (${AMBASSADOR_STATUS_WORDS[status]}), so their link does not work yet. It works once they are approved.`;
  }
}

/** The surname: everything after the first name, or nothing. */
function surnameOf(name: string): string {
  return name.trim().split(/\s+/).slice(1).join(' ');
}

/**
 * One Ambassador's link, codes and QR code, for the owner and staff: the sign-up link, their check
 * code and check link, and the print link (the sign-up link through the check page, as every
 * printed QR code goes), with their rate. A pending, declined, suspended or removed Ambassador has
 * their status and no link. Never a document.
 */
export async function ambassadorLinks(ctx: Ctx, agreementId: string) {
  const agreement = await ctx.repository.ambassadors.findAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Ambassador');
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  const name = account?.name ?? 'Closed account';
  const origin = ctx.env?.primaryOrigin ?? '';
  const works = account !== null && !account.closed && ambassadorLinkWorks(agreement.status);
  const base = {
    id: agreement.id,
    name,
    firstName: firstNameOf(name),
    surname: surnameOf(name),
    kindWords: KIND_WORDS[agreement.accountKind],
    status: agreement.status,
    statusWords: AMBASSADOR_STATUS_WORDS[agreement.status],
    approved: ambassadorApproved(agreement.status),
    linkWorks: works,
    rate: rateView(ctx, agreement),
  };
  if (!works || !account) {
    return {
      ...base,
      link: null,
      linkAloud: null,
      checkCode: null,
      checkLink: null,
      printLink: null,
      words: noLinkWords(name, agreement.status),
    };
  }
  const link = ambassadorLink(origin, account);
  const checkCode = await ensureCheckCode(ctx, agreement);
  return {
    ...base,
    link,
    linkAloud: linkAloud(link),
    checkCode,
    checkLink: checkLink(origin, checkCode),
    printLink: checkLink(origin, checkCode, link.slice(origin.length)),
    words: `${base.firstName}'s business sign-up link. A business that joins through it is tied to ${base.firstName}, and the reward goes to them.`,
  };
}

/** The text a business gets: fixed words, the product's name and the link, nothing else. */
export function linkTextWords(
  config: Pick<AppContext['config'], 'productName' | 'assistantName'>,
  firstName: string,
  link: string,
): string {
  return `Hello from ${config.productName}. ${firstName} invited you to join as a Shop Partner. Sign up here: ${link}. Joining ${config.assistantName} is always free; never pay an Ambassador.`;
}

export const LINK_TEXT_ACTION = 'ambassadors.link-texted';

/**
 * Texts an approved Ambassador's business sign-up link to a UK mobile, as the staff member's own
 * action. At most `ambassador.linkTextsPerDay` a UK day for each person, counted from the audit
 * log; the number lives only in that log's entry.
 */
export async function textAmbassadorLink(
  ctx: Ctx,
  agreementId: string,
  phoneGiven: string,
  by: ActingPerson,
): Promise<{ message: string; to: string }> {
  const found = await ambassadorLinks(ctx, agreementId);
  if (!found.link) throw new ConflictError(found.words);
  const phone = ukPhone(phoneGiven);
  if (!phone) throw new BadRequestError(NOT_A_UK_NUMBER);
  if (!isUkMobile(phone)) {
    throw new BadRequestError('A text can only go to a mobile number, starting 07.');
  }
  if (!ctx.sendText) {
    throw new ConflictError('Texts are not set up on this server, so the link cannot be sent.');
  }
  const most = ctx.config.ambassador.linkTextsPerDay;
  const today = await ctx.repository.audit.list({
    since: ukStartOfDay(ctx.now()),
    search: LINK_TEXT_ACTION,
    limit: 1000,
  });
  const sentToday = today.filter(
    (entry) =>
      entry.action === LINK_TEXT_ACTION &&
      (by.actorId ? entry.actorId === by.actorId : entry.actorName === by.name),
  ).length;
  if (sentToday >= most) {
    throw new TooManyRequestsError(
      `You have sent ${most} link texts today, the most for one person in a day. Please try again tomorrow.`,
    );
  }
  await ctx.sendText(phone, linkTextWords(ctx.config, found.firstName, found.link));
  await ctx.repository.audit.record({
    at: ctx.now(),
    actorId: by.actorId,
    actorName: by.name,
    actorRole: by.role,
    action: LINK_TEXT_ACTION,
    target: `ambassador-application=${agreementId}`,
    detail: `Texted ${found.name}'s business sign-up link to ${phone}${by.via === 'voice' ? ' by voice, talking to Ozi, after reading it back' : ''}.`,
    ip: by.ip ?? '',
  });
  return {
    message: `${found.firstName}'s link is texted to ${phone}. The business joins through it, and the reward goes to ${found.firstName}.`,
    to: phone,
  };
}

export const RATE_SET_ACTION = 'ambassadors.rate-set';

/**
 * The owner sets one Ambassador's individual rate (ruling 94): a percentage from the standard
 * rate up to the cap, kept as the multiplier on every percentage share, for new shares from now.
 * Only an approved Ambassador's. Written in the audit log with before, after and who.
 */
export async function setAmbassadorRate(
  ctx: Ctx,
  agreementId: string,
  percent: number,
  by: ActingPerson,
): Promise<{ message: string; rate: RateView }> {
  const agreement = await ctx.repository.ambassadors.findAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Ambassador');
  const settings = ctx.config.ambassador;
  const problem = individualRateProblem(percent, settings);
  if (problem) throw new BadRequestError(problem);
  if (!ambassadorApproved(agreement.status)) {
    throw new ConflictError('An individual rate is for an approved Ambassador only.');
  }
  const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
  const name = account?.name ?? 'Closed account';
  const before = rateView(ctx, agreement);
  const multiplier = individualRateMultiplier(percent, settings);
  const at = ctx.now();
  const updated = await ctx.repository.ambassadors.updateAgreement(agreement.id, {
    shareMultiplier: multiplier,
    rateSetAt: at,
    rateSetBy: by.name,
  });
  const after = rateView(ctx, updated);
  await ctx.repository.audit.record({
    at,
    actorId: by.actorId,
    actorName: by.name,
    actorRole: by.role,
    action: RATE_SET_ACTION,
    target: `ambassador-application=${agreement.id}`,
    detail: `${name}'s individual Ambassador rate: ${before.percent}% before, ${after.percent}% after, set by ${by.name}${by.via === 'voice' ? ' by voice, talking to Ozi, after reading it back' : ''}. New shares only, from now.`,
    ip: by.ip ?? '',
  });
  return {
    message:
      multiplier === 1
        ? `${name} is back on the standard rate of ${after.standardPercent}%, for new shares from now.`
        : `${name} now earns ${after.percent}% where others earn ${after.standardPercent}%, on every share from now. Nothing already earned changes.`,
    rate: after,
  };
}

/**
 * The Ambassador the owner named by voice: by first name, surname, full name or check code,
 * among those who applied. One match, or the problem in words.
 */
export async function findAmbassadorByWords(
  ctx: Ctx,
  said: string,
): Promise<{ agreement: AmbassadorAgreement; name: string } | { why: string }> {
  const wanted = said
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (wanted === '') return { why: 'Which Ambassador? Please say their name.' };
  const matches: Array<{ agreement: AmbassadorAgreement; name: string }> = [];
  for (const agreement of await ctx.repository.ambassadors.listAgreements()) {
    if (agreement.checkCode && agreement.checkCode.toLowerCase() === wanted.replace(/ /g, '')) {
      const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
      return { agreement, name: account?.name ?? 'Closed account' };
    }
    const account = await findAccount(ctx, agreement.accountKind, agreement.accountId);
    if (!account) continue;
    const name = account.name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ');
    const parts = name.split(' ');
    if (name === wanted || parts.includes(wanted) || name.includes(wanted)) {
      matches.push({ agreement, name: account.name });
    }
  }
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) return { why: `I cannot find an Ambassador called ${said.trim()}.` };
  return {
    why: `There is more than one Ambassador called ${said.trim()}: ${matches.map((match) => match.name).join(', ')}. Please say the full name.`,
  };
}
