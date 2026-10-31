/**
 * The owner sees and controls all staff (Anthony, 31 October 2026, ruling 85).
 *
 * The staff list: each account's name and job, whether it is on or switched off, whether it is
 * signed in now (seen in the last `admin.staffOnlineMinutes`), when it was last seen, and roughly
 * where its latest activity came from (services/../lib/staff-sightings.ts), or "place not known".
 *
 * The switches: one account on or off, and "Switch off all staff except me". Switching off sets
 * the account inactive and raises both its session version and its remembered-phone version, so
 * every session it has, a phone kept signed in included, stops on its very next request (the
 * account's `active` is also checked on every request, in lib/staff.ts). Switching back on lets
 * it sign in again. The owner's own account can never be switched off this way. Only the owner
 * may use them: in the admin panel, or by voice after reading back and his clear yes; both come
 * here, and each is written in the audit log as his, with how it was done.
 */

import type { AppContext } from '../app.js';
import type { StaffMember } from '../domain.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors.js';
import { isStaffRole, STAFF_ROLES } from '../lib/staff.js';

export type StaffControlContext = Pick<AppContext, 'repository' | 'config' | 'now'>;

/** Who is switching, and how: only the owner, in the panel or by voice. */
export interface OwnerSwitcher {
  /** The owner's account, or null for none (which is refused). */
  actorId: string | null;
  name: string;
  isOwner: boolean;
  via: 'panel' | 'voice';
  ip?: string;
}

export const PLACE_NOT_KNOWN = 'place not known';

export interface StaffListEntry {
  id: string;
  name: string;
  role: string;
  title: string;
  isOwner: boolean;
  active: boolean;
  signedInNow: boolean;
  lastSeenAt: Date | null;
  /** A town or a country, or "place not known". */
  place: string;
  /** Phone, tablet, computer or other, from the latest sighting; null if never seen. */
  device: string | null;
}

function titleOf(member: StaffMember): string {
  if (member.isOwner) return 'Founder and owner';
  return isStaffRole(member.role) ? STAFF_ROLES[member.role].title : member.role;
}

/** Everybody with an admin sign-in, the owner first, then oldest first. */
export async function staffList(ctx: StaffControlContext): Promise<StaffListEntry[]> {
  const at = ctx.now();
  const members = await ctx.repository.staffMembers.list();
  const latest = new Map(
    (await ctx.repository.staffSightings.latestForEach(members.map((member) => member.id))).map(
      (row) => [row.staffId, row],
    ),
  );
  const onlineMs = ctx.config.admin.staffOnlineMinutes * 60_000;
  return members
    .map((member) => {
      const seen = latest.get(member.id) ?? null;
      const times = [seen?.at, member.lastSignInAt].filter((one): one is Date => one != null);
      const lastSeenAt =
        times.length === 0 ? null : new Date(Math.max(...times.map((one) => one.getTime())));
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        title: titleOf(member),
        isOwner: member.isOwner,
        active: member.active,
        signedInNow:
          member.active && lastSeenAt !== null && at.getTime() - lastSeenAt.getTime() < onlineMs,
        lastSeenAt,
        place: seen?.place ?? PLACE_NOT_KNOWN,
        device: seen?.userAgentKind ?? null,
      };
    })
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

function requireOwner(who: OwnerSwitcher): void {
  if (!who.isOwner || !who.actorId) {
    throw new ForbiddenError('Only the owner can switch staff accounts on or off.');
  }
}

function how(via: OwnerSwitcher['via']): string {
  return via === 'voice' ? 'by voice, talking to Ozi' : 'in the admin panel';
}

async function audit(
  ctx: StaffControlContext,
  who: OwnerSwitcher,
  action: string,
  target: string,
  detail: string,
): Promise<void> {
  await ctx.repository.audit.record({
    at: ctx.now(),
    actorId: who.actorId,
    actorName: who.name,
    actorRole: 'owner',
    action,
    target,
    detail: detail.slice(0, 500),
    ip: who.ip ?? '',
  });
}

/**
 * One account on or off. Off: inactive and signed out everywhere at once, remembered phones
 * included. On: it may sign in again. Never the owner's own account.
 */
export async function switchStaff(
  ctx: StaffControlContext,
  input: { staffId: string; on: boolean },
  who: OwnerSwitcher,
): Promise<{ member: StaffMember; words: string }> {
  requireOwner(who);
  const member = await ctx.repository.staffMembers.findById(input.staffId);
  if (!member) throw new NotFoundError('staff member');
  if (member.isOwner) {
    throw new BadRequestError('The owner’s own account can never be switched off this way.');
  }
  const updated = await ctx.repository.staffMembers.update(
    member.id,
    input.on
      ? { active: true, failedAttempts: 0, lockedUntil: null }
      : {
          active: false,
          sessionVersion: member.sessionVersion + 1,
          rememberedVersion: (member.rememberedVersion ?? 0) + 1,
        },
  );
  await audit(
    ctx,
    who,
    input.on ? 'staff.switched-on' : 'staff.switched-off',
    `staff=${member.id}`,
    input.on
      ? `Switched ${member.name}'s account back on ${how(who.via)}.`
      : `Switched ${member.name}'s account off ${how(who.via)}, and signed it out everywhere.`,
  );
  return {
    member: updated,
    words: input.on
      ? `${member.name}'s account is switched back on. They sign in again with their password.`
      : `${member.name}'s account is switched off, and signed out everywhere, phones included.`,
  };
}

/** "Switch off all staff except me": every account but the owner's, off and signed out. */
export async function switchAllStaffOff(
  ctx: StaffControlContext,
  who: OwnerSwitcher,
): Promise<{ count: number; words: string }> {
  requireOwner(who);
  let count = 0;
  for (const member of await ctx.repository.staffMembers.list()) {
    if (member.isOwner) continue;
    await ctx.repository.staffMembers.update(member.id, {
      active: false,
      sessionVersion: member.sessionVersion + 1,
      rememberedVersion: (member.rememberedVersion ?? 0) + 1,
    });
    count += 1;
  }
  await audit(
    ctx,
    who,
    'staff.all-switched-off',
    'staff=all',
    `Switched off every staff account but the owner's ${how(who.via)}: ${count} ${count === 1 ? 'account' : 'accounts'}, each signed out everywhere.`,
  );
  return {
    count,
    words:
      count === 0
        ? 'There was nobody else to switch off. Your own account stays on.'
        : `Done. ${count === 1 ? 'One account is' : `${count} accounts are`} switched off and signed out everywhere. Your own account stays on.`,
  };
}

/**
 * The account the owner means by a name ("Yvette", "Yvette Smith") or an id: exactly one, or a
 * plain reason why not.
 */
export async function findStaffByName(
  ctx: StaffControlContext,
  said: string,
): Promise<{ member: StaffMember } | { why: string }> {
  const members = await ctx.repository.staffMembers.list();
  const byId = members.find((member) => member.id === said);
  if (byId) return { member: byId };
  const words = said
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return { why: 'I did not catch whose account.' };
  const matches = members.filter((member) => {
    const name = member.name.toLowerCase();
    return (
      words.every((word) => name.split(/\s+/).some((part) => part.startsWith(word))) ||
      member.username === said.toLowerCase().trim()
    );
  });
  if (matches.length === 1) return { member: matches[0]! };
  if (matches.length === 0) return { why: `I can't find anyone called ${said} on the team.` };
  return {
    why: `More than one person is called that: ${matches.map((member) => member.name).join(', ')}. Which one?`,
  };
}
