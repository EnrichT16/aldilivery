import { useCallback, useEffect, useRef, useState } from 'react';

import {
  endMySos,
  fetchSos,
  pressSos,
  sendSosLocation,
  sosWords,
  type SosState,
  type Whereabouts,
} from '../lib/runner-api';

/**
 * The SOS button (docs/BUILD_PROMPT.md, Section M). Large, on the Runner's job screen, and asked
 * twice, so a pocket or a stray thumb cannot set it off: SOS, then "Yes, send SOS".
 *
 * When it is on, the phone shares where the Runner is, kept up to date while it is on, with the
 * owner and staff only: a text to the owner's alert phone with a private link, and the admin
 * panel. Nothing goes to the Shopper, and no Shopper's number is part of it.
 *
 * Safety first (Anthony, 30 October 2026): the first and largest words, once it is opened, are
 * "If you are in danger, call 999 now.", with a button that rings it in one tap. What it says
 * about the office is only what really happened: told, with or without where they are, or not
 * reached at all, and then to call 999. It never says "told" when the alert did not go.
 */

/** The first words, whatever the server says: the emergency services come first. */
const CALL_999 = 'If you are in danger, call 999 now.';

/** How often a moving Runner's place is sent, at most. */
const SEND_EVERY_MS = 15_000;

function fromPosition(position: GeolocationPosition): Whereabouts {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMetres: Math.round(position.coords.accuracy),
  };
}

/** One reading of where the phone is, or null if it will not say within ten seconds. */
function whereNow(): Promise<Whereabouts | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(fromPosition(position)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

export function RunnerSos(): JSX.Element {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [sos, setSos] = useState<SosState | null>(null);
  const [call999, setCall999] = useState(CALL_999);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [ended, setEnded] = useState('');
  const lastSent = useRef(0);

  // An SOS already on, after the page was closed and opened again, carries on.
  useEffect(() => {
    let cancelled = false;
    fetchSos()
      .then((result) => {
        if (cancelled) return;
        setCall999(result.call999 || CALL_999);
        if (result.sos?.on) {
          setSos(result.sos);
          setNews(result.message ?? sosWords(result.sos));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // While it is on, the phone's place is followed and sent, every fifteen seconds at most.
  const on = sos?.on === true;
  useEffect(() => {
    if (!on || !('geolocation' in navigator)) return undefined;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const at = Date.now();
        if (at - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = at;
        sendSosLocation(fromPosition(position))
          .then((result) => {
            setSos(result.sos);
            setNews(result.message ?? sosWords(result.sos));
          })
          .catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on]);

  const send = useCallback(async () => {
    setStage('sending');
    setProblem('');
    setEnded('');
    try {
      const location = await whereNow();
      lastSent.current = Date.now();
      const result = await pressSos(location);
      setSos(result.sos);
      setCall999(result.call999 || CALL_999);
      setNews(result.message || sosWords(result.sos));
      setStage('idle');
    } catch {
      // The office was not reached: never "told" (Anthony, 30 October 2026).
      setStage('idle');
      setProblem('We could not reach the office. Please call 999.');
    }
  }, []);

  const ring999 = (
    <a
      href="tel:999"
      className="control w-full bg-paper text-ink text-lead font-bold border-4 border-ink justify-center"
    >
      Call 999
    </a>
  );

  // The first and largest words on the SOS screen, with the one-tap call straight after.
  const danger = (
    <>
      <p className="m-0 text-display font-bold">{call999}</p>
      {ring999}
    </>
  );

  if (on && sos) {
    return (
      <section
        aria-labelledby="sos-heading"
        className="space-y-3 max-w-xl border-4 border-paper rounded-2xl p-4"
      >
        {danger}
        <h2 id="sos-heading" className="text-lead font-bold m-0">
          SOS is on
        </h2>
        <p role="alert" className="m-0">
          {news !== '' ? news : sosWords(sos)}
        </p>
        <p className="m-0">
          {sos.located
            ? 'Your phone is sharing where you are, kept up to date while the SOS is on.'
            : 'Your phone has not shared where you are yet. If it asks, please allow it.'}{' '}
          <span className="extra">Only our own staff see it. Nothing is sent to the Shopper.</span>
        </p>
        <button
          type="button"
          onClick={() => {
            endMySos()
              .then((result) => {
                setSos(null);
                setNews('');
                setStage('idle');
                setProblem('');
                setEnded(result.message);
              })
              .catch((failure: unknown) =>
                setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
              );
          }}
          className="control w-full bg-paper/10 text-paper underline"
        >
          I am safe now
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="sos-heading" className="space-y-3 max-w-xl">
      <h2 id="sos-heading" className="visually-hidden">
        Safety
      </h2>
      {problem !== '' && (
        <>
          {danger}
          <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
            {problem}
          </p>
        </>
      )}
      {stage === 'idle' ? (
        <>
          <button
            type="button"
            aria-describedby="sos-hint"
            onClick={() => setStage('confirm')}
            className="control w-full bg-paper text-ink text-display font-bold border-4 border-ink"
          >
            SOS
          </button>
          <p id="sos-hint" className="m-0 extra">
            If you feel unsafe. It alerts the office, and shows you how to call 999.
          </p>
        </>
      ) : (
        <div role="alert" className="space-y-3 border-2 border-paper rounded-2xl p-4">
          {danger}
          <p className="m-0 text-lead font-bold">Send an SOS to the office?</p>
          <p className="m-0">
            It alerts the office straight away, and shares where you are if your phone allows it.
          </p>
          <button
            type="button"
            disabled={stage === 'sending'}
            onClick={() => {
              void send();
            }}
            className="control w-full bg-paper text-ink text-lead font-bold border-4 border-ink disabled:opacity-70"
          >
            {stage === 'sending' ? 'Sending SOS…' : 'Yes, send SOS'}
          </button>
          <button
            type="button"
            onClick={() => setStage('idle')}
            className="control bg-paper/10 text-paper underline"
          >
            No, I am fine
          </button>
        </div>
      )}
      <p role="status" className="m-0">
        {ended}
      </p>
    </section>
  );
}
