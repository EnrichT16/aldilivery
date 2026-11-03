import { appVersion } from '../lib/version';

/**
 * Which build this phone is running (ruling 95): small, readable, in the footer of every page,
 * on the sign-in pages and in Settings, so "it doesn't load fully" can be matched to a release.
 * A note, named for a screen reader, never an alert.
 */
export function AppVersion({ className = '' }: { className?: string }): JSX.Element {
  const version = appVersion();
  return (
    <p
      role="note"
      aria-label="App version"
      // Always on the screen, never behind "Show words on the screen": a report needs it.
      className={`m-0 text-paper/80 text-[0.9rem] ${className}`.trim()}
      data-build={__BUILD_ID__}
    >
      {version.words}
    </p>
  );
}
