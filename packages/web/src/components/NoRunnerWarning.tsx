import { useEffect, useRef, useState } from 'react';

import { storeConfig } from '../config';
import { fetchMyShareLink } from '../lib/api';

/**
 * The gentle warning as a Shopper places an order where there is no Runner (driver) yet, or the
 * area is paused (Anthony, 30 October 2026). Every area is open: this never stops the order, and
 * the button to pay is never greyed out because of it. It is shown only on the confirmation
 * screen, once for each order attempt, never at sign-up or while browsing.
 *
 * An alert dialog: focus moves into it, a screen reader announces it, and Ozi says the words out
 * loud. Two choices, both returning to the order:
 *
 * - "OK, I understand": closes it, and the Shopper may carry on and pay as normal.
 * - "Send my referral link": the phone's share sheet (or the link copied, where there is none)
 *   with their referral link for a driver, which opens Runner sign-up with them recorded as the
 *   one who invited the new Runner.
 *
 * Escape is "OK, I understand". Tab stays inside it until it closes.
 */
export function NoRunnerWarning({
  onClose,
  onNews,
}: {
  /** Back to the order. */
  onClose: () => void;
  /** Said in the page's status line: the link was copied, or could not be had. */
  onNews: (text: string) => void;
}): JSX.Element {
  const words = storeConfig.areas.noRunnerWords;
  const okButton = useRef<HTMLButtonElement | null>(null);
  const shareButton = useRef<HTMLButtonElement | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  // Focus moves into the dialog as it opens, onto the choice that carries on.
  useEffect(() => {
    okButton.current?.focus();
  }, []);

  // The link is asked for as the dialog opens, so the share sheet opens straight from the press.
  useEffect(() => {
    let live = true;
    fetchMyShareLink()
      .then((share) => {
        if (live && share.runnerLink) setLink(share.runnerLink);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function share(): Promise<void> {
    if (sharing) return;
    setSharing(true);
    try {
      const url = link ?? (await fetchMyShareLink()).runnerLink ?? null;
      if (!url) {
        onNews('Your referral link could not be found just now. Please try again later.');
        return;
      }
      const text = storeConfig.areas.inviteDriverWords.replace('{link}', url);
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: storeConfig.productName, text, url });
      } else {
        await navigator.clipboard.writeText(text);
        onNews('Your referral link is copied. You can paste it into a message to a driver.');
      }
    } catch {
      // They closed the share sheet, or the link could not be had: back to the order all the same.
    } finally {
      setSharing(false);
      onClose();
    }
  }

  // The keys while it is open: Escape is "OK, I understand"; Tab and Shift+Tab go between the two
  // buttons, and never behind the dialog.
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  useEffect(() => {
    const press = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNow.current();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const onOk = document.activeElement === okButton.current;
      (onOk ? shareButton : okButton).current?.focus();
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/90 p-4 flex items-center justify-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="no-runner-title"
        aria-describedby="no-runner-words"
        className="bg-ink text-paper border-2 border-paper rounded-2xl p-6 space-y-6 max-w-xl w-full"
      >
        <h2 id="no-runner-title" className="text-lead font-bold m-0">
          Before you send your order
        </h2>
        <p id="no-runner-words" className="text-lead m-0">
          {words}
        </p>
        <div className="flex flex-col gap-4">
          <button
            ref={okButton}
            type="button"
            onClick={onClose}
            className="control bg-highlight text-on-accent"
          >
            {storeConfig.areas.noRunnerOkButton}
          </button>
          <button
            ref={shareButton}
            type="button"
            onClick={() => {
              void share();
            }}
            className="control border-paper bg-paper/10 text-paper"
          >
            {storeConfig.areas.noRunnerShareButton}
          </button>
        </div>
      </div>
    </div>
  );
}
