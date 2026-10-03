/**
 * A Runner's own account (rulings of 2 October 2026; docs/BUILD_PROMPT.md, Section M).
 *
 * - Documents, photographed with the phone and sent from the app: a face photo, the right to
 *   work, a DBS certificate, and for a car or motorbike the driving licence and insurance. A
 *   share code can be given instead of a photo for the right to work and the DBS check. A person
 *   decides each one; the photo is then removed, apart from the face photo, which the Shopper
 *   sees at the door. Nobody comes to an office.
 * - How they travel. Walking or cycling can be chosen at any time, instantly, with nothing more
 *   needed. A car or motorbike needs a licence and insurance a person has accepted, still in date.
 * - Their dashboard: what they have earned today, this week and in all, big and plain; every job
 *   with its date, area, pay and order reference; and their payouts.
 * - Their own ID and the link they share, and a way to tell us things.
 *
 * And for staff, with the staff key: the documents waiting, each photo, and the decision.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { RUNNER_PAYMENT_PENCE, formatPence } from '@aldilivery/core';

import { requireSession, requireStaff } from '../app.js';
import type { Runner, RunnerDocument, RunnerDocumentKind, VehicleType } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';
import { recordRunnerCheck } from '../services/runner-checks.js';

export const MOTOR_MODES: VehicleType[] = ['motorbike', 'car', 'van'];
const KINDS: RunnerDocumentKind[] = [
  'face_photo',
  'right_to_work',
  'dbs',
  'driving_licence_front',
  'driving_licence_back',
  'insurance',
];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** A phone photo, made smaller by the app before it is sent, is far below this. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const KIND_WORDS: Record<RunnerDocumentKind, string> = {
  face_photo: 'A photo of your face',
  right_to_work: 'Your right to work in the UK',
  dbs: 'Your DBS certificate',
  driving_licence_front: 'The front of your driving licence',
  driving_licence_back: 'The back of your driving licence',
  insurance: 'Your motor insurance certificate',
};

/** The documents this Runner needs, for the ways they said they might deliver. */
export function documentsNeeded(travelModes: VehicleType[]): RunnerDocumentKind[] {
  const needed: RunnerDocumentKind[] = ['face_photo', 'right_to_work', 'dbs'];
  if (travelModes.some((mode) => MOTOR_MODES.includes(mode))) {
    needed.push('driving_licence_front', 'driving_licence_back', 'insurance');
  }
  return needed;
}

/** Whether a car or motorbike is allowed today: a licence and in-date insurance, both accepted. */
export function canDrive(runner: Runner, today: Date): boolean {
  return (
    runner.drivingLicenceVerified &&
    runner.motorInsuranceUntil !== null &&
    runner.motorInsuranceUntil.getTime() >= startOfDay(today).getTime()
  );
}

function startOfDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The postcode district of an address, "ME7", so old jobs show an area and not a door. */
export function areaOf(address: string): string {
  const match = address.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  return match?.[1] ?? 'Area not recorded';
}

/** The reference a Runner sees for an order. Never the Shopper's name or number. */
export function orderReference(orderId: string): string {
  return `OZ-${orderId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-6)
    .toUpperCase()}`;
}

/** The calendar day in the UK, as YYYY-MM-DD, and the Monday that starts its week. */
function ukDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(at);
}
function ukWeekStart(at: Date): string {
  const day = new Date(`${ukDay(at)}T12:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7; // Monday is 0
  day.setUTCDate(day.getUTCDate() - weekday);
  return day.toISOString().slice(0, 10);
}

function publicDocument(document: RunnerDocument) {
  return {
    id: document.id,
    kind: document.kind,
    name: KIND_WORDS[document.kind],
    status: document.status,
    reviewNote: document.reviewNote,
    expiresOn: document.expiresOn,
    sentAs: document.shareCode ? 'share code' : 'photo',
    createdAt: document.createdAt,
  };
}

export async function registerRunnerAccountRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, env, now } = app.ctx;
  const symbol = config.store.currencySymbol;

  async function me(request: Parameters<typeof requireSession>[0]): Promise<Runner> {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    return runner;
  }

  /** What is still needed: never sent, or sent and turned down. */
  async function stillNeeded(runner: Runner): Promise<RunnerDocumentKind[]> {
    const documents = await repository.runnerDocuments.listForRunner(runner.id);
    return documentsNeeded(runner.travelModes).filter((kind) => {
      const latest = documents.find((document) => document.kind === kind);
      return !latest || latest.status === 'rejected';
    });
  }

  /* ------------------------------------------------------------------ documents */

  app.post('/runners/me/documents', { bodyLimit: 9 * 1024 * 1024 }, async (request, reply) => {
    const runner = await me(request);
    const body = z
      .object({
        kind: z.enum(KINDS as [RunnerDocumentKind, ...RunnerDocumentKind[]]),
        image: z
          .string()
          .max(9 * 1024 * 1024)
          .optional(),
        contentType: z.string().max(40).optional(),
        shareCode: z
          .string()
          .trim()
          .min(6, 'A share code is longer than that. Please check it.')
          .max(20, 'That share code is too long. Please check it.')
          .optional(),
        expiresOn: z.string().date('Please give the date as day, month and year.').optional(),
      })
      .parse(request.body);

    let image: Buffer | null = null;
    if (body.image) {
      if (!body.contentType || !IMAGE_TYPES.includes(body.contentType)) {
        throw new BadRequestError('Please send a photo.');
      }
      image = Buffer.from(body.image, 'base64');
      if (image.length === 0)
        throw new BadRequestError('That photo was empty. Please take it again.');
      if (image.length > MAX_IMAGE_BYTES) {
        throw new BadRequestError('That photo is too large. Please take it again.');
      }
    }
    const shareCodeAllowed = body.kind === 'right_to_work' || body.kind === 'dbs';
    if (body.shareCode && !shareCodeAllowed) {
      throw new BadRequestError('This one needs a photo.');
    }
    if (!image && !(body.shareCode && shareCodeAllowed)) {
      throw new BadRequestError(
        shareCodeAllowed ? 'Please send a photo, or type the share code.' : 'Please send a photo.',
      );
    }
    if (body.kind === 'insurance' && !body.expiresOn) {
      throw new BadRequestError('Please give the date your insurance runs out.');
    }

    const document = await repository.runnerDocuments.create({
      runnerId: runner.id,
      kind: body.kind,
      image,
      contentType: image ? (body.contentType ?? null) : null,
      shareCode: body.shareCode ? body.shareCode.toUpperCase().replace(/\s+/g, '') : null,
      expiresOn: body.expiresOn ? new Date(`${body.expiresOn}T00:00:00Z`) : null,
      status: 'submitted',
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now(),
    });
    void reply.status(201);
    return {
      document: publicDocument(document),
      stillNeeded: (await stillNeeded(runner)).map((kind) => ({ kind, name: KIND_WORDS[kind] })),
      message: 'Thank you. We will check it and let you know.',
    };
  });

  app.get('/runners/me/documents', async (request) => {
    const runner = await me(request);
    const documents = await repository.runnerDocuments.listForRunner(runner.id);
    return {
      documents: documents.map(publicDocument),
      stillNeeded: (await stillNeeded(runner)).map((kind) => ({ kind, name: KIND_WORDS[kind] })),
    };
  });

  /* ------------------------------------------------------------------ travel */

  /** How they are delivering today. Walking or cycling: at once. Driving: licence and insurance. */
  app.post('/runners/me/travel-mode', async (request) => {
    const runner = await me(request);
    const { mode } = z
      .object({ mode: z.enum(['on_foot', 'bicycle', 'motorbike', 'car', 'van']) })
      .parse(request.body);
    if (MOTOR_MODES.includes(mode) && !canDrive(runner, now())) {
      throw new ConflictError(
        runner.drivingLicenceVerified || runner.motorInsuranceUntil
          ? 'Your insurance has run out, or has not been checked yet. You can deliver walking or by bicycle today.'
          : 'Before you can deliver by car or motorbike, we need to check your driving licence and insurance. You can deliver walking or by bicycle today.',
        { needs: 'licence_and_insurance' },
      );
    }
    const travelModes = runner.travelModes.includes(mode)
      ? runner.travelModes
      : [...runner.travelModes, mode];
    const updated = await repository.runners.update(runner.id, { vehicleType: mode, travelModes });
    const words: Record<VehicleType, string> = {
      on_foot: 'walking',
      bicycle: 'by bicycle',
      motorbike: 'by motorbike or scooter',
      car: 'by car',
      van: 'by van',
    };
    return { runner: updated, message: `Done. You are delivering ${words[mode]}.` };
  });

  /* ------------------------------------------------------------------ dashboard */

  app.get('/runners/me/dashboard', async (request) => {
    const runner = await me(request);
    const at = now();
    const today = ukDay(at);
    const weekStart = ukWeekStart(at);

    const orders = await repository.orders.listForRunner(runner.id);
    const payouts = await repository.payouts.listForRunner(runner.id);
    const payoutFor = new Map(payouts.map((payout) => [payout.orderId, payout]));

    const jobs = orders
      .filter((order) => ['delivered', 'completed'].includes(order.status))
      .map((order) => {
        const when = order.deliveredAt ?? order.completedAt ?? order.updatedAt;
        const payout = payoutFor.get(order.id);
        return {
          orderId: order.id,
          reference: orderReference(order.id),
          deliveredAt: when,
          area: areaOf(order.deliveryAddress),
          earnedPence: payout?.earnedPence ?? RUNNER_PAYMENT_PENCE,
          paid: payout !== undefined,
          day: ukDay(when),
        };
      });
    const sum = (list: typeof jobs): number => list.reduce((t, job) => t + job.earnedPence, 0);
    const todayPence = sum(jobs.filter((job) => job.day === today));
    const weekPence = sum(jobs.filter((job) => job.day >= weekStart));
    const allPence = sum(jobs);
    const origin = env.primaryOrigin ?? '';
    // What is owed after a decision against them, and what has been taken back so far. Never
    // hidden: every deduction, its reason and what is left.
    const owed = await repository.recoveries.listOutstanding(runner.id);
    const owing = await Promise.all(
      owed.map(async (recovery) => {
        const report = await repository.problems.findById(recovery.reportId);
        return {
          reference: report ? orderReference(report.orderId) : '',
          amountPence: recovery.amountPence,
          recoveredPence: recovery.recoveredPence,
          remainingPence: recovery.amountPence - recovery.recoveredPence,
          reason: report?.decisionNote ?? '',
        };
      }),
    );

    return {
      runnerId: runner.referralCode,
      shareLink: `${origin}/join?ref=${runner.referralCode}`,
      travelling: runner.vehicleType,
      travelModes: runner.travelModes,
      canDrive: canDrive(runner, at),
      earnings: {
        todayPence,
        weekPence,
        allTimePence: allPence,
        todayWords: `${formatPence(todayPence, symbol)} today`,
        jobsToday: jobs.filter((job) => job.day === today).length,
      },
      jobs: jobs.map(({ day: _day, ...job }) => job),
      payouts: payouts.map((payout) => ({
        reference: orderReference(payout.orderId),
        earnedPence: payout.earnedPence,
        coolBagWithheldPence: payout.coolBagWithheldPence,
        recoveryWithheldPence: payout.recoveryWithheldPence,
        transferredPence: payout.transferredPence,
        at: payout.createdAt,
      })),
      totalTransferredPence: payouts.reduce((t, payout) => t + payout.transferredPence, 0),
      owing,
      recoveryPercentOfPay: config.problems.recoveryPercentOfPay,
    };
  });

  /* ------------------------------------------------------------------ feedback */

  app.post('/runners/me/feedback', async (request, reply) => {
    const runner = await me(request);
    const body = z
      .object({
        message: z
          .string()
          .trim()
          .min(1, 'Please say what you would like to tell us.')
          .max(4000, 'That is longer than we can take in one go. Please send it in two parts.'),
        anonymous: z.boolean().default(false),
      })
      .parse(request.body);
    await repository.runnerFeedback.create({
      runnerId: body.anonymous ? null : runner.id,
      message: body.message,
      createdAt: now(),
    });
    void reply.status(201);
    return {
      message: body.anonymous
        ? 'Thank you. We have it, without your name.'
        : 'Thank you. We have it, and may get back to you.',
    };
  });

  /* ------------------------------------------------------------------ staff */

  app.get('/staff/documents', async (request) => {
    requireStaff(request, env.staffKey);
    const waiting = await repository.runnerDocuments.listSubmitted();
    const rows = [];
    for (const document of waiting) {
      const runner = await repository.runners.findById(document.runnerId);
      rows.push({
        ...publicDocument(document),
        shareCode: document.shareCode,
        runner: runner ? { id: runner.id, name: runner.name, runnerId: runner.referralCode } : null,
      });
    }
    return { documents: rows };
  });

  app.get('/staff/documents/:id/image', async (request, reply) => {
    requireStaff(request, env.staffKey);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const document = await repository.runnerDocuments.findById(id);
    if (!document?.image || !document.contentType) throw new NotFoundError('photo');
    void reply.header('content-type', document.contentType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(document.image));
  });

  app.post('/staff/documents/:id/review', async (request) => {
    requireStaff(request, env.staffKey);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        decision: z.enum(['accept', 'reject']),
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
        note: z.string().trim().max(500).optional(),
        expiresOn: z.string().date().optional(),
      })
      .parse(request.body);
    const document = await repository.runnerDocuments.findById(id);
    if (!document) throw new NotFoundError('document');
    if (document.status !== 'submitted') throw new ConflictError('That has already been decided.');
    if (body.decision === 'reject' && !body.note) {
      throw new BadRequestError('Please say why, so the Runner knows what to send instead.');
    }
    const at = now();
    const expiresOn = body.expiresOn ? new Date(`${body.expiresOn}T00:00:00Z`) : document.expiresOn;
    if (body.decision === 'accept' && document.kind === 'insurance' && !expiresOn) {
      throw new BadRequestError('Please give the date the insurance runs out.');
    }

    const decided = await repository.runnerDocuments.update(document.id, {
      status: body.decision === 'accept' ? 'accepted' : 'rejected',
      reviewNote: body.note ?? null,
      reviewedBy: body.by,
      reviewedAt: at,
      expiresOn,
      // Kept only until decided, apart from the face photo the Shopper sees at the door.
      ...(document.kind === 'face_photo' && body.decision === 'accept'
        ? {}
        : { image: null, contentType: null }),
    });

    if (body.decision === 'accept') {
      const evidence = `${KIND_WORDS[document.kind]}, ${document.shareCode ? `share code ending ${document.shareCode.slice(-4)}` : 'photo'}, seen in the app`;
      if (document.kind === 'right_to_work' || document.kind === 'dbs') {
        await recordRunnerCheck(repository, {
          runnerId: document.runnerId,
          kind: document.kind === 'right_to_work' ? 'right_to_work' : 'criminal_record',
          outcome: 'verified',
          evidence,
          checkedBy: body.by,
          note: body.note ?? '',
          checkedAt: at,
        });
      } else if (
        document.kind === 'driving_licence_front' ||
        document.kind === 'driving_licence_back'
      ) {
        const documents = await repository.runnerDocuments.listForRunner(document.runnerId);
        const bothSides = ['driving_licence_front', 'driving_licence_back'].every((kind) =>
          documents.some((d) => d.kind === kind && d.status === 'accepted'),
        );
        if (bothSides) {
          await repository.runners.update(document.runnerId, { drivingLicenceVerified: true });
        }
      } else if (document.kind === 'insurance') {
        await repository.runners.update(document.runnerId, { motorInsuranceUntil: expiresOn });
      }
    }
    return { document: publicDocument(decided) };
  });
}
