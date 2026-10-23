import {
  DELIVERY_WINDOWS,
  addDays,
  bookableDays,
  dayWords,
  daysBetween,
  ukDay,
  windowWords,
  type ChargePlan,
  type DeliveryWindow,
} from '@aldilivery/core';

import { storeConfig } from '../config';

/** What the Shopper chose at checkout (ruling 78): today, or a later day, and when they pay. */
export interface Booking {
  when: 'asap' | 'later';
  deliveryDay: string;
  window: DeliveryWindow;
  pay: ChargePlan;
  chargeDay: string;
  chargeTime: string;
}

export function startingBooking(now: Date = new Date()): Booking {
  const days = bookableDays(now, storeConfig.scheduled);
  return {
    when: 'asap',
    deliveryDay: days[0] ?? addDays(ukDay(now), 1),
    window: 'morning',
    pay: 'now',
    chargeDay: ukDay(now),
    chargeTime: storeConfig.scheduled.defaultChargeTime,
  };
}

const WINDOW_LABEL: Record<DeliveryWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

/**
 * "When it comes" on the confirmation screen (ruling 78): as soon as possible, or a later day up
 * to `scheduled.maxDaysAhead` days ahead in a window, and when the money is taken: now, on a day
 * and time the Shopper chooses (their payday), or by bank transfer before the day. Every choice is
 * a native control with its words beside it; nothing is chosen for them but "as soon as possible".
 */
export function WhenItComes({
  booking,
  onChange,
  bankOn,
  laterPaymentAllowed,
}: {
  booking: Booking;
  onChange: (next: Booking) => void;
  bankOn: boolean;
  /** False on a family plan, which pays when it is sent. */
  laterPaymentAllowed: boolean;
}): JSX.Element {
  const settings = storeConfig.scheduled;
  const now = new Date();
  const days = bookableDays(now, settings);
  const today = ukDay(now);
  // The money is taken on or before the day of delivery: today up to that day.
  const chargeDays = Array.from(
    { length: Math.max(1, daysBetween(today, booking.deliveryDay) + 1) },
    (_, index) => addDays(today, index),
  );
  const set = (patch: Partial<Booking>): void => {
    const next = { ...booking, ...patch };
    if (daysBetween(next.chargeDay, next.deliveryDay) < 0) next.chargeDay = next.deliveryDay;
    onChange(next);
  };

  return (
    <section aria-labelledby="when-heading" className="space-y-3">
      <h2 id="when-heading" className="text-lead font-bold">
        When it comes
      </h2>
      <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0 space-y-2">
        <legend className="px-2 font-bold">Deliver</legend>
        <div className="flex items-center gap-3 min-h-control">
          <input
            id="when-asap"
            type="radio"
            name="when"
            checked={booking.when === 'asap'}
            onChange={() => set({ when: 'asap' })}
            className="h-7 w-7 shrink-0"
          />
          <label htmlFor="when-asap">As soon as possible, today</label>
        </div>
        <div className="flex items-center gap-3 min-h-control">
          <input
            id="when-later"
            type="radio"
            name="when"
            checked={booking.when === 'later'}
            onChange={() => set({ when: 'later' })}
            aria-describedby="when-later-hint"
            className="h-7 w-7 shrink-0"
          />
          <label htmlFor="when-later">On another day</label>
        </div>
        <p id="when-later-hint" className="m-0">
          Order now for any day up to {settings.maxDaysAhead} days ahead. You can also say, for
          example, &ldquo;deliver it on Saturday morning&rdquo;.
        </p>
      </fieldset>

      {booking.when === 'later' && (
        <>
          <div className="space-y-2 max-w-xl">
            <label htmlFor="delivery-day" className="block font-bold">
              The day
            </label>
            <select
              id="delivery-day"
              value={booking.deliveryDay}
              onChange={(event) => set({ deliveryDay: event.target.value })}
              className="control w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {dayWords(day)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0 space-y-2">
            <legend className="px-2 font-bold">The time of day</legend>
            {DELIVERY_WINDOWS.map((slot) => (
              <div key={slot} className="flex items-center gap-3 min-h-control">
                <input
                  id={`window-${slot}`}
                  type="radio"
                  name="window"
                  checked={booking.window === slot}
                  onChange={() => set({ window: slot })}
                  className="h-7 w-7 shrink-0"
                />
                <label htmlFor={`window-${slot}`}>
                  {WINDOW_LABEL[slot]}, {windowWords(slot, settings).replace(/^the \w+, /, '')}
                </label>
              </div>
            ))}
          </fieldset>

          <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0 space-y-2">
            <legend className="px-2 font-bold">When the money is taken</legend>
            <div className="flex items-center gap-3 min-h-control">
              <input
                id="charge-now"
                type="radio"
                name="charge"
                checked={booking.pay === 'now'}
                onChange={() => set({ pay: 'now' })}
                className="h-7 w-7 shrink-0"
              />
              <label htmlFor="charge-now">Now, from my card</label>
            </div>
            {laterPaymentAllowed && (
              <div className="flex items-center gap-3 min-h-control">
                <input
                  id="charge-later"
                  type="radio"
                  name="charge"
                  checked={booking.pay === 'scheduled'}
                  onChange={() => set({ pay: 'scheduled' })}
                  aria-describedby="charge-later-hint"
                  className="h-7 w-7 shrink-0"
                />
                <label htmlFor="charge-later">From my card, on a day and time I choose</label>
              </div>
            )}
            {laterPaymentAllowed && (
              <p id="charge-later-hint" className="m-0">
                For example on payday, when your wages or benefits arrive. You can also say
                &ldquo;take the money on the first at five past midnight&rdquo;.
              </p>
            )}
            {bankOn && laterPaymentAllowed && (
              <div className="flex items-center gap-3 min-h-control">
                <input
                  id="charge-bank"
                  type="radio"
                  name="charge"
                  checked={booking.pay === 'bank'}
                  onChange={() => set({ pay: 'bank' })}
                  className="h-7 w-7 shrink-0"
                />
                <label htmlFor="charge-bank">
                  By bank transfer, by {dayWords(addDays(booking.deliveryDay, -1))}
                </label>
              </div>
            )}
          </fieldset>

          {booking.pay === 'scheduled' && laterPaymentAllowed && (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <label htmlFor="charge-day" className="block font-bold">
                  The day the money is taken
                </label>
                <select
                  id="charge-day"
                  value={booking.chargeDay}
                  onChange={(event) => set({ chargeDay: event.target.value })}
                  className="control min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
                >
                  {chargeDays.map((day) => (
                    <option key={day} value={day}>
                      {dayWords(day)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="charge-time" className="block font-bold">
                  The time it is taken
                </label>
                <input
                  id="charge-time"
                  type="time"
                  value={booking.chargeTime}
                  onChange={(event) => set({ chargeTime: event.target.value })}
                  className="control min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
                />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
