/**
 * The Watchman. Every few minutes it checks each website and health address in its list: does
 * it answer, quickly, with what it should say? After two failed checks in a row (one blip is
 * ignored) it texts Anthony once, and texts again when the site is working. Every change is in
 * the log; the counts go into the Briefing.
 */
import type { WatchCheck } from '../../core/config.js';
import type { TeachableHelper } from '../../core/helper.js';
import type { Runtime } from '../../core/runtime.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  /** Plain English, for example "answered with error 503". */
  problem: string | null;
  milliseconds: number;
}

export interface WatchState {
  status: 'up' | 'down';
  failures: number;
  since: string;
  lastProblem: string | null;
  alerted: boolean;
}

export interface WatchStats {
  checks: number;
  problems: number;
}

function seconds(milliseconds: number): string {
  const value = milliseconds / 1000;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} seconds`;
}

function readField(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), body);
}

/** One check, once. Never throws: every failure becomes a plain English problem. */
export async function checkOnce(runtime: Runtime, check: WatchCheck, now: () => number = Date.now): Promise<CheckResult> {
  const timeout = check.timeoutMs ?? 10_000;
  const slow = check.slowMs ?? 5_000;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const result = (problem: string | null): CheckResult => ({
    name: check.name,
    ok: problem === null,
    problem,
    milliseconds: Math.max(0, now() - started),
  });
  try {
    const response = await runtime.fetch(check.url, {
      method: 'GET',
      headers: { 'user-agent': 'TofadachiHelpers-Watchman/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = check.expectText || check.expectJson ? await response.text() : '';
    if (response.status >= 400) return result(`answered with error ${response.status}`);
    if (check.expectText && !body.includes(check.expectText)) {
      return result(`answered, but the page did not say "${check.expectText}"`);
    }
    if (check.expectJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return result('answered, but not with the health report it should give');
      }
      for (const [field, wanted] of Object.entries(check.expectJson)) {
        const actual = readField(parsed, field);
        if (actual !== wanted) return result(`says ${field} is "${String(actual)}" instead of "${String(wanted)}"`);
      }
    }
    const done = result(null);
    if (done.milliseconds > slow) return { ...done, ok: false, problem: `is slow: it took ${seconds(done.milliseconds)}` };
    return done;
  } catch (error) {
    if (controller.signal.aborted) return result(`did not answer within ${seconds(timeout)}`);
    return result(`could not be reached (${(error as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
}

function since(fromIso: string, to: Date): string {
  const minutes = Math.round((to.getTime() - new Date(fromIso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

async function watchOne(runtime: Runtime, helper: TeachableHelper, now: () => number): Promise<CheckResult[]> {
  const settings = helper.config.watchman;
  if (!settings) return [];
  const threshold = Math.max(1, settings.alertAfterFailures ?? 2);
  const results = await Promise.all(settings.checks.map((check) => checkOnce(runtime, check, now)));
  const at = runtime.clock();

  for (const result of results) {
    const key = `watchman/${helper.id}/${result.name}`;
    const before = (await runtime.records.state<WatchState>(key)) ?? {
      status: 'up',
      failures: 0,
      since: at.toISOString(),
      lastProblem: null,
      alerted: false,
    };
    let after: WatchState = before;
    if (result.ok) {
      if (before.status === 'down' || before.failures > 0) {
        after = { status: 'up', failures: 0, since: at.toISOString(), lastProblem: null, alerted: false };
        if (before.alerted) {
          await helper.log('watch.recovered', `${result.name} is working again, after ${since(before.since, at)}.`);
          await runtime.textOwner(helper, `Good news, ${runtime.ownerName}: ${result.name} is working again after ${since(before.since, at)}.`);
        } else if (before.status === 'down') {
          await helper.log('watch.recovered', `${result.name} is working again.`);
        }
      }
    } else {
      const failures = before.failures + 1;
      const startedNow = before.status === 'up';
      after = {
        status: 'down',
        failures,
        since: startedNow ? at.toISOString() : before.since,
        lastProblem: result.problem,
        alerted: before.alerted,
      };
      if (startedNow) await helper.log('watch.down', `${result.name} ${result.problem}.`, { check: result.name });
      if (!before.alerted && failures >= threshold) {
        await runtime.textOwner(helper, `${runtime.ownerName}, ${result.name} ${result.problem}. It has failed ${failures} checks in a row. From the Watchman.`);
        after.alerted = true;
      }
    }
    if (JSON.stringify(after) !== JSON.stringify(before)) await runtime.records.saveState(key, after);
  }

  const statsKey = `watchman/stats/${at.toISOString().slice(0, 10)}`;
  const stats = (await runtime.records.state<WatchStats>(statsKey)) ?? { checks: 0, problems: 0 };
  await runtime.records.saveState(statsKey, {
    checks: stats.checks + results.length,
    problems: stats.problems + results.filter((r) => !r.ok).length,
  });
  return results;
}

/** Runs every Watchman once. Returns a one line summary for the scheduler's log. */
export async function runWatchman(runtime: Runtime, now: () => number = Date.now): Promise<string> {
  const lines: string[] = [];
  for (const helper of runtime.ofType('watchman')) {
    if (!(await helper.allowed('check-websites', 'check the websites'))) continue;
    const results = await watchOne(runtime, helper, now);
    const bad = results.filter((r) => !r.ok);
    lines.push(bad.length === 0 ? `all ${results.length} working` : bad.map((r) => `${r.name} ${r.problem}`).join('; '));
  }
  return lines.join(' | ') || 'nothing was checked';
}

/** What every check looks like now, for the Briefing and the admin page. */
export async function currentWatch(runtime: Runtime): Promise<Array<{ helperId: string; name: string; state: WatchState | null }>> {
  const out: Array<{ helperId: string; name: string; state: WatchState | null }> = [];
  for (const helper of runtime.ofType('watchman')) {
    for (const check of helper.config.watchman?.checks ?? []) {
      out.push({ helperId: helper.id, name: check.name, state: await runtime.records.state<WatchState>(`watchman/${helper.id}/${check.name}`) });
    }
  }
  return out;
}
