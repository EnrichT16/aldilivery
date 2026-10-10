/**
 * Which Runners may carry which order, and splitting an order no available Runner can carry
 * (ruling 59, then ruling 60, Anthony, 10 October 2026).
 *
 * A large shop is too heavy and too bulky to carry on foot or on a bicycle. Each way of
 * travelling has its own most of shopping at shop prices (`dispatch.maxGoodsPenceByMode`): on
 * foot and by bicycle £60, by motorbike £70, by car and by van any order up to the whole-order
 * cap (£150). A motorbike, car or van also needs a driving licence and in-date insurance that a
 * person has accepted (checked apart, in the API). The item charges and delivery do not count:
 * they weigh nothing.
 *
 * When an order is over what walking and cycling carry, and no Runner who can carry it takes it
 * within `dispatch.splitAfterMinutes`, it is split by item into parts, each within the walking
 * and cycling limit (`splitIntoParts`), and each part is offered as its own job.
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
export function modeCarries(vehicleType: string, goodsPence: number, limits: MaxGoodsByMode): boolean {
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

/**
 * Split an order by item into as few parts as it takes, each no more than `limitPence` of
 * shopping, dearest units first (first fit decreasing). Two parts where two will do, more only
 * when needed. A line of several units may be shared between parts; no unit is ever split.
 * Refuses a single unit dearer than the limit, which the product cap (£60) makes impossible.
 */
export function splitIntoParts(lines: readonly SplitLine[], limitPence: number): SplitPart[] {
  if (!Number.isInteger(limitPence) || limitPence <= 0) {
    throw new RangeError('The size of a split part must be a whole number of pence above nothing.');
  }
  const units: Array<{ key: string; price: number; order: number }> = [];
  lines.forEach((line, order) => {
    if (line.unitPricePence > limitPence) {
      throw new RangeError(
        `One item costs more than a part may carry (${line.unitPricePence}p over ${limitPence}p).`,
      );
    }
    for (let n = 0; n < line.quantity; n += 1) {
      units.push({ key: line.key, price: line.unitPricePence, order });
    }
  });
  units.sort((a, b) => b.price - a.price || a.order - b.order);

  const total = units.reduce((sum, unit) => sum + unit.price, 0);
  const bins: Array<{ total: number; units: typeof units }> = [];
  const least = Math.max(1, Math.ceil(total / limitPence));
  for (let n = 0; n < least; n += 1) bins.push({ total: 0, units: [] });

  // Into the emptiest part it fits, so the parts come out about the same size.
  for (const unit of units) {
    const fits = bins
      .filter((bin) => bin.total + unit.price <= limitPence)
      .sort((a, b) => a.total - b.total)[0];
    const bin = fits ?? { total: 0, units: [] };
    if (!fits) bins.push(bin);
    bin.total += unit.price;
    bin.units.push(unit);
  }

  return bins
    .filter((bin) => bin.units.length > 0)
    .map((bin) => {
      const byKey = new Map<string, { key: string; quantity: number; unitPricePence: number; order: number }>();
      for (const unit of bin.units) {
        const entry = byKey.get(unit.key);
        if (entry) entry.quantity += 1;
        else byKey.set(unit.key, { key: unit.key, quantity: 1, unitPricePence: unit.price, order: unit.order });
      }
      return {
        lines: [...byKey.values()]
          .sort((a, b) => a.order - b.order)
          .map(({ key, quantity, unitPricePence }) => ({ key, quantity, unitPricePence })),
        goodsPence: bin.total,
      };
    });
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
