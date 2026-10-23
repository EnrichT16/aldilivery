import { useEffect, useState } from 'react';
import {
  DELIVERY_WINDOWS,
  addDays,
  bookableDays,
  dayWords,
  daysBetween,
  ukClock,
  ukDay,
  type DeliveryWindow,
} from '@aldilivery/core';

import { storeConfig } from '../config';
import {
  cancelBookedOrder,
  changeBookedOrder,
  fetchBookedOrders,
  type BookedOrder,
} from '../lib/api';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';

const WINDOW_LABEL: Record<DeliveryWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

function statusWords(order: BookedOrder): string {
  if (order.held) return 'Not paid by its time, so no Runner has been sent. It is waiting.';
  if (order.chargeStatus === 'needs_authentication') {
    return 'Your bank wants to check it is you. We have sent you a link to pay.';
  }
  if (order.chargeStatus === 'retrying' || order.chargeStatus === 'failed') {
    return 'The payment could not be taken. Please check your card or pay by bank transfer.';
  }
  if (order.paid) return 'Paid. A Runner is found on the day.';
  if (order.chargePlan === 'bank')
    return `Waiting for your bank transfer, reference ${order.bankReference ?? ''}.`;
  return `The money is taken ${order.chargeWords}.`;
}

/**
 * Booked orders (ruling 78): what is coming on a later day, with a way to change the day, the
 * time of day or when the money is taken, and to cancel. Shown at the top of Past orders, and
 * only when there is one. Cancelling asks once more, in words, before anything happens.
 */
export function BookedOrders(): JSX.Element | null {
  const [orders, setOrders] = useState<BookedOrder[]>([]);
  const [news, setNews] = useState('');
  const ozi = useOzi();

  async function load(): Promise<void> {
    try {
      setOrders((await fetchBookedOrders()).orders);
    } catch {
      setOrders([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (orders.length === 0 && news === '') return null;

  async function done(message: string): Promise<void> {
    setNews(message);
    void ozi.say(message);
    await load();
  }

  return (
    <section aria-labelledby="booked-heading" className="space-y-3">
      <h2 id="booked-heading" className="text-lead font-bold m-0">
        Booked for later
      </h2>
      <p role="status" className="m-0">
        {news}
      </p>
      <ul className="list-none m-0 p-0 space-y-4">
        {orders.map((order) => (
          <BookedRow key={order.id} order={order} onDone={done} />
        ))}
      </ul>
    </section>
  );
}

function BookedRow({
  order,
  onDone,
}: {
  order: BookedOrder;
  onDone: (message: string) => Promise<void>;
}): JSX.Element {
  const [mode, setMode] = useState<'view' | 'change' | 'cancel'>('view');
  const [day, setDay] = useState(order.deliveryDay);
  const [slot, setSlot] = useState<DeliveryWindow>(order.deliveryWindow ?? 'morning');
  const chargeAt = order.chargeAt ? new Date(order.chargeAt) : null;
  const [chargeDay, setChargeDay] = useState(chargeAt ? ukDay(chargeAt) : ukDay(new Date()));
  const [chargeTime, setChargeTime] = useState(
    chargeAt ? ukClock(chargeAt) : storeConfig.scheduled.defaultChargeTime,
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = bookableDays(new Date(), storeConfig.scheduled);
  const today = ukDay(new Date());
  const chargeDays = Array.from({ length: Math.max(1, daysBetween(today, day) + 1) }, (_, index) =>
    addDays(today, index),
  );
  const what = order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ');
  const id = order.id;

  async function save(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const result = await changeBookedOrder(id, {
        deliveryDay: day,
        window: slot,
        ...(order.canChangePayment ? { chargeDay, chargeTime } : {}),
      });
      setMode('view');
      await onDone(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const result = await cancelBookedOrder(id);
      await onDone(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That could not be cancelled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
      <h3 className="text-lead font-bold m-0">{order.deliveryWords}</h3>
      <p className="m-0">{what}.</p>
      <p className="m-0">
        About {money(order.totalPence)}. {statusWords(order)}
      </p>
      <p className="m-0 text-paper/80">Order reference {order.reference}.</p>
      {error !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {error}
        </p>
      )}

      {mode === 'change' && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-2">
            <label htmlFor={`day-${id}`} className="block font-bold">
              The day
            </label>
            <select
              id={`day-${id}`}
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="control w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
            >
              {days.map((option) => (
                <option key={option} value={option}>
                  {dayWords(option)}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0 space-y-2">
            <legend className="px-2 font-bold">The time of day</legend>
            {DELIVERY_WINDOWS.map((option) => (
              <div key={option} className="flex items-center gap-3 min-h-control">
                <input
                  id={`window-${id}-${option}`}
                  type="radio"
                  name={`window-${id}`}
                  checked={slot === option}
                  onChange={() => setSlot(option)}
                  className="h-7 w-7 shrink-0"
                />
                <label htmlFor={`window-${id}-${option}`}>{WINDOW_LABEL[option]}</label>
              </div>
            ))}
          </fieldset>
          {order.canChangePayment && (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <label htmlFor={`charge-day-${id}`} className="block font-bold">
                  The day the money is taken
                </label>
                <select
                  id={`charge-day-${id}`}
                  value={chargeDay}
                  onChange={(event) => setChargeDay(event.target.value)}
                  className="control min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
                >
                  {chargeDays.map((option) => (
                    <option key={option} value={option}>
                      {dayWords(option)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor={`charge-time-${id}`} className="block font-bold">
                  The time it is taken
                </label>
                <input
                  id={`charge-time-${id}`}
                  type="time"
                  value={chargeTime}
                  onChange={(event) => setChargeTime(event.target.value)}
                  className="control min-h-control rounded-2xl border-2 border-paper bg-paper text-ink"
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
              Save the change
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="control bg-paper/10 text-paper underline"
            >
              Keep it as it is
            </button>
          </div>
        </form>
      )}

      {mode === 'cancel' && (
        <div className="space-y-3">
          <p className="m-0 font-bold">
            {order.paid
              ? 'Cancel this order? Everything you paid comes back to you in full.'
              : 'Cancel this order? Nothing has been taken.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
              className="control bg-highlight text-on-accent"
            >
              Yes, cancel it
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="control bg-paper/10 text-paper underline"
            >
              No, keep it
            </button>
          </div>
        </div>
      )}

      {mode === 'view' && (
        <div className="flex flex-wrap gap-3">
          {order.canChange && (
            <button
              type="button"
              onClick={() => setMode('change')}
              className="control border-paper bg-paper/10 text-paper"
            >
              Change<span className="visually-hidden"> the order for {order.deliveryWords}</span>
            </button>
          )}
          {order.canCancel && (
            <button
              type="button"
              onClick={() => setMode('cancel')}
              className="control border-paper bg-paper/10 text-paper"
            >
              Cancel<span className="visually-hidden"> the order for {order.deliveryWords}</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}
