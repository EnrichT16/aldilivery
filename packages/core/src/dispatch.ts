/**
 * Which Runners may carry which order, and splitting an order no available Runner can carry
 * (ruling 59, then rulings 60 and 61, Anthony, 10 October 2026).
 *
 * A large shop is too heavy and too bulky to carry on foot or on a bicycle. Each way of
 * travelling has its own most of shopping at shop prices (`dispatch.maxGoodsPenceByMode`): on
 * foot and by bicycle £60, by motorbike £70, by car and by van any order up to the whole-order
 * cap (£150). A motorbike, car or van also needs a driving licence and in-date insurance that a
 * person has accepted (checked apart, in the API). The item charges and delivery do not count:
 * they weigh nothing.
 *
 * When an order is over what walking and cycling carry, and no Runner who can carry it takes it
 * within `dispatch.splitAfterMinutes` (10), it is split by item into parts for the fewest Runners
 * possible, motorbike riders first, then Runners on foot or bicycle (`planSplit`, ruling 61), and
 * each part is offered as its own job to Runners of its kind.
 */

/** The ways a Runner travels, as the configuration names them. */
export const TRAVEL_MODES = ['foot', 'bicycle', 'motorbike', 'car', 'van'] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** The ways of travelling that need a driving licence and insurance. */
export const MOTOR_TRAVEL_MODES: readonly TravelMode[] = ['motorbike', 'car', 'van'];

/** The most of shopping, at shop prices, each way of travelling carries. */
export type MaxGoodsByMode = Readonly<Record<TravelMode, number>>;

/** The configuration's name for a Runner's way of travelling ("on_foot" is "foot"). */
export function travelModeOf(vehicleType: string): TravelMode | null {
  const mode = vehicleType === 'on_foot' ? 'foot' : vehicleType;
  return (TRAVEL_MODES as readonly string[]).includes(mode) ? (mode as TravelMode) : null;
}

/** The most this way of travelling carries; nothing for a way we do not know. */
export function maxGoodsFor(vehicleType: string, limits: MaxGoodsByMode): number {
  const mode = travelModeOf(vehicleType);
  return mode === null ? 0 : limits[mode];
}

/** Whether a Runner travelling this way could carry this much (insurance is checked apart). */
export function modeCarries(
  vehicleType: string,
  goodsPence: number,
  limits: MaxGoodsByMode,
): boolean {
  return goodsPence <= maxGoodsFor(vehicleType, limits);
}

/** Whether this way of travelling needs a licence and insurance checked. */
export function isMotorMode(vehicleType: string): boolean {
  const mode = travelModeOf(vehicleType);
  return mode !== null && MOTOR_TRAVEL_MODES.includes(mode);
}

/** The most a Runner on foot or on a bicycle carries: the size of each split part. */
export function splitPartLimitPence(limits: MaxGoodsByMode): number {
  return Math.min(limits.foot, limits.bicycle);
}

/** Whether this order is over what walking and cycling carry, so needs a vehicle or a split. */
export function needsVehicle(goodsPence: number, limits: MaxGoodsByMode): boolean {
  return goodsPence > splitPartLimitPence(limits);
}

/** One line of an order, as it is split: which line, what one costs, and how many. */
export interface SplitLine {
  readonly key: string;
  readonly unitPricePence: number;
  readonly quantity: number;
}

/** One part of a split order: its lines (with the quantity in this part) and its goods total. */
export interface SplitPart {
  readonly lines: ReadonlyArray<{ key: string; quantity: number; unitPricePence: number }>;
  readonly goodsPence: number;
}

/** The kinds of split part (ruling 61): one for a motorbike rider, or one for foot or bicycle. */
export const SPLIT_PART_MODES = ['motorbike', 'foot'] as const;
export type SplitPartMode = (typeof SPLIT_PART_MODES)[number];

/** The most of shopping each kind of split part carries (`dispatch.splitPartMaxPenceByMode`). */
export type SplitPartMaxByMode = Readonly<Record<SplitPartMode, number>>;

/** One planned part: who it is for, its lines (with the quantity in this part) and its total. */
export interface PlannedPart extends SplitPart {
  readonly mode: SplitPartMode;
}

/**
 * Plan how to split an order by item (ruling 61, Anthony, 10 October 2026): the fewest Runners
 * possible, motorbike riders first, then Runners on foot or bicycle. `motorbikeRiders` is how many
 * motorbike riders are on shift and could take a part right now; each motorbike part carries up
 * to `partMax.motorbike` (£75), each foot or bicycle part up to `partMax.foot` (£60).
 *
 * Units are placed dearest first, each into the first part it fits, motorbike parts before foot
 * parts, so the larger parts are filled first; a new part is opened only when a unit fits in none,
 * a motorbike part while riders remain, otherwise a foot part. A line of several units may be
 * shared between parts; no unit is ever split. So £150 of shopping becomes two motorbike parts of
 * £75 with two riders, motorbike £75 + foot £60 + foot £15 with one, and three foot parts with
 * none. Refuses a single unit dearer than a foot part, which the product cap (£60) makes impossible.
 */
export function planSplit(
  lines: readonly SplitLine[],
  motorbikeRiders: number,
  partMax: SplitPartMaxByMode,
): PlannedPart[] {
  for (const mode of SPLIT_PART_MODES) {
    if (!Number.isInteger(partMax[mode]) || partMax[mode] <= 0) {
      throw new RangeError(
        'The size of a split part must be a whole number of pence above nothing.',
      );
    }
  }
  const riders = Math.max(0, Math.floor(motorbikeRiders));
  // Motorbike parts are opened first, while riders remain, so they are always ahead of the foot
  // parts in the list and fill first.
  return packFirstFit(lines, partMax.foot, (opened) => {
    const mode: SplitPartMode = opened < riders ? 'motorbike' : 'foot';
    return { tag: mode, capacityPence: partMax[mode] };
  }).map(({ tag, lines: partLines, goodsPence }) => ({ mode: tag, lines: partLines, goodsPence }));
}

/**
 * Pack an order's units into bins, dearest first, each into the first bin it fits, opening a
 * new bin (as `openBin` says, given how many are open) only when it fits in none. A line may
 * be shared between bins; a unit never is. Refuses a unit dearer than `largestUnitPence`.
 */
export function packFirstFit<T>(
  lines: readonly SplitLine[],
  largestUnitPence: number,
  openBin: (opened: number) => { tag: T; capacityPence: number },
): Array<SplitPart & { tag: T }> {
  const units: Array<{ key: string; price: number; order: number }> = [];
  lines.forEach((line, order) => {
    if (line.unitPricePence > largestUnitPence) {
      throw new RangeError(
        `One item costs more than a part may carry (${line.unitPricePence}p over ${largestUnitPence}p).`,
      );
    }
    for (let n = 0; n < line.quantity; n += 1) {
      units.push({ key: line.key, price: line.unitPricePence, order });
    }
  });
  units.sort((a, b) => b.price - a.price || a.order - b.order);

  const bins: Array<{ tag: T; capacity: number; total: number; units: typeof units }> = [];
  for (const unit of units) {
    let bin = bins.find((open) => open.total + unit.price <= open.capacity);
    if (!bin) {
      const opened = openBin(bins.length);
      bin = { tag: opened.tag, capacity: opened.capacityPence, total: 0, units: [] };
      bins.push(bin);
    }
    bin.total += unit.price;
    bin.units.push(unit);
  }

  return bins.map((bin) => {
    const byKey = new Map<
      string,
      { key: string; quantity: number; unitPricePence: number; order: number }
    >();
    for (const unit of bin.units) {
      const entry = byKey.get(unit.key);
      if (entry) entry.quantity += 1;
      else
        byKey.set(unit.key, {
          key: unit.key,
          quantity: 1,
          unitPricePence: unit.price,
          order: unit.order,
        });
    }
    return {
      tag: bin.tag,
      lines: [...byKey.values()]
        .sort((a, b) => a.order - b.order)
        .map(({ key, quantity, unitPricePence }) => ({ key, quantity, unitPricePence })),
      goodsPence: bin.total,
    };
  });
}

/** Whether a Runner travelling this way may take a split part of this kind (ruling 61). */
export function modeTakesPart(vehicleType: string, part: SplitPartMode): boolean {
  const mode = travelModeOf(vehicleType);
  if (mode === null) return false;
  return part === 'motorbike'
    ? MOTOR_TRAVEL_MODES.includes(mode)
    : mode === 'foot' || mode === 'bicycle';
}

/** "a motorbike, car or van" or "on foot or by bicycle": who a split part goes to. */
export function splitPartWho(part: SplitPartMode): string {
  return part === 'motorbike'
    ? 'a Runner with a motorbike, car or van'
    : 'a Runner on foot or by bicycle';
}

const VEHICLE_WORDS: Record<TravelMode, string> = {
  foot: 'on foot',
  bicycle: 'bicycle',
  motorbike: 'motorbike',
  car: 'car',
  van: 'van',
};

/** "a motorbike, car or van": the vehicles that may carry this much shopping. */
export function vehiclesWords(goodsPence: number, limits: MaxGoodsByMode): string {
  const modes = MOTOR_TRAVEL_MODES.filter((mode) => limits[mode] >= goodsPence).map(
    (mode) => VEHICLE_WORDS[mode],
  );
  if (modes.length === 0) return 'a vehicle';
  if (modes.length === 1) return `a ${modes[0]}`;
  return `a ${modes.slice(0, -1).join(', ')} or ${modes[modes.length - 1]}`;
}

/**
 * What the Shopper is told about a large order before they say yes (rulings 59 and 60): who
 * carries it, and that it may come in parts, for the same price. The same words on the screen,
 * in the basket's explanation and from the API.
 */
export function largeOrderShopperWords(goodsPence: number, limits: MaxGoodsByMode): string {
  return `Large orders go to a Runner with ${vehiclesWords(goodsPence, limits)}. If none is free, it may come in parts, for the same price.`;
}

// ---------------------------------------------------------------------------
// The fair queue sharpened (ruling 64, Anthony, 16 October 2026)
// ---------------------------------------------------------------------------

/**
 * Four sharpenings of who is offered a job first, all configured under `dispatch` in
 * config/store.json. The functions here are pure: plain data and a time in, an order out, so
 * every rule is proved by tests that need no database and no clock.
 *
 * 1. Earned-today balance: among the Runners who may take a job, the one who has earned least
 *    today goes first, then the one who has waited longest since their last job. Nobody jumps the
 *    fair order (the Shopper's regular Runner, a Runner chaining from the door) while they are
 *    more than `fairShareMaxLeadPence` (£15) ahead of the lowest earner who is on shift and
 *    eligible.
 * 2. Chaining: a Runner on the final leg of a job may be offered the next job whose pickup is
 *    within `chainRadiusMiles` (1.5) of their drop-off, up to `chainMinutesBeforeDone` (2)
 *    before they are done, ahead of the general queue, and may decline without penalty.
 * 3. Distance band first: Runners within `nearBandMiles` (1.5) of the pickup are the first band,
 *    ordered by fairness inside it; everybody else is the second band. If nobody in the first
 *    band accepts within `bandSeconds` (60), the offer widens.
 * 4. Queue position: a Runner can be told their place in the fair queue in one spoken sentence,
 *    "You are second in line for the next job." They see their own place and never anybody
 *    else's earnings.
 */

/** The ruling 64 figures, as `dispatch` in config/store.json names them. */
export interface FairShareSettings {
  readonly fairShareMaxLeadPence: number;
  readonly chainRadiusMiles: number;
  readonly chainMinutesBeforeDone: number;
  readonly nearBandMiles: number;
  readonly bandSeconds: number;
}

/** Anthony's defaults for ruling 64, used when config/store.json does not say. */
export const FAIR_SHARE_DEFAULTS: FairShareSettings = {
  fairShareMaxLeadPence: 1500,
  chainRadiusMiles: 1.5,
  chainMinutesBeforeDone: 2,
  nearBandMiles: 1.5,
  bandSeconds: 60,
};

/** Everything the fair queue needs to know about one eligible Runner. */
export interface FairRunner {
  readonly id: string;
  /** What they have earned today, in pence. Only ever compared, never shown to another Runner. */
  readonly earnedTodayPence: number;
  /** Null for a Runner who has never completed a job: they have waited longest of all. */
  readonly lastJobCompletedAt: Date | null;
  /** How far they are from the pickup, in miles; null when nobody knows where they are. */
  readonly distanceMiles: number | null;
}

/** Near the pickup (the first band) or not (the second). */
export type DistanceBand = 'near' | 'far';

/** One place in the fair queue. */
export interface FairPlace {
  readonly runnerId: string;
  readonly band: DistanceBand;
  readonly distanceMiles: number | null;
  readonly earnedTodayPence: number;
  /** Milliseconds since their last job, Infinity for never. */
  readonly waitedMs: number;
  /** 0 is first. */
  readonly position: number;
}

/** The least anybody in the queue has earned today; nothing when the queue is empty. */
export function lowestEarnedToday(
  runners: ReadonlyArray<Pick<FairRunner, 'earnedTodayPence'>>,
): number {
  if (runners.length === 0) return 0;
  return runners.reduce((lowest, runner) => Math.min(lowest, runner.earnedTodayPence), Infinity);
}

/**
 * Whether a Runner is too far ahead to jump the fair order: more than `maxLeadPence` above the
 * lowest earner who is on shift and eligible. Exactly the lead is not too far.
 */
export function tooFarAhead(
  earnedTodayPence: number,
  lowestPence: number,
  maxLeadPence: number,
): boolean {
  return earnedTodayPence - lowestPence > maxLeadPence;
}

/** Which band a Runner this far from the pickup is in. Nobody knows where: the second band. */
export function bandOf(distanceMiles: number | null, nearBandMiles: number): DistanceBand {
  return distanceMiles !== null && distanceMiles <= nearBandMiles ? 'near' : 'far';
}

/** Milliseconds since a Runner's last job, Infinity for a Runner who has never had one. */
export function waitedMsSince(lastJobCompletedAt: Date | null, now: Date): number {
  return lastJobCompletedAt === null
    ? Number.POSITIVE_INFINITY
    : now.getTime() - lastJobCompletedAt.getTime();
}

/**
 * Fairness between two Runners: the one who has earned less today first, then the one who has
 * waited longer since their last job (never had one counts as longest), then a stable tie break.
 */
export function compareFairShare(a: FairRunner, b: FairRunner, now: Date): number {
  if (a.earnedTodayPence !== b.earnedTodayPence) return a.earnedTodayPence - b.earnedTodayPence;
  const waitedA = waitedMsSince(a.lastJobCompletedAt, now);
  const waitedB = waitedMsSince(b.lastJobCompletedAt, now);
  if (waitedA !== waitedB) return waitedB - waitedA;
  return a.id.localeCompare(b.id);
}

/**
 * The fair queue for one job (rules 1 and 3): the near band first, then the far band, each in
 * fairness order. The Shopper's regular Runner (`regularRunnerId`), when they are in the queue
 * and not more than `fairShareMaxLeadPence` ahead of the lowest earner, is moved to the front;
 * when they are too far ahead they keep their fair place like everybody else.
 */
export function fairQueue(
  runners: readonly FairRunner[],
  now: Date,
  settings: Pick<FairShareSettings, 'fairShareMaxLeadPence' | 'nearBandMiles'>,
  regularRunnerId: string | null = null,
): FairPlace[] {
  const lowest = lowestEarnedToday(runners);
  const ordered = [...runners].sort((a, b) => {
    const bandA = bandOf(a.distanceMiles, settings.nearBandMiles) === 'near' ? 0 : 1;
    const bandB = bandOf(b.distanceMiles, settings.nearBandMiles) === 'near' ? 0 : 1;
    if (bandA !== bandB) return bandA - bandB;
    return compareFairShare(a, b, now);
  });
  const regular = ordered.find(
    (runner) =>
      runner.id === regularRunnerId &&
      !tooFarAhead(runner.earnedTodayPence, lowest, settings.fairShareMaxLeadPence),
  );
  const placed = regular ? [regular, ...ordered.filter((runner) => runner !== regular)] : ordered;
  return placed.map((runner, position) => ({
    runnerId: runner.id,
    band: bandOf(runner.distanceMiles, settings.nearBandMiles),
    distanceMiles: runner.distanceMiles,
    earnedTodayPence: runner.earnedTodayPence,
    waitedMs: waitedMsSince(runner.lastJobCompletedAt, now),
    position,
  }));
}

/**
 * Whether the offer is still the first band's alone (rule 3): the band was first asked at
 * `firstAskedAt`, and `bandSeconds` have not yet passed. After that the offer widens to everybody.
 */
export function firstBandOnly(firstAskedAt: Date, now: Date, bandSeconds: number): boolean {
  return now.getTime() - firstAskedAt.getTime() < bandSeconds * 1000;
}

/**
 * Whether a Runner on the final leg of a job may be offered this one before the general queue
 * (rule 2): its pickup is within `chainRadiusMiles` of their drop-off (unknown is not within),
 * and they are not more than `fairShareMaxLeadPence` ahead of the lowest earner in the queue.
 */
export function mayChain(
  runner: Pick<FairRunner, 'earnedTodayPence'>,
  dropOffToPickupMiles: number | null,
  lowestEarnedPence: number,
  settings: Pick<FairShareSettings, 'chainRadiusMiles' | 'fairShareMaxLeadPence'>,
): boolean {
  if (dropOffToPickupMiles === null || dropOffToPickupMiles > settings.chainRadiusMiles)
    return false;
  return !tooFarAhead(runner.earnedTodayPence, lowestEarnedPence, settings.fairShareMaxLeadPence);
}

/** How long a chained offer is held: the minutes before they are done, in seconds. */
export function chainHoldSeconds(
  settings: Pick<FairShareSettings, 'chainMinutesBeforeDone'>,
): number {
  return settings.chainMinutesBeforeDone * 60;
}

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

/** Why a Runner has no place in the queue right now. */
export type NotInLine = 'off_shift' | 'job_in_hand' | 'checks_not_done' | 'not_allowed';

/**
 * One short spoken sentence about a Runner's place in the fair queue (rule 4), for Ozi and the
 * screen: "You are second in line for the next job." Position 0 is first. Says nothing about
 * anybody else, and nothing about money.
 */
export function queuePositionWords(
  position: number | null,
  reason: NotInLine | null = null,
): string {
  if (position !== null) {
    const place = ORDINALS[position] ?? `number ${position + 1}`;
    return `You are ${place} in line for the next job.`;
  }
  switch (reason) {
    case 'job_in_hand':
      return 'You have a job in hand. You are back in line as soon as it is delivered.';
    case 'checks_not_done':
      return 'Your checks are not finished yet, so you are not in line for jobs.';
    case 'not_allowed':
      return 'You are not in line for jobs just now. Your Runner page says what is needed first.';
    default:
      return 'You are off shift, so you are not in line for jobs. Go on shift to join the line.';
  }
}
