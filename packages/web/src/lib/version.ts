/**
 * Which build this is, in words (ruling 95, 3 November 2026: a visible version on every page,
 * so a report of "it doesn't load fully" can say which copy of the app the phone is running).
 *
 * `__BUILD_ID__` is baked in by vite.config.ts: the commit, when the build knows it, otherwise
 * the moment of the build. `__BUILD_AT__` is always the moment of the build. The short id is
 * what is shown and read aloud; the date is for people.
 */

import { UK_TIME_ZONE, ukParts } from '@aldilivery/core';

export interface AppVersion {
  /** A short form of the build id, fit for a footer. */
  id: string;
  /** The day the build was made, in UK words, or '' when unknown. */
  date: string;
  /** "Version <id>, <date>". */
  words: string;
}

const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** A build id short enough for a footer: a date-stamped build as the UK day and minute. */
export function shortBuildId(build: string): string {
  const trimmed = build.trim();
  if (ISO_MOMENT.test(trimmed)) {
    const at = new Date(trimmed);
    if (!Number.isNaN(at.getTime())) {
      const parts = ukParts(at);
      const two = (n: number): string => String(n).padStart(2, '0');
      return `${parts.year}${two(parts.month)}${two(parts.day)}.${two(parts.hour)}${two(parts.minute)}`;
    }
  }
  // A commit, or anything else: its first seven characters, as git shortens a commit.
  return trimmed === '' ? 'unknown' : trimmed.slice(0, 7);
}

/** The day a build was made, as "3 November 2026", or '' when the moment is not known. */
export function buildDateWords(builtAt: string): string {
  const at = new Date(builtAt);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at);
}

export function appVersion(
  build: string = __BUILD_ID__,
  builtAt: string = __BUILD_AT__,
): AppVersion {
  const id = shortBuildId(build);
  const date = buildDateWords(builtAt);
  return { id, date, words: date === '' ? `Version ${id}` : `Version ${id}, ${date}` };
}

/** "What version is this?", "which version am I on", "app version", "version number". */
export const ASKS_VERSION =
  /\b(?:(?:what|which)(?:'s| is)? (?:the )?(?:app |software |build )?version(?: number)?(?: is (?:this|it)| am i (?:on|using)| do i have| is (?:this|the) app| of the app(?: is this)?)?|(?:what|which) build(?: is this| am i on)?|app version|version number|version of the app)\b/i;

/** The version, said aloud: a date-stamped build as the day and time, a commit letter by letter. */
export function versionSpoken(version: AppVersion = appVersion()): string {
  const stamped = /^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})$/.exec(version.id);
  if (stamped && version.date !== '') {
    return `This is the version from ${version.date}, built at ${stamped[4]}:${stamped[5]}.`;
  }
  const letters = version.id.split('').join(' ');
  return version.date === ''
    ? `This is version ${letters}.`
    : `This is version ${letters}, from ${version.date}.`;
}
