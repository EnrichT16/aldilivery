/**
 * The demo sign-in for app store reviewers (ruling 60, Anthony, 10 October 2026: "yes, shown as
 * demo").
 *
 * Apple and Google reviewers cannot receive our text messages, so one demo telephone number
 * accepts one fixed code without a text being sent. It is off unless both `DEMO_SIGNIN_PHONE`
 * and `DEMO_SIGNIN_CODE` are set on the server; the code is a secret, kept only in the server's
 * environment, never in the repository and never written to a log. It works for that number
 * alone.
 *
 * Signing in with it opens a clearly labelled demo account, a Shopper or a Runner as chosen on
 * the sign-in screen, holding no real person's details. A demo Shopper's orders are marked demo:
 * no card is charged (the order is never sent to Stripe) and no Runner is ever sent. The demo
 * Runner is never offered a real job. Cards cannot be added and nothing can be bought on a demo
 * account.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import type { AppContext } from '../app.js';
import type { Runner, Shopper } from '../domain.js';
import { ConflictError, ForbiddenError } from '../errors.js';
import { ukPhone } from '../lib/phone.js';

/** What the screens show on a demo account. */
export const DEMO_BANNER = 'Demo account — no real orders';

/** The words when something that would move real money is tried on a demo account. */
export const DEMO_REFUSED =
  'This is a demo account, so nothing can be bought or charged. Everything else works as normal.';

/** The demo card saved on the demo Shopper: not a card at all, and never sent to Stripe. */
export const DEMO_CARD_ID = 'pm_demo_not_a_real_card';

/** The demo number, as it is stored, when the demo sign-in is switched on; otherwise nothing. */
export function demoPhone(env: Pick<AppContext['env'], 'demoSignInPhone' | 'demoSignInCode'>): string | null {
  if (!env.demoSignInPhone || !env.demoSignInCode) return null;
  return ukPhone(env.demoSignInPhone) ?? null;
}

/** Whether this (already normalised) number is the demo number. */
export function isDemoPhone(
  env: Pick<AppContext['env'], 'demoSignInPhone' | 'demoSignInCode'>,
  phone: string,
): boolean {
  const demo = demoPhone(env);
  return demo !== null && demo === phone;
}

/** Whether the code given is the demo code, compared in constant time. */
export function isDemoCode(
  env: Pick<AppContext['env'], 'demoSignInCode'>,
  code: string,
): boolean {
  if (!env.demoSignInCode) return false;
  const a = createHash('sha256').update(code.trim()).digest();
  const b = createHash('sha256').update(env.demoSignInCode.trim()).digest();
  return timingSafeEqual(a, b);
}

/** The demo Shopper, made the first time and found after. Never a real person's account. */
export async function demoShopper(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  phone: string,
): Promise<Shopper> {
  const { repository } = ctx;
  const existing = await repository.shoppers.findByPhone(phone);
  if (existing && !existing.isDemo) {
    throw new ConflictError('The demo number belongs to a real account, so the demo sign-in is off.');
  }
  if (existing) return existing;

  let handle = 'demo-shopper';
  for (let n = 2; await repository.shoppers.findByHandle(handle); n += 1) handle = `demo-shopper-${n}`;
  const shopper = await repository.shoppers.create({
    displayName: 'Demo Shopper',
    handle,
    phone,
    deliveryAddress: '1 Demo Street, Demo Town (a demo address)',
    doorstepProtocol: 'Demo account: nobody will come to the door.',
    isDemo: true,
  });
  // Saved so ordering can be tried all the way to the confirmation. It is not a card: a demo
  // order is never sent to Stripe.
  await repository.paymentMethods.create({
    shopperId: shopper.id,
    stripePaymentMethodId: DEMO_CARD_ID,
    lastFour: '4242',
    brand: 'demo',
    isDefault: true,
  });
  return (await repository.shoppers.update(shopper.id, { stripeCustomerId: `cus_demo_${shopper.id}` }));
}

/**
 * The demo Runner, made the first time and found after: checked so the Runner screens can be
 * seen, never offered a real job (services/dispatch.ts). A reviewer who closed it finds it open
 * again, so the next reviewer can try closing it too.
 */
export async function demoRunner(
  ctx: Pick<AppContext, 'repository' | 'now'>,
  phone: string,
): Promise<Runner> {
  const { repository } = ctx;
  const existing = await repository.runners.findByPhone(phone);
  if (existing && !existing.isDemo) {
    throw new ConflictError('The demo number belongs to a real account, so the demo sign-in is off.');
  }
  if (existing) {
    return existing.leftAt
      ? repository.runners.update(existing.id, { leftAt: null, leftReason: null, leftBy: null })
      : existing;
  }
  return repository.runners.create({
    name: 'Demo Runner',
    phone,
    vehicleType: 'on_foot',
    travelModes: ['on_foot'],
    rightToWorkVerified: true,
    criminalRecordCheckVerified: true,
    isDemo: true,
  });
}

/** Refuses anything that would move real money for a demo Shopper. */
export function refuseIfDemo(account: { isDemo: boolean } | null | undefined): void {
  if (account?.isDemo) throw new ForbiddenError(DEMO_REFUSED);
}
