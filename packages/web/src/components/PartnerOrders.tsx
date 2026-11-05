import { useCallback, useEffect, useRef, useState } from 'react';

import { connectToCall, type CallConnection } from '../lib/call-connection';
import { money } from '../lib/money';
import {
  endPartnerCall,
  fetchPartnerOrders,
  markPartnerOrderReady,
  sendPartnerMessage,
  startPartnerCall,
  type PartnerOrderRow,
  type PartnerOrdersPage,
} from '../lib/partner-orders-api';
import { useOzi } from '../state/ozi';
import { YourId } from './YourId';

/** How often the list is looked at again while an order is under way. */
const POLL_MS = 15_000;
const YES = /\b(yes|yeah|yep|correct|that'?s right|go ahead|confirm|do it|ok|okay)\b/i;

/** "OZ-ABC123" spoken as "O Z, A B C, 1 2 3", so it can be written down. */
export function spokenReference(reference: string): string {
  const tidy = reference.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const prefix = tidy.slice(0, 2).split('').join(' ');
  const body = tidy.slice(2);
  const groups: string[] = [];
  for (let index = 0; index < body.length; index += 3) {
    groups.push(
      body
        .slice(index, index + 3)
        .split('')
        .join(' '),
    );
  }
  return [prefix, ...groups].join(', ');
}

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayAndTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One order read aloud: its reference, where it is, and the Runner by first name. */
export function orderSpoken(order: PartnerOrderRow): string {
  const things = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const runner = order.runner ? `, Runner ${order.runner.firstName}` : '';
  return `Order ${spokenReference(order.reference)}: ${order.statusWords}${runner}, ${things} of your ${things === 1 ? 'thing' : 'things'}${order.readyAt ? ', marked ready' : ''}.`;
}

/**
 * A Shop Partner's orders (ruling 97, 5 November 2026): the orders under way with this shop's
 * lines, each with the Runner's first name and Runner ID, Ready for pickup, the short set
 * messages, and a free in-app call to the Runner on paid packages; then the order history.
 * Large controls, plain words, nothing of the Shopper's. By voice: "read my orders", and
 * "order ready", which confirms which order and waits for the yes.
 */
export function PartnerOrders({
  registerVoice,
}: {
  /** Hands the dashboard this section's spoken commands; it tries them first. */
  registerVoice?: (handler: ((text: string) => boolean) | null) => void;
}): JSX.Element {
  const ozi = useOzi();
  const [page, setPage] = useState<PartnerOrdersPage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ ozi, page });
  latest.current = { ozi, page };

  const load = useCallback(
    async (which = historyPage): Promise<PartnerOrdersPage | null> => {
      try {
        const result = await fetchPartnerOrders(which);
        setPage(result);
        setFailed(false);
        return result;
      } catch {
        // The rest of the dashboard stands: this section says so quietly, once.
        setFailed(true);
        return null;
      }
    },
    [historyPage],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!page || page.active.length === 0) return undefined;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [page, load]);

  const ready = useCallback(
    async (order: PartnerOrderRow, say: boolean) => {
      setBusy(order.id);
      setProblem('');
      try {
        const answer = await markPartnerOrderReady(order.id);
        setNews(answer.message);
        if (say) void latest.current.ozi.say(answer.message);
        await load();
      } catch (failure) {
        const words = failure instanceof Error ? failure.message : 'That did not work.';
        setProblem(words);
        if (say) void latest.current.ozi.say(words);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const message = useCallback(
    async (order: PartnerOrderRow, kind: string) => {
      setBusy(order.id);
      setProblem('');
      try {
        const answer = await sendPartnerMessage(order.id, kind);
        setNews(answer.message);
        await load();
      } catch (failure) {
        setProblem(failure instanceof Error ? failure.message : 'That did not work.');
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  // Spoken commands, tried by the dashboard before its own.
  useEffect(() => {
    if (!registerVoice) return undefined;
    const say = (words: string): void => void latest.current.ozi.say(words);
    const confirmReady = (order: PartnerOrderRow): void => {
      const who = order.runner ? order.runner.firstName : 'your Runner';
      latest.current.ozi.listenFor(
        `Shall I tell ${who} that order ${spokenReference(order.reference)} is ready for pickup?`,
        (answer) => {
          if (YES.test(answer)) void ready(order, true);
          else say('All right, nothing was sent.');
        },
      );
    };
    const handle = (text: string): boolean => {
      const said = text
        .toLowerCase()
        .replace(/[?!,.]+/g, ' ')
        .trim();
      const current = latest.current.page;
      if (/\b(read|what are|what'?s|list|any|how many)\b.*\borders?\b|^(my )?orders?$/.test(said)) {
        if (!current) {
          say('I could not reach your orders just now. Please try again in a moment.');
          return true;
        }
        if (current.active.length === 0) {
          say(
            `You have no orders under way. ${current.total === 0 ? 'None' : current.total} in the last ${current.historyDays} days.`,
          );
          return true;
        }
        say(
          `You have ${current.active.length} ${current.active.length === 1 ? 'order' : 'orders'} under way. ${current.active
            .map(orderSpoken)
            .join(' ')}`,
        );
        return true;
      }
      if (
        /\b(order|it'?s|it is|that'?s|this one is) ready\b|\bready for pickup\b|\bmark .*ready\b/.test(
          said,
        )
      ) {
        const candidates = (current?.active ?? []).filter((order) => order.canReady);
        if (candidates.length === 0) {
          say('There is no order waiting for you to say it is ready.');
          return true;
        }
        if (candidates.length === 1) {
          confirmReady(candidates[0]!);
          return true;
        }
        latest.current.ozi.listenFor(
          `Which order? ${candidates.map((order) => `${spokenReference(order.reference)}`).join(', or ')}. Say the last three characters.`,
          (answer) => {
            const heard = answer.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const found = candidates.find((order) =>
              heard.endsWith(order.reference.replace(/[^A-Z0-9]/g, '').slice(-3)),
            );
            if (found) confirmReady(found);
            else say("I didn't catch which order. Please use the buttons on the screen.");
          },
        );
        return true;
      }
      return false;
    };
    registerVoice(handle);
    return () => registerVoice(null);
  }, [registerVoice, ready]);

  const kinds = page?.messageKinds ?? [];

  return (
    <section aria-labelledby="orders-heading" className="space-y-4">
      <h2 id="orders-heading" className="text-lead font-bold m-0">
        Your orders
      </h2>
      {page && <YourId words="Partner ID" id={page.shop.publicId} heading={false} />}
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {failed && !page && (
        <p className="m-0">Your orders could not be loaded just now. They will appear here.</p>
      )}
      {page && page.active.length === 0 && (
        <p className="m-0">No orders under way right now. New ones appear here as they come.</p>
      )}
      <ul className="list-none m-0 p-0 space-y-4">
        {page?.active.map((order) => (
          <li key={order.id} className="border-2 border-highlight rounded-2xl p-4 space-y-3">
            <h3 className="m-0 text-lead font-bold">
              Order {order.reference}
              <span className="visually-hidden">, {spokenReference(order.reference)}</span>
            </h3>
            <p className="m-0">
              {order.statusWords}.{' '}
              {order.runner
                ? `Runner: ${order.runner.firstName}, Runner ID ${order.runner.runnerId}.`
                : 'No Runner yet.'}
              {order.runnerAtShop === true ? ' In your shop now.' : ''}
              {order.readyAt ? ` You said it was ready at ${when(order.readyAt)}.` : ''}
            </p>
            <p className="m-0 extra">
              Placed {dayAndTime(order.placedAt)}
              {order.acceptedAt ? `; taken ${when(order.acceptedAt)}` : ''}
              {order.deliveringAt ? `; on its way ${when(order.deliveringAt)}` : ''}
              {order.deliveredAt ? `; delivered ${when(order.deliveredAt)}` : ''}.
            </p>
            <ul className="m-0 ps-6">
              {order.lines.map((line) => (
                <li key={line.id}>
                  {line.quantity} × {line.name}, {money(line.runnerPaysPence)} each at your counter
                </li>
              ))}
            </ul>
            {order.messages.length > 0 && (
              <p className="m-0">
                Sent to your Runner:{' '}
                {order.messages.map((row) => `${row.words} (${when(row.at)})`).join('; ')}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {order.canReady && (
                <button
                  type="button"
                  disabled={busy === order.id}
                  onClick={() => void ready(order, false)}
                  className="control bg-highlight text-on-accent font-bold disabled:opacity-70"
                >
                  Ready for pickup
                  <span className="visually-hidden">: order {order.reference}</span>
                </button>
              )}
              {order.canMessage &&
                kinds
                  .filter((kind) => kind.kind !== 'ready')
                  .map((kind) => (
                    <button
                      key={kind.kind}
                      type="button"
                      disabled={busy === order.id}
                      onClick={() => void message(order, kind.kind)}
                      className="control border-paper bg-paper/10 text-paper disabled:opacity-70"
                    >
                      {kind.words}
                      <span className="visually-hidden">
                        : send to the Runner of order {order.reference}
                      </span>
                    </button>
                  ))}
            </div>
            {order.canCall && order.runner && (
              <PartnerCall
                orderId={order.id}
                reference={order.reference}
                runnerName={order.runner.firstName}
                paid={page.shop.paidPlan}
                callWords={page.shop.callWords}
                onNews={setNews}
              />
            )}
          </li>
        ))}
      </ul>

      {page && (
        <details className="space-y-3">
          <summary className="control px-0 text-paper underline">
            Order history: {page.total} in the last {page.historyDays} days
          </summary>
          {page.recent.length === 0 ? (
            <p className="m-0">Nothing yet.</p>
          ) : (
            <ul className="list-none m-0 p-0 space-y-2">
              {page.recent.map((order) => (
                <li key={order.id} className="border-2 border-paper/40 rounded-2xl p-3">
                  <p className="m-0 font-bold">
                    Order {order.reference}: {order.statusWords}
                  </p>
                  <p className="m-0 extra">
                    {dayAndTime(order.placedAt)}
                    {order.runner
                      ? `. Runner ${order.runner.firstName}, ${order.runner.runnerId}`
                      : ''}
                    . {order.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}.
                  </p>
                </li>
              ))}
            </ul>
          )}
          {page.pages > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((n) => Math.max(1, n - 1))}
                className="control border-paper bg-paper/10 text-paper disabled:opacity-50"
              >
                Newer orders
              </button>
              <span>
                Page {page.page} of {page.pages}
              </span>
              <button
                type="button"
                disabled={historyPage >= page.pages}
                onClick={() => setHistoryPage((n) => n + 1)}
                className="control border-paper bg-paper/10 text-paper disabled:opacity-50"
              >
                Older orders
              </button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

type CallStage =
  { kind: 'idle' } | { kind: 'connecting' } | { kind: 'in-call'; callId: string; others: number };

/**
 * The shop's free in-app call to the Runner (ruling 97): paid packages only. On the free listing
 * the button is shown but cannot be pressed, with the plain words why. Never a phone number.
 */
function PartnerCall({
  orderId,
  reference,
  runnerName,
  paid,
  callWords,
  onNews,
}: {
  orderId: string;
  reference: string;
  runnerName: string;
  paid: boolean;
  callWords: string | null;
  onNews: (words: string) => void;
}): JSX.Element {
  const [stage, setStage] = useState<CallStage>({ kind: 'idle' });
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState('');
  const connection = useRef<CallConnection | null>(null);

  useEffect(
    () => () => {
      void connection.current?.leave();
    },
    [],
  );

  async function start(): Promise<void> {
    setProblem('');
    setStage({ kind: 'connecting' });
    try {
      const { call, join } = await startPartnerCall(orderId);
      connection.current = await connectToCall(join, {
        onOthersChanged: (count) =>
          setStage((current) =>
            current.kind === 'in-call' ? { ...current, others: count } : current,
          ),
        onDisconnected: () => {
          connection.current = null;
          setStage({ kind: 'idle' });
          setMuted(false);
          onNews('The call has ended.');
        },
      });
      setStage({ kind: 'in-call', callId: call.id, others: 0 });
      onNews(`Calling ${runnerName} about order ${reference}. This call is free.`);
    } catch (failure) {
      setStage({ kind: 'idle' });
      setProblem(
        failure instanceof Error
          ? failure.message
          : 'The call could not connect. Please try again.',
      );
    }
  }

  if (stage.kind === 'in-call') {
    return (
      <div className="space-y-2 border-2 border-paper rounded-2xl p-3">
        <p className="m-0 font-bold">
          {stage.others > 0 ? `On the call with ${runnerName}` : `Calling ${runnerName}…`}
        </p>
        <button
          type="button"
          onClick={() => {
            void endPartnerCall(stage.callId).catch(() => undefined);
            void connection.current?.leave();
          }}
          className="control w-full bg-paper text-ink text-lead border-4 border-ink"
        >
          End call
        </button>
        <button
          type="button"
          aria-pressed={muted}
          onClick={() => {
            const next = !muted;
            void connection.current?.setMuted(next).then(() => setMuted(next));
          }}
          className="control w-full bg-paper text-ink"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-3 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <button
        type="button"
        disabled={!paid || stage.kind === 'connecting'}
        aria-describedby={paid ? undefined : `call-words-${orderId}`}
        onClick={() => void start()}
        className="control bg-listening text-on-accent font-bold border-4 border-on-accent disabled:opacity-60"
      >
        {stage.kind === 'connecting' ? 'Connecting…' : `Call ${runnerName}`}
        <span className="visually-hidden">: order {reference}, free</span>
      </button>
      {!paid && callWords && (
        <p id={`call-words-${orderId}`} className="m-0">
          {callWords}
        </p>
      )}
    </div>
  );
}
