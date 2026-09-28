import { useEffect, useState } from 'react';

import { storeConfig } from '../config';
import { fetchPushPublicKey } from '../lib/api';
import { notificationState, turnOff, turnOn, type NotificationState } from '../lib/notifications';

/**
 * "Tell me when my Runner has a question." Shown on the Your order page and when an order has
 * just been sent, which is when a Shopper is most likely to put the phone down.
 *
 * Says nothing at all where notifications are not switched on for the site, or this browser
 * cannot do them: an offer that cannot work is worse than none. Everything it says is in plain
 * words, including what to do when the browser has blocked it.
 */
export function NotifyMe(): JSX.Element | null {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [state, setState] = useState<NotificationState | null>(null);
  const [working, setWorking] = useState(false);
  const [said, setSaid] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const key = await fetchPushPublicKey();
        if (!key || cancelled) return;
        const current = await notificationState();
        if (cancelled) return;
        setPublicKey(key);
        setState(current);
      } catch {
        // Nothing offered. The Your order page still shows every question.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!publicKey || state === null || state === 'unsupported') return null;

  async function change(next: () => Promise<NotificationState>, done: string): Promise<void> {
    setWorking(true);
    setSaid('');
    try {
      const result = await next();
      setState(result);
      setSaid(result === 'on' || result === 'off' ? done : '');
    } catch {
      setSaid('That did not work. Your Runner’s questions will still appear on this page.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="notify-heading" className="space-y-3 max-w-xl">
      <h2 id="notify-heading" className="text-lead font-bold">
        If your Runner has a question
      </h2>
      {state === 'needs-home-screen' && (
        <p className="m-0">
          On an iPhone or iPad, we can only tell you when this page is closed if you add{' '}
          {storeConfig.productName} to your Home Screen first: press Share, then Add to Home Screen,
          and open it from there.
        </p>
      )}
      {state === 'blocked' && (
        <p className="m-0">
          Notifications are blocked for this site in your browser’s settings, so we can only ask you
          on this page. You can allow them in the settings for this site.
        </p>
      )}
      {state === 'off' && (
        <>
          <p className="m-0">
            We can tell you on this device, even when this page is closed. Your phone will ask you
            first.
          </p>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              void change(
                () => turnOn(publicKey),
                'Done. We will tell you on this device when your Runner has a question.',
              );
            }}
            className="control w-full bg-paper text-ink text-lead disabled:opacity-70"
          >
            Tell me when my Runner has a question
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="m-0">We will tell you on this device, even when this page is closed.</p>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              void change(turnOff, 'Notifications are off for this device.');
            }}
            className="control bg-paper/10 text-paper underline disabled:opacity-70"
          >
            Stop telling me on this device
          </button>
        </>
      )}
      <p role="status" className="m-0">
        {said}
      </p>
    </section>
  );
}
