/**
 * UK time, in words (Anthony, 3 November 2026, ruling 93).
 *
 * The clock on every signed-in dashboard, what Ozi says to "what time is it", and the moment a
 * reminder is due are all UK time (Europe/London, which moves between GMT and BST by itself).
 * Nothing here takes the machine's own time zone for granted: every figure comes out of
 * `Intl.DateTimeFormat` for London, so a server in Dublin or Frankfurt gives the same words.
 *
 * Nothing here is a name or a price (Rule Nine): only the clock.
 */

export interface UkParts {
  year: number;
  /** 1 to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
  hour: number;
  minute: number;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const UK_TIME_ZONE = 'Europe/London';

/** The UK clock and calendar at a moment. */
export function ukParts(at: Date): UkParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: UK_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    String(parts['weekday']).slice(0, 3),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    // Some engines write midnight as 24 in h23 for a moment; keep it on the clock.
    hour: Number(parts['hour']) % 24,
    minute: Number(parts['minute']),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/**
 * The moment that is this UK wall-clock time: the date and time as if London were UTC, then
 * corrected by London's offset on that day, so BST and GMT both come out right. A time that does
 * not exist (the hour the clocks go forward) lands an hour later, as a clock would.
 */
export function ukWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const seen = ukParts(new Date(guess));
  const seenMinutes = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  const offsetMs = seenMinutes - guess;
  return new Date(guess - offsetMs);
}

/** "2026-11-03" for the UK day a moment falls on. */
export function ukDateKey(at: Date): string {
  const { year, month, day } = ukParts(at);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Midnight at the start of the UK day `days` days after the day `at` falls on. */
export function ukStartOfDay(at: Date, days = 0): Date {
  const { year, month, day } = ukParts(at);
  // Date.UTC carries a day past the month's end into the next month by itself.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return ukWallTimeToDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
  );
}

/** "Tuesday 3 November, 10:42": the clock on every dashboard. */
export function ukClockWords(at: Date): string {
  const parts = ukParts(at);
  return `${WEEKDAYS[parts.weekday]} ${parts.day} ${MONTHS[parts.month - 1]}, ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** "10 in the morning", "half past two in the afternoon", "midday", "7:45 in the evening". */
export function ukTimeSpoken(at: Date): string {
  const { hour, minute } = ukParts(at);
  return clockSpoken(hour, minute);
}

export function clockSpoken(hour: number, minute: number): string {
  if (hour === 0 && minute === 0) return 'midnight';
  if (hour === 12 && minute === 0) return 'midday';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const part = hour < 12 ? 'in the morning' : hour < 18 ? 'in the afternoon' : 'in the evening';
  if (minute === 0) return `${twelve} ${part}`;
  if (minute === 30) return `half past ${twelve} ${part}`;
  if (minute === 15) return `quarter past ${twelve} ${part}`;
  return `${twelve}:${String(minute).padStart(2, '0')} ${part}`;
}

/** "Tuesday 3 November" for a moment, UK time. */
export function ukDayWords(at: Date): string {
  const parts = ukParts(at);
  return `${WEEKDAYS[parts.weekday]} ${parts.day} ${MONTHS[parts.month - 1]}`;
}

/**
 * When a moment is, said relative to now: "today at 10 in the morning", "tomorrow at half past
 * two in the afternoon", "on Monday 9 November at 9 in the morning". Said by Ozi reading a
 * reminder back and shown on the screen.
 */
export function ukWhenWords(at: Date, now: Date): string {
  const time = ukTimeSpoken(at);
  const day = ukDateKey(at);
  if (day === ukDateKey(now)) return `today at ${time}`;
  if (day === ukDateKey(ukStartOfDay(now, 1))) return `tomorrow at ${time}`;
  return `on ${ukDayWords(at)} at ${time}`;
}

/** What Ozi says to "what time is it" or "what's the date": the day and the time in words. */
export function ukTimeAnswer(at: Date): string {
  const parts = ukParts(at);
  return `It's ${ukTimeSpoken(at)} on ${WEEKDAYS[parts.weekday]} the ${ordinalDay(parts.day)} of ${MONTHS[parts.month - 1]}.`;
}

function ordinalDay(day: number): string {
  const words: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
    13: 'thirteenth',
    14: 'fourteenth',
    15: 'fifteenth',
    16: 'sixteenth',
    17: 'seventeenth',
    18: 'eighteenth',
    19: 'nineteenth',
    20: 'twentieth',
    21: 'twenty-first',
    22: 'twenty-second',
    23: 'twenty-third',
    24: 'twenty-fourth',
    25: 'twenty-fifth',
    26: 'twenty-sixth',
    27: 'twenty-seventh',
    28: 'twenty-eighth',
    29: 'twenty-ninth',
    30: 'thirtieth',
    31: 'thirty-first',
  };
  return words[day] ?? String(day);
}

/** "what time is it", "what's the date", "what day is it today": a question about the clock. */
export const ASKS_THE_TIME =
  /^(?:(?:hey |hi |ok |okay )?[a-z]+[,]? )?(?:what(?:'?s| is)? (?:the )?(?:time|date|day)(?: is it| today| now| is it today| is it now)?|what time (?:is it|do you make it)|(?:have you got|do you have) the time|(?:tell me|say) the (?:time|date)|what day (?:is it|is today|of the week is it)|is it (?:morning|afternoon|evening) yet)\W*$/i;
