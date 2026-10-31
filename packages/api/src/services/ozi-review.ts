/**
 * Ozi's weekly self-review (Anthony, 31 October 2026, ruling 83).
 *
 * Once every `ozi.reviewEveryDays` (7), from the hourly sweep in index.ts: that week's exchanges
 * that were rated wrong, went unanswered, or ended badly (refused, not found, stopped), at most
 * `ozi.reviewMostExchanges` (50), each shown to the language model for a better reply. Each
 * suggestion goes on the existing Learning list beside the question, for a person to approve or
 * change; it is never spoken, and never becomes a phrase, until a person approves it.
 *
 * Running it again changes nothing: each exchange is marked reviewed and never looked at twice,
 * a question that already has a suggestion keeps it, and the review waits its days before the
 * next one.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { AppContext } from '../app.js';
import { bannedList, containsBanned, fitToKeep } from '../lib/banned.js';
import { normalise, PHRASE_ACCOUNTS, withoutName, type PhraseAccount } from '../lib/phrases.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewReport {
  /** Why nothing was looked at, when nothing was. */
  skipped: 'no-model' | 'not-due' | null;
  reviewed: number;
  suggested: number;
}

export async function reviewOziWeek(
  ctx: Pick<AppContext, 'repository' | 'config' | 'now' | 'brain' | 'env'>,
  log?: FastifyBaseLogger,
): Promise<ReviewReport> {
  const { repository, config, brain } = ctx;
  if (!brain?.suggestReply) return { skipped: 'no-model', reviewed: 0, suggested: 0 };
  const at = ctx.now();
  const every = config.ozi.reviewEveryDays * DAY_MS;
  const last = await repository.memory.lastReviewedAt();
  if (last && at.getTime() - last.getTime() < every) {
    return { skipped: 'not-due', reviewed: 0, suggested: 0 };
  }
  const rows = await repository.memory.listToReview(
    new Date(at.getTime() - every),
    config.ozi.reviewMostExchanges,
  );
  const banned = bannedList(ctx.env.storeConfigPath);
  const names = {
    product: config.productName,
    assistant: config.assistantName,
    heardAs: config.assistantHeardAs,
  };
  let suggested = 0;
  for (const row of rows) {
    try {
      const account = row.account as PhraseAccount;
      const text = normalise(withoutName(row.heard, names));
      if (!PHRASE_ACCOUNTS.includes(account) || text === '' || !fitToKeep(text, banned)) continue;
      const known = await repository.learned.findByText(account, text);
      // Already decided by a person, or already suggested: left as it is.
      if (known && (known.status !== 'waiting' || known.suggestedReply)) continue;
      const better = await brain.suggestReply({
        heard: row.heard,
        said: row.said,
        account: row.accountKind ?? row.account,
        outcome: row.verdict === 'wrong' ? 'rated wrong by a person' : row.outcome,
      });
      if (!better || containsBanned(better, banned)) continue;
      if (!known) await repository.learned.heard({ account, text, at });
      const waiting = known ?? (await repository.learned.findByText(account, text));
      if (!waiting) continue;
      await repository.learned.suggest(waiting.id, better, at);
      suggested += 1;
    } catch (failure) {
      log?.warn({ err: failure }, 'An exchange could not be reviewed.');
    }
  }
  await repository.memory.markReviewed(
    rows.map((row) => row.id),
    at,
  );
  return { skipped: null, reviewed: rows.length, suggested };
}
