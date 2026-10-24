/**
 * Unlocking anybody, and resetting a PIN or a password, in the admin panel (ruling 81, Anthony,
 * 24 October 2026; docs/changes/unlock-and-reset.md). For the owner, and the staff he lets
 * unlock in Team (services/unlock.ts).
 *
 * - `GET /staff/locked-out`: everyone locked out of anything now, for Needs you now.
 * - `GET /staff/unlock/find?search=`: Shoppers, Runners and staff by name, username or the end
 *   of their number, each with what they are locked out of. Never a whole telephone number.
 * - `POST /staff/shoppers/:id/pin/unlock`, `POST /staff/shoppers/:id/pin/reset`.
 * - `POST /staff/team/:id/unlock`: signing in and message and call codes, both.
 * - `POST /staff/shoppers/:id/sign-in-codes/clear`, `POST /staff/runners/:id/sign-in-codes/clear`.
 *
 * A staff member's password is reset at `POST /staff/team/:id/reset` (routes/staff.ts). Each one
 * is written in the audit log, and the person affected is told by text with no secret in it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { recordAudit } from '../lib/audit.js';
import { staffActor } from '../lib/staff.js';
import { clearCodeLockout, codeLockouts } from '../services/company-contact.js';
import {
  auditUnlock,
  lockedOut,
  phoneEnding,
  requireUnlocker,
  ringUs,
  signInCodesLockedUntil,
  staffSignInLocked,
  tellByText,
} from '../services/unlock.js';
import { CODE_LIMITS } from './auth.js';

const idParams = z.object({ id: z.string().min(1) });

export async function registerUnlockRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const { repository, now, config } = ctx;

  async function unlocker(request: FastifyRequest) {
    const actor = await staffActor(request);
    await requireUnlocker(ctx, actor);
    return actor;
  }

  /** Said after what was done: whether the person was texted. */
  function toldWords(told: boolean): string {
    return told
      ? ' We have texted them to say so.'
      : ' We could not text them, so please let them know.';
  }

  /** When the limits on sign-in codes for each number open again, for those reached now. */
  async function signInCodeLocks(): Promise<Map<string, Date>> {
    const at = now();
    const day = CODE_LIMITS.perNumberDay.minutes * 60_000;
    const times = new Map<string, Date[]>();
    for (const code of await repository.oneTimeCodes.listSince(new Date(at.getTime() - day))) {
      const key = `${code.role}:${code.phone}`;
      times.set(key, [...(times.get(key) ?? []), code.createdAt]);
    }
    const out = new Map<string, Date>();
    for (const [key, list] of times) {
      const until = signInCodesLockedUntil(list, at);
      if (until) out.set(key, until);
    }
    return out;
  }

  app.get('/staff/locked-out', async (request) => {
    await unlocker(request);
    return { lockedOut: await lockedOut(ctx) };
  });

  app.get('/staff/unlock/find', async (request) => {
    await unlocker(request);
    const { search } = z
      .object({ search: z.string().trim().min(2, 'Please type at least two letters.').max(80) })
      .parse(request.query ?? {});
    await recordAudit(request, { action: 'unlock.searched', detail: search });
    const at = now();
    const text = search.toLowerCase();
    const digits = search.replace(/\D/g, '');
    const byPhone = (phone: string): boolean =>
      digits.length >= 3 && phone.replace(/\D/g, '').includes(digits);
    const codeLocks = await signInCodeLocks();
    const staffCodeLocks = new Set(codeLockouts(at).map((row) => row.staffId));

    const shoppers = (await repository.admin.searchShoppers(search, 10))
      .filter((shopper) => shopper.erasedAt === null)
      .map((shopper) => ({
        account: 'shopper' as const,
        id: shopper.id,
        name: shopper.displayName,
        phoneEnding: phoneEnding(shopper.phone),
        hasPin: shopper.pinHash !== null,
        pinLocked: shopper.pinLockedUntil !== null && shopper.pinLockedUntil > at,
        signInCodesLocked: codeLocks.has(`shopper:${shopper.phone}`),
      }));
    const runners = (await repository.runners.listAll())
      .filter((runner) => runner.name.toLowerCase().includes(text) || byPhone(runner.phone))
      .slice(0, 10)
      .map((runner) => ({
        account: 'runner' as const,
        id: runner.id,
        name: runner.name,
        phoneEnding: phoneEnding(runner.phone),
        signInCodesLocked: codeLocks.has(`runner:${runner.phone}`),
      }));
    const staff = (await repository.staffMembers.list())
      .filter(
        (member) =>
          member.name.toLowerCase().includes(text) || member.username.toLowerCase().includes(text),
      )
      .slice(0, 10)
      .map((member) => ({
        account: 'staff' as const,
        id: member.id,
        name: member.name,
        isOwner: member.isOwner,
        signInLocked: staffSignInLocked(member, at),
        codesLocked: staffCodeLocks.has(member.id),
      }));
    return { people: [...shoppers, ...runners, ...staff] };
  });

  async function shopperOr404(request: FastifyRequest) {
    const { id } = idParams.parse(request.params);
    const shopper = await repository.shoppers.findById(id);
    if (!shopper || shopper.erasedAt !== null) throw new NotFoundError('Shopper');
    return shopper;
  }

  /** Unlock a Shopper's PIN after three wrong tries: tries back to none, the lock gone. */
  app.post('/staff/shoppers/:id/pin/unlock', async (request) => {
    const actor = await unlocker(request);
    const shopper = await shopperOr404(request);
    const wasLocked = shopper.pinLockedUntil !== null && shopper.pinLockedUntil > now();
    await repository.shoppers.update(shopper.id, { pinFailedAttempts: 0, pinLockedUntil: null });
    await auditUnlock(
      request,
      'unlock.shopper-pin',
      `shopper=${shopper.id}`,
      `${actor.name} unlocked ${shopper.displayName}'s PIN${wasLocked ? '' : ' (it was not locked)'}.`,
    );
    if (!wasLocked) {
      return { told: false, message: `${shopper.displayName}'s PIN was not locked.` };
    }
    const told = await tellByText(
      ctx,
      request,
      shopper.phone,
      `Your PIN was unlocked by ${config.productName}. You can try it again now. If you did not ask for this, ${ringUs(ctx)}.`,
    );
    return {
      told,
      message: `${shopper.displayName}'s PIN is unlocked.${toldWords(told)}`,
    };
  });

  /**
   * Reset a Shopper's PIN: none kept, and the lock gone, so they choose a new one the next time
   * one is needed (`POST /me/pin` works when there is no PIN).
   */
  app.post('/staff/shoppers/:id/pin/reset', async (request) => {
    const actor = await unlocker(request);
    const shopper = await shopperOr404(request);
    await repository.shoppers.update(shopper.id, {
      pinHash: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    });
    await auditUnlock(
      request,
      'unlock.shopper-pin-reset',
      `shopper=${shopper.id}`,
      `${actor.name} reset ${shopper.displayName}'s PIN${shopper.pinHash ? '' : ' (they had none yet)'}.`,
    );
    if (!shopper.pinHash) {
      return {
        told: false,
        message: `${shopper.displayName} has no PIN yet, so there was nothing to reset. They choose one the first time it is needed.`,
      };
    }
    const told = await tellByText(
      ctx,
      request,
      shopper.phone,
      `Your PIN was reset by ${config.productName}. You will be asked to choose a new one the next time it is needed. If you did not ask for this, ${ringUs(ctx)}.`,
    );
    return {
      told,
      message: `${shopper.displayName}'s PIN is reset. They choose a new one the next time it is needed.${toldWords(told)}`,
    };
  });

  /**
   * Unlock a staff member: signing in after wrong passwords, passcodes or two-step codes, and
   * message and call codes after five wrong codes (ruling 77). Both, in one go.
   */
  app.post('/staff/team/:id/unlock', async (request) => {
    const actor = await unlocker(request);
    const { id } = idParams.parse(request.params);
    const member = await repository.staffMembers.findById(id);
    if (!member) throw new NotFoundError('staff member');
    const at = now();
    const signIn = staffSignInLocked(member, at);
    await repository.staffMembers.update(member.id, { failedAttempts: 0, lockedUntil: null });
    const codes = clearCodeLockout(member.id, at);
    const what = [signIn ? 'signing in' : '', codes ? 'message and call codes' : '']
      .filter(Boolean)
      .join(' and ');
    await auditUnlock(
      request,
      'unlock.staff',
      `staff=${member.id}`,
      `${actor.name} unlocked ${member.name}${what ? `: ${what}` : ' (they were not locked out)'}.`,
    );
    return {
      told: false,
      message: what
        ? `${member.name} is unlocked: ${what}. Staff accounts have no phone number to text, so please let them know.`
        : `${member.name} was not locked out.`,
    };
  });

  /** Clear the limits on sign-in codes sent to an account's phone, found by the account. */
  async function clearSignInCodes(
    request: FastifyRequest,
    account: 'shopper' | 'runner',
  ): Promise<{ told: boolean; message: string }> {
    const actor = await unlocker(request);
    const { id } = idParams.parse(request.params);
    const found =
      account === 'shopper'
        ? await repository.shoppers.findById(id)
        : await repository.runners.findById(id);
    if (!found || ('erasedAt' in found && found.erasedAt !== null)) {
      throw new NotFoundError(account === 'shopper' ? 'Shopper' : 'Runner');
    }
    const name = 'displayName' in found ? found.displayName : found.name;
    const locked = (await signInCodeLocks()).has(`${account}:${found.phone}`);
    await repository.oneTimeCodes.clearLimits(found.phone, now());
    await auditUnlock(
      request,
      'unlock.sign-in-codes',
      `${account}=${found.id}`,
      `${actor.name} cleared the limits on sign-in codes for ${name}'s phone${locked ? '' : ' (they had not reached them)'}.`,
    );
    if (!locked) {
      return {
        told: false,
        message: `${name} had not reached the limits on sign-in codes. They can ask for a code now.`,
      };
    }
    const told = await tellByText(
      ctx,
      request,
      found.phone,
      `${config.productName} has cleared the limit on sign-in codes for your phone, so you can ask for a new code now. If you did not ask for this, ${ringUs(ctx)}.`,
    );
    return {
      told,
      message: `${name} can ask for a sign-in code again.${toldWords(told)}`,
    };
  }

  app.post('/staff/shoppers/:id/sign-in-codes/clear', async (request) =>
    clearSignInCodes(request, 'shopper'),
  );
  app.post('/staff/runners/:id/sign-in-codes/clear', async (request) =>
    clearSignInCodes(request, 'runner'),
  );
}
