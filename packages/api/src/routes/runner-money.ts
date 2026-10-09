/**
 * A Runner's money, beyond each job's pay (ruling 16; docs/LEGAL_REVIEW.md):
 *
 * - when it reaches their bank: weekly by default, daily, or an instant payout at Stripe's fee,
 *   shown first (services/payout-schedule.ts);
 * - leaving: a Runner closing their Runner account, or staff removing one, and the cool bag
 *   deposit paid back (services/runner-leaving.ts);
 * - for staff, a deposit that waits for a person's written decision.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { formatPence } from '@aldilivery/core';

import { requireSession } from '../app.js';
import type { Runner } from '../domain.js';
import { NotFoundError } from '../errors.js';
import { decidedBy, staffActor } from '../lib/staff.js';
import {
  chooseSchedule,
  instantQuote,
  scheduleWords,
  takeInstantPayout,
  WHAT_THE_SCHEDULE_CONTROLS,
} from '../services/payout-schedule.js';
import { decideDeposit, depositHeld, depositWords, leave } from '../services/runner-leaving.js';

export async function registerRunnerMoneyRoutes(app: FastifyInstance): Promise<void> {
  const { repository, config } = app.ctx;
  const symbol = config.store.currencySymbol;

  async function me(request: Parameters<typeof requireSession>[0]): Promise<Runner> {
    const session = requireSession(request, 'runner');
    const runner = await repository.runners.findById(session.accountId);
    if (!runner) throw new NotFoundError('account');
    return runner;
  }

  /** The schedule, what it controls, and what an instant payout would be now, fee first. */
  app.get('/runners/me/payout-schedule', async (request) => {
    const runner = await me(request);
    return {
      schedule: runner.payoutSchedule,
      words: scheduleWords(runner.payoutSchedule),
      controls: WHAT_THE_SCHEDULE_CONTROLS,
      instant: await instantQuote(app.ctx, runner),
      instantFee: {
        basisPoints: config.runners.instantPayoutFeeBasisPoints,
        minimumPence: config.runners.instantPayoutFeeMinimumPence,
      },
    };
  });

  app.post('/runners/me/payout-schedule', async (request) => {
    const runner = await me(request);
    const { schedule } = z.object({ schedule: z.enum(['weekly', 'daily']) }).parse(request.body);
    const updated = await chooseSchedule(app.ctx, runner, schedule);
    return {
      schedule: updated.payoutSchedule,
      words: scheduleWords(updated.payoutSchedule),
      message: `Done. ${scheduleWords(updated.payoutSchedule)}`,
    };
  });

  /** An instant payout, after seeing the fee. The figure they saw comes back, to be sure. */
  app.post('/runners/me/payouts/instant', async (request) => {
    const runner = await me(request);
    const { youGetPence } = z
      .object({ youGetPence: z.number().int().positive() })
      .parse(request.body);
    return takeInstantPayout(app.ctx, runner, youGetPence);
  });

  /** Closing their own Runner account. Their pay and their deposit are settled. */
  app.post('/runners/me/leave', async (request) => {
    const runner = await me(request);
    z.object({
      confirm: z.literal(true, {
        errorMap: () => ({ message: 'Please say you want to stop being a Runner.' }),
      }),
    }).parse(request.body ?? {});
    const { deposit } = await leave(
      app.ctx,
      runner,
      { reason: 'Closed by the Runner', by: `${runner.name}, the Runner` },
      request.log,
    );
    return {
      left: true,
      deposit,
      message: `Your Runner account is closed. Anything still owed to you for jobs is paid as normal. ${depositWords(deposit, symbol)}`,
    };
  });

  /** Staff removing a Runner (the Runner agreement, "Stopping, and changes"). */
  app.post('/staff/runners/:id/remove', async (request) => {
    const actor = await staffActor(request, 'documents');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
        reason: z.string().trim().min(3, 'Please say why, so the Runner can be told.').max(500),
      })
      .parse(request.body ?? {});
    const runner =
      (await repository.runners.findById(id)) ??
      (await repository.runners.findByReferralCode(id.toUpperCase()));
    if (!runner) throw new NotFoundError('Runner');
    const { deposit } = await leave(
      app.ctx,
      runner,
      { reason: body.reason, by: decidedBy(actor, body.by) },
      request.log,
    );
    return {
      deposit,
      message: `${runner.name} has been removed. ${depositWords(deposit, symbol)}`,
    };
  });

  /** Runners who have left with a deposit still held, and why it waits. */
  app.get('/staff/runners/deposits', async (request) => {
    await staffActor(request, 'owed');
    const rows = [];
    for (const runner of await repository.runners.listAll()) {
      const held = depositHeld(runner);
      if (!runner.leftAt || held <= 0) continue;
      const owed = await repository.recoveries.listOutstanding(runner.id);
      rows.push({
        id: runner.id,
        name: runner.name,
        runnerId: runner.referralCode,
        leftAt: runner.leftAt,
        heldPence: held,
        owedPence: owed.reduce((sum, row) => sum + row.amountPence - row.recoveredPence, 0),
        note: runner.coolBagRefundNote,
      });
    }
    return { deposits: rows };
  });

  /** A person's written decision about a deposit that waited. */
  app.post('/staff/runners/:id/deposit', async (request) => {
    const actor = await staffActor(request, 'owed');
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z
      .object({
        by: z.string().trim().min(1, 'Please say who decided.').max(80),
        keepPence: z.number().int().min(0),
        note: z
          .string()
          .trim()
          .min(3, 'Please write down why, so the Runner can be told in writing.')
          .max(1000),
      })
      .parse(request.body ?? {});
    const runner = await repository.runners.findById(id);
    if (!runner) throw new NotFoundError('Runner');
    const { kept, outcome } = await decideDeposit(app.ctx, runner, {
      keepPence: body.keepPence,
      note: body.note,
      by: decidedBy(actor, body.by),
    });
    return {
      keptPence: kept,
      outcome,
      message: `${kept > 0 ? `${formatPence(kept, symbol)} kept against what is owed. ` : ''}${
        outcome.kind === 'none' ? 'Nothing is left to pay back.' : depositWords(outcome, symbol)
      }`,
    };
  });
}
