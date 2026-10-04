import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';

/**
 * The switch at the bottom of every screen (Anthony, 4 October 2026): for anybody who would
 * rather Ozi did not keep talking, or would rather type. Off, Ozi neither speaks nor listens, and
 * its words are still shown on the screen, and read by a screen reader. Saying "turn off" does
 * the same; turning back on is this switch, or Ozi's own button.
 *
 * It is a real switch to assistive technology (role "switch", on or off), and the words beside
 * it say on or off too, so the state never rests on the picture of the switch alone.
 */
export function OziSwitch(): JSX.Element {
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;
  const on = ozi.voiceOn;

  return (
    <aside
      aria-label={`${assistant} on or off`}
      className="fixed bottom-0 inset-x-0 z-40 border-t-2 border-paper/25 bg-ink px-5 py-2"
    >
      <div className="mx-auto w-full max-w-3xl flex items-center justify-between gap-4">
        <span id="ozi-switch-label" className="font-bold">
          {assistant} talks and listens
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="ozi-switch-label"
          onClick={() => ozi.setVoiceOn(!on)}
          className="control flex items-center gap-3 bg-paper/10 text-paper"
        >
          <span
            aria-hidden="true"
            className={`relative inline-block w-14 h-8 rounded-full border-2 border-paper ${on ? 'bg-[var(--colour-listening)]' : 'bg-ink'}`}
          >
            <span
              className={`absolute top-0.5 w-6 h-6 rounded-full bg-paper border-2 border-ink ${on ? 'right-0.5' : 'left-0.5'}`}
            />
          </span>
          <span aria-hidden="true" className="min-w-[2.5rem] text-left">
            {on ? 'On' : 'Off'}
          </span>
        </button>
      </div>
    </aside>
  );
}
