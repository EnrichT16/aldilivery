/**
 * The private referral reward (rulings 12 and 16): £150 when someone has referred 100 people
 * who have each paid for an order that was not refunded. Built and tracked for the owner in the
 * admin panel, and not announced anywhere in the app until Anthony says so.
 *
 * Who can refer: a Shopper, by the share link on their account (`/join?via=shopper-<handle>`),
 * and a Runner, by theirs (`/join?ref=<Runner ID>`), when the person who follows it opens a
 * Shopper account. The account remembers which link it came by (`joinedVia`), which is the
 * record of every referral (ruling 12). Shop Partners, organisations and staff share links too,
 * but those are business, not people, and are not counted here.
 *
 * Who counts: a person referred who has paid for at least one order that was delivered and was
 * not refunded (no refund given on a problem with it, and not cancelled or refunded). The guards
 * against cheating (2 October proposals):
 *
 * - nobody can refer themselves: not the same account, and not the same phone number;
 * - each person counted needs a card of their own: the same card (Stripe's fingerprint for it)
 *   counts once, and never when it is a card on the referrer's own account;
 * - and an address of their own: the same delivery address counts once, and never the
 *   referrer's own.
 *
 * Phone numbers are already one to an account. The same phone or computer cannot be told apart
 * without keeping something that identifies the device, which the service does not do.
 *
 * Asking Stripe about cards is only done for someone who is near the line (enough people
 * counted on every other test), so looking at the page does not ask Stripe about everybody.
 */

import { formatPence } from '@aldilivery/core';

import type { AppContext } from '../app.js';
import type { Order, Shopper } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';

type RewardContext = Pick<AppContext, 'repository' | 'config' | 'payments' | 'now'>;

export interface ReferrerTally {
  referrer: string;
  kind: 'shopper' | 'runner';
  /** For the owner's eyes only. */
  name: string;
  joined: number;
  counted: number;
  /** Not counted yet: no paid, delivered, unrefunded order. */
  notYet: number;
  /** Not counted, ever, and why. */
  excluded: { self: number; sameCard: number; sameAddress: number };
  /** Whether the card test was run: only once someone is near the line. */
  cardsChecked: boolean;
  rewardsEarned: number;
  rewardsGiven: number;
  due: boolean;
}

/** An address as written, made comparable: case, spaces and punctuation do not matter. */
export function sameAddressKey(address: string): string {
  return address.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The first order this person paid for that was delivered and not refunded, if any. */
async function firstGoodOrder(ctx: RewardContext, shopperId: string): Promise<Order | null> {
  const orders = (await ctx.repository.orders.listForShopper(shopperId))
    .filter((order) => order.status === 'delivered' || order.status === 'completed')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const order of orders) {
    const reports = await ctx.repository.problems.listForOrder(order.id);
    if (reports.some((report) => report.refundPence > 0)) continue;
    return order;
  }
  return null;
}

async function cardOf(ctx: RewardContext, order: Order): Promise<string | null> {
  if (!order.paymentMethodId) return null;
  const method = await ctx.repository.paymentMethods.findById(order.paymentMethodId);
  if (!method) return null;
  return ctx.payments.cardFingerprint(method.stripePaymentMethodId).catch(() => null);
}

interface Referrer {
  kind: 'shopper' | 'runner';
  id: string;
  name: string;
  phone: string;
  address: string | null;
  shopperId: string | null;
}

async function findReferrer(ctx: RewardContext, key: string): Promise<Referrer | null> {
  const [kind, code] = key.split(':') as [string, string];
  if (kind === 'shopper') {
    const shopper = await ctx.repository.shoppers.findByHandle(code);
    return shopper
      ? {
          kind: 'shopper',
          id: shopper.id,
          name: shopper.displayName,
          phone: shopper.phone,
          address: shopper.deliveryAddress || null,
          shopperId: shopper.id,
        }
      : null;
  }
  if (kind === 'runner') {
    const runner = await ctx.repository.runners.findByReferralCode(code.toUpperCase());
    if (!runner) return null;
    // A Runner who also shops with us is the same person on both sides.
    const asShopper = await ctx.repository.shoppers.findByPhone(runner.phone);
    return {
      kind: 'runner',
      id: runner.id,
      name: runner.name,
      phone: runner.phone,
      address: asShopper?.deliveryAddress || null,
      shopperId: asShopper?.id ?? null,
    };
  }
  return null;
}

async function tallyOne(
  ctx: RewardContext,
  key: string,
  referrer: Referrer,
  people: Shopper[],
  given: number,
): Promise<ReferrerTally> {
  const needed = ctx.config.runners.referralsForReward;
  const excluded = { self: 0, sameCard: 0, sameAddress: 0 };
  let notYet = 0;
  const candidates: Array<{ shopper: Shopper; order: Order }> = [];
  const addresses = new Set<string>(referrer.address ? [sameAddressKey(referrer.address)] : []);

  for (const shopper of [...people].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (shopper.id === referrer.shopperId || shopper.phone === referrer.phone) {
      excluded.self += 1;
      continue;
    }
    const order = await firstGoodOrder(ctx, shopper.id);
    if (!order) {
      notYet += 1;
      continue;
    }
    const address = sameAddressKey(order.deliveryAddress);
    if (address !== '' && addresses.has(address)) {
      excluded.sameAddress += 1;
      continue;
    }
    if (address !== '') addresses.add(address);
    candidates.push({ shopper, order });
  }

  // Cards are asked about only for someone near the line.
  const cardsChecked = candidates.length >= needed;
  let counted = candidates.length;
  if (cardsChecked) {
    const own = new Set<string>();
    if (referrer.shopperId) {
      for (const method of await ctx.repository.paymentMethods.listForShopper(referrer.shopperId)) {
        const print = await ctx.payments
          .cardFingerprint(method.stripePaymentMethodId)
          .catch(() => null);
        if (print) own.add(print);
      }
    }
    const seen = new Set<string>();
    counted = 0;
    for (const { order } of candidates) {
      const print = await cardOf(ctx, order);
      if (print && (own.has(print) || seen.has(print))) {
        excluded.sameCard += 1;
        continue;
      }
      if (print) seen.add(print);
      counted += 1;
    }
  }

  const rewardsEarned = cardsChecked ? Math.floor(counted / needed) : 0;
  return {
    referrer: key,
    kind: referrer.kind,
    name: referrer.name,
    joined: people.length,
    counted,
    notYet,
    excluded,
    cardsChecked,
    rewardsEarned,
    rewardsGiven: given,
    due: rewardsEarned > given,
  };
}

/** Everybody who has referred anybody, the most counted first. */
export async function tallyReferrals(ctx: RewardContext): Promise<ReferrerTally[]> {
  const byReferrer = new Map<string, Shopper[]>();
  for (const shopper of await ctx.repository.shoppers.listReferred()) {
    const key = shopper.joinedVia as string;
    byReferrer.set(key, [...(byReferrer.get(key) ?? []), shopper]);
  }
  const given = new Map<string, number>();
  for (const reward of await ctx.repository.referralRewards.list()) {
    given.set(reward.referrer, (given.get(reward.referrer) ?? 0) + 1);
  }
  const rows: ReferrerTally[] = [];
  for (const [key, people] of byReferrer) {
    const referrer = await findReferrer(ctx, key);
    if (!referrer) continue;
    rows.push(await tallyOne(ctx, key, referrer, people, given.get(key) ?? 0));
  }
  return rows.sort((a, b) => b.counted - a.counted || b.joined - a.joined);
}

/**
 * The owner gives a reward that is due: as credit for a Shopper, or to a Runner's own Stripe
 * account. Or by hand, outside the app, with a note of how. Once per reward earned.
 */
export async function giveReward(
  ctx: RewardContext,
  input: { referrer: string; by: string; byHand?: { reference: string } | undefined },
): Promise<{ message: string }> {
  const referrer = await findReferrer(ctx, input.referrer);
  if (!referrer) throw new NotFoundError('referrer');
  const people = (await ctx.repository.shoppers.listReferred()).filter(
    (shopper) => shopper.joinedVia === input.referrer,
  );
  const given = (await ctx.repository.referralRewards.list()).filter(
    (reward) => reward.referrer === input.referrer,
  ).length;
  const tally = await tallyOne(ctx, input.referrer, referrer, people, given);
  if (!tally.due) {
    throw new ConflictError('No reward is due to them now.');
  }
  const pence = ctx.config.runners.referralRewardPence;
  const symbol = ctx.config.store.currencySymbol;
  let method: 'credit' | 'transfer' | 'by_hand';
  let reference: string | null;

  if (input.byHand) {
    method = 'by_hand';
    reference = input.byHand.reference;
  } else if (referrer.kind === 'shopper') {
    const shopper = await ctx.repository.shoppers.findById(referrer.id);
    if (!shopper) throw new NotFoundError('Shopper');
    await ctx.repository.shoppers.update(shopper.id, {
      creditPence: shopper.creditPence + pence,
    });
    method = 'credit';
    reference = null;
  } else {
    const runner = await ctx.repository.runners.findById(referrer.id);
    if (!runner?.stripeConnectedAccountId) {
      throw new BadRequestError(
        'This Runner has no payout account set up. Pay it by hand and note how, or wait until they set it up.',
      );
    }
    const transfer = await ctx.payments.createTransfer({
      amountPence: pence,
      currency: ctx.config.fees.currency,
      destinationAccountId: runner.stripeConnectedAccountId,
      orderId: `referral-${runner.id}`,
      description: `${ctx.config.productName} thank you for introducing people`,
      idempotencyKey: `referral:${input.referrer}:${given + 1}`,
    });
    method = 'transfer';
    reference = transfer.id;
  }

  await ctx.repository.referralRewards.create({
    referrer: input.referrer,
    qualifyingCount: tally.counted,
    amountPence: pence,
    method,
    reference,
    decidedBy: input.by,
    createdAt: ctx.now(),
  });
  const how =
    method === 'credit'
      ? 'added to their account as credit'
      : method === 'transfer'
        ? 'sent to their own Stripe account'
        : `recorded as paid by hand (${reference ?? ''})`;
  return { message: `${formatPence(pence, symbol)} for ${referrer.name}, ${how}.` };
}
