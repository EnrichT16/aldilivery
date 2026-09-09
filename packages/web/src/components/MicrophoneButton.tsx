import { useId, useState } from 'react';

import { storeConfig } from '../config';

/**
 * The microphone.
 *
 * It is the largest thing on the landing page because, for the people this product is for,
 * it will one day be the only thing they need to touch. In this phase it does not listen.
 * Pressing it says so, plainly, in text that a screen reader announces and a sighted user
 * reads in the same words.
 *
 * There is no `aria-label`. The button's accessible name is its own visible text, which is
 * exactly what a voice control user will say to press it.
 */
export function MicrophoneButton(): JSX.Element {
  const [pressed, setPressed] = useState(false);
  const messageId = useId();

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        className="control h-48 w-48 rounded-full bg-highlight text-ink flex-col text-lead font-bold shadow-lg"
        aria-describedby={pressed ? messageId : undefined}
        onClick={() => {
          setPressed(true);
        }}
      >
        <MicrophoneGlyph />
        <span>Say what you need</span>
      </button>

      {/*
        The message appears in a live region so it is announced when it arrives, and it is
        also plainly visible. Nothing here is carried by colour alone.
      */}
      <p
        id={messageId}
        role="status"
        aria-live="polite"
        className="m-0 min-h-control max-w-md text-center"
      >
        {pressed
          ? `Talking to ${storeConfig.assistantName} is not ready yet. For now, please use the buttons below, or ring us.`
          : ''}
      </p>
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
