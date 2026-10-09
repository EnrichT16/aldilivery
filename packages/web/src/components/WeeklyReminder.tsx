import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchWeeklyShops } from '../lib/api';
import { addNamedItems, listInWords } from '../lib/extras';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

const ASKED = 'ozidelivery.weekly.asked';

/** Today as the server counts days: 1 for Monday to 7 for Sunday. */
export function serverDay(now = new Date()): number {
  return now.getDay() === 0 ? 7 : now.getDay();
}

/**
 * On the weekly shop day, once that day, Ozi offers to put the usual shopping in the basket.
 * Only an offer: nothing is ordered or paid until the Shopper confirms it as usual (Rules One
 * and Five).
 */
export function WeeklyReminder(): null {
  const { shopper } = useSession();
  const ozi = useOzi();
  const basket = useBasket();
  const navigate = useNavigate();
  const latest = useRef({ ozi, basket, navigate });
  latest.current = { ozi, basket, navigate };
  const signedIn = shopper?.id;

  useEffect(() => {
    if (!signedIn) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (window.localStorage.getItem(ASKED) === today) return;
    } catch {
      // Storage refused: it may ask again on another visit today, which is harmless.
    }
    let cancelled = false;
    // A moment's pause, so it never talks over the greeting.
    const timer = window.setTimeout(() => {
      fetchWeeklyShops()
        .then(({ sets }) => {
          if (cancelled) return;
          // One that sends itself needs no offer: it has its own notice, with the skip word.
          const due = sets.find(
            (set) => set.active && !set.autoSendAgreedAt && set.dayOfWeek === serverDay(),
          );
          if (!due) return;
          try {
            window.localStorage.setItem(ASKED, today);
          } catch {
            // As above.
          }
          const { ozi: voice } = latest.current;
          voice.listenFor(
            "It's your weekly shop day. Shall I put your usual shopping in the basket?",
            (heard) => {
              if (!/\b(yes|yeah|ok|okay|please|sure|go on)\b/i.test(heard)) {
                void latest.current.ozi.say("All right. Just tell me when you're ready.");
                return;
              }
              void addNamedItems(
                due.items.map((item) => ({ item: item.name, quantity: item.quantity })),
                latest.current.basket,
              ).then(({ added }) => {
                latest.current.navigate('/basket');
                void latest.current.ozi.say(
                  added.length > 0
                    ? `Your usual is in the basket: ${listInWords(added)}. Change anything you like, then send it when you're ready.`
                    : "I couldn't find your usual things in the shop today.",
                );
              });
            },
          );
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signedIn]);

  return null;
}
