import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { joinAsGuest } from '../lib/api';
import { connectToCall, type CallConnection } from '../lib/call-connection';

/**
 * Joining a call from a link the Shopper sent (MERGE, ruling of 2 October 2026). A carer or
 * relative needs no account: the code after the # in the link is their pass, and it never goes to
 * the server in the address itself. The Shopper agreed to pay for them before the link was made.
 */
export function CallJoin(): JSX.Element {
  const code = useLocation().hash.replace(/^#/, '').trim();
  const [stage, setStage] = useState<'ready' | 'connecting' | 'in-call' | 'ended'>('ready');
  const [name, setName] = useState('');
  const [muted, setMuted] = useState(false);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const connection = useRef<CallConnection | null>(null);

  useEffect(
    () => () => {
      void connection.current?.leave();
    },
    [],
  );

  if (code === '') {
    return (
      <div className="space-y-4 max-w-xl">
        <h1 className="text-display font-bold m-0">Join a call</h1>
        <p className="m-0">
          This link is not complete. Please ask the person who sent it to send it again.
        </p>
      </div>
    );
  }

  const join = async (): Promise<void> => {
    setProblem('');
    setStage('connecting');
    try {
      const result = await joinAsGuest(code);
      setName(result.name);
      connection.current = await connectToCall(result.join, {
        onOthersChanged: () => undefined,
        onDisconnected: () => {
          connection.current = null;
          setStage('ended');
          setNews('The call has ended.');
        },
      });
      setStage('in-call');
      setNews('You are on the call.');
    } catch (failure) {
      setStage('ready');
      setProblem(
        failure instanceof Error
          ? failure.message
          : 'The call could not connect. Please try again.',
      );
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-display font-bold m-0">
        {stage === 'in-call' ? 'On the call' : 'Join a call'}
      </h1>
      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {stage === 'in-call' ? (
        <>
          {name !== '' && <p className="m-0">You joined as {name}.</p>}
          <button
            type="button"
            onClick={() => {
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
        </>
      ) : stage === 'ended' ? (
        <p className="m-0">Thank you. You can close this page.</p>
      ) : (
        <>
          <p className="m-0">
            You have been asked to join a call about a shopping delivery. It costs you nothing. Your
            microphone is used for the call, and the call is not recorded.
          </p>
          <button
            type="button"
            disabled={stage === 'connecting'}
            onClick={() => {
              void join();
            }}
            className="control w-full bg-[var(--colour-listening)] text-ink text-lead font-bold border-4 border-ink disabled:opacity-70"
          >
            {stage === 'connecting' ? 'Joining…' : 'Join the call'}
          </button>
        </>
      )}
    </div>
  );
}
