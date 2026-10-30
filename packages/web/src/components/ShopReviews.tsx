import { useEffect, useRef, useState } from 'react';

import {
  fetchPendingShopReviews,
  sendShopReview,
  type PendingShopReview,
  type ReviewPointsBalance,
  type ReviewRules,
} from '../lib/api';
import { REVIEW_POINTS_WORDS } from '../lib/partnership';
import { useOzi } from '../state/ozi';

const STAR_WORDS = ['one', 'two', 'three', 'four', 'five'];

/** "four stars", "4 star", "five out of five" said on the page: the stars, or null. */
export function heardStars(said: string): number | null {
  const text = said.toLowerCase();
  const match = text.match(/\b(one|two|three|four|five|[1-5])\b\s*(?:stars?|out of five)/);
  if (!match) return null;
  const word = match[1]!;
  const index = STAR_WORDS.indexOf(word);
  return index >= 0 ? index + 1 : Number(word);
}

/** "40p" or "£1.20": what the points are worth, said the way the server says it. */
function worthWords(pence: number, symbol: string): string {
  return pence < 100 ? `${pence}p` : `${symbol}${(pence / 100).toFixed(2)}`;
}

/**
 * Rate the shop (ruling 70): after a delivery with a Shop Partner's things in it, the Shopper
 * gives the shop one to five stars, by touch or by voice ("four stars"), with a few words if they
 * like. Every honest rating earns the same points, one star or five; the points wait their days
 * and then come off a later order as credit. The balance is always shown in words.
 */
export function ShopReviews({
  currencySymbol = '£',
}: {
  currencySymbol?: string;
}): JSX.Element | null {
  const ozi = useOzi();
  const [pending, setPending] = useState<PendingShopReview[]>([]);
  const [balance, setBalance] = useState<ReviewPointsBalance | null>(null);
  const [rules, setRules] = useState<ReviewRules | null>(null);
  const [stars, setStars] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef({ pending, stars });
  latest.current = { pending, stars };

  useEffect(() => {
    fetchPendingShopReviews()
      .then((result) => {
        setPending(result.pending);
        setBalance(result.balance);
        setRules(result.rules);
      })
      .catch(() => {
        // Nothing to rate and nothing to show: the section stays away.
        setBalance(null);
      });
  }, []);

  async function send(review: PendingShopReview, chosen: number): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await sendShopReview(review.orderId, {
        shop: review.shop.id,
        stars: chosen,
        message: (message[review.shop.id] ?? '').trim(),
      });
      setPending((was) => was.filter((one) => one.shop.id !== review.shop.id));
      setBalance(result.balance);
      setNews(result.message);
      void ozi.say(result.message);
    } catch (failure) {
      const words = failure instanceof Error ? failure.message : 'That could not be sent.';
      setProblem(words);
      void ozi.say(words);
    } finally {
      setBusy(false);
    }
  }

  // "Four stars" said aloud rates the first shop waiting, so the whole thing works by voice.
  useEffect(() => {
    if (pending.length === 0) return undefined;
    const handle = (text: string): boolean => {
      const chosen = heardStars(text);
      const first = latest.current.pending[0];
      if (chosen === null || !first) return false;
      setStars((was) => ({ ...was, [first.shop.id]: chosen }));
      void send(first, chosen);
      return true;
    };
    ozi.setPageCommands(handle);
    return () => ozi.setPageCommands(null);
    // `send` reads the latest state through refs and setters; the handler only needs the list.
  }, [pending.length]);

  if (balance === null) return null;
  if (pending.length === 0 && balance.reviews === 0 && news === '') return null;

  return (
    <section aria-labelledby="shop-reviews-heading" className="space-y-4">
      <h2 id="shop-reviews-heading" className="text-lead font-bold m-0">
        Rate your shops
      </h2>
      <p className="m-0">{REVIEW_POINTS_WORDS}</p>
      <p className="m-0" aria-live="polite">
        {balance.words}
        {rules && balance.points < rules.spendFromPoints
          ? ` From ${rules.spendFromPoints} points, ${worthWords(rules.spendFromPoints * rules.pencePerPoint, currencySymbol)} comes off your next order.`
          : ''}
      </p>
      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {pending.length > 0 && rules && (
        <p className="m-0">
          How was each shop? One star or five, every honest rating earns {rules.pointsPerReview}{' '}
          points, yours in {rules.pendingDays} days. You can press the stars or say them, like
          &ldquo;four stars&rdquo;.
        </p>
      )}
      <ul className="list-none m-0 p-0 space-y-4">
        {pending.map((review) => {
          const chosen = stars[review.shop.id] ?? 0;
          const when = new Date(review.deliveredAt).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });
          return (
            <li key={review.shop.id} className="border-2 border-paper/40 rounded-2xl p-4 space-y-3">
              <h3 className="m-0 font-bold">
                {review.shop.name}
                <span className="visually-hidden">, delivered {when}</span>
              </h3>
              <div
                role="group"
                aria-label={`Stars for ${review.shop.name}`}
                className="flex flex-wrap gap-2"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={chosen === value}
                    disabled={busy}
                    onClick={() => setStars((was) => ({ ...was, [review.shop.id]: value }))}
                    className={`control flex-col ${
                      chosen >= value ? 'bg-paper text-ink' : 'border-paper bg-paper/10 text-paper'
                    }`}
                  >
                    <span aria-hidden="true" className="text-lead">
                      {chosen >= value ? '★' : '☆'}
                    </span>
                    <span>
                      {value} {value === 1 ? 'star' : 'stars'}
                    </span>
                  </button>
                ))}
              </div>
              <label htmlFor={`review-words-${review.shop.id}`} className="block font-bold">
                A few words, if you like
              </label>
              <textarea
                id={`review-words-${review.shop.id}`}
                value={message[review.shop.id] ?? ''}
                onChange={(event) =>
                  setMessage((was) => ({ ...was, [review.shop.id]: event.target.value }))
                }
                maxLength={1000}
                className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
              />
              <button
                type="button"
                disabled={busy || chosen === 0}
                onClick={() => void send(review, chosen)}
                className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
              >
                Send my rating of {review.shop.name}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
