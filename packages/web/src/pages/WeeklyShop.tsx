import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  bookWeeklyShop,
  fetchMyOrders,
  fetchWeeklyShops,
  stopWeeklyShop,
  type WeeklyShop as WeeklyShopRow,
} from '../lib/api';
import { listInWords } from '../lib/extras';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/** 1 for Monday to 7 for Sunday, as the server counts them. */
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The weekly shop (7 October 2026). The Shopper picks a day. On that day Ozi reminds them and
 * offers to put their usual shopping in the basket. Nothing is ordered, and nothing is paid,
 * until they say so (Rules One and Five).
 */
export function WeeklyShop(): JSX.Element {
  const { shopper } = useSession();
  // Loaded once per person: changing their details here must not reload over the answer.
  const shopperId = shopper?.id;
  const basket = useBasket();
  const ozi = useOzi();
  const [shops, setShops] = useState<WeeklyShopRow[] | null>(null);
  const [day, setDay] = useState(5);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const current = shops?.find((row) => row.active);

  useEffect(() => {
    if (!shopperId) return;
    fetchWeeklyShops()
      .then((result) => setShops(result.sets))
      .catch(() => setShops([]));
  }, [shopperId]);

  async function book(): Promise<void> {
    if (!shopper) return;
    setBusy(true);
    setProblem('');
    try {
      // What goes in it: the basket as it is now, or else the last order.
      let lines = basket.lines.map((line) => ({
        catalogueItemId: line.item.id,
        quantity: line.quantity,
      }));
      let names = basket.lines.map((line) => line.item.name);
      if (lines.length === 0) {
        const { orders } = await fetchMyOrders();
        const last = orders.find((order) => order.items.some((item) => item.catalogueItemId));
        const items = last?.items.filter((item) => item.catalogueItemId) ?? [];
        lines = items.map((item) => ({
          catalogueItemId: item.catalogueItemId ?? '',
          quantity: item.quantity,
        }));
        names = items.map((item) => item.name);
      }
      if (lines.length === 0) {
        throw new Error('Put your usual shopping in the basket first, then book your weekly shop.');
      }
      if (current) await stopWeeklyShop(current.id);
      const { set } = await bookWeeklyShop({
        dayOfWeek: day,
        deliveryAddress: shopper.deliveryAddress || 'Home',
        lines,
      });
      setShops([set]);
      const words = `Your weekly shop is booked for every ${DAYS[day - 1]}: ${listInWords(names)}. Each ${DAYS[day - 1]}, I'll remind you and put it in your basket, and nothing is sent until you say so.`;
      setNews(words);
      void ozi.say(words);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
      void ozi.say(message);
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    if (!current) return;
    await stopWeeklyShop(current.id);
    setShops((before) => (before ?? []).map((row) => ({ ...row, active: false })));
    const words = 'Your weekly shop is stopped. I won’t remind you any more.';
    setNews(words);
    void ozi.say(words);
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">Your weekly shop</h1>
      <p className="m-0">
        Choose a day. On that day, {storeConfig.assistantName} reminds you and puts your usual
        shopping in your basket. You can change it, and nothing is sent or paid until you say so.
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {!shopper ? (
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up an account first
        </Link>
      ) : (
        <>
          {current && (
            <section aria-labelledby="booked" className="space-y-2">
              <h2 id="booked" className="text-lead font-bold m-0">
                Every {DAYS[current.dayOfWeek - 1]}
              </h2>
              <p className="m-0">
                {listInWords(current.items.map((item) => `${item.quantity} ${item.name}`))}.
              </p>
              <button
                type="button"
                onClick={() => void stop()}
                className="control bg-paper/10 text-paper underline"
              >
                Stop my weekly shop
              </button>
            </section>
          )}
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-lead font-bold">Which day?</legend>
            {DAYS.map((name, index) => (
              <label key={name} className="flex items-center gap-3 min-h-control">
                <input
                  type="radio"
                  name="weekly-day"
                  checked={day === index + 1}
                  onChange={() => setDay(index + 1)}
                  className="w-6 h-6"
                />
                {name}
              </label>
            ))}
          </fieldset>
          <p className="m-0">
            {basket.lines.length > 0
              ? 'It will be what is in your basket now.'
              : 'It will be the same as your last order.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void book()}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            {current ? 'Change my weekly shop' : 'Book my weekly shop'}
          </button>
        </>
      )}
    </div>
  );
}
