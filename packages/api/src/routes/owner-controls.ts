/**
 * The owner's own controls in the admin panel (Anthony, 31 October 2026, ruling 85): every staff
 * account with its sign-in and rough place, the on and off switches, "Switch off all staff except
 * me", and how Ozi reaches him. The owner's alone: his own account, signed in with his passcode.
 * The same service functions answer him by voice, after reading back and his yes.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ALERT_KINDS, ALERT_WAYS } from '@aldilivery/core';
import { z } from 'zod';

import { ForbiddenError } from '../errors.js';
import { staffActor, type StaffActor } from '../lib/staff.js';
import {
  ALERT_KIND_WORDS,
  ALERT_WAY_WORDS,
  alertPreferences,
  saveAlertPreferences,
} from '../services/alert-preferences.js';
import { staffList, switchAllStaffOff, switchStaff } from '../services/staff-control.js';

/** The owner, or refused: the staff key and everyone else may not use these. */
async function theOwner(request: FastifyRequest): Promise<StaffActor> {
  const actor = await staffActor(request);
  if (!actor.isOwner || !actor.id) throw new ForbiddenError('Only the owner can do that.');
  return actor;
}

/** Written in the audit log by the service itself, as the owner's: not again by the hook. */
function audited(request: FastifyRequest): void {
  (request as FastifyRequest & { audited?: boolean }).audited = true;
}

const way = z.enum(ALERT_WAYS);

export async function registerOwnerControlRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/staff/owner/staff', async (request) => {
    await theOwner(request);
    return { staff: await staffList(ctx) };
  });

  app.post('/staff/owner/staff/switch-all-off', async (request) => {
    const actor = await theOwner(request);
    const result = await switchAllStaffOff(ctx, {
      actorId: actor.id,
      name: actor.name,
      isOwner: actor.isOwner,
      via: 'panel',
      ip: request.ip ?? '',
    });
    audited(request);
    return { count: result.count, message: result.words, staff: await staffList(ctx) };
  });

  app.post('/staff/owner/staff/:id/switch', async (request) => {
    const actor = await theOwner(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { on } = z.object({ on: z.boolean() }).parse(request.body ?? {});
    const result = await switchStaff(
      ctx,
      { staffId: id, on },
      {
        actorId: actor.id,
        name: actor.name,
        isOwner: actor.isOwner,
        via: 'panel',
        ip: request.ip ?? '',
      },
    );
    audited(request);
    return { message: result.words, staff: await staffList(ctx) };
  });

  /** How Ozi reaches him, for each kind of matter, and his quiet hours. */
  app.get('/staff/owner/alerts', async (request) => {
    await theOwner(request);
    const preferences = await alertPreferences(ctx);
    return {
      ...preferences,
      kinds: ALERT_KINDS.map((kind) => ({
        kind,
        label: ALERT_KIND_WORDS[kind],
        way: preferences.ways[kind],
        fixed: kind === 'urgentSafety',
      })),
      choices: ALERT_WAYS.map((one) => ({ way: one, label: ALERT_WAY_WORDS[one] })),
    };
  });

  app.post('/staff/owner/alerts', async (request) => {
    const actor = await theOwner(request);
    const body = z
      .object({
        importantEmail: way.optional(),
        otherEmail: way.optional(),
        approvals: way.optional(),
        money: way.optional(),
        quietFrom: z.string().max(10).optional(),
        quietUntil: z.string().max(10).optional(),
      })
      .parse(request.body ?? {});
    const changes = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    ) as typeof body;
    const saved = await saveAlertPreferences(ctx, changes, {
      actorId: actor.id,
      name: actor.name,
      via: 'panel',
      ip: request.ip ?? '',
    });
    audited(request);
    return { message: saved.words, ...saved.preferences };
  });
}
