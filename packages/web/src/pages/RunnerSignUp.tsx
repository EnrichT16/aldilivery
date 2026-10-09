import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { DocumentsChecklist } from '../components/DocumentsChecklist';
import { Field } from '../components/FormFields';
import { storeConfig } from '../config';
import { registerRunner, type VehicleType } from '../lib/api';
import { readReferral } from '../lib/referral';
import { writeRunnerToken } from '../lib/session';

const WAYS: Array<{ value: VehicleType; label: string }> = [
  { value: 'on_foot', label: 'Walking' },
  { value: 'bicycle', label: 'Bicycle or electric bike' },
  { value: 'motorbike', label: 'Motorbike or moped' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
];

/**
 * Signing up to run, all in the app, from anywhere in the UK (rulings of 2 October 2026).
 *
 * First a name, a mobile number, and every way they might deliver — tick all, so switching
 * later needs nothing new. Then, straight away, the documents, photographed with the phone:
 * a face photo, the right to work, a DBS certificate, and for a car or motorbike the licence
 * and insurance. Whether somebody may deliver is decided by a person looking at those, never by
 * a form, and the screen says so before anybody fills anything in.
 *
 * Built the same way as the Shopper sign-up: real labels, hints joined to their fields,
 * problems listed in words at the top, taking focus.
 */
export function RunnerSignUp(): JSX.Element {
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ name: string; phone: string } | null>(null);
  const [news, setNews] = useState('');
  const [params] = useSearchParams();
  const referredBy = params.get('ref') ?? readReferral() ?? undefined;
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errors.length > 0) summary.current?.focus();
  }, [errors]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const name = String(data.get('runnerName') ?? '').trim();
    const phone = String(data.get('runnerPhone') ?? '').trim();
    const travelModes = data.getAll('travelModes').map(String) as VehicleType[];

    const found: Array<{ field: string; message: string }> = [];
    if (name === '') found.push({ field: 'runnerName', message: 'Please tell us your name.' });
    if (phone === '') {
      found.push({ field: 'runnerPhone', message: 'Please give us your mobile number.' });
    }
    if (travelModes.length === 0) {
      found.push({
        field: 'travelModes-on_foot',
        message: 'Please choose at least one way you will deliver.',
      });
    }
    if (found.length > 0) {
      setErrors(found);
      return;
    }

    setErrors([]);
    setSaving(true);
    try {
      const result = await registerRunner({
        name,
        phone,
        travelModes,
        ...(referredBy ? { referredBy } : {}),
      });
      // Kept as the Runner's own sign-in, so any Shopper signed in here stays signed in.
      writeRunnerToken(result.token);
      setDone({ name: result.runner.name, phone });
    } catch (error) {
      setErrors([
        {
          field: 'runnerPhone',
          message: error instanceof Error ? error.message : 'We could not sign you up.',
        },
      ]);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Thank you, {done.name}</h1>
        <p role="status" className="m-0 max-w-xl text-lead">
          You are signed up to run for {storeConfig.productName}. {news}
        </p>
        <section aria-labelledby="next-heading" className="space-y-3 max-w-xl">
          <h2 id="next-heading" className="text-lead font-bold">
            Now, your documents
          </h2>
          <p className="m-0">
            Take a photo of each with this phone. There is no need to scan anything or come to an
            office. A person at {storeConfig.productName} checks each one, and nobody is offered a
            job until they have. You can stop and carry on later from your Runner page.
          </p>
        </section>
        <DocumentsChecklist onNews={setNews} />
        <Link to="/runner/home" className="control bg-highlight text-ink">
          Go to your Runner page
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Sign up to run</h1>
      <p className="m-0 max-w-xl">
        This takes a few minutes, all on your phone. First your name, number and how you will
        deliver; then photos of your documents. Before you can be offered any job, a person at{' '}
        {storeConfig.productName} checks your right to work in the UK and a DBS check, and for a car
        or motorbike your licence and insurance.
      </p>

      {errors.length > 0 && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl"
        >
          <h2 className="text-lead font-bold m-0">
            There {errors.length === 1 ? 'is 1 problem' : `are ${errors.length} problems`} to fix
          </h2>
          <ul className="m-0 mt-2 ps-6">
            {errors.map((error) => (
              <li key={`${error.field}-${error.message}`}>
                <a href={`#${error.field}`} className="underline">
                  {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="space-y-6 max-w-xl"
      >
        <Field
          id="runnerName"
          label="Your name"
          hint="The name on your documents, so the checks match."
          autoComplete="name"
        />
        <Field
          id="runnerPhone"
          label="Your mobile number"
          hint="We will contact you on this number to arrange your checks, like 07700 900123."
          type="tel"
          autoComplete="tel"
        />

        <fieldset className="space-y-2 border-0 p-0 m-0" aria-describedby="ways-hint">
          <legend className="text-lead font-bold mb-2">How will you deliver?</legend>
          <p id="ways-hint" className="m-0 text-paper/90">
            Tick every way you might use. You can switch any day in your settings. Walking and
            cycling need no insurance; a car or motorbike needs a licence and insurance that covers
            delivery work.
          </p>
          {WAYS.map((way) => (
            <div key={way.value} className="flex items-center gap-3 min-h-control">
              <input
                type="checkbox"
                id={`travelModes-${way.value}`}
                name="travelModes"
                value={way.value}
                defaultChecked={way.value === 'on_foot'}
                className="h-6 w-6"
              />
              <label htmlFor={`travelModes-${way.value}`} className="m-0">
                {way.label}
              </label>
            </div>
          ))}
        </fieldset>

        <p className="m-0">
          By signing up, you confirm you are 18 or over and agree to the Runner agreement. We will
          ask you to agree to its final version before your first job.
        </p>
        <Link to="/runner/agreement" className="control bg-paper/10 text-paper underline">
          Read the Runner agreement
        </Link>

        <button
          type="submit"
          disabled={saving}
          className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
        >
          {saving ? 'Signing you up…' : 'Sign me up to run'}
        </button>
      </form>
    </div>
  );
}
