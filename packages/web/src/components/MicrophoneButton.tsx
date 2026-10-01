import { useId, useRef, useState } from 'react';

import { storeConfig } from '../config';
import { useVoice } from '../state/voice';

/**
 * The microphone: where a conversation with Ozi starts.
 *
 * Pressing it, Ozi says hello aloud and listens; what it heard is shown and answered aloud.
 * Pressing it again while Ozi is talking stops Ozi mid-sentence, and pressing it while Ozi is
 * listening stops the listening. Ordering by voice is built on top of this next
 * (docs/BUILD_PROMPT.md, Section E); until then Ozi says so, plainly.
 *
 * Everything Ozi says is also written underneath. When Ozi is speaking aloud, those words are
 * shown but not announced, so a screen reader does not read them over Ozi's voice; when Ozi is
 * muted or cannot speak, they are announced instead.
 *
 * There is no `aria-label`. The button's accessible name is its own visible text, which is
 * exactly what a voice control user will say to press it.
 */

type Stage = 'idle' | 'speaking' | 'listening';

export function MicrophoneButton(): JSX.Element {
  const voice = useVoice();
  const [stage, setStage] = useState<Stage>('idle');
  const [said, setSaid] = useState('');
  const [heard, setHeard] = useState('');
  // Set when a sentence could not be spoken, so the screen announces it instead.
  const [announce, setAnnounce] = useState(false);
  const messageId = useId();
  const turn = useRef(0);
  const assistant = storeConfig.assistantName;

  async function speak(text: string, thisTurn: number): Promise<boolean> {
    setSaid(text);
    setStage('speaking');
    const outcome = await voice.say(text);
    if (outcome === 'not-spoken' && voice.speaking) {
      // The words were shown quietly because Ozi was meant to say them, and it could not.
      // Show them again, announced, so a screen reader still reads them.
      setAnnounce(true);
      setSaid('');
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      setSaid(text);
    }
    return outcome !== 'interrupted' && turn.current === thisTurn;
  }

  async function converse(): Promise<void> {
    turn.current += 1;
    const thisTurn = turn.current;
    setHeard('');

    const ready = await voice.engine.readiness(voice.settings.language);
    if (!ready.canListen) {
      await speak(
        `I cannot listen on this phone or browser yet. ${ready.reason ?? ''} For now, please use the buttons below, or ring us.`.replace(
          /\s+/g,
          ' ',
        ),
        thisTurn,
      );
      if (turn.current === thisTurn) setStage('idle');
      return;
    }

    if (!(await speak(`Hello, I am ${assistant}. What would you like?`, thisTurn))) {
      if (turn.current === thisTurn) setStage('idle');
      return;
    }

    setStage('listening');
    let text = '';
    try {
      text = await voice.listen();
    } catch (failure) {
      if (turn.current !== thisTurn) return;
      const message = (failure as { message?: string }).message ?? 'Something went wrong.';
      await speak(message, thisTurn);
      if (turn.current === thisTurn) setStage('idle');
      return;
    }
    if (turn.current !== thisTurn) return;

    setHeard(text);
    await speak(
      text === ''
        ? 'I did not hear anything. Press the button when you are ready to try again.'
        : `You said: ${text}. Ordering by voice is the next thing being built. For now, please use the buttons below.`,
      thisTurn,
    );
    if (turn.current === thisTurn) setStage('idle');
  }

  function press(): void {
    if (stage === 'speaking') {
      turn.current += 1;
      voice.interrupt();
      setStage('idle');
      return;
    }
    if (stage === 'listening') {
      voice.engine.stopListening();
      return;
    }
    void converse();
  }

  const label =
    stage === 'speaking'
      ? `Stop ${assistant} talking`
      : stage === 'listening'
        ? 'Listening. Press to stop'
        : 'Say what you need';

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        className="control h-48 w-48 rounded-full bg-highlight text-ink flex-col text-lead font-bold shadow-lg"
        aria-describedby={said !== '' ? messageId : undefined}
        onClick={press}
      >
        <MicrophoneGlyph />
        <span>{label}</span>
      </button>

      <div className="m-0 min-h-control max-w-md text-center space-y-2">
        {heard !== '' && <p className="m-0">You said: {heard}</p>}
        <p
          id={messageId}
          role="status"
          aria-live={voice.speaking && !announce ? 'off' : 'polite'}
          className="m-0"
        >
          {said}
        </p>
      </div>
    </div>
  );
}

/** Decorative. The button already says what it is in words. */
function MicrophoneGlyph(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
