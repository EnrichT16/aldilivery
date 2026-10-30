import { useEffect, useRef, useState, type FormEvent } from 'react';

import { storeConfig } from '../config';
import { saveHomePostcode, shareRunnerLocation } from '../lib/api';

/**
 * Sharing where a Runner is (Anthony, 30 October 2026), so jobs go to the nearest Runner in the
 * same area rather than to every Runner in the country.
 *
 * - On shift: where they are, about every two minutes (`areas.shareOnShiftSeconds`).
 * - With a job in hand, until it is delivered: followed as they move, sent at most every
 *   `areas.shareOnJobSeconds`.
 * - Off shift with no job: nothing at all.
 *
 * Honestly: a website can only share where somebody is while it is open on the screen. A phone
 * stops it when the page is closed or the screen locks, so the page asks Runners to keep it open
 * during a job. If they say no to sharing, being on shift still works, but jobs come only from
 * their home postcode's area, and the page says kindly how to allow it.
 *
 * The note saying it is being shared is a live region whose words change only when what is
 * shared changes, so a screen reader says it once, not every time a place is sent.
 */

type Refusal = 'refused' | 'unavailable' | null;

export function RunnerLocation({
  onShift,
  onJob,
}: {
  onShift: boolean;
  onJob: boolean;
}): JSX.Element {
  const [refusal, setRefusal] = useState<Refusal>(null);
  const lastSent = useRef(0);
  const mode: 'job' | 'shift' | 'off' = onJob ? 'job' : onShift ? 'shift' : 'off';

  useEffect(() => {
    if (mode === 'off') return undefined;
    if (!('geolocation' in navigator)) {
      setRefusal('unavailable');
      return undefined;
    }
    const send = (position: GeolocationPosition): void => {
      setRefusal(null);
      lastSent.current = Date.now();
      shareRunnerLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }).catch(() => undefined);
    };
    const failed = (error: GeolocationPositionError): void => {
      if (error.code === error.PERMISSION_DENIED) setRefusal('refused');
    };

    if (mode === 'job') {
      const everyMs = storeConfig.areas.shareOnJobSeconds * 1000;
      const watch = navigator.geolocation.watchPosition(
        (position) => {
          if (Date.now() - lastSent.current < everyMs) return;
          send(position);
        },
        failed,
        { enableHighAccuracy: true, maximumAge: 10_000 },
      );
      return () => navigator.geolocation.clearWatch(watch);
    }

    const once = (): void => {
      navigator.geolocation.getCurrentPosition(send, failed, {
        enableHighAccuracy: false,
        timeout: 20_000,
        maximumAge: 60_000,
      });
    };
    once();
    const timer = window.setInterval(once, storeConfig.areas.shareOnShiftSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const sharing = mode !== 'off' && refusal === null;
  const note = !sharing
    ? ''
    : mode === 'job'
      ? 'Your location is being shared while you are on this job.'
      : 'Your location is being shared while you are on shift.';

  return (
    <div className="space-y-2 max-w-xl">
      <p role="status" className="m-0 font-bold">
        {note}
      </p>
      {sharing && (
        <p className="m-0">
          Only our own staff see it, never the Shopper. A website can only share where you are while
          it is open on your screen
          {mode === 'job'
            ? `, so please keep ${storeConfig.productName} open until the shopping is delivered.`
            : '.'}
        </p>
      )}
      {mode !== 'off' && refusal !== null && (
        <div className="space-y-2 border-2 border-paper rounded-2xl p-4">
          <p className="m-0 font-bold">Your phone is not sharing where you are</p>
          <p className="m-0">
            That is all right: you can still be on shift, but you will only be offered jobs in your
            home postcode&rsquo;s area. To be offered the nearest jobs, allow location for this site
            in your browser&rsquo;s settings (often the padlock or the letter &ldquo;i&rdquo; next
            to the address), then come back to this page.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Asks a Runner who signed up before areas began for their home postcode (Anthony, 30 October
 * 2026): it gives their area, and jobs are offered only in it.
 */
export function HomePostcode({ onSaved }: { onSaved: (message: string) => void }): JSX.Element {
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const postcode = String(new FormData(event.currentTarget).get('homePostcode') ?? '').trim();
    if (postcode === '') {
      setProblem('Please give your home postcode, like ME7 1AA.');
      return;
    }
    setSaving(true);
    setProblem('');
    saveHomePostcode(postcode)
      .then((result) => onSaved(result.message))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not save.'),
      )
      .finally(() => setSaving(false));
  }

  return (
    <section aria-labelledby="home-postcode-heading" className="space-y-3 max-w-xl">
      <h2 id="home-postcode-heading" className="text-lead font-bold">
        Your home postcode
      </h2>
      <p className="m-0">
        Jobs are offered in your own area, from the postcode where you live. Please give it before
        you go on shift.
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <label htmlFor="homePostcode" className="block font-bold">
          Home postcode
        </label>
        <input
          id="homePostcode"
          name="homePostcode"
          autoComplete="postal-code"
          aria-describedby={problem ? 'home-postcode-problem' : undefined}
          aria-invalid={problem ? true : undefined}
          className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
        />
        {problem && (
          <p id="home-postcode-problem" role="alert" className="m-0">
            {problem}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="control bg-highlight text-on-accent disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save my postcode'}
        </button>
      </form>
    </section>
  );
}
