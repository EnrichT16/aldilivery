/**
 * Staff accounts (7 October 2026): signing in to the admin panel with a username and password,
 * changing that password, and, for the founder, the team: adding people, giving each a job,
 * resetting a forgotten password and turning an account off.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { StaffMember } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError, UnauthorisedError } from '../errors.js';
import {
  hashPassword,
  isStaffRole,
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

const roleSchema = z.string().refine(isStaffRole, { message: 'That is not one of the jobs.' });

function publicMember(member: StaffMember) {
  const role = isStaffRole(member.role) ? member.role : null;
  return {
    id: member.id,
    name: member.name,
    username: member.username,
    role: member.role,
    title: role ? STAFF_ROLES[role].title : member.role,
    active: member.active,
    mustChangePassword: member.mustChangePassword,
    lastSignInAt: member.lastSignInAt,
    createdAt: member.createdAt,
  };
}

export async function registerStaffRoutes(app: FastifyInstance): Promise<void> {
  const { repository, env, now } = app.ctx;

  /** The jobs, and which parts of the panel each one sees. Public: there is nothing secret. */
  app.get('/staff/roles', async () => ({
    roles: Object.entries(STAFF_ROLES).map(([role, value]) => ({ role, ...value })),
  }));

  app.post('/staff/sign-in', async (request) => {
    const body = z
      .object({
        username: z.string().trim().toLowerCase().min(1, 'Please give your username.').max(40),
        password: z.string().min(1, 'Please give your password.').max(200),
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
    await staffActor(request, 'team');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const member = await repository.staffMembers.findById(id);
    if (!member) throw new NotFoundError('staff member');
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
}
