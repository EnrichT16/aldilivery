import { useVoice } from '../state/voice';

/**
 * "Show words on the screen" (ruling 47). The screens are tidy by default: the descriptive words
 * are kept for screen readers but not shown. Somebody partially sighted can show them here, on
 * any screen with this switch: Settings, the admin panel, the Runner's and the business areas.
 * Kept on this phone, for everybody who uses it.
 */
export function ShowWordsSwitch(): JSX.Element {
  const { settings, update } = useVoice();
  return (
    <div className="flex items-start gap-3">
      <input
        id="show-words"
        type="checkbox"
        checked={settings.showText}
        aria-describedby="show-words-hint"
        onChange={(event) => update({ showText: event.target.checked })}
        className="h-8 w-8 mt-1 shrink-0"
      />
      <div>
        <label htmlFor="show-words" className="font-bold text-lead">
          Show words on the screen
        </label>
        <p id="show-words-hint" className="m-0 extra">
          The descriptions under each heading and button. A screen reader reads them either way. To
          make anything bigger, pinch the screen open with two fingers.
        </p>
      </div>
    </div>
  );
}
