/**
 * Staff accounts (7 October 2026): signing in to the admin panel with a username and password,
 * changing that password, and, for the founder, the team: adding people, giving each a job,
 * resetting a forgotten password and turning an account off.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { StaffMember } from '../domain.js';
import { phraseBook } from '../lib/phrases.js';
import {
  ApiError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorisedError,
} from '../errors.js';
import {
  hashPassword,
  isPasscode,
  isStaffRole,
  isViewerRole,
  newTotpSecret,
  totpMatches,
  VIEWER_AREAS,
  passwordMatches,
  signStaffToken,
  staffActor,
  STAFF_ROLES,
  STAFF_SESSION_HOURS,
  temporaryPassword,
} from '../lib/staff.js';

/** Wrong passwords in a row before an account waits, and how long it waits. */
const ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9.]{2,29}$/, 'A username is 3 to 30 letters, numbers or dots.');

const roleSchema = z.string().refine(isStaffRole, { message: 'That is not one of the jobs.' });

function publicMember(member: StaffMember) {
  const role = isStaffRole(member.role) ? member.role : null;
  return {
    id: member.id,
    name: member.name,
    username: member.username,
    role: member.role,
    title: member.isOwner ? 'Founder and owner' : role ? STAFF_ROLES[role].title : member.role,
    isOwner: member.isOwner,
    active: member.active,
    mustChangePassword: member.mustChangePassword,
    lastSignInAt: member.lastSignInAt,
    createdAt: member.createdAt,
  };
}

export async function registerStaffRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, config, now } = app.ctx;

  /** The jobs, and which parts of the panel each one sees. Public: there is nothing secret. */
  app.get('/staff/roles', async () => ({
    roles: Object.entries(STAFF_ROLES).map(([role, value]) => ({ role, ...value })),
  }));

  app.post('/staff/sign-in', async (request) => {
    const body = z
      .object({
        username: z.string().trim().toLowerCase().min(1, 'Please give your username.').max(40),
        password: z.string().min(1, 'Please give your password.').max(200),
        /** The owner's passcode: six digits and a special character. */
        passcode: z.string().max(20).optional(),
        /** A two-step code from an authenticator app, when the owner has turned them on. */
        code: z.string().max(10).optional(),
      })
      .parse(request.body ?? {});
    const member = await repository.staffMembers.findByUsername(body.username);
    const refused = new UnauthorisedError('That username and password do not match.');
    if (!member || !member.active) throw refused;
    const at = now();
    if (member.lockedUntil && member.lockedUntil.getTime() > at.getTime()) {
      throw new UnauthorisedError(
        `Too many wrong passwords. Please wait ${LOCK_MINUTES} minutes, or ask the founder to reset it.`,
      );
    }
    if (!passwordMatches(body.password, member.passwordHash)) {
      const failed = member.failedAttempts + 1;
      await repository.staffMembers.update(member.id, {
        failedAttempts: failed >= ATTEMPTS ? 0 : failed,
        lockedUntil: failed >= ATTEMPTS ? new Date(at.getTime() + LOCK_MINUTES * 60_000) : null,
      });
      throw refused;
    }
    // The owner's account also needs the passcode, and the two-step code if turned on.
    if (member.isOwner) {
      const needs = ['passcode', ...(member.totpEnabled ? ['code'] : [])];
      if (!body.passcode || (member.totpEnabled && !body.code)) {
        throw new ApiError(401, 'more_needed', 'Now your passcode, please.', { needs });
      }
      const passcodeRight =
        member.passcodeHash !== null && passwordMatches(body.passcode, member.passcodeHash);
      const codeRight =
        !member.totpEnabled ||
        (member.totpSecret !== null && totpMatches(member.totpSecret, body.code ?? '', at));
      if (!passcodeRight || !codeRight) {
        const failed = member.failedAttempts + 1;
        await repository.staffMembers.update(member.id, {
          failedAttempts: failed >= ATTEMPTS ? 0 : failed,
          lockedUntil: failed >= ATTEMPTS ? new Date(at.getTime() + LOCK_MINUTES * 60_000) : null,
        });
        throw new ApiError(401, 'more_needed', 'That passcode or code was not right.', { needs });
      }
    }
    const updated = await repository.staffMembers.update(member.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastSignInAt: at,
    });
    const role = isStaffRole(updated.role) ? updated.role : 'onboarding';
    return {
      token: signStaffToken(
        updated.id,
        new Date(at.getTime() + STAFF_SESSION_HOURS * 3_600_000),
        env.authTokenSecret,
        { version: updated.sessionVersion, passcode: updated.isOwner },
      ),
      name: updated.name,
      role,
      title: STAFF_ROLES[role].title,
      areas: STAFF_ROLES[role].areas,
      mustChangePassword: updated.mustChangePassword,
    };
  });

  /** Who is signed in, and what they may see. */
  app.get('/staff/me', async (request) => {
    const actor = await staffActor(request);
    const member = actor.id ? await repository.staffMembers.findById(actor.id) : null;
    return {
      name: actor.name,
      role: actor.role,
      title: STAFF_ROLES[actor.role].title,
      areas: actor.areas,
      account: actor.id !== null,
      mustChangePassword: member?.mustChangePassword ?? false,
      isOwner: actor.isOwner,
      // How Ozi addresses the owner, "Mr Anthony" (ruling 44); null for everyone else.
      address: actor.isOwner ? phraseBook(env.storeConfigPath).ownerAddress : null,
      viewOnly: actor.viewOnly,
      totpEnabled: member?.totpEnabled ?? false,
    };
  });

  app.post('/staff/password', async (request) => {
    const actor = await staffActor(request);
    if (!actor.id) throw new BadRequestError('The staff key has no password to change.');
    const body = z
      .object({
        current: z.string().min(1).max(200),
        password: z
          .string()
          .min(10, 'Please choose a password of at least 10 characters.')
          .max(200),
      })
      .parse(request.body ?? {});
    const member = await repository.staffMembers.findById(actor.id);
    if (!member || !passwordMatches(body.current, member.passwordHash)) {
      throw new UnauthorisedError('Your current password was not right.');
    }
    await repository.staffMembers.update(member.id, {
      passwordHash: hashPassword(body.password),
      mustChangePassword: false,
    });
    return { message: 'Your password is changed.' };
  });

  /* ------------------------------------------------------------------ the team */

  app.get('/staff/team', async (request) => {
    await staffActor(request, 'team');
    return { team: (await repository.staffMembers.list()).map(publicMember) };
  });

  app.post('/staff/team', async (request, reply) => {
    await staffActor(request, 'team');
    const body = z
      .object({
        name: z.string().trim().min(2, 'Please give their name.').max(80),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z][a-z0-9.]{2,29}$/, 'A username is 3 to 30 letters, numbers or dots.'),
        role: roleSchema,
      })
      .parse(request.body ?? {});
    if (isViewerRole(body.role)) {
      throw new BadRequestError(
        'Family and investor accounts are added by the owner, in Who sees my dashboard.',
      );
    }
    if (await repository.staffMembers.findByUsername(body.username)) {
      throw new ConflictError('That username is taken. Please choose another.');
    }
    const password = temporaryPassword();
    const member = await repository.staffMembers.create({
      name: body.name,
      username: body.username,
      role: body.role,
      passwordHash: hashPassword(password),
    });
    void reply.status(201);
    return {
      member: publicMember(member),
      password,
      message: `${body.name} can now sign in as ${body.username} with the password ${password}. They choose their own password the first time. This password is shown only once.`,
    };
  });

  app.post('/staff/team/:id', async (request) => {
    const actor = await staffActor(request, 'team');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ role: roleSchema.optional(), active: z.boolean().optional() })
      .parse(request.body ?? {});
    const member = await repository.staffMembers.findById(id);
    if (!member) throw new NotFoundError('staff member');
    if (member.isOwner && !actor.isOwner) {
      throw new ForbiddenError('Only the owner changes the owner’s account.');
    }
    if (body.role && isViewerRole(body.role)) {
      throw new BadRequestError('Family and investor accounts are added by the owner.');
    }
    if (
      actor.id === member.id &&
      (body.active === false || (body.role && body.role !== 'founder'))
    ) {
      throw new BadRequestError('You cannot turn off or demote your own account.');
    }
    const updated = await repository.staffMembers.update(member.id, {
      ...(body.role ? { role: body.role } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });
    return { member: publicMember(updated) };
  });

  app.post('/staff/team/:id/reset', async (request) => {
    const actor = await staffActor(request, 'team');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const member = await repository.staffMembers.findById(id);
    if (!member) throw new NotFoundError('staff member');
    if (member.isOwner && !actor.isOwner) {
      throw new ForbiddenError('Only the owner changes the owner’s account.');
    }
    const password = temporaryPassword();
    await repository.staffMembers.update(member.id, {
      passwordHash: hashPassword(password),
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    });
    return {
      password,
      message: `${member.name}'s new password is ${password}. They choose their own the next time they sign in. This is shown only once.`,
    };
  });

  /* ------------------------------------------------------------------ the owner */

  /** Whether the owner's account has been made yet. */
  app.get('/staff/owner', async (request) => {
    await staffActor(request);
    const team = await repository.staffMembers.list();
    return { ownerExists: team.some((member) => member.isOwner) };
  });

  /**
   * Making the owner's own account, once, with the staff key: a username, a password and the
   * 7-character passcode. After this, only the owner changes it.
   */
  app.post('/staff/owner', async (request, reply) => {
    const actor = await staffActor(request, 'team');
    if (actor.id !== null) {
      throw new ForbiddenError('The owner’s account is made with the staff key.');
    }
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        username: usernameSchema,
        password: z
          .string()
          .min(10, 'Please choose a password of at least 10 characters.')
          .max(200),
        passcode: passcodeSchema('The passcode'),
      })
      .parse(request.body ?? {});
    const team = await repository.staffMembers.list();
    if (team.some((member) => member.isOwner)) {
      throw new ConflictError('The owner’s account already exists.');
    }
    if (await repository.staffMembers.findByUsername(body.username)) {
      throw new ConflictError('That username is taken. Please choose another.');
    }
    await repository.staffMembers.create({
      name: body.name,
      username: body.username,
      role: 'founder',
      passwordHash: hashPassword(body.password),
      isOwner: true,
      passcodeHash: hashPassword(body.passcode),
      mustChangePassword: false,
    });
    void reply.status(201);
    return {
      message: `Your owner’s account is ready, ${body.name}. Sign in with your username, password and passcode.`,
    };
  });

  async function owner(request: Parameters<typeof staffActor>[0]): Promise<StaffMember> {
    const actor = await staffActor(request);
    const member =
      actor.isOwner && actor.id ? await repository.staffMembers.findById(actor.id) : null;
    if (!member) throw new ForbiddenError('Only the owner can do that.');
    return member;
  }

  function passcodeSchema(label: string) {
    return z.string().refine(isPasscode, {
      message: `${label} is six numbers, then one special character, such as 123456#.`,
    });
  }

  function checkPasscode(member: StaffMember, passcode: string): void {
    if (!member.passcodeHash || !passwordMatches(passcode, member.passcodeHash)) {
      throw new UnauthorisedError('Your passcode was not right.');
    }
  }

  app.post('/staff/owner/passcode', async (request) => {
    const member = await owner(request);
    const body = z
      .object({ current: z.string().max(20), passcode: passcodeSchema('The new passcode') })
      .parse(request.body ?? {});
    checkPasscode(member, body.current);
    await repository.staffMembers.update(member.id, { passcodeHash: hashPassword(body.passcode) });
    return { message: 'Your passcode is changed.' };
  });

  app.post('/staff/owner/two-step/start', async (request) => {
    const member = await owner(request);
    const secret = newTotpSecret();
    await repository.staffMembers.update(member.id, { totpSecret: secret, totpEnabled: false });
    const label = encodeURIComponent(`${config.productName}:${member.username}`);
    return {
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(config.productName)}`,
      message:
        'Add this key to your authenticator app, then type the 6-digit code it shows to switch two-step codes on.',
    };
  });

  app.post('/staff/owner/two-step/confirm', async (request) => {
    const member = await owner(request);
    const { code } = z.object({ code: z.string().max(10) }).parse(request.body ?? {});
    if (!member.totpSecret || !totpMatches(member.totpSecret, code, now())) {
      throw new BadRequestError('That code was not right. Please try the newest one.');
    }
    await repository.staffMembers.update(member.id, { totpEnabled: true });
    return { message: 'Two-step codes are on. You will be asked for one each time you sign in.' };
  });

  app.post('/staff/owner/two-step/off', async (request) => {
    const member = await owner(request);
    const { passcode } = z.object({ passcode: z.string().max(20) }).parse(request.body ?? {});
    checkPasscode(member, passcode);
    await repository.staffMembers.update(member.id, { totpEnabled: false, totpSecret: null });
    return { message: 'Two-step codes are off.' };
  });

  /**
   * The kill switch: with the passcode, every family and investor switch goes off and every
   * admin session everywhere is signed out, the owner's own included. Nothing is deleted.
   */
  app.post('/staff/owner/kill-switch', async (request) => {
    const member = await owner(request);
    const { passcode } = z.object({ passcode: z.string().max(20) }).parse(request.body ?? {});
    checkPasscode(member, passcode);
    for (const person of await repository.staffMembers.list()) {
      await repository.staffMembers.update(person.id, {
        sessionVersion: person.sessionVersion + 1,
        ...(isViewerRole(person.role) ? { allowedAreas: '' } : {}),
      });
    }
    return {
      message:
        'Done. Everyone who sees your dashboard has every switch off, and every admin session is signed out, yours too. Nothing was deleted.',
    };
  });

  /* ------------------------------------------------------------------ who sees the owner's dashboard */

  function publicViewer(member: StaffMember) {
    return {
      id: member.id,
      name: member.name,
      username: member.username,
      kind: member.role,
      active: member.active,
      areas: member.allowedAreas.split(',').filter(Boolean),
      lastSignInAt: member.lastSignInAt,
    };
  }

  app.get('/staff/viewers', async (request) => {
    await owner(request);
    const viewers = (await repository.staffMembers.list()).filter((member) =>
      isViewerRole(member.role),
    );
    return { viewers: viewers.map(publicViewer), areas: VIEWER_AREAS };
  });

  app.post('/staff/viewers', async (request, reply) => {
    await owner(request);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        username: usernameSchema,
        kind: z.enum(['family', 'investor']),
      })
      .parse(request.body ?? {});
    if (await repository.staffMembers.findByUsername(body.username)) {
      throw new ConflictError('That username is taken. Please choose another.');
    }
    const password = temporaryPassword();
    const member = await repository.staffMembers.create({
      name: body.name,
      username: body.username,
      role: body.kind,
      passwordHash: hashPassword(password),
    });
    void reply.status(201);
    return {
      viewer: publicViewer(member),
      password,
      message: `${body.name} can sign in as ${body.username} with the password ${password}. Everything is switched off until you switch it on, and they never see the money.`,
    };
  });

  /** The switches: which parts this person may see. Never the money. */
  app.post('/staff/viewers/:id', async (request) => {
    await owner(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        areas: z.array(z.string()).max(20).optional(),
        all: z.boolean().optional(),
        active: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const member = await repository.staffMembers.findById(id);
    if (!member || !isViewerRole(member.role))
      throw new NotFoundError('family or investor account');
    const chosen =
      body.all === true
        ? [...VIEWER_AREAS]
        : body.all === false
          ? []
          : body.areas
            ? VIEWER_AREAS.filter((area) => body.areas?.includes(area))
            : null;
    const updated = await repository.staffMembers.update(member.id, {
      ...(chosen ? { allowedAreas: chosen.join(',') } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });
    return { viewer: publicViewer(updated) };
  });
}
