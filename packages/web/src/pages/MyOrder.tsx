import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { CallControls } from '../components/CallControls';
import { NotifyMe } from '../components/NotifyMe';

import {
  answerQuestion,
  fetchMyOrder,
  type ItemAnswer,
  type ItemQuestion,
  type MyOrder as Order,
} from '../lib/api';
import { buzz, chime } from '../lib/alert';
import { money } from '../lib/money';
import { useSession } from '../state/session';

/**
 * A Shopper's order while it is on its way, and the place their Runner's questions arrive.
 *
 * When the Runner cannot find something, the question appears here with two answers, and
 * nobody's phone number changes hands (chosen by Anthony, 27 Sep 2026). The page asks the
 * server every few seconds, so the Shopper does not have to keep refreshing.
 *
 * Only the question itself is in the alert, and its words do not change while it waits: a
 * live region whose countdown ticked would be read out again every few seconds. The time
 * left is in minutes, next to the buttons, and says what happens if nobody answers.
 *
 * A new question also chimes and buzzes, once, for somebody who has put the phone down with the
 * page open. For a closed page, the Shopper can allow notifications here (`NotifyMe`).
 */

const POLL_MS = 5000;

const ANSWER_WORDS: Record<ItemAnswer, string> = {
  similar: 'bring something similar',
  leave_out: 'leave it out',
};

function whereItIs(order: Order): string {
  const runner = order.runnerName ?? 'Your Runner';
  switch (order.status) {
    case 'paid':
    case 'offered':
      return 'We are finding you a Runner.';
    case 'accepted':
      return `${runner} has your order and is going to the shop.`;
    case 'shopping':
      return `${runner} is doing your shopping now.`;
    case 'receipt_submitted':
      return `${runner} has paid at the till and will set off soon.`;
    case 'delivering':
      return `${runner} is on the way to you.`;
    case 'delivered':
    case 'completed':
      return 'Your shopping has been delivered.';
  }
}

function timeLeft(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

export function MyOrder(): JSX.Element {
  const { shopper, restoring } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [questions, setQuestions] = useState<ItemQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const problemRef = useRef<HTMLParagraphElement>(null);
  const heard = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const result = await fetchMyOrder();
      setOrder(result.order);
      const questions = result.questions ?? [];
      setQuestions(questions);
      const fresh = questions.filter(
        (question) => question.answer === null && !heard.current.has(question.id),
      );
      fresh.forEach((question) => heard.current.add(question.id));
      if (fresh.length > 0) {
        chime();
        buzz();
      }
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'We could not check your order.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shopper) return undefined;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [shopper, refresh]);

  useEffect(() => {
    if (problem !== '') problemRef.current?.focus();
  }, [problem]);

  async function answer(question: ItemQuestion, value: ItemAnswer): Promise<void> {
    if (!order || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await answerQuestion(order.id, question.id, value);
      setNews(result.message);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'We could not send your answer.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

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
        <h1 className="text-display font-bold m-0">Your order</h1>
        <p className="m-0 max-w-xl">Sign in to see where your order has got to.</p>
        <Link to="/sign-in?next=/my-order" className="control bg-highlight text-ink">
          Sign in
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <p role="status" className="m-0">
        Checking your order.
      </p>
    );
  }

  const waiting = questions.filter((question) => question.answer === null);
  const settled = questions.filter((question) => question.answer !== null);

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Your order</h1>

      <p role="status" className="m-0 min-h-control max-w-xl">
        {news}
      </p>

      {problem !== '' && (
        <p
          ref={problemRef}
          tabIndex={-1}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0 max-w-xl"
        >
          {problem}
        </p>
      )}

      {!order ? (
        <div className="space-y-4">
          <p className="m-0 max-w-xl">You have no order on its way at the moment.</p>
          <Link to="/shop" className="control bg-highlight text-ink">
            Find your shopping
          </Link>
        </div>
      ) : (
        <>
          {waiting.map((question) => (
            <section
              key={question.id}
              aria-labelledby={`question-${question.id}`}
              className="space-y-3 max-w-xl border-2 border-highlight rounded-xl p-4"
            >
              <h2 id={`question-${question.id}`} className="text-lead font-bold m-0">
                A question from your Runner
              </h2>
              <p role="alert" className="m-0 text-lead">
                {order.runnerName ?? 'Your Runner'} cannot find {question.itemName}. What would you
                like them to do?
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void answer(question, 'similar');
                }}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
              >
                Bring something similar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void answer(question, 'leave_out');
                }}
                className="control w-full bg-paper text-ink text-lead disabled:opacity-70"
              >
                Leave it out
              </button>
              <p className="m-0">
                If we do not hear from you in {timeLeft(question.secondsLeft)}, they will leave it
                out, and you will not be charged for it. Nothing is ever swapped without asking you.
              </p>
            </section>
          ))}

          <NotifyMe />

          {order.runnerName && !['delivered', 'completed'].includes(order.status) && (
            <CallControls orderId={order.id} as="shopper" otherName={order.runnerName} />
          )}

          <section aria-labelledby="where-heading" className="space-y-3 max-w-xl">
            <h2 id="where-heading" className="text-lead font-bold">
              Where it has got to
            </h2>
            <p className="m-0">{whereItIs(order)}</p>
          </section>

          <section aria-labelledby="list-heading" className="space-y-3 max-w-xl">
            <h2 id="list-heading" className="text-lead font-bold">
              What you asked for
            </h2>
            <ul className="m-0 ps-6 space-y-1">
              {order.items.map((item) => {
                const decided = settled.find((question) => question.orderItemId === item.id);
                return (
                  <li key={item.id}>
                    {item.quantity} × {item.name}
                    {decided?.answer &&
                      (decided.answeredBy === 'shopper'
                        ? `. Not on the shelf: you asked them to ${ANSWER_WORDS[decided.answer]}.`
                        : '. Not on the shelf, and we could not reach you in time, so it was left out. You are not charged for it.')}
                  </li>
                );
              })}
            </ul>
            <p className="m-0">
              About {money(order.totalEstimatePence)} altogether. You pay what the till says.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
