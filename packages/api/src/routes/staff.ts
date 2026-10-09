/**
 * Staff accounts (7 October 2026): signing in to the admin panel with a username and password,
 * changing that password, and, for the founder, the team: adding people, giving each a job,
 * resetting a forgotten password and turning an account off.
 *
 * Two-step codes (Section Q): every staff sign-in, not only the owner's, asks for the 6-digit
 * code from an authenticator app once it is set up. Each person has a grace period to set it
 * up (config/store.json, admin); after that, signing in opens only the two-step set-up until
 * they have. Eight recovery codes, each good once, are given when it is switched on, for a
 * lost phone.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { StaffMember } from '../domain.js';
import { recordAudit } from '../lib/audit.js';
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
  hashRecoveryCodes,
  newRecoveryCodes,
  recoveryCodesLeft,
  twoStepDueAt,
  useRecoveryCode,
  type StaffActor,
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
    twoStepOn: member.totpEnabled,
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
        /**
         * The 6-digit code from an authenticator app, once two-step codes are on, or one of the
         * recovery codes given when they were switched on.
         */
        code: z.string().max(20).optional(),
      })
      .parse(request.body ?? {});
    const member = await repository.staffMembers.findByUsername(body.username);
    const refused = new UnauthorisedError('That username and password do not match.');
    if (!member || !member.active) throw refused;
    const who = { id: member.id, name: member.name, role: member.role };
    const at = now();
    if (member.lockedUntil && member.lockedUntil.getTime() > at.getTime()) {
      throw new UnauthorisedError(
        `Too many wrong passwords. Please wait ${LOCK_MINUTES} minutes, or ask the founder to reset it.`,
      );
    }
    const wrongTry = async (why: string): Promise<void> => {
      const failed = member.failedAttempts + 1;
      await repository.staffMembers.update(member.id, {
        failedAttempts: failed >= ATTEMPTS ? 0 : failed,
        lockedUntil: failed >= ATTEMPTS ? new Date(at.getTime() + LOCK_MINUTES * 60_000) : null,
      });
      await recordAudit(request, { actor: who, action: 'staff.sign-in-refused', detail: why });
    };
    if (!passwordMatches(body.password, member.passwordHash)) {
      await wrongTry('wrong password');
      throw refused;
    }
    // The owner's account also needs the passcode; everyone's needs the two-step code once
    // it is switched on.
    const needs = [
      ...(member.isOwner ? ['passcode'] : []),
      ...(member.totpEnabled ? ['code'] : []),
    ];
    if ((member.isOwner && !body.passcode) || (member.totpEnabled && !body.code)) {
      throw new ApiError(
        401,
        'more_needed',
        member.isOwner
          ? 'Now your passcode, please.'
          : 'Now the 6-digit code from your authenticator app, please.',
        { needs },
      );
    }
    const passcodeRight =
      !member.isOwner ||
      (member.passcodeHash !== null && passwordMatches(body.passcode ?? '', member.passcodeHash));
    let recoveryLeft: string | null = null;
    let codeRight = !member.totpEnabled;
    if (member.totpEnabled && member.totpSecret !== null) {
      codeRight = totpMatches(member.totpSecret, body.code ?? '', at);
      if (!codeRight) {
        recoveryLeft = useRecoveryCode(member.recoveryCodes, body.code ?? '');
        codeRight = recoveryLeft !== null;
      }
    }
    if (!passcodeRight || !codeRight) {
      await wrongTry(passcodeRight ? 'wrong two-step code' : 'wrong passcode');
      throw new ApiError(
        401,
        'more_needed',
        member.isOwner ? 'That passcode or code was not right.' : 'That code was not right.',
        { needs },
      );
    }
    const updated = await repository.staffMembers.update(member.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastSignInAt: at,
      ...(recoveryLeft !== null ? { recoveryCodes: recoveryLeft } : {}),
    });
    const role = isStaffRole(updated.role) ? updated.role : 'onboarding';
    // After the grace period, someone without two-step codes can only set them up.
    const dueAt = twoStepDueAt(updated, config);
    const setupOnly = !updated.totpEnabled && at.getTime() >= dueAt.getTime();
    await recordAudit(request, {
      actor: who,
      action: 'staff.signed-in',
      detail: [
        recoveryLeft !== null ? 'with a recovery code' : '',
        setupOnly ? 'to set up two-step codes only' : '',
      ]
        .filter(Boolean)
        .join(', '),
    });
    return {
      token: signStaffToken(
        updated.id,
        new Date(at.getTime() + STAFF_SESSION_HOURS * 3_600_000),
        env.authTokenSecret,
        { version: updated.sessionVersion, passcode: updated.isOwner, setup: setupOnly },
      ),
      name: updated.name,
      role,
      title: STAFF_ROLES[role].title,
      areas: setupOnly ? [] : STAFF_ROLES[role].areas,
      mustChangePassword: updated.mustChangePassword,
      twoStep: twoStepState(updated, at),
      ...(recoveryLeft !== null
        ? {
            message: `You signed in with a recovery code. It cannot be used again. You have ${recoveryCodesLeft(recoveryLeft)} left.`,
          }
        : {}),
    };
  });

  /** Where someone's two-step codes stand, for the screen. */
  function twoStepState(member: StaffMember, at: Date) {
    const dueAt = twoStepDueAt(member, config);
    return {
      on: member.totpEnabled,
      dueAt,
      /** Past the grace period and not set up: nothing else opens until it is. */
      setupNeeded: !member.totpEnabled && at.getTime() >= dueAt.getTime(),
      recoveryCodesLeft: member.totpEnabled ? recoveryCodesLeft(member.recoveryCodes) : 0,
    };
  }

  /** Who is signed in, and what they may see. */
  app.get('/staff/me', async (request) => {
    const actor = await staffActor(request, undefined, { allowSetup: true });
    const member = actor.id ? await repository.staffMembers.findById(actor.id) : null;
    const twoStep = member ? twoStepState(member, now()) : null;
    return {
      name: actor.name,
      role: actor.role,
      title: STAFF_ROLES[actor.role].title,
      areas: twoStep?.setupNeeded ? [] : actor.areas,
      account: actor.id !== null,
      mustChangePassword: member?.mustChangePassword ?? false,
      isOwner: actor.isOwner,
      // How Ozi addresses the owner, "Mr Anthony" (ruling 44); null for everyone else.
      address: actor.isOwner ? phraseBook(env.storeConfigPath).ownerAddress : null,
      viewOnly: actor.viewOnly,
      totpEnabled: member?.totpEnabled ?? false,
      // Null for the staff key, which has no account and so no two-step codes of its own.
      twoStep,
    };
  });

  app.post('/staff/password', async (request) => {
    const actor = await staffActor(request, undefined, { allowSetup: true });
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

  /**
   * Someone lost their phone and their recovery codes: the founder switches their two-step
   * codes off and signs them out everywhere. They set them up again at their next sign-in.
   */
  app.post('/staff/team/:id/two-step-reset', async (request) => {
    const actor = await staffActor(request, 'team');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const member = await repository.staffMembers.findById(id);
    if (!member) throw new NotFoundError('staff member');
    if (member.isOwner) {
      throw new ForbiddenError(
        'The owner’s two-step codes are reset with one of his recovery codes, never by anyone else.',
      );
    }
    if (actor.id === member.id) {
      throw new BadRequestError('Please use My two-step codes to change your own.');
    }
    await repository.staffMembers.update(member.id, {
      totpEnabled: false,
      totpSecret: null,
      recoveryCodes: '',
      sessionVersion: member.sessionVersion + 1,
    });
    return {
      message: `${member.name}'s two-step codes are off and they are signed out. They set them up again the next time they sign in.`,
    };
  });

  /* ------------------------------------------------------------------ two-step codes, everyone */

  /** The signed-in person's own account; two-step codes need one, so not the staff key. */
  async function ownAccount(request: Parameters<typeof staffActor>[0]): Promise<{
    actor: StaffActor;
    member: StaffMember;
  }> {
    const actor = await staffActor(request, undefined, { allowSetup: true });
    const member = actor.id ? await repository.staffMembers.findById(actor.id) : null;
    if (!member) {
      throw new BadRequestError('The staff key has no account, so no two-step codes of its own.');
    }
    // Family and investors only look at the business, but their own sign-in is theirs to keep
    // safe: they set two-step codes up like everyone (every admin sign-in, Section Q).
    return { actor, member };
  }

  async function startTwoStep(member: StaffMember) {
    if (member.totpEnabled) {
      throw new ConflictError(
        'Two-step codes are already on. To move them to a new phone, switch them off first.',
      );
    }
    const secret = newTotpSecret();
    await repository.staffMembers.update(member.id, { totpSecret: secret, totpEnabled: false });
    const label = encodeURIComponent(`${config.productName}:${member.username}`);
    return {
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(config.productName)}`,
      message:
        'Add this key to your authenticator app, then type the 6-digit code it shows to switch two-step codes on.',
    };
  }

  async function confirmTwoStep(member: StaffMember, code: string) {
    if (!member.totpSecret || !totpMatches(member.totpSecret, code, now())) {
      throw new BadRequestError('That code was not right. Please try the newest one.');
    }
    const codes = newRecoveryCodes();
    const updated = await repository.staffMembers.update(member.id, {
      totpEnabled: true,
      recoveryCodes: hashRecoveryCodes(codes),
    });
    const at = now();
    return {
      message:
        'Two-step codes are on. You will be asked for one each time you sign in. Keep the recovery codes somewhere safe: each one works once, if you lose your phone.',
      recoveryCodes: codes,
      // A fresh session, so someone who could only set up two-step codes can now carry on.
      token: signStaffToken(
        updated.id,
        new Date(at.getTime() + STAFF_SESSION_HOURS * 3_600_000),
        env.authTokenSecret,
        { version: updated.sessionVersion, passcode: updated.isOwner },
      ),
    };
  }

  async function switchOff(member: StaffMember) {
    if (now().getTime() >= twoStepDueAt(member, config).getTime()) {
      throw new ForbiddenError(
        'Two-step codes are a must for every admin sign-in now, so they cannot be switched off. To move them to a new phone, ask the founder to reset them.',
      );
    }
    await repository.staffMembers.update(member.id, {
      totpEnabled: false,
      totpSecret: null,
      recoveryCodes: '',
    });
    return { message: 'Two-step codes are off.' };
  }

  app.post('/staff/two-step/start', async (request) => {
    const { member } = await ownAccount(request);
    return startTwoStep(member);
  });

  app.post('/staff/two-step/confirm', async (request) => {
    const { member } = await ownAccount(request);
    const { code } = z.object({ code: z.string().max(10) }).parse(request.body ?? {});
    return confirmTwoStep(member, code);
  });

  /** Before the grace period ends, two-step codes can be switched off again, with the password. */
  app.post('/staff/two-step/off', async (request) => {
    const { member } = await ownAccount(request);
    const { password } = z.object({ password: z.string().max(200) }).parse(request.body ?? {});
    if (member.isOwner) {
      throw new ForbiddenError('The owner switches two-step codes off with his passcode.');
    }
    if (!passwordMatches(password, member.passwordHash)) {
      throw new UnauthorisedError('Your password was not right.');
    }
    return switchOff(member);
  });

  /** A fresh set of recovery codes, the old ones stopping, with a code from the app. */
  app.post('/staff/two-step/recovery-codes', async (request) => {
    const { member } = await ownAccount(request);
    const { code } = z.object({ code: z.string().max(10) }).parse(request.body ?? {});
    if (!member.totpEnabled || !member.totpSecret) {
      throw new BadRequestError('Two-step codes are not on yet.');
    }
    if (!totpMatches(member.totpSecret, code, now())) {
      throw new BadRequestError('That code was not right. Please try the newest one.');
    }
    const codes = newRecoveryCodes();
    await repository.staffMembers.update(member.id, { recoveryCodes: hashRecoveryCodes(codes) });
    return {
      recoveryCodes: codes,
      message: 'Here are your new recovery codes. The old ones no longer work.',
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

  /** The owner's own account; `allowSetup` for setting up two-step codes, and nothing else. */
  async function owner(
    request: Parameters<typeof staffActor>[0],
    allowSetup = false,
  ): Promise<StaffMember> {
    const actor = await staffActor(request, undefined, { allowSetup });
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

  // The owner's own way in to the same two-step codes as everyone, switched off with the
  // passcode rather than the password.
  app.post('/staff/owner/two-step/start', async (request) => {
    return startTwoStep(await owner(request, true));
  });

  app.post('/staff/owner/two-step/confirm', async (request) => {
    const member = await owner(request, true);
    const { code } = z.object({ code: z.string().max(10) }).parse(request.body ?? {});
    return confirmTwoStep(member, code);
  });

  app.post('/staff/owner/two-step/off', async (request) => {
    const member = await owner(request);
    const { passcode } = z.object({ passcode: z.string().max(20) }).parse(request.body ?? {});
    checkPasscode(member, passcode);
    return switchOff(member);
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
