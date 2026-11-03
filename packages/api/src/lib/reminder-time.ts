/**
 * When a reminder is for, from the words people say (Anthony, 3 November 2026, ruling 93).
 *
 * "Remind me tomorrow at 10 to call the bank", "in 20 minutes", "every Monday at 9", "tonight at
 * 8", "on Friday afternoon". Everything is worked out in UK time (Europe/London, so BST and GMT
 * both come out right) from the clock the server is given, never from the machine's own zone.
 *
 * Two callers: the language model gives Ozi a `relative` phrase or an exact `dueAtIso`, which is
 * resolved here; and, with the model away, `understandReminderPhrase` reads a whole "remind me…"
 * sentence by itself, so a reminder can always be set.
 */

import { ukParts, ukStartOfDay, ukWallTimeToDate, ukWhenWords } from '@aldilivery/core';

import type { ReminderChannel, ReminderRepeat } from '../domain.js';

export interface ResolvedWhen {
  dueAt: Date;
  /** "every Monday" and the like set the repeat as well as the first time. */
  repeat: ReminderRepeat | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const SMALL_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fortyfive: 45,
  'forty-five': 45,
  'forty five': 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  half: 0.5,
  'half an': 0.5,
  'a couple of': 2,
  couple: 2,
  few: 3,
  'a few': 3,
};

function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.,;!?]+/g, ' ')
    .replace(/\bo'clock\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberOf(word: string): number | null {
  const n = Number(word);
  if (Number.isFinite(n)) return n;
  return SMALL_NUMBERS[word] ?? null;
}

/* ------------------------------------------------------------------ a clock time */

interface ClockTime {
  hour: number;
  minute: number;
  /** Said with am, pm, "in the morning", "tonight" and so on: the hour is not a guess. */
  marked: boolean;
}

const TIME_WORDS =
  /\b(?:at |by |for )?(?:(noon|midday|midnight)|(?:(half|quarter) (past|to) (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))|(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a m|p m)?)(?: (in the (?:morning|afternoon|evening)|at night|tonight|this (?:morning|afternoon|evening)))?\b/;

/** The clock time in a phrase, the phrase with it taken out, and the words that said it. */
function takeTime(phrase: string): { time: ClockTime | null; rest: string; matched: string } {
  // "at 10", "at 10:30", "at half past two", "at midday", "10 in the morning", "8 tonight".
  const match = TIME_WORDS.exec(phrase);
  if (!match) return { time: null, rest: phrase, matched: '' };
  const [whole, special, fraction, direction, baseWord, hourText, minuteText, meridian, part] =
    match;
  // A bare number that is really a count ("in 20 minutes", "every 2 weeks") is not a time.
  const after = phrase.slice((match.index ?? 0) + whole.length).trim();
  if (
    !special &&
    !fraction &&
    !meridian &&
    !part &&
    !/^(?:at|by|for) /.test(whole.trim()) &&
    /^(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/.test(after)
  ) {
    return { time: null, rest: phrase, matched: '' };
  }
  let hour: number;
  let minute = 0;
  let marked = Boolean(meridian || part || special);
  if (special) {
    hour = special === 'midnight' ? 0 : 12;
  } else if (fraction) {
    const base = numberOf(baseWord ?? '') ?? 0;
    if (direction === 'past') {
      hour = base;
      minute = fraction === 'half' ? 30 : 15;
    } else {
      hour = base - 1;
      minute = 45;
    }
  } else {
    hour = Number(hourText);
    minute = minuteText ? Number(minuteText) : 0;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || minute < 0 || minute > 59) {
    return { time: null, rest: phrase, matched: '' };
  }
  const m = (meridian ?? '').replace(/\s/g, '');
  if (m === 'pm' && hour < 12) hour += 12;
  if (m === 'am' && hour === 12) hour = 0;
  if (part) {
    if (/afternoon|evening|night|tonight/.test(part) && hour < 12) hour += 12;
    if (/morning/.test(part) && hour === 12) hour = 0;
  }
  if (hour === 24) hour = 0;
  if (hour > 12 && hour <= 23) marked = true;
  const rest = `${phrase.slice(0, match.index)} ${after}`.replace(/\s+/g, ' ').trim();
  return { time: { hour, minute, marked }, rest, matched: whole.trim() };
}

/* ------------------------------------------------------------------ the day */

interface DayWords {
  /** Days from today, or a weekday to come. */
  daysAhead?: number;
  weekday?: number;
  /** "every …" */
  repeat?: ReminderRepeat;
  /** "tonight", "tomorrow evening": the time, if bare, is in that part of the day. */
  part?: 'morning' | 'afternoon' | 'evening';
  /** "in 20 minutes": an exact moment from now. */
  fromNowMs?: number;
}

const PART = /\b(morning|afternoon|evening|night|tonight)\b/;

function partOf(text: string): DayWords['part'] | undefined {
  const found = PART.exec(text)?.[1];
  if (!found) return undefined;
  if (found === 'night' || found === 'tonight') return 'evening';
  return found as DayWords['part'];
}

/** The day in a phrase, the phrase with it taken out, and the words that said it. */
function takeDay(phrase: string): { day: DayWords | null; rest: string; matched: string } {
  const patterns: Array<[RegExp, (m: RegExpExecArray) => DayWords | null]> = [
    // "in 20 minutes", "in an hour", "in half an hour", "in 2 days", "in a week".
    [
      /\bin (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty[- ]?five|fifty|half an|a couple of|a few) ?(minutes?|mins?|hours?|hrs?|days?|weeks?)\b(?: time)?/,
      (m) => {
        const count = numberOf(m[1]!);
        if (count === null) return null;
        const unit = m[2]!;
        const ms = /^min/.test(unit)
          ? 60_000
          : /^(hour|hr)/.test(unit)
            ? 3_600_000
            : /^day/.test(unit)
              ? DAY_MS
              : 7 * DAY_MS;
        return { fromNowMs: Math.round(count * ms) };
      },
    ],
    [
      /\bevery (?:day|morning|evening|night|afternoon)\b/,
      (m) => ({ repeat: 'daily', part: partOf(m[0]) }),
    ],
    [
      /\b(?:every|each) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b(?: (morning|afternoon|evening|night))?/,
      (m) => ({
        repeat: 'weekly',
        weekday: WEEKDAY_NAMES.indexOf(m[1]!),
        part: partOf(m[0]),
      }),
    ],
    [/\bevery week\b/, () => ({ repeat: 'weekly', daysAhead: 0 })],
    [/\bevery month\b/, () => ({ repeat: 'monthly', daysAhead: 0 })],
    [
      /\b(?:the )?day after tomorrow\b(?: (morning|afternoon|evening|night))?/,
      (m) => ({ daysAhead: 2, part: partOf(m[0]) }),
    ],
    [
      /\btomorrow\b(?: (morning|afternoon|evening|night))?/,
      (m) => ({ daysAhead: 1, part: partOf(m[0]) }),
    ],
    [/\btonight\b/, () => ({ daysAhead: 0, part: 'evening' })],
    [
      /\b(?:today|this (?:morning|afternoon|evening))\b/,
      (m) => ({ daysAhead: 0, part: partOf(m[0]) }),
    ],
    [
      /\b(?:on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b(?: (morning|afternoon|evening|night))?/,
      (m) => ({
        weekday: WEEKDAY_NAMES.indexOf(m[1]!),
        part: partOf(m[0]),
      }),
    ],
    [/\bnext week\b/, () => ({ daysAhead: 7 })],
  ];
  for (const [pattern, read] of patterns) {
    const match = pattern.exec(phrase);
    if (!match) continue;
    const day = read(match);
    if (!day) continue;
    const rest = `${phrase.slice(0, match.index)} ${phrase.slice(match.index + match[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return { day, rest, matched: match[0] };
  }
  return { day: null, rest: phrase, matched: '' };
}

/* ------------------------------------------------------------------ putting it together */

/** The moment at `hour:minute` UK time on the UK day `daysAhead` days from `now`. */
function onDay(now: Date, daysAhead: number, hour: number, minute: number): Date {
  const start = ukStartOfDay(now, daysAhead);
  const { year, month, day } = ukParts(start);
  return ukWallTimeToDate(year, month, day, hour, minute);
}

/** A bare hour, no am or pm: the next such hour on the clock, morning or afternoon. */
function guessHour(now: Date, daysAhead: number, time: ClockTime, part?: DayWords['part']): Date {
  if (time.marked) return onDay(now, daysAhead, time.hour, time.minute);
  if (part === 'afternoon' || part === 'evening') {
    return onDay(now, daysAhead, time.hour < 12 ? time.hour + 12 : time.hour, time.minute);
  }
  if (part === 'morning') return onDay(now, daysAhead, time.hour % 12, time.minute);
  const morning = onDay(now, daysAhead, time.hour, time.minute);
  if (time.hour >= 12) return morning;
  // "At 3" said in the morning means three this afternoon; "at 10" said at nine means ten this
  // morning. On another day, 1 to 6 are taken as the afternoon, 7 to 11 as the morning.
  if (daysAhead === 0) {
    if (morning.getTime() > now.getTime()) return morning;
    return onDay(now, daysAhead, time.hour + 12, time.minute);
  }
  return time.hour <= 6 ? onDay(now, daysAhead, time.hour + 12, time.minute) : morning;
}

/**
 * The words about when, resolved to a moment and a repeat. Null when no time could be read.
 * A day with no time is nine in the morning; a time with no day is the next such time.
 */
export function resolveWhen(relative: string, now: Date): ResolvedWhen | null {
  const phrase = tidy(relative);
  if (phrase === '') return null;
  const { day, rest } = takeDay(phrase);
  const { time } = takeTime(rest);
  if (!day && !time) return null;
  if (day?.fromNowMs !== undefined) {
    return { dueAt: new Date(now.getTime() + day.fromNowMs), repeat: null };
  }
  const repeat = day?.repeat ?? null;
  const clock: ClockTime = time ?? { hour: 9, minute: 0, marked: true };
  if (day?.weekday !== undefined) {
    const today = ukParts(now).weekday;
    let ahead = (day.weekday - today + 7) % 7;
    let candidate = guessHour(now, ahead, clock, day.part);
    if (candidate.getTime() <= now.getTime()) {
      ahead += 7;
      candidate = guessHour(now, ahead, clock, day.part);
    }
    return { dueAt: candidate, repeat };
  }
  const daysAhead = day?.daysAhead ?? 0;
  let dueAt = guessHour(now, daysAhead, clock, day?.part);
  if (!day && dueAt.getTime() <= now.getTime()) dueAt = guessHour(now, 1, clock);
  if (day && repeat && dueAt.getTime() <= now.getTime()) {
    // "every day at 8" said at nine: the first is tomorrow.
    dueAt = guessHour(
      now,
      daysAhead + (repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : 0),
      clock,
      day.part,
    );
    if (repeat === 'monthly' && dueAt.getTime() <= now.getTime())
      dueAt = nextOccurrence(dueAt, 'monthly');
  }
  return { dueAt, repeat };
}

/** The next time a repeating reminder is due after `dueAt`, on the UK clock. */
export function nextOccurrence(dueAt: Date, repeat: ReminderRepeat): Date {
  const parts = ukParts(dueAt);
  switch (repeat) {
    case 'daily':
      return ukWallTimeToDate(parts.year, parts.month, parts.day + 1, parts.hour, parts.minute);
    case 'weekly':
      return ukWallTimeToDate(parts.year, parts.month, parts.day + 7, parts.hour, parts.minute);
    case 'monthly': {
      // The same day next month; a day the next month has not got is its last day.
      const next = new Date(Date.UTC(parts.year, parts.month, parts.day));
      if (next.getUTCDate() !== parts.day) next.setUTCDate(0);
      return ukWallTimeToDate(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        parts.hour,
        parts.minute,
      );
    }
    case 'none':
      return dueAt;
  }
}

/** "every day", "every Monday", "every month on the same date", for reading back. */
export function repeatWords(repeat: ReminderRepeat, dueAt: Date): string {
  switch (repeat) {
    case 'daily':
      return 'every day';
    case 'weekly': {
      const name = WEEKDAY_NAMES[ukParts(dueAt).weekday] ?? '';
      return `every ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    }
    case 'monthly':
      return 'every month on the same date';
    case 'none':
      return '';
  }
}

/** "tomorrow at 10 in the morning, and then every day": when a reminder is for, in words. */
export function whenWords(dueAt: Date, repeat: ReminderRepeat, now: Date): string {
  const when = ukWhenWords(dueAt, now);
  return repeat === 'none' ? when : `${when}, and then ${repeatWords(repeat, dueAt)}`;
}

/* ------------------------------------------------------------------ a whole sentence */

export interface ReminderPhrase {
  text: string;
  dueAt: Date;
  repeat: ReminderRepeat;
  channel: ReminderChannel | null;
}

/** "Remind me…", "set a reminder…", "can you remind me…": a reminder is being asked for. */
export const ASKS_FOR_REMINDER =
  /\b(?:remind me|set (?:me )?(?:a|an|up a) reminder|(?:a |an )?reminder (?:for|to|that|about))\b/i;

/** "What are my reminders", "list my reminders", "do I have any reminders". */
export const ASKS_REMINDER_LIST =
  /\b(?:(?:what|which) (?:are|about) my reminders|(?:list|read|show|tell me) (?:me )?(?:my |the )?reminders|(?:do i have|have i got) (?:any )?reminders|my reminders)\b/i;

/** "Cancel my reminder", "delete the reminder", "forget my reminders". */
export const ASKS_REMINDER_CANCEL =
  /\b(?:cancel|delete|remove|forget|scrap) (?:my |the |that |all (?:my |the )?)?reminders?\b/i;

const CHANNEL_WORDS: Array<[RegExp, ReminderChannel]> = [
  [/\bby (?:a )?(?:phone ?call|call|calling|phone|ringing)\b|\b(?:ring|call|phone) me\b/, 'call'],
  [/\bby (?:a )?(?:text|sms|text message|texting)\b|\btext me\b/, 'text'],
  [/\bby (?:a )?(?:notification|alert|ping)\b/, 'notification'],
];

/**
 * A whole "remind me…" sentence read without the model: the words of the reminder, when, how
 * often and, if said, how. Null when it is not a reminder, or no time could be read: Ozi then
 * asks for one.
 */
export function understandReminderPhrase(
  said: string,
  now: Date,
): ReminderPhrase | { needsTime: true; text: string } | null {
  const phrase = tidy(said);
  if (!ASKS_FOR_REMINDER.test(phrase)) return null;
  let rest = phrase;
  let channel: ReminderChannel | null = null;
  for (const [pattern, kind] of CHANNEL_WORDS) {
    if (pattern.test(rest)) {
      channel = kind;
      rest = rest.replace(pattern, ' ');
    }
  }
  // The time can come before or after the words: both are taken out, and the words remain.
  const { day, rest: noDay, matched: dayWords } = takeDay(rest);
  const { time, rest: noTime, matched: timeWords } = takeTime(noDay);
  const words = noTime
    .replace(/^(?:(?:hey|hi|ok|okay) [a-z]+ )?/, '')
    .replace(/\b(?:can|could|would|will) you (?:please )?/, ' ')
    .replace(/\bplease\b/g, ' ')
    .replace(ASKS_FOR_REMINDER, ' ')
    .replace(/\b(?:to|that|about)\b/, ' ')
    .replace(/^\s*(?:to|that|about|and|then)\s+/, '')
    .replace(/\s+(?:to|that|about|at|on|in|and|then|for)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!day && !time) {
    return { needsTime: true, text: words };
  }
  // The time clause is put back together for resolving, so the two halves agree.
  const resolved = resolveWhen(`${dayWords} ${timeWords}`.trim(), now);
  if (!resolved) return { needsTime: true, text: words };
  return {
    text: words,
    dueAt: resolved.dueAt,
    repeat: resolved.repeat ?? 'none',
    channel,
  };
}
