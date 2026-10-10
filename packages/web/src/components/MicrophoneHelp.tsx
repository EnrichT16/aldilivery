import { useState } from 'react';

import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';
import {
  ALLOW_LINE,
  openElsewhereBanner,
  openInChromeLink,
  tapToTalkLabel,
} from '../voice/microphone-help';

/**
 * Getting the microphone in one tap, and saying plainly what to do when it cannot be had
 * (ruling 62). Everything here sits at the top of the page, in the flow of it, and pushes the
 * page down: nothing is laid over a form field, as the old message beside Ozi's button was
 * over "Your name" on the sign-up page.
 *
 * - Inside another app's browser (Instagram, Facebook, Gmail and the like), a banner: open
 *   this page in Safari, or Chrome on Android, with a button to copy the link.
 * - Before the first listening of a visit, one big button, "Tap to talk to Ozi", and the line
 *   "Your phone will ask to use the microphone. Tap Allow."
 * - When something went wrong, one short note saying what to tap, closed with one tap.
 *
 * Typing always works alongside: none of this stands between anybody and the page.
 */
export function MicrophoneHelp(): JSX.Element | null {
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;
  const [bannerClosed, setBannerClosed] = useState(false);
  const [copied, setCopied] = useState('');

  const inApp = ozi.browser.inApp !== null && !bannerClosed;
  // While the page waits for its first touch to let Ozi speak, that touch comes first: Ozi
  // speaks, then asks for the tap that lets it listen.
  const needsTap = ozi.presence === 'needs-tap' && !ozi.waitingForTouch;
  const note = ozi.micNote;
  if (!inApp && !needsTap && !note) return null;

  const here = typeof window !== 'undefined' ? window.location.href : '';
  const chrome = ozi.browser.android ? openInChromeLink(here) : null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(here);
      setCopied(
        ozi.browser.iPhone
          ? 'Copied. Open Safari, tap the address bar, and paste.'
          : 'Copied. Open Chrome, tap the address bar, and paste.',
      );
    } catch {
      setCopied(`The address is: ${here}`);
    }
  };

  return (
    <div className="mb-6 space-y-4">
      {inApp && (
        <section
          aria-label="Open in your browser"
          className="rounded-xl border-4 border-highlight bg-paper text-ink p-4 space-y-3"
        >
          <p className="m-0 text-lead font-bold">{openElsewhereBanner(ozi.browser, assistant)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              className="control bg-ink text-paper"
            >
              Copy the link
            </button>
            {chrome && (
              <a href={chrome} className="control bg-highlight text-ink underline">
                Open in Chrome
              </a>
            )}
            <button
              type="button"
              onClick={() => setBannerClosed(true)}
              className="control bg-paper text-ink border-2 border-ink"
            >
              Close
            </button>
          </div>
          <p role="status" className="m-0">
            {copied}
          </p>
        </section>
      )}

      {needsTap && (
        <section aria-label={tapToTalkLabel(assistant)} data-ozi className="space-y-2">
          <button
            type="button"
            onClick={ozi.tapToTalk}
            className="control w-full max-w-xl bg-[var(--colour-listening)] text-ink text-display font-bold border-4 border-ink py-6"
          >
            {tapToTalkLabel(assistant)}
          </button>
          <p className="m-0 text-lead">{ALLOW_LINE}</p>
          <p className="m-0">Or just type: everything works without your voice too.</p>
        </section>
      )}

      {note && (
        <div
          role="status"
          className="rounded-xl border-4 border-highlight bg-paper text-ink p-4 flex flex-wrap items-start gap-3"
        >
          <p className="m-0 flex-1 min-w-[12rem] text-lead">{note.text}</p>
          <button
            type="button"
            onClick={ozi.dismissMicNote}
            className="control bg-ink text-paper"
            aria-label="Close this note"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
