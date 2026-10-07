/**
 * When something goes wrong with an order (rulings of 2 October 2026).
 *
 * - The Runner or the Shopper reports it, on their own, in the app, and adds evidence: voice
 *   notes, photos, and written notes. Either side of the order can add to a report.
 * - A person decides within two working days. The UK's Consumer Rights Act gives fourteen days
 *   to refund once agreed; the refund here goes back the day it is decided.
 * - A small refund (£5 or less, a setting) is given straight away, with no investigation, and is
 *   never counted against the Runner.
 * - Who pays, once decided: the platform refunds the Shopper. Found at fault, a Runner repays a
 *   small part of each job's pay (10%, a setting) until it is repaid; never automatically, only
 *   after a person's written decision, which the Runner sees and can answer. The Shopper at
 *   fault: no refund. The platform or the shop at fault: the platform bears it.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import { requireSession, type Session } from '../app.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import type { Order, ProblemDecision, ProblemEvidence, ProblemReport } from '../domain.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors.js';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/x-m4a',
];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const DECISION_WORDS: Record<ProblemDecision, string> = {
  shopper_at_fault: 'The Shopper was responsible.',
  runner_at_fault: 'The Runner was responsible.',
  platform_at_fault: 'We were responsible.',
  shop_at_fault: 'The shop was responsible.',
  no_fault: 'Nobody was at fault.',
};

/** Two working days on: Saturdays and Sundays do not count. */
export function addWorkingDays(from: Date, days: number): Date {
  const at = new Date(from);
  let left = days;
  while (left > 0) {
    at.setUTCDate(at.getUTCDate() + 1);
    const weekday = at.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return at;
}

function publicEvidence(evidence: ProblemEvidence) {
  return {
    id: evidence.id,
    kind: evidence.kind,
    addedBy: evidence.addedBy,
    text: evidence.text,
    contentType: evidence.contentType,
    createdAt: evidence.createdAt,
  };
}

export async function registerProblemRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config, payments, now } = app.ctx;
  const symbol = config.store.currencySymbol;

  /** The order, if this person is its Shopper or its Runner. */
  async function partyTo(session: Session, orderId: string): Promise<Order> {
    const order = await repository.orders.findById(orderId);
    const mine =
      order &&
      ((session.role === 'shopper' && order.shopperId === session.accountId) ||
        (session.role === 'runner' && order.runnerId === session.accountId));
    if (!order || !mine) throw new NotFoundError('order');
    return order;
  }

  function orderTotal(order: Order): number {
    // Gift card money already went back to the card, so it cannot be refunded twice.
    return (order.finalTotalPence ?? order.totalEstimatePence) - order.creditAppliedPence;
  }

  async function withEvidence(report: ProblemReport) {
    const evidence = await repository.problemEvidence.listForReport(report.id);
    return {
      id: report.id,
      orderId: report.orderId,
      reportedBy: report.reportedBy,
      summary: report.summary,
      refundRequestedPence: report.refundRequestedPence,
      status: report.status,
      decideBy: report.decideBy,
      decision: report.decision,
      decisionWords: report.decision ? DECISION_WORDS[report.decision] : null,
      refundPence: report.refundPence,
      decisionNote: report.decisionNote,
      decidedAt: report.decidedAt,
      evidence: evidence.map(publicEvidence),
    };
  }

  async function refund(order: Order, amountPence: number, reportId: string): Promise<string> {
    if (!order.stripePaymentIntentId) {
      throw new ConflictError('There is no card payment on this order to refund.');
    }
    const result = await payments.refundPayment({
      paymentIntentId: order.stripePaymentIntentId,
      amountPence,
      reference: `problem:${reportId}`,
    });
    return result.id;
  }

  /* ------------------------------------------------------------------ reporting */

  app.post('/orders/:orderId/problems', async (request, reply) => {
    const session = requireSession(request);
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        summary: z
          .string()
          .trim()
          .min(1, 'Please say what went wrong.')
          .max(2000, 'That is a lot for one report. Please add the rest as a note.'),
        refundRequestedPence: z.number().int().min(0).optional(),
      })
      .parse(request.body);
    const order = await partyTo(session, orderId);
    const asked = session.role === 'shopper' ? (body.refundRequestedPence ?? 0) : 0;
    if (asked > orderTotal(order)) {
      throw new BadRequestError(
        `That is more than the order cost, which was ${formatPence(orderTotal(order), symbol)}.`,
      );
    }

    const at = now();
    let report = await repository.problems.create({
      orderId: order.id,
      reportedBy: session.role === 'shopper' ? 'shopper' : 'runner',
      reporterId: session.accountId,
      summary: body.summary,
      refundRequestedPence: asked,
      status: 'open',
      decideBy: addWorkingDays(at, config.problems.decideWithinWorkingDays),
      decision: null,
      refundPence: 0,
      refundReference: null,
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: at,
    });

    // Small amounts back straight away: investigating would cost more than the item.
    let message = `Thank you. A person will look at this and decide by ${report.decideBy.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}. You can add voice notes, photos or notes to it.`;
    if (
      asked > 0 &&
      asked <= config.problems.instantRefundUpToPence &&
      order.stripePaymentIntentId
    ) {
      const reference = await refund(order, asked, report.id);
      report = await repository.problems.update(report.id, {
        status: 'decided',
        decision: 'no_fault',
        refundPence: asked,
        refundReference: reference,
        decisionNote: `Refunded straight away. Amounts of ${formatPence(config.problems.instantRefundUpToPence, symbol)} or less are not investigated, and not counted against anyone.`,
        decidedBy: 'automatic',
        decidedAt: at,
      });
      message = `${formatPence(asked, symbol)} is on its way back to your card. Your bank may take a few days to show it.`;
    }
    void reply.status(201);
    return { report: await withEvidence(report), message };
  });

  app.get('/orders/:orderId/problems', async (request) => {
    const session = requireSession(request);
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(request.params);
    const order = await partyTo(session, orderId);
    const reports = await repository.problems.listForOrder(order.id);
    return { reports: await Promise.all(reports.map(withEvidence)) };
  });

  /** A voice note, a photo, or a written note — before or after the decision, to answer it. */
  app.post('/problems/:id/evidence', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const session = requireSession(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        kind: z.enum(['voice_note', 'photo', 'note']),
        data: z
          .string()
          .max(12 * 1024 * 1024)
          .optional(),
        contentType: z.string().max(40).optional(),
        text: z.string().trim().max(4000).optional(),
      })
      .parse(request.body);
    const report = await repository.problems.findById(id);
    if (!report) throw new NotFoundError('report');
    await partyTo(session, report.orderId);

    let data: Buffer | null = null;
    if (body.kind === 'note') {
      if (!body.text) throw new BadRequestError('Please write the note.');
    } else {
      const allowed = body.kind === 'photo' ? PHOTO_TYPES : AUDIO_TYPES;
      const type = (body.contentType ?? '').split(';')[0] ?? '';
      if (!body.data || !allowed.includes(type)) {
        throw new BadRequestError(
          body.kind === 'photo' ? 'Please send a photo.' : 'Please send a voice note.',
        );
      }
      data = Buffer.from(body.data, 'base64');
      if (data.length === 0 || data.length > MAX_FILE_BYTES) {
        throw new BadRequestError(
          'That is too large to send. Please keep a voice note under five minutes.',
        );
      }
    }

    const evidence = await repository.problemEvidence.create({
      reportId: report.id,
      addedBy: session.role === 'shopper' ? 'shopper' : 'runner',
      kind: body.kind,
      data,
      contentType: data ? (body.contentType ?? null) : null,
      text: body.kind === 'note' ? (body.text ?? null) : null,
      createdAt: now(),
    });
    void reply.status(201);
    return {
      evidence: publicEvidence(evidence),
      message:
        body.kind === 'voice_note'
          ? 'Your voice note is sent.'
          : body.kind === 'photo'
            ? 'Your photo is sent.'
            : 'Your note is sent.',
    };
  });

  /* ------------------------------------------------------------------ staff */

  app.get('/staff/problems', async (request) => {
    await staffActor(request, 'problems');
    const at = now();
    const open = await repository.problems.listOpen();
    return {
      reports: await Promise.all(
        open.map(async (report) => {
          // Who sent it, by name, so the panel (and Ozi reading it out) can say so.
          const order = await repository.orders.findById(report.orderId);
          const from =
            report.reportedBy === 'shopper'
              ? order && (await repository.shoppers.findById(order.shopperId))?.displayName
              : order?.runnerId && (await repository.runners.findById(order.runnerId))?.name;
          return {
            ...(await withEvidence(report)),
            reporterName: from || null,
            overdue: report.decideBy.getTime() < at.getTime(),
          };
        }),
      ),
    };
  });

  app.get('/staff/evidence/:id', async (request, reply) => {
    await staffActor(request, 'problems');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const evidence = await repository.problemEvidence.findById(id);
    if (!evidence?.data || !evidence.contentType) throw new NotFoundError('file');
    void reply.header('content-type', evidence.contentType);
    void reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(evidence.data));
  });

  app.post('/staff/problems/:id/decide', async (request) => {
    const actor = await staffActor(request, 'problems');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        decision: z.enum([
          'shopper_at_fault',
          'runner_at_fault',
          'platform_at_fault',
          'shop_at_fault',
          'no_fault',
        ]),
        refundPence: z.number().int().min(0),
        note: z
          .string()
          .trim()
          .min(1, 'Please write the decision down, in words the Runner and Shopper will read.')
          .max(2000),
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
      })
      .parse(request.body);
    const report = await repository.problems.findById(id);
    if (!report) throw new NotFoundError('report');
    if (report.status === 'decided') throw new ConflictError('That has already been decided.');
    const order = await repository.orders.findById(report.orderId);
    if (!order) throw new NotFoundError('order');
    if (body.decision === 'shopper_at_fault' && body.refundPence > 0) {
      throw new BadRequestError('When the Shopper was responsible, there is no refund.');
    }
    const alreadyRefunded = (await repository.problems.listForOrder(order.id)).reduce(
      (total, other) => total + other.refundPence,
      0,
    );
    if (body.refundPence + alreadyRefunded > orderTotal(order)) {
      throw new BadRequestError('That would refund more than the order cost.');
    }

    const at = now();
    const reference =
      body.refundPence > 0 ? await refund(order, body.refundPence, report.id) : null;
    const decided = await repository.problems.update(report.id, {
      status: 'decided',
      decision: body.decision,
      refundPence: body.refundPence,
      refundReference: reference,
      decisionNote: body.note,
      decidedBy: decidedBy(actor, body.by),
      decidedAt: at,
    });

    if (body.decision === 'runner_at_fault' && body.refundPence > 0 && order.runnerId) {
      await repository.recoveries.create({
        runnerId: order.runnerId,
        reportId: report.id,
        amountPence: body.refundPence,
        recoveredPence: 0,
        writtenOff: false,
        writtenOffBy: null,
        writtenOffAt: null,
        createdAt: at,
      });
    }
    return { report: await withEvidence(decided) };
  });
}
