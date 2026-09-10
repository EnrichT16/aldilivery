/**
 * Which commit is running.
 *
 * There is no reliable way to ask a platform this, so we look in three places and stop at
 * the first answer: an environment variable the platform or the build set, a build stamp
 * written next to the compiled code, and finally the git checkout itself if one is still
 * there. If none of them answers, `/health` says `null` rather than guessing, because a
 * wrong commit on a health check is worse than no commit at all.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Every name a platform or a CI system might have used. Checked in this order. */
const COMMIT_VARIABLES = [
  'GIT_COMMIT',
  'GIT_COMMIT_SHA',
  'SOURCE_COMMIT',
  'COMMIT_SHA',
  'GITHUB_SHA',
  'DIGITALOCEAN_APP_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'HEROKU_SLUG_COMMIT',
];

const SHA = /^[0-9a-f]{7,40}$/i;

function fromEnvironment(source: NodeJS.ProcessEnv): string | null {
  for (const name of COMMIT_VARIABLES) {
    const value = source[name]?.trim();
    if (value && SHA.test(value)) return value;
  }
  return null;
}

/** A file the build may have written. Absent in development, and that is fine. */
function fromBuildStamp(): string | null {
  try {
    const stamp = readFileSync(
      fileURLToPath(new URL('../COMMIT', import.meta.url)),
      'utf8',
    ).trim();
    return SHA.test(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

function fromGit(): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return SHA.test(output) ? output : null;
  } catch {
    return null;
  }
}

/**
 * Resolved once, at startup, and never again. Asking git on every health check would turn a
 * liveness probe into a process spawn.
 */
export function resolveGitCommit(source: NodeJS.ProcessEnv = process.env): string | null {
  return fromEnvironment(source) ?? fromBuildStamp() ?? fromGit();
}

let cached: string | null | undefined;

/** The same answer every time, worked out on the first call only. */
export function gitCommit(): string | null {
  if (cached === undefined) cached = resolveGitCommit();
  return cached;
}
