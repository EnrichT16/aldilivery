import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { fetchMyOrders, type PastOrder } from '../lib/api';
import { addNamedItems, listInWords } from '../lib/extras';
import { money } from '../lib/money';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

const STATUS_WORDS: Record<string, string> = {
  confirmed: 'Waiting for payment',
  paid: 'Finding a Runner',
  offered: 'Finding a Runner',
  accepted: 'A Runner has it',
  shopping: 'Being shopped',
  receipt_submitted: 'Being shopped',
  delivering: 'On its way',
  delivered: 'Delivered',
  completed: 'Delivered',
  cancelled: 'Cancelled, nothing charged',
  refunded: 'Refunded',
};

/**
 * Your orders: every order, newest first, each with what was in it, what it cost, and a way to
 * report a problem with it (rulings of 2 October 2026).
 */
export function Orders(): JSX.Element {
  const { shopper, restoring } = useSession();
  const [orders, setOrders] = useState<PastOrder[] | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const basket = useBasket();
  const ozi = useOzi();
  const navigate = useNavigate();

  // The weekly shop, again (Anthony, 6 October 2026): one press puts the same things back in
  // the basket, where they can be changed before anything is ordered.
  async function orderAgain(order: PastOrder): Promise<void> {
    const { added, missing } = await addNamedItems(
      order.items.map((item) => ({ item: item.name, quantity: item.quantity })),
      basket,
    );
    const words =
      (added.length > 0
        ? `I've put the same shopping in your basket: ${listInWords(added)}.`
        : "I couldn't find those things in the shop today.") +
      (missing.length > 0 && added.length > 0 ? ` I couldn't find ${listInWords(missing)}.` : '') +
      (added.length > 0 ? ' Shall we look at your basket?' : '');
    setNews(words);
    if (added.length === 0) {
      void ozi.say(words);
      return;
    }
    ozi.listenFor(words, (heard) => {
      if (/\b(yes|yeah|ok|okay|please|sure)\b/i.test(heard)) navigate('/basket');
    });
  }

  useEffect(() => {
    if (!shopper) return;
    fetchMyOrders()
      .then((result) => setOrders(result.orders))
      .catch((failure: unknown) => {
        setProblem(failure instanceof Error ? failure.message : 'We could not load your orders.');
      });
  }, [shopper]);

  if (restoring) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }
  if (!shopper) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your orders</h1>
        <p className="m-0">Sign in to see your orders.</p>
        <Link to="/sign-in?next=/orders" className="control bg-highlight text-ink">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">Your orders</h1>
      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {orders === null ? (
        problem === '' && <p className="m-0">Finding your orders.</p>
      ) : orders.length === 0 ? (
        <p className="m-0">No orders yet.</p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-4">
          {orders.map((order) => {
            const when = new Date(order.deliveredAt ?? order.createdAt).toLocaleDateString(
              'en-GB',
              {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              },
            );
            return (
              <li key={order.id} className="border-2 border-paper/40 rounded-xl p-4 space-y-2">
                <h2 className="text-lead font-bold m-0">
                  {when}: {STATUS_WORDS[order.status] ?? order.status}
                </h2>
                <p className="m-0">
                  {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}.
                </p>
                <p className="m-0">
                  {order.finalTotalPence !== null
                    ? `You paid ${money(order.finalTotalPence)}.`
                    : `About ${money(order.totalEstimatePence)}.`}
                </p>
                {order.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void orderAgain(order)}
                    className="control w-full bg-highlight text-ink"
                  >
                    Order these again<span className="visually-hidden"> from {when}</span>
                  </button>
                )}
                <Link
                  to={`/orders/${encodeURIComponent(order.id)}/problem`}
                  className="control bg-paper/10 text-paper underline"
                >
                  Report a problem<span className="visually-hidden"> with the order of {when}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
