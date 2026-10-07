/**
 * One running copy of the helpers: the runtime, the web handler, the timed tasks and the email
 * entrance. Each platform file (worker.ts, node-server.ts) makes one of these with its own
 * adapters and hands it what arrives.
 */
import { createHandler, type Tasks } from '../admin/api.js';
import { cronMatches } from '../core/cron.js';
import { Runtime, type RuntimeOptions } from '../core/runtime.js';
import { handleEmail, type InboxResult } from '../helpers/inbox/inbox.js';
import type { IncomingEmail } from '../helpers/inbox/mime.js';
import { runBriefing } from '../helpers/briefing/briefing.js';
import { runWatchman } from '../helpers/watchman/watchman.js';

/** The default timings, in UTC. 06:30 UTC is 07:30 in a British summer and 06:30 in winter. */
export const DEFAULT_SCHEDULE = {
  watchman: '*/5 * * * *',
  dailyBriefing: '30 6 * * *',
  weeklyBriefing: '0 7 * * 1',
};

export interface App {
  runtime: Runtime;
  tasks: Tasks;
  fetch(request: Request): Promise<Response>;
  /** Runs every task whose cron line is due at this minute (or exactly matches `cron`). */
  scheduled(at: Date, cron?: string): Promise<string[]>;
  email(email: IncomingEmail): Promise<InboxResult>;
}

/** Extra tasks a platform adds, for example reading a mailbox by IMAP on a Node server. */
export type ExtraTasks = Record<
  string,
  { cron?: string; run: (runtime: Runtime) => Promise<string> }
>;

export function createApp(options: RuntimeOptions, extra: ExtraTasks = {}): App {
  const runtime = new Runtime(options);
  const schedule = { ...DEFAULT_SCHEDULE, ...runtime.config.schedule };
  const timed: Array<{ name: string; cron: string; run: () => Promise<string> }> = [];
  const tasks: Tasks = {};

  const add = (name: string, cron: string | undefined, run: () => Promise<string>): void => {
    tasks[name] = run;
    if (cron) timed.push({ name, cron, run });
  };
  if (runtime.ofType('watchman').length > 0)
    add('watchman', schedule.watchman, () => runWatchman(runtime));
  if (runtime.ofType('briefing').length > 0) {
    add('daily-briefing', schedule.dailyBriefing, () => runBriefing(runtime, 'daily'));
    add('weekly-briefing', schedule.weeklyBriefing, () => runBriefing(runtime, 'weekly'));
  }
  for (const [name, task] of Object.entries(extra)) add(name, task.cron, () => task.run(runtime));

  const handler = createHandler(runtime, tasks);
  return {
    runtime,
    tasks,
    fetch: handler,
    async scheduled(at, cron) {
      const results: string[] = [];
      for (const task of timed) {
        if (cron ? task.cron === cron : cronMatches(task.cron, at)) {
          try {
            results.push(`${task.name}: ${await task.run()}`);
          } catch (error) {
            results.push(`${task.name} failed: ${(error as Error).message}`);
            await runtime.records.log(
              'system',
              'task.failed',
              `The ${task.name} task failed: ${(error as Error).message}`,
            );
          }
        }
      }
      return results;
    },
    email: (email) => handleEmail(runtime, email),
  };
}
