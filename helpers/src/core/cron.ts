/**
 * Reads the five part cron lines Cloudflare uses ("*\/5 * * * *" = every five minutes), so the
 * Node scheduler runs the same timings from the same configuration. Times are UTC.
 * Supports `*`, numbers, ranges `1-5`, lists `1,3` and steps `*\/15` or `0-30/10`.
 */
const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, Sunday 0 (7 is also Sunday)
];

function field(spec: string, [low, high]: [number, number]): Set<number> {
  const values = new Set<number>();
  for (const part of spec.split(',')) {
    const [range = '*', stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    let from = low;
    let to = high;
    if (range !== '*') {
      const [a, b] = range.split('-');
      from = Number(a);
      to = b === undefined ? (stepText ? high : from) : Number(b);
    }
    if (![from, to, step].every(Number.isInteger) || step < 1)
      throw new Error(`Cannot read "${spec}" in a cron line.`);
    for (let value = from; value <= to; value += step)
      values.add(value === 7 && high === 6 ? 0 : value);
  }
  return values;
}

/** Whether a cron line is due at this minute (UTC). */
export function cronMatches(line: string, at: Date): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`A cron line needs five parts: "${line}".`);
  const sets = parts.map((part, index) => field(part, RANGES[index]!));
  const [minutes, hours, days, months, weekdays] = sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  const dayRestricted = parts[2] !== '*';
  const weekdayRestricted = parts[4] !== '*';
  const dayOk = days.has(at.getUTCDate());
  const weekdayOk = weekdays.has(at.getUTCDay());
  // As in standard cron: if both day fields are set, either may match.
  const dateOk = dayRestricted && weekdayRestricted ? dayOk || weekdayOk : dayOk && weekdayOk;
  return (
    minutes.has(at.getUTCMinutes()) &&
    hours.has(at.getUTCHours()) &&
    months.has(at.getUTCMonth() + 1) &&
    dateOk
  );
}
