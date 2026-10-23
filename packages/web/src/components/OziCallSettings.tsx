import { useEffect, useState } from 'react';

import { fetchPushPublicKey } from '../lib/api';
import { turnOn } from '../lib/notifications';
import { fetchOwnerReach, saveOwnerDevice, testOziCall, type OwnerReach } from '../lib/owner-call';

/**
 * In the owner's My settings (ruling 79): "Let Ozi ring me in the app" allows notifications on
 * this device and keeps it against his own staff account, so each of Ozi's calls rings here first;
 * "Test Ozi's call" rings him in the app, then his phone if he does not answer, so anyone setting
 * it up can prove it works. Never shows his number: only whether it is set up.
 */
export function OziCallSettings({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const [reach, setReach] = useState<OwnerReach | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    fetchOwnerReach(staffKey)
      .then(setReach)
      .catch(() => setReach(null));
  };
  useEffect(load, [staffKey]);

  const fail = (failure: unknown): void =>
    setProblem(failure instanceof Error ? failure.message : 'That did not work.');

  const allow = async (): Promise<void> => {
    setProblem('');
    setBusy(true);
    try {
      const publicKey = await fetchPushPublicKey();
      if (!publicKey) {
        setProblem('Notifications are not switched on for the admin panel yet.');
        return;
      }
      const state = await turnOn(publicKey, (subscription) =>
        saveOwnerDevice(staffKey, subscription),
      );
      if (state === 'on') {
        onNews('Ozi can ring you in the app on this device.');
        load();
      } else if (state === 'blocked') {
        setProblem(
          'This browser is set to refuse notifications from us. Allow them in its settings, then press the button again.',
        );
      } else if (state === 'needs-home-screen') {
        setProblem(
          'On an iPhone or iPad, add the app to the Home Screen first, then open it there.',
        );
      } else if (state === 'unsupported') {
        setProblem(
          'This browser cannot show notifications. The panel still rings while it is open.',
        );
      } else {
        setProblem('Notifications were not allowed, so Ozi will ring your phone instead.');
      }
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setProblem('');
    setBusy(true);
    try {
      onNews((await testOziCall(staffKey)).message);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="ozi-calls-heading" className="space-y-4">
      <h3 id="ozi-calls-heading" className="text-lead font-bold m-0">
        Ozi&apos;s calls
      </h3>
      <p className="m-0">
        When something needs you, Ozi rings you in the app first, on every device where you allowed
        it, and here while the admin panel is open. If you do not answer within{' '}
        {reach?.appRingSeconds ?? 30} seconds, Ozi rings your phone.
      </p>
      {reach && (
        <p className="m-0">
          {reach.devices === 0
            ? 'No device is set to ring yet.'
            : reach.devices === 1
              ? 'One device is set to ring.'
              : `${reach.devices} devices are set to ring.`}{' '}
          {reach.phone ? 'Your phone is set up.' : 'Your phone is not set up for Ozi’s calls yet.'}
        </p>
      )}
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void allow()}
          className="control min-h-control bg-highlight text-on-accent"
        >
          Let Ozi ring me in the app
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void test()}
          className="control min-h-control border-paper bg-paper/10 text-paper"
        >
          Test Ozi&apos;s call
        </button>
      </div>
    </section>
  );
}
