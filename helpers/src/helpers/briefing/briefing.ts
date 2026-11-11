/**
 * The Briefing. A short daily and weekly summary for Anthony, written to be heard: short
 * sentences, no symbols, no web or email addresses, numbers said plainly. It is kept for the
 * admin page (with a "Read aloud" button) and for Oluoma Voice to fetch, and can also go by
 * text or email.
 */
import type { Metric } from '../../core/config.js';
import type { TeachableHelper } from '../../core/helper.js';
import type { Runtime } from '../../core/runtime.js';
import type { LogEntry } from '../../core/types.js';
import { CATEGORY_LABELS, type Category } from '../inbox/classify.js';
import { currentWatch, type WatchStats } from '../watchman/watchman.js';

export type Period = 'daily' | 'weekly';

const CATEGORY_PLURALS: Record<Category, string> = {
  spam: 'spam',
  complaint: 'complaints',
  order: 'order questions',
  partner: 'from shops or partners',
  council: 'from councils',
  job: 'job enquiries',
  general: 'general questions',
};

function count(n: number, one: string, many: string): string {
  return `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`;
}

function listInWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function greeting(at: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(at),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function spokenDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(at);
}

function spokenTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(new Date(iso))
    .replace(':00', '')
    .replace(/\s+/g, ' ');
}

async function readMetric(runtime: Runtime, metric: Metric): Promise<number | null> {
  const url = metric.url ?? (metric.urlEnv ? runtime.env[metric.urlEnv] : undefined);
  if (!url) return null;
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = metric.tokenEnv ? runtime.env[metric.tokenEnv] : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await runtime.fetch(url, { headers });
    if (!response.ok) return null;
    const value = ((await response.json()) as Record<string, unknown>)[metric.field ?? 'count'];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

function emailSentences(log: LogEntry[], waitingReplies: number): string[] {
  const received = log.filter((e) => e.event === 'email.received');
  const sentences: string[] = [];
  if (received.length === 0) {
    sentences.push('No emails came in.');
  } else {
    const byCategory = new Map<Category, number>();
    for (const entry of received) {
      const category = (entry.data?.category as Category | undefined) ?? 'general';
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
    const parts = [...byCategory.entries()]
      .filter(([category]) => category !== 'spam')
      .sort((a, b) => b[1] - a[1])
      .map(
        ([category, n]) =>
          `${n} ${n === 1 ? CATEGORY_LABELS[category].replace(/^an? /, '') : CATEGORY_PLURALS[category]}`,
      );
    const spam = byCategory.get('spam') ?? 0;
    sentences.push(
      `${capitalise(count(received.length, 'email', 'emails'))} came in${parts.length ? `: ${listInWords(parts)}` : ''}.` +
        (spam
          ? ` ${capitalise(count(spam, 'was spam and was', 'were spam and were'))} set aside.`
          : ''),
    );
    const urgent = received.filter((e) => e.data?.urgent === true).length;
    if (urgent)
      sentences.push(
        `${capitalise(count(urgent, 'was urgent', 'were urgent'))}, and you were texted.`,
      );
  }
  const sent = log.filter((e) => e.event === 'email.replied').length;
  if (sent) sentences.push(`${capitalise(count(sent, 'reply was', 'replies were'))} sent.`);
  sentences.push(
    waitingReplies === 0
      ? 'No replies are waiting for you.'
      : `${capitalise(count(waitingReplies, 'reply is', 'replies are'))} waiting for your approval.`,
  );
  return sentences;
}

/** Writes the briefing. Does not send it: see `runBriefing`. */
export async function buildBriefing(
  runtime: Runtime,
  period: Period,
  helper?: TeachableHelper,
): Promise<string> {
  const at = runtime.clock();
  const zone = runtime.timeZone;
  const days = period === 'weekly' ? 7 : 1;
  const from = new Date(at.getTime() - days * 86_400_000);
  const canRead = helper ? helper.can('read-log') : true;
  const log = canRead ? await runtime.records.logBetween(from, at) : [];

  const waiting = (await Promise.all(runtime.all().map((h) => h.waiting()))).flat();
  const waitingReplies = waiting.filter((item) => item.kind === 'reply').length;
  const waitingQuestions = waiting.filter((item) => item.kind === 'question').length;

  const sentences: string[] = [
    period === 'weekly'
      ? `${greeting(at, zone)} ${runtime.ownerName}. This is your weekly briefing, for the seven days to ${spokenDate(at, zone)}.`
      : `${greeting(at, zone)} ${runtime.ownerName}. This is your briefing for ${spokenDate(at, zone)}.`,
  ];

  if (runtime.ofType('inbox').length > 0) sentences.push(...emailSentences(log, waitingReplies));

  const taught = log.filter((e) => e.event === 'knowledge.taught').length;
  const approved = log.filter((e) => e.event === 'review.approved').length;
  if (taught || approved) {
    sentences.push(
      `The helpers learned ${count(taught, 'new answer', 'new answers')}, and ${count(approved, 'item was', 'items were')} approved.`,
    );
  }
  if (waitingQuestions) {
    sentences.push(
      `${capitalise(count(waitingQuestions, 'question is', 'questions are'))} waiting for you to teach an answer.`,
    );
  }

  const watch = await currentWatch(runtime);
  if (watch.length > 0) {
    const down = watch.filter((c) => c.state?.status === 'down');
    const incidents = log.filter((e) => e.event === 'watch.down').length;
    if (down.length === 0) {
      sentences.push(
        `All ${watch.length === 1 ? 'the websites are' : `${watch.length} websites are`} working.` +
          (incidents
            ? ` There ${incidents === 1 ? 'was 1 problem' : `were ${incidents} problems`}, now fixed.`
            : ''),
      );
    } else {
      for (const check of down) {
        sentences.push(
          `${capitalise(check.name)} has a problem since ${spokenTime(check.state!.since, zone)}: it ${check.state!.lastProblem ?? 'is not working'}.`,
        );
      }
    }
    let stats: WatchStats = { checks: 0, problems: 0 };
    for (let d = 0; d < days; d += 1) {
      const day = new Date(at.getTime() - d * 86_400_000).toISOString().slice(0, 10);
      const s = await runtime.records.state<WatchStats>(`watchman/stats/${day}`);
      if (s) stats = { checks: stats.checks + s.checks, problems: stats.problems + s.problems };
    }
    if (period === 'weekly' && stats.checks > 0) {
      const percent = Math.round(((stats.checks - stats.problems) / stats.checks) * 1000) / 10;
      sentences.push(`Over the week, ${percent} percent of website checks passed.`);
    }
  }

  const metrics = helper?.config.briefing?.metrics ?? [];
  if (metrics.length > 0 && helper?.can('read-metrics')) {
    const said: string[] = [];
    for (const metric of metrics) {
      const value = await readMetric(runtime, metric);
      said.push(value === null ? `${metric.label}: not available` : `${metric.label}: ${value}`);
    }
    sentences.push(`${capitalise(said.join('. '))}.`);
  }

  const failures = log.filter(
    (e) => e.event === 'brain.failed' || e.event === 'task.failed' || e.event === 'alert.not-sent',
  ).length;
  if (failures)
    sentences.push(
      `Something needs a look: ${count(failures, 'thing', 'things')} did not work as planned. The log has the details.`,
    );

  sentences.push(
    period === 'weekly' ? 'That is all for this week.' : 'That is all. Have a good day.',
  );
  return sentences.join('\n');
}

/** Writes the briefing, keeps it, and sends it where the configuration says. */
export async function runBriefing(runtime: Runtime, period: Period): Promise<string> {
  const helper = runtime.ofType('briefing')[0];
  const text = await buildBriefing(runtime, period, helper);
  await runtime.records.saveState('briefing/latest', {
    text,
    at: runtime.clock().toISOString(),
    period,
  });
  if (!helper) return text;
  await helper.log('briefing.made', `The ${period} briefing was written.`);
  const deliver = helper.config.briefing?.deliver ?? [];
  if (deliver.includes('text')) await runtime.textOwner(helper, text);
  if (deliver.includes('email') && (await helper.allowed('email-owner', 'email the briefing'))) {
    const to = runtime.ownerEmail();
    const from =
      runtime.ofType('inbox')[0]?.config.inbox?.replyFrom ??
      runtime.ofType('inbox')[0]?.config.inbox?.addresses[0];
    if (to && from) {
      const result = await runtime.email.send({
        from,
        to,
        subject: `Your ${period} briefing`,
        text,
      });
      await helper.log(
        result.sent ? 'briefing.emailed' : 'briefing.not-emailed',
        result.sent
          ? `The briefing was emailed to ${runtime.ownerName}.`
          : `The briefing was not emailed: ${result.detail}`,
      );
    } else {
      await helper.log(
        'briefing.not-emailed',
        "The briefing was not emailed: the owner's email or a sending address is not set.",
      );
    }
  }
  return text;
}
