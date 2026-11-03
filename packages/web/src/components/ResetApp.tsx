import { useId, useState } from 'react';

import { storeConfig } from '../config';
import { resetApp } from '../lib/updates';
import { useOzi } from '../state/ozi';

/** What Ozi says when the button is pressed, before the page goes. */
export const RESET_LINE = 'Resetting the app. One moment, and it will open again.';

/** How long the spoken confirmation may take before the reset goes ahead regardless. */
const SAY_AT_MOST_MS = 4000;

/**
 * "Reset the app" (ruling 95): throws away the copy of the app saved on this device and loads
 * it afresh from the server. Every sign-in stays. On the sign-in pages, in Settings, and on the
 * page shown when the app could not load at all, where there is no Ozi to speak, so `say` is
 * optional.
 */
export function ResetAppButton({
  say,
  reload,
}: {
  say?: (text: string) => Promise<unknown>;
  /** For tests; the page reloads itself otherwise. */
  reload?: () => void;
}): JSX.Element {
  const hint = useId();
  const [busy, setBusy] = useState(false);

  const press = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    if (say) {
      await Promise.race([
        say(RESET_LINE).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, SAY_AT_MOST_MS)),
      ]);
    }
    await resetApp(reload);
  };

  return (
    <div className="space-y-2 max-w-xl">
      <button
        type="button"
        onClick={() => {
          void press();
        }}
        aria-describedby={hint}
        disabled={busy}
        className="control border-paper bg-paper/10 text-paper disabled:opacity-70"
      >
        Reset the app
      </button>
      <p id={hint} className="m-0 extra">
        If {storeConfig.productName} looks wrong or does not load fully, this throws away the copy
        saved on this device and loads it afresh from our server. You stay signed in.
      </p>
      <p role="status" className="m-0">
        {busy ? RESET_LINE : ''}
      </p>
    </div>
  );
}

/** The same button, with Ozi saying what is happening. */
export function ResetApp(): JSX.Element {
  const ozi = useOzi();
  return <ResetAppButton say={(text) => ozi.say(text)} />;
}
