import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';

/**
 * The big microphone on the landing page: the same Ozi as the round button on every screen,
 * only larger, because for the people this is for it may be the only thing they touch.
 *
 * Pressed while Ozi is talking, it stops Ozi mid-sentence. Pressed while Ozi is muted, it
 * brings Ozi back, listening. Pressed while Ozi is listening, it mutes Ozi. What Ozi said and
 * heard is written underneath; the round button's own words are what a screen reader is told,
 * so they are not announced twice.
 *
 * There is no `aria-label`. The button's accessible name is its own visible text, which is
 * exactly what a voice control user will say to press it.
 */
export function MicrophoneButton(): JSX.Element {
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;

  const label = ozi.talking
    ? `Stop ${assistant} talking`
    : ozi.presence === 'listening'
      ? 'Listening. Press to mute'
      : 'Say what you need';

  return (
    <div className="flex flex-col items-center gap-5">
      <button
        type="button"
        className="control h-48 w-48 rounded-full bg-highlight text-ink flex-col text-lead font-bold shadow-lg"
        onClick={() => {
          ozi.press();
        }}
      >
        <MicrophoneGlyph />
        <span>{label}</span>
      </button>

      <div className="m-0 min-h-control max-w-md text-center space-y-2" aria-hidden="true">
        {ozi.heard !== '' && <p className="m-0">You said: {ozi.heard}</p>}
        {ozi.said !== '' && <p className="m-0">{ozi.said}</p>}
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
