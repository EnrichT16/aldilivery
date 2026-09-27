import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Field, Radio } from '../components/FormFields';
import { storeConfig } from '../config';
import { registerRunner, type VehicleType } from '../lib/api';
import { writeRunnerToken } from '../lib/session';

/**
 * Signing up to run.
 *
 * Short on purpose: a name, a mobile number, and how they get around. Everything that decides
 * whether somebody may deliver — their right to work and a criminal record check — is done by
 * a person looking at documents afterwards, never by a form. The screen says so before anybody
 * fills anything in, and again at the end, so nobody signs up thinking they can start today.
 *
 * Built the same way as the Shopper sign-up: real labels, hints joined to their fields,
 * problems listed in words at the top, taking focus.
 */
export function RunnerSignUp(): JSX.Element {
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ name: string; phone: string } | null>(null);
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
    const vehicleType = String(data.get('vehicleType') ?? 'on_foot') as VehicleType;

    const found: Array<{ field: string; message: string }> = [];
    if (name === '') found.push({ field: 'runnerName', message: 'Please tell us your name.' });
    if (phone === '') {
      found.push({ field: 'runnerPhone', message: 'Please give us your mobile number.' });
    }
    if (found.length > 0) {
      setErrors(found);
      return;
    }

    setErrors([]);
    setSaving(true);
    try {
      const result = await registerRunner({ name, phone, vehicleType });
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
          You are signed up to run for {storeConfig.productName}.
        </p>
        <section aria-labelledby="next-heading" className="space-y-3 max-w-xl">
          <h2 id="next-heading" className="text-lead font-bold">
            What happens next
          </h2>
          <p className="m-0">
            We will contact you on {done.phone} to arrange your checks. Nobody is offered a job
            until a person at {storeConfig.productName} has seen two things:
          </p>
          <ul className="m-0 ps-6 space-y-2">
            <li>proof of your right to work in the United Kingdom, and</li>
            <li>a criminal record check.</li>
          </ul>
          <p className="m-0">
            Once your checks are done, your Runner page is where you go on shift and take jobs. You
            are signed in to it on this device.
          </p>
        </section>
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
        This takes a minute. Before you can be offered any job, a person at{' '}
        {storeConfig.productName} will check your right to work in the United Kingdom and a criminal
        record check. We will contact you to arrange that.
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

        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="text-lead font-bold mb-2">How will you get around?</legend>
          <Radio name="vehicleType" value="on_foot" label="On foot" defaultChecked />
          <Radio name="vehicleType" value="bicycle" label="Bicycle" />
          <Radio name="vehicleType" value="motorbike" label="Motorbike or scooter" />
          <Radio name="vehicleType" value="car" label="Car" />
          <Radio name="vehicleType" value="van" label="Van" />
        </fieldset>

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
