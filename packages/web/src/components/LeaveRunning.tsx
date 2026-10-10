import { useEffect, useRef, useState } from 'react';

import { storeConfig } from '../config';
import { CLOSE_QUESTION, leaveRunning } from '../lib/runner-api';
import { useOzi } from '../state/ozi';
import { yesOrNo } from '../state/voice-sign-up';

/**
 * Stopping being a Runner (the Runner agreement, "Stopping, and changes"). Asked twice. Anything
 * still owed for jobs is paid as normal, and the cool bag deposit held is paid back straight
 * away unless money is owed after a decision, when a person writes to them within 14 days.
 *
 * Apple guideline 5.1.1(v) (ruling 60): anyone who can open an account in the app can close it
 * there. Two presses, or a press and a spoken yes to Ozi; refused while a job is in hand. Their
 * details are removed after the same days as a Shopper's closed account, keeping pay records.
 */
export function LeaveRunning({ onNews }: { onNews: (news: string) => void }): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [listening, setListening] = useState(false);
  const ozi = useOzi();
  const cancel = useRef<(() => void) | null>(null);
  const live = useRef({ ozi, onNews });
  live.current = { ozi, onNews };

  // Leaving the page stops the question, so nothing said later is taken as an answer.
  useEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );

  function close(): void {
    setBusy(true);
    setProblem('');
    leaveRunning()
      .then((result) => {
        setAsking(false);
        live.current.onNews(result.message);
        void live.current.ozi.say(result.message);
      })
      .catch((failure: unknown) => {
        const words = failure instanceof Error ? failure.message : 'That did not work.';
        setProblem(words);
        void live.current.ozi.say(words);
      })
      .finally(() => setBusy(false));
  }

  function askByVoice(prompt: string): void {
    cancel.current = live.current.ozi.listenFor(prompt, (text) => {
      const answer = yesOrNo(text);
      if (answer === 'yes') {
        setListening(false);
        close();
        return;
      }
      if (answer === 'no') {
        setListening(false);
        void live.current.ozi.say('All right. Your Runner account stays open.');
        return;
      }
      askByVoice(`Sorry, I need a yes or a no. ${CLOSE_QUESTION}`);
    });
  }

  return (
    <section aria-labelledby="leave-heading" className="space-y-3">
      <h2 id="leave-heading" className="text-lead font-bold">
        Stop being a Runner
      </h2>
      <p className="m-0 extra">
        You can stop at any time. We pay what is owed for your jobs, and pay back any cool bag
        deposit we hold. Not while a job is in hand. Your name, number and photos are removed{' '}
        {storeConfig.accountDeletion.recycleBinDays} days after you close it; we keep the record of
        what you were paid, as the law asks.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {asking ? (
        <div role="alert" className="space-y-3 border-2 border-paper rounded-xl p-4">
          <p className="m-0">Close your Runner account? You will not be offered any more jobs.</p>
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="control w-full bg-paper text-ink disabled:opacity-70"
          >
            Yes, close my Runner account
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="control bg-paper/10 text-paper underline"
          >
            No, keep it
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="control bg-paper/10 text-paper underline"
          >
            Close my Runner account
          </button>
          <button
            type="button"
            disabled={busy || listening}
            onClick={() => {
              setListening(true);
              askByVoice(CLOSE_QUESTION);
            }}
            className="control bg-paper/10 text-paper underline disabled:opacity-70"
          >
            {listening
              ? `${storeConfig.assistantName} is asking…`
              : `Close it by talking to ${storeConfig.assistantName}`}
          </button>
        </>
      )}
    </section>
  );
}
