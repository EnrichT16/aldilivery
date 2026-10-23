/**
 * Ordering now for a later day (ruling 78, Anthony, 23 October 2026).
 *
 * A Shopper may choose the day their shopping comes, from tomorrow up to `maxDaysAhead` (28)
 * days ahead, in a window (morning, afternoon or evening), and when the money is taken: now, at
 * a day and time they choose (payday), or by bank transfer before the day. The order is kept as
 * booked and only offered to Runners at the start of its window less `offerLeadMinutes` (90).
 *
 * Everything here is pure: dates are UK calendar days written YYYY-MM-DD, times are UK clock
 * times written HH:MM, and the only clock is the `now` passed in. The same words are shown on
 * the screen, said by Ozi and read on the telephone, so the one yes always agrees to the same
 * thing (Rule One).
 */

export type DeliveryWindow = 'morning' | 'afternoon' | 'evening';
export const DELIVERY_WINDOWS: readonly DeliveryWindow[] = ['morning', 'afternoon', 'evening'];

/** When the money is taken: now, at a chosen day and time, or by bank transfer before the day. */
export type ChargePlan = 'now' | 'scheduled' | 'bank';

export interface WindowTimes {
  /** HH:MM, UK time. */
  readonly from: string;
  readonly until: string;
}

export interface ScheduledSettings {
  readonly maxDaysAhead: number;
  readonly offerLeadMinutes: number;
  /** The time the money is taken when the Shopper names only a day: "00:05". */
  readonly defaultChargeTime: string;
  readonly retryEveryMinutes: number;
  readonly maxChargeTries: number;
  readonly windows: Readonly<Record<DeliveryWindow, WindowTimes>>;
  readonly reminders: {
    /** The Shopper's reminder the day before, at this UK time. */
    readonly dayBeforeAt: string;
    /** The Shopper's reminder on the morning of delivery, at this UK time. */
    readonly morningOfAt: string;
    /** The owner's one summary of the day's booked orders, on Ozi's desk, at this UK time. */
    readonly ownerSummaryAt: string;
  };
}

export const SCHEDULED_DEFAULTS: ScheduledSettings = {
  maxDaysAhead: 28,
  offerLeadMinutes: 90,
  defaultChargeTime: '00:05',
  retryEveryMinutes: 60,
  maxChargeTries: 6,
  windows: {
    morning: { from: '08:00', until: '12:00' },
    afternoon: { from: '12:00', until: '17:00' },
    evening: { from: '17:00', until: '21:00' },
  },
  reminders: { dayBeforeAt: '18:00', morningOfAt: '07:30', ownerSummaryAt: '07:00' },
};

/* ------------------------------------------------------------------ UK days and times */

const UK = 'Europe/London';

function ukParts(at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: UK,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The UK calendar day of a moment, as YYYY-MM-DD. */
export function ukDay(at: Date): string {
  const parts = ukParts(at);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The UK clock time of a moment, as HH:MM. */
export function ukClock(at: Date): string {
  const parts = ukParts(at);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** A day written YYYY-MM-DD that is a real calendar day. */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A time written HH:MM, from 00:00 to 23:59. */
export function isClock(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** The moment a UK day and clock time names, summer time or not. */
export function ukMoment(day: string, clock: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const [hour, minute] = clock.split(':').map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let guess = wall;
  // Twice is enough: the offset found at the first guess is right except across a change.
  for (let i = 0; i < 2; i += 1) {
    const seen = ukParts(new Date(guess));
    const seenWall = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wall - seenWall;
  }
  return new Date(guess);
}

/** A day so many days on: addDays('2026-10-31', 1) is '2026-11-01'. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Whole days from one day to another: daysBetween('2026-10-23', '2026-10-24') is 1. */
export function daysBetween(from: string, to: string): number {
  const at = (day: string): number => {
    const [year, month, date] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
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

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** "Saturday 31 October". */
export function dayWords(day: string): string {
  const [, month, date] = day.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[weekdayOf(day)]} ${date} ${MONTHS[month - 1]}`;
}

/** "the morning, 8:00 to 12:00". */
export function windowWords(window: DeliveryWindow, settings: ScheduledSettings): string {
  const times = settings.windows[window];
  const short = (clock: string): string => clock.replace(/^0(\d)/, '$1');
  return `the ${window}, ${short(times.from)} to ${short(times.until)}`;
}

/** The days a Shopper may choose, tomorrow first, up to `maxDaysAhead` days ahead. */
export function bookableDays(now: Date, settings: ScheduledSettings): string[] {
  const today = ukDay(now);
  const days: string[] = [];
  for (let ahead = 1; ahead <= settings.maxDaysAhead; ahead += 1) days.push(addDays(today, ahead));
  return days;
}

/** When a booked order is offered to Runners: the start of its window, less the lead time. */
export function offerAtFor(day: string, window: DeliveryWindow, settings: ScheduledSettings): Date {
  const start = ukMoment(day, settings.windows[window].from);
  return new Date(start.getTime() - settings.offerLeadMinutes * 60_000);
}

/** The day by which a bank transfer for a booked order must arrive: the day before delivery. */
export function payByDayFor(day: string): string {
  return addDays(day, -1);
}

/* ------------------------------------------------------------------ checking a booking */

export interface ScheduleChoice {
  deliveryDay: string;
  window: DeliveryWindow;
  chargePlan: ChargePlan;
  /** For `scheduled`: the UK day and time the money is taken. */
  chargeDay?: string | undefined;
  chargeTime?: string | undefined;
}

export type ScheduleCheck =
  | {
      ok: true;
      offerAt: Date;
      /** For `scheduled`: the moment the card is charged. */
      chargeAt: Date | null;
      /** For `bank`: the day the transfer must arrive by. */
      payByDay: string | null;
    }
  | { ok: false; message: string };

/**
 * Whether a booking can be made, and if so when it is offered and when the money is taken.
 * Refusals are in plain words, ready to show or say.
 */
export function checkSchedule(
  choice: ScheduleChoice,
  now: Date,
  settings: ScheduledSettings,
): ScheduleCheck {
  const today = ukDay(now);
  if (!isDay(choice.deliveryDay)) {
    return { ok: false, message: 'Please choose the day for your delivery.' };
  }
  const ahead = daysBetween(today, choice.deliveryDay);
  if (ahead < 1) {
    return {
      ok: false,
      message: 'A booked delivery is for tomorrow or later. For today, choose as soon as possible.',
    };
  }
  if (ahead > settings.maxDaysAhead) {
    return {
      ok: false,
      message: `You can book a delivery up to ${settings.maxDaysAhead} days ahead, so the latest day is ${dayWords(addDays(today, settings.maxDaysAhead))}.`,
    };
  }
  if (!DELIVERY_WINDOWS.includes(choice.window)) {
    return { ok: false, message: 'Please choose morning, afternoon or evening.' };
  }
  const offerAt = offerAtFor(choice.deliveryDay, choice.window, settings);
  if (choice.chargePlan === 'now') return { ok: true, offerAt, chargeAt: null, payByDay: null };
  if (choice.chargePlan === 'bank') {
    return { ok: true, offerAt, chargeAt: null, payByDay: payByDayFor(choice.deliveryDay) };
  }
  const chargeDay = choice.chargeDay ?? '';
  const chargeTime = choice.chargeTime ?? settings.defaultChargeTime;
  if (!isDay(chargeDay)) {
    return { ok: false, message: 'Please choose the day the money is taken.' };
  }
  if (!isClock(chargeTime)) {
    return { ok: false, message: 'Please choose the time the money is taken, such as 00:05.' };
  }
  if (daysBetween(chargeDay, choice.deliveryDay) < 0) {
    return {
      ok: false,
      message: `The money is taken on or before the day of delivery, so please choose ${dayWords(choice.deliveryDay)} or earlier.`,
    };
  }
  const chargeAt = ukMoment(chargeDay, chargeTime);
  if (chargeAt.getTime() <= now.getTime()) {
    return { ok: false, message: 'That time has already gone. Please choose a later time.' };
  }
  if (chargeAt.getTime() > offerAt.getTime()) {
    return {
      ok: false,
      message: `The money must be taken before we send a Runner, so please choose a time before ${ukClock(offerAt)} on ${dayWords(choice.deliveryDay)}.`,
    };
  }
  return { ok: true, offerAt, chargeAt, payByDay: null };
}

/**
 * When a payment that could not be taken is tried again: `retryEveryMinutes` after the last try,
 * up to `maxChargeTries` tries in all (the first included). Null when no try is left.
 */
export function nextChargeTry(
  triesSoFar: number,
  lastTriedAt: Date,
  settings: Pick<ScheduledSettings, 'retryEveryMinutes' | 'maxChargeTries'>,
): Date | null {
  if (triesSoFar >= settings.maxChargeTries) return null;
  return new Date(lastTriedAt.getTime() + settings.retryEveryMinutes * 60_000);
}

/* ------------------------------------------------------------------ the words agreed to */

/** "on Sunday 1 November at 00:05". */
export function chargeMomentWords(day: string, time: string): string {
  return `on ${dayWords(day)} at ${time}`;
}

/**
 * The sentences the Shopper agrees to with their one yes, for a booked order: the day and
 * window, when the money is taken, and that the final amount is what the till says on the day.
 */
export function scheduleAgreementWords(
  choice: ScheduleChoice,
  settings: ScheduledSettings,
): string {
  const when = `Delivered on ${dayWords(choice.deliveryDay)}, in ${windowWords(choice.window, settings)}.`;
  const money =
    choice.chargePlan === 'now'
      ? 'The money is taken from your card now.'
      : choice.chargePlan === 'bank'
        ? `You pay by bank transfer by ${dayWords(payByDayFor(choice.deliveryDay))}.`
        : `The money is taken from your card ${chargeMomentWords(choice.chargeDay ?? choice.deliveryDay, choice.chargeTime ?? settings.defaultChargeTime)}.`;
  const till =
    choice.chargePlan === 'bank'
      ? 'The final amount is what the till says on the day: if prices have gone up, the difference is added to what you pay by bank transfer; if they have gone down, it is given back.'
      : 'The final amount is what the till says on the day: if prices have gone up, the difference is taken from your card on the day; if they have gone down, it is given back.';
  return `${when} ${money} ${till}`;
}

/* ------------------------------------------------------------------ hearing it said */

export interface HeardSchedule {
  /** "as soon as possible", "today". */
  asap?: true;
  deliveryDay?: string;
  window?: DeliveryWindow;
  /** "take the money now". */
  chargeNow?: true;
  /** "pay by bank transfer". */
  bank?: true;
  chargeDay?: string;
  chargeTime?: string;
}

const MONTH_INDEX: Record<string, number> = Object.fromEntries(
  MONTHS.flatMap((name, index) => [
    [name.toLowerCase(), index + 1],
    [name.slice(0, 3).toLowerCase(), index + 1],
  ]),
);
const MONTH_PATTERN =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
MONTH_INDEX['sept'] = 9;

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
};
const ORDINAL_PATTERN =
  '(?:(twenty|thirty)[\\s-])?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)';

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
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
  'twenty five': 25,
  'twenty-five': 25,
  quarter: 15,
  half: 30,
};

function numberFrom(word: string): number | null {
  const clean = word.trim().toLowerCase();
  if (/^\d+$/.test(clean)) return Number(clean);
  return NUMBER_WORDS[clean] ?? null;
}

function ordinalDate(tens: string | undefined, unit: string): number {
  const base = ORDINAL_WORDS[unit] ?? 0;
  if (tens === 'twenty') return 20 + base;
  if (tens === 'thirty') return 30 + base;
  return base;
}

/** The next real day with this day of the month, from today on (this month, or the next). */
function nextDateOfMonth(today: string, date: number, month?: number): string | null {
  const [year, nowMonth] = today.split('-').map(Number) as [number, number];
  const candidates: string[] = [];
  if (month) {
    candidates.push(`${year}-${pad(month)}-${pad(date)}`, `${year + 1}-${pad(month)}-${pad(date)}`);
  } else {
    for (let step = 0; step < 3; step += 1) {
      const index = nowMonth - 1 + step;
      candidates.push(`${year + Math.floor(index / 12)}-${pad((index % 12) + 1)}-${pad(date)}`);
    }
  }
  return candidates.find((day) => isDay(day) && daysBetween(today, day) >= 0) ?? null;
}

const WEEKDAY_PATTERN = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i;

/** A day named in words, from today: "tomorrow", "Saturday", "next week", "the first". */
export function parseSpokenDay(text: string, now: Date): string | null {
  const said = text.toLowerCase();
  const today = ukDay(now);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(said);
  if (iso && isDay(iso[1]!)) return iso[1]!;
  if (/\bday after tomorrow\b/.test(said)) return addDays(today, 2);
  if (/\btomorrow\b/.test(said)) return addDays(today, 1);
  const weeks = /\bin (a|one|two|three|four|\d) weeks?\b/.exec(said);
  if (weeks) return addDays(today, 7 * (numberFrom(weeks[1]!) ?? 1));
  if (/\bin a fortnight\b|\bfortnight\b/.test(said)) return addDays(today, 14);
  const days = /\bin (two|three|four|five|six|\d{1,2}) days\b/.exec(said);
  if (days) return addDays(today, numberFrom(days[1]!) ?? 0);
  // A date: "the first", "the 1st of November", "1 November", "November the first".
  const monthFirst = new RegExp(
    `\\b${MONTH_PATTERN}\\s+(?:the\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?\\b|${ORDINAL_PATTERN}\\b)`,
  ).exec(said);
  if (monthFirst) {
    const month = MONTH_INDEX[monthFirst[1]!];
    const date = monthFirst[2] ? Number(monthFirst[2]) : ordinalDate(monthFirst[3], monthFirst[4]!);
    const found = nextDateOfMonth(today, date, month);
    if (found) return found;
  }
  const dateFirst = new RegExp(
    `\\b(?:the\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)|(\\d{1,2})(?=\\s+(?:of\\s+)?${MONTH_PATTERN})|${ORDINAL_PATTERN})\\b(?:\\s+(?:of\\s+)?${MONTH_PATTERN})?`,
  ).exec(said);
  if (dateFirst) {
    const date = dateFirst[1]
      ? Number(dateFirst[1])
      : dateFirst[2]
        ? Number(dateFirst[2])
        : ordinalDate(dateFirst[4], dateFirst[5]!);
    const month = dateFirst[7] ? MONTH_INDEX[dateFirst[7]] : undefined;
    const found = nextDateOfMonth(today, date, month);
    if (found) return found;
  }
  const weekday = WEEKDAY_PATTERN.exec(said);
  if (weekday) {
    const wanted = WEEKDAYS.findIndex((name) => name.toLowerCase() === weekday[1]!.toLowerCase());
    let ahead = (wanted - weekdayOf(today) + 7) % 7;
    if (ahead === 0) ahead = 7;
    // "Saturday week": the one after.
    if (new RegExp(`${weekday[1]!}s? week\\b`).test(said)) ahead += 7;
    return addDays(today, ahead);
  }
  if (/\bnext week\b/.test(said)) return addDays(today, 7);
  if (/\btoday\b|\btonight\b/.test(said)) return today;
  return null;
}

const HOUR_WORDS =
  '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|midnight|noon|midday)';
const MINUTE_WORDS = '(\\d{1,2}|five|ten|quarter|twenty|twenty[\\s-]five|half|a quarter)';

function hourFrom(word: string): number | null {
  const clean = word.trim().toLowerCase();
  if (clean === 'midnight') return 0;
  if (clean === 'noon' || clean === 'midday') return 12;
  const value = numberFrom(clean);
  return value !== null && value >= 0 && value <= 23 ? value : null;
}

function afternoon(rest: string): 'am' | 'pm' | null {
  if (
    /^\s*(pm|p\.m\.?)\b|^\s*in the (afternoon|evening)\b|^\s*at night\b|^\s*tonight\b/.test(rest)
  ) {
    return 'pm';
  }
  if (/^\s*(am|a\.m\.?)\b|^\s*in the morning\b/.test(rest)) return 'am';
  return null;
}

function clockOf(hour: number, minute: number, half: 'am' | 'pm' | null): string | null {
  let h = hour;
  if (half === 'pm' && h < 12) h += 12;
  if (half === 'am' && h === 12) h = 0;
  if (h < 0 || h > 23 || minute < 0 || minute > 59) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/** A time named in words: "five past midnight" is 00:05, "half past eight" 08:30, "9pm" 21:00. */
export function parseSpokenTime(text: string): string | null {
  const said = text.toLowerCase().replace(/o'?clock/g, "o'clock");
  const digital = /\b(\d{1,2})[:.](\d{2})\b(.*)$/.exec(said);
  if (digital) return clockOf(Number(digital[1]), Number(digital[2]), afternoon(digital[3] ?? ''));
  const past = new RegExp(
    `\\b${MINUTE_WORDS}(?:\\s+minutes?)?\\s+(past|after|to)\\s+${HOUR_WORDS}\\b(.*)$`,
  ).exec(said);
  if (past) {
    const minutes = numberFrom(past[1]!.replace(/^a\s+/, '').replace('-', ' '));
    const hour = hourFrom(past[3]!);
    if (minutes !== null && hour !== null) {
      const half = /midnight/.test(past[3]!)
        ? 'am'
        : /noon|midday/.test(past[3]!)
          ? 'pm'
          : afternoon(past[4] ?? '');
      if (past[2] === 'to') {
        const base = clockOf(hour, 0, half);
        if (!base) return null;
        const [h] = base.split(':').map(Number) as [number];
        return clockOf((h + 23) % 24, 60 - minutes, null);
      }
      return clockOf(hour, minutes, half === 'am' && hour === 0 ? null : half);
    }
  }
  if (/\bmidnight\b/.test(said)) return '00:00';
  if (/\b(noon|midday)\b/.test(said)) return '12:00';
  const plain = new RegExp(
    `\\b(?:at\\s+)?${HOUR_WORDS}(?:\\s+o'clock)?(?=\\s|$|am\\b|pm\\b|a\\.m|p\\.m|[.,!?])(.*)$`,
  ).exec(said.replace(/^.*?\bat\b/, 'at'));
  if (plain && /\bat\b|o'clock|am\b|pm\b|a\.m|p\.m/.test(said)) {
    const hour = hourFrom(plain[1]!);
    if (hour !== null) return clockOf(hour, 0, afternoon(plain[2] ?? ''));
  }
  return null;
}

/** Morning, afternoon or evening, said anywhere. */
export function parseSpokenWindow(text: string): DeliveryWindow | null {
  const said = text.toLowerCase();
  if (/\bmorning\b/.test(said)) return 'morning';
  if (/\bafternoon\b|\blunch ?time\b/.test(said)) return 'afternoon';
  if (/\bevening\b|\btonight\b|\bteatime\b|\bafter work\b/.test(said)) return 'evening';
  return null;
}

const CHARGE_CUE = /\b(take|taking|charge|charging|pay|paying|payment|money|payday)\b/;

/**
 * What was said about when to deliver and when to take the money: "deliver it on Saturday
 * morning and take the money on the first at five past midnight". Only what was clearly said is
 * returned; nothing is guessed.
 */
export function parseSpokenSchedule(text: string, now: Date): HeardSchedule {
  const heard: HeardSchedule = {};
  const clauses = text
    .toLowerCase()
    .split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|\bbut\b)\s*/)
    .filter((clause) => clause.trim() !== '');
  for (const clause of clauses) {
    if (CHARGE_CUE.test(clause)) {
      if (/\bbank transfer\b|\bby bank\b|\bthe bank\b/.test(clause)) {
        heard.bank = true;
        continue;
      }
      if (/\b(now|straight away|right away|today)\b/.test(clause) && !/\bat\b/.test(clause)) {
        heard.chargeNow = true;
        continue;
      }
      const time = parseSpokenTime(clause);
      // The time words must not be read as a day: "five past midnight" names no date.
      const day = parseSpokenDay(clause.replace(/\bat\b.*$/, ''), now);
      if (day) heard.chargeDay = day;
      if (time) heard.chargeTime = time;
      continue;
    }
    if (
      /\bas soon as (possible|you can)\b|\basap\b|\bstraight away\b|\bright away\b/.test(clause)
    ) {
      heard.asap = true;
      continue;
    }
    const day = parseSpokenDay(clause, now);
    const window = parseSpokenWindow(clause);
    if (day) {
      if (day === ukDay(now) && !window) heard.asap = true;
      else heard.deliveryDay = day;
    }
    if (window) heard.window = window;
  }
  return heard;
}
