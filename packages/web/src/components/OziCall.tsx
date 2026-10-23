import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import {
  answerOziCall,
  decideInApp,
  endOziCall,
  fetchOziRing,
  heardChoice,
  keyChoice,
  markMatterRead,
  notNowOziCall,
  type AnsweredCall,
  type CallMatter,
  type DeskChoice,
  type OziRing,
} from '../lib/owner-call';
import { useOzi } from '../state/ozi';

/**
 * Ozi ringing the owner in the app (ruling 79, Anthony, 23 October 2026). While the owner has the
 * admin panel open it asks every few seconds whether Ozi is ringing. When it is, the whole screen
 * becomes the incoming call, announced to a screen reader (an alert dialog, with the focus on
 * Answer): Answer, or Not now, by button, by keyboard, or by voice.
 *
 * Answered, Ozi says what the telephone says, in the browser's own speech: "Hello, Mr. Anthony.
 * This is Ozi.", how many things, then each in turn. He answers each with the big buttons, with
 * 1, 2 and 3 on the keyboard as on the keypad, or by saying "yes", "approve", "no", "decline",
 * "later" or "heard it". Each choice is the keypad's own, recorded as made in the app. Not
 * answered within half a minute, Ozi rings his phone instead, and this screen closes.
 */

const POLL_MS = 4000;

type Stage =
  | { kind: 'idle' }
  | { kind: 'ringing'; ring: OziRing }
  | { kind: 'in-call'; ring: OziRing; call: AnsweredCall; index: number; words: string };

function PhoneIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" />
    </svg>
  );
}

function CrossIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TickIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function OziCall({
  staffKey,
  onChanged,
}: {
  staffKey: string;
  /** Something was decided on the call, or the call ended: the screen loads its lists again. */
  onChanged: (news: string) => void;
}): JSX.Element | null {
  const ozi = useOzi();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const live = useRef({ ozi, staffKey, onChanged });
  live.current = { ozi, staffKey, onChanged };
  const answerButton = useRef<HTMLButtonElement | null>(null);
  const firstChoice = useRef<HTMLButtonElement | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  // Calls he said "Not now" to, so the next poll does not bring them back.
  const turnedDown = useRef(new Set<string>());

  const quiet = (): void => {
    stopListening.current?.();
    stopListening.current = null;
  };

  // Leaving the panel stops listening, so nothing said later is taken as an answer.
  useEffect(() => () => quiet(), []);

  /* ------------------------------------------------------------ is Ozi ringing? */

  useEffect(() => {
    let stopped = false;
    const ask = (): void => {
      if (stageRef.current.kind === 'in-call') return;
      fetchOziRing(live.current.staffKey)
        .then((result) => {
          if (stopped || stageRef.current.kind === 'in-call') return;
          const ring = result?.ring ?? null;
          if (ring && !turnedDown.current.has(ring.id)) {
            if (stageRef.current.kind !== 'ringing' || stageRef.current.ring.id !== ring.id) {
              setStage({ kind: 'ringing', ring });
            }
          } else if (stageRef.current.kind === 'ringing') {
            // Rung long enough: Ozi has gone on to the phone.
            quiet();
            setStage({ kind: 'idle' });
          }
        })
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  /* ------------------------------------------------------------ the call */

  const busyNow = useRef(false);
  const working = (on: boolean): void => {
    busyNow.current = on;
    setBusy(on);
  };

  function finish(ring: OziRing, words: string): void {
    quiet();
    setStage({ kind: 'idle' });
    void live.current.ozi.say(words);
    endOziCall(live.current.staffKey, ring.id).catch(() => undefined);
    live.current.onChanged(words);
  }

  /** Says the matter at `index` after `lead`, and listens for his answer; or says goodbye. */
  function present(ring: OziRing, call: AnsweredCall, index: number, lead: string): void {
    quiet();
    const matter = call.matters[index];
    if (!matter) {
      finish(ring, `${lead} ${call.farewell}`.replace(/\s+/g, ' ').trim());
      return;
    }
    const words = `${lead} ${matter.spoken}`.replace(/\s+/g, ' ').trim();
    setStage({ kind: 'in-call', ring, call, index, words });
    markMatterRead(live.current.staffKey, matter.id).catch(() => undefined);
    listen(ring, call, index, words);
  }

  function listen(ring: OziRing, call: AnsweredCall, index: number, words: string): void {
    const matter = call.matters[index] as CallMatter;
    stopListening.current = live.current.ozi.listenFor(words, (heard) => {
      const choice = heardChoice(heard, matter.options);
      if (!choice) {
        listen(ring, call, index, `Sorry, I did not catch that. ${matter.prompt}`);
        return;
      }
      void choose(choice, { ring, call, index });
    });
  }

  async function choose(
    choice: DeskChoice,
    at: { ring: OziRing; call: AnsweredCall; index: number },
  ): Promise<void> {
    const matter = at.call.matters[at.index];
    if (!matter || busyNow.current) return;
    quiet();
    working(true);
    try {
      const outcome = await decideInApp(live.current.staffKey, matter.id, choice);
      live.current.onChanged(outcome.message);
      present(at.ring, at.call, at.index + 1, outcome.message);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : 'That did not work.';
      present(at.ring, at.call, at.index, `${reason} Let's try that one again.`);
    } finally {
      working(false);
    }
  }

  async function answer(ring: OziRing): Promise<void> {
    if (busyNow.current) return;
    quiet();
    working(true);
    try {
      const call = await answerOziCall(live.current.staffKey, ring.id);
      present(ring, call, 0, call.opening);
    } catch (failure) {
      setStage({ kind: 'idle' });
      void live.current.ozi.say(
        failure instanceof Error ? failure.message : 'That call has already ended.',
      );
    } finally {
      working(false);
    }
  }

  async function notNow(ring: OziRing): Promise<void> {
    quiet();
    turnedDown.current.add(ring.id);
    setStage({ kind: 'idle' });
    try {
      const result = await notNowOziCall(live.current.staffKey, ring.id);
      void live.current.ozi.say(result.message);
    } catch {
      // The call had already ended; nothing more to say.
    }
  }

  const hangUp = (): void => {
    if (stage.kind !== 'in-call') return;
    finish(stage.ring, `All right. I'll keep the rest for next time. ${stage.call.farewell}`);
  };

  const actions = useRef({ answer, notNow });
  actions.current = { answer, notNow };

  // A new ring: the focus goes to Answer, and Ozi asks aloud as well.
  const ringingId = stage.kind === 'ringing' ? stage.ring.id : null;
  useEffect(() => {
    if (stageRef.current.kind !== 'ringing') return;
    const { ring } = stageRef.current;
    answerButton.current?.focus();
    const ask = (prompt: string): void => {
      stopListening.current = live.current.ozi.listenFor(prompt, (heard) => {
        const said = heard.toLowerCase();
        if (/\b(not now|no|later|decline|reject)\b/.test(said)) void actions.current.notNow(ring);
        else if (/\b(answer|yes|yeah|pick up|hello|ok|okay)\b/.test(said)) {
          void actions.current.answer(ring);
        } else ask('Say answer, or not now.');
      });
    };
    ask(`${ring.words} Say answer, or not now.`);
  }, [ringingId]);

  // Each matter on the call: the focus on its first choice.
  const matterIndex = stage.kind === 'in-call' ? stage.index : -1;
  useEffect(() => {
    if (matterIndex >= 0) firstChoice.current?.focus();
  }, [matterIndex]);

  // The keys while the call is on the screen: Escape is Not now; 1, 2 and 3 as on the keypad.
  const keys = (event: globalThis.KeyboardEvent): void => {
    if (stage.kind === 'idle') return;
    if (stage.kind === 'ringing') {
      if (event.key === 'Escape') {
        event.preventDefault();
        void notNow(stage.ring);
      }
      return;
    }
    const matter = stage.call.matters[stage.index];
    if (!matter) return;
    const choice = keyChoice(event.key, matter.options);
    if (choice) {
      event.preventDefault();
      void choose(choice, stage);
    }
  };
  const keysNow = useRef(keys);
  keysNow.current = keys;
  const showing = stage.kind !== 'idle';
  useEffect(() => {
    if (!showing) return undefined;
    const press = (event: globalThis.KeyboardEvent): void => keysNow.current(event);
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, [showing]);

  if (stage.kind === 'idle') return null;

  const big = 'control min-h-control text-lead';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ozi-call-title"
      aria-describedby="ozi-call-words"
      className="fixed inset-0 z-50 overflow-y-auto bg-ink text-paper p-6 flex flex-col gap-6"
    >
      {stage.kind === 'ringing' ? (
        <>
          <h2 id="ozi-call-title" className="text-display font-bold m-0">
            {stage.ring.test ? 'Ozi is calling (a test)' : 'Ozi is calling'}
          </h2>
          <p id="ozi-call-words" className="text-lead m-0">
            {stage.ring.words} Answer, or Not now. You can also say “answer” or “not now”.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              ref={answerButton}
              type="button"
              disabled={busy}
              onClick={() => void answer(stage.ring)}
              className={`${big} bg-highlight text-on-accent`}
            >
              <PhoneIcon />
              Answer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void notNow(stage.ring)}
              className={`${big} border-paper bg-paper/10 text-paper`}
            >
              <CrossIcon />
              Not now
            </button>
          </div>
        </>
      ) : (
        <InCall
          stage={stage}
          busy={busy}
          firstChoice={firstChoice}
          choose={choose}
          hangUp={hangUp}
        />
      )}
    </div>
  );
}

function InCall({
  stage,
  busy,
  firstChoice,
  choose,
  hangUp,
}: {
  stage: Extract<Stage, { kind: 'in-call' }>;
  busy: boolean;
  firstChoice: MutableRefObject<HTMLButtonElement | null>;
  choose: (
    choice: DeskChoice,
    at: { ring: OziRing; call: AnsweredCall; index: number },
  ) => Promise<void>;
  hangUp: () => void;
}): JSX.Element {
  const matter = stage.call.matters[stage.index] as CallMatter;
  const total = stage.call.matters.length;
  const big = 'control min-h-control text-lead';
  const pick = (choice: DeskChoice) => () => void choose(choice, stage);
  return (
    <>
      <h2 id="ozi-call-title" className="text-display font-bold m-0">
        On a call with Ozi
      </h2>
      <p className="m-0">
        {total === 1 ? 'One thing' : `${stage.index + 1} of ${total}`}
        {matter.options === 'decide'
          ? '. Keys: 1 approve, 2 decline, 3 later.'
          : '. Keys: 1 heard it, 3 later.'}
      </p>
      <p id="ozi-call-words" aria-live="polite" className="text-lead m-0">
        {stage.words}
      </p>
      <div className="flex flex-wrap gap-4">
        {matter.options === 'decide' ? (
          <>
            <button
              ref={firstChoice}
              type="button"
              disabled={busy}
              onClick={pick('approve')}
              className={`${big} bg-highlight text-on-accent`}
            >
              <TickIcon />
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={pick('decline')}
              className={`${big} border-paper bg-paper/10 text-paper`}
            >
              <CrossIcon />
              Decline
            </button>
          </>
        ) : (
          <button
            ref={firstChoice}
            type="button"
            disabled={busy}
            onClick={pick('acknowledge')}
            className={`${big} bg-highlight text-on-accent`}
          >
            <TickIcon />
            Heard it
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={pick('later')}
          className={`${big} border-paper bg-paper/10 text-paper`}
        >
          <ClockIcon />
          Later
        </button>
      </div>
      <button
        type="button"
        onClick={hangUp}
        className="control min-h-control border-paper bg-paper/10 text-paper self-start"
      >
        <PhoneIcon />
        End the call
      </button>
    </>
  );
}
