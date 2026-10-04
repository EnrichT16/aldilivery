import { useCallback, useEffect, useRef, useState } from 'react';

import {
  addCallGuest,
  answerCall,
  endCall,
  fetchCallsConfig,
  fetchCurrentCall,
  startCall,
  type CallInfo,
  type CallJoin,
} from '../lib/api';
import { connectToCall, type CallConnection } from '../lib/call-connection';

/**
 * Calling about an order (docs/BUILD_PROMPT.md, Section F): a big round green call button, the
 * other side ringing in, and the call panel — END CALL, MUTE, LOUDSPEAKER and, for the Shopper,
 * MERGE to add a carer or relative by a link.
 *
 * Rule One: the Shopper is told the price and says yes before calling or answering, and before
 * adding each person. A Runner never pays. No telephone number is shown or used anywhere.
 *
 * On this website the sound plays through the loudspeaker; choosing the earpiece, and the phone
 * ringing on a locked screen, come with the phone apps (CallKit and ConnectionService).
 */

const POLL_MS = 5000;

type Stage =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'connecting' }
  | { kind: 'in-call'; callId: string; others: number };

export function CallControls({
  orderId,
  as,
  otherName,
}: {
  orderId: string;
  as: 'shopper' | 'runner';
  /** Who is on the other end, in words: "your Runner", "Margaret". */
  otherName: string;
}): JSX.Element | null {
  const [pence, setPence] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [ringing, setRinging] = useState<CallInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const connection = useRef<CallConnection | null>(null);
  const callId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCallsConfig()
      .then((config) => {
        if (!cancelled && config.enabled) setPence(config.pencePerMinute);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The other side calling in: looked for every few seconds while nobody is on a call here.
  useEffect(() => {
    if (pence === null || stage.kind !== 'idle') return undefined;
    let cancelled = false;
    const look = (): void => {
      fetchCurrentCall(orderId, as)
        .then(({ call }) => {
          if (cancelled) return;
          const fromOther = call && call.status !== 'ended' && call.startedBy !== as ? call : null;
          setRinging((was) => {
            if (fromOther && !was) setNews(`${capital(otherName)} is calling.`);
            return fromOther;
          });
        })
        .catch(() => undefined);
    };
    look();
    const timer = window.setInterval(look, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pence, stage.kind, orderId, as, otherName]);

  useEffect(
    () => () => {
      void connection.current?.leave();
    },
    [],
  );

  const join = useCallback(
    async (get: () => Promise<{ call: CallInfo; join: CallJoin }>) => {
      setProblem('');
      setStage({ kind: 'connecting' });
      try {
        const { call, join: pass } = await get();
        callId.current = call.id;
        connection.current = await connectToCall(pass, {
          onOthersChanged: (count) =>
            setStage((current) =>
              current.kind === 'in-call' ? { ...current, others: count } : current,
            ),
          onDisconnected: () => {
            connection.current = null;
            setStage({ kind: 'idle' });
            setMuted(false);
            setNews('The call has ended.');
          },
        });
        setRinging(null);
        setStage({ kind: 'in-call', callId: call.id, others: 0 });
        setNews(`Calling ${otherName}.`);
      } catch (failure) {
        setStage({ kind: 'idle' });
        setProblem(
          failure instanceof Error
            ? failure.message
            : 'The call could not connect. Please try again.',
        );
      }
    },
    [otherName],
  );

  if (pence === null) return null;
  const price = `Calls cost ${pence}p a minute, paid from your card when the call ends.`;

  if (stage.kind === 'in-call') {
    return (
      <section
        aria-labelledby="call-heading"
        className="space-y-3 max-w-xl border-2 border-paper rounded-xl p-4"
      >
        <h2 id="call-heading" className="text-lead font-bold m-0">
          {stage.others > 0 ? `On the call with ${otherName}` : `Calling ${otherName}…`}
        </h2>
        <p role="status" className="m-0">
          {news}
        </p>
        <button
          type="button"
          onClick={() => {
            const id = stage.callId;
            void endCall(id, as).catch(() => undefined);
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
            void connection.current?.setMuted(next).then(() => {
              setMuted(next);
              setNews(next ? 'You are muted. They cannot hear you.' : 'They can hear you again.');
            });
          }}
          className="control w-full bg-paper text-ink"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <p className="m-0">
          Loudspeaker: on this website the sound already comes through your loudspeaker.
        </p>
        {as === 'shopper' && <Merge callId={stage.callId} pence={pence} onNews={setNews} />}
      </section>
    );
  }

  return (
    <section aria-labelledby="call-heading" className="space-y-3 max-w-xl">
      <h2 id="call-heading" className="visually-hidden">
        Calls
      </h2>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {ringing ? (
        <div role="alert" className="space-y-3 border-2 border-highlight rounded-xl p-4">
          <p className="m-0 text-lead font-bold">{capital(otherName)} is calling.</p>
          {as === 'shopper' && <p className="m-0">{price}</p>}
          <button
            type="button"
            disabled={stage.kind === 'connecting'}
            onClick={() => {
              void join(() => answerCall(ringing.id, as));
            }}
            className="control w-full bg-[var(--colour-listening)] text-ink text-lead font-bold border-4 border-ink"
          >
            {as === 'shopper' ? 'Answer, and pay for the call' : 'Answer'}
          </button>
        </div>
      ) : stage.kind === 'confirm' ? (
        <div className="space-y-3 border-2 border-paper rounded-xl p-4">
          <p className="m-0 text-lead">{price}</p>
          <button
            type="button"
            onClick={() => {
              void join(() => startCall(orderId, as));
            }}
            className="control w-full bg-[var(--colour-listening)] text-ink text-lead font-bold border-4 border-ink"
          >
            Yes, call {otherName}
          </button>
          <button
            type="button"
            onClick={() => setStage({ kind: 'idle' })}
            className="control bg-paper/10 text-paper underline"
          >
            Not now
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={stage.kind === 'connecting'}
          onClick={() => {
            if (as === 'shopper') setStage({ kind: 'confirm' });
            else void join(() => startCall(orderId, as));
          }}
          style={{ width: 144, height: 144, borderRadius: '50%' }}
          className="control p-0 flex flex-col items-center justify-center text-center bg-[var(--colour-listening)] text-ink font-bold border-4 border-ink disabled:opacity-70"
        >
          <PhoneGlyph />
          <span>{stage.kind === 'connecting' ? 'Connecting…' : `Call ${otherName}`}</span>
        </button>
      )}
    </section>
  );
}

/** MERGE: the Shopper adds a carer or relative, who joins from a link (ruling, 2 October 2026). */
function Merge({
  callId,
  pence,
  onNews,
}: {
  callId: string;
  pence: number;
  onNews: (news: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="control w-full bg-paper text-ink"
      >
        Add someone to the call
      </button>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '') {
          setProblem('Please say who you are adding.');
          return;
        }
        setProblem('');
        addCallGuest(callId, name.trim())
          .then(async (result) => {
            setLink(result.link);
            onNews(result.message);
            try {
              if (navigator.share) await navigator.share({ text: result.link, url: result.link });
            } catch {
              // They closed the share sheet; the link is on the screen to copy.
            }
          })
          .catch((failure: unknown) => {
            setProblem(failure instanceof Error ? failure.message : 'They could not be added.');
          });
      }}
    >
      <label htmlFor="guest-name" className="block font-bold">
        Who are you adding?
      </label>
      <input
        id="guest-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      />
      <p className="m-0">
        Adding {name.trim() || 'them'} costs {pence}p a minute for them, paid from your card.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      <button type="submit" className="control w-full bg-highlight text-ink">
        Yes, add them and send the link
      </button>
      {link !== '' && <p className="m-0 break-all">Their link: {link}</p>}
    </form>
  );
}

function capital(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Decorative: the button says what it does, in words. */
function PhoneGlyph(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}
