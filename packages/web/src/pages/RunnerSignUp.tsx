import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

import { DocumentsChecklist } from '../components/DocumentsChecklist';
import { WrongAppWarning } from '../components/GetTheApp';
import { HomeScreenSignInNote } from '../components/HomeScreenSignInNote';
import { Field } from '../components/FormFields';
import { storeConfig } from '../config';
import { ApiError, registerRunner, type VehicleType } from '../lib/api';
import { readReferral } from '../lib/referral';
import { DOCUMENT_CHECK_WORDS, ENHANCED_DBS_OPTIONAL } from '../lib/runner-words';
import { readRunnerToken, writeRunnerToken } from '../lib/session';
import { useOzi } from '../state/ozi';

const WAYS: Array<{ value: VehicleType; label: string }> = [
  { value: 'on_foot', label: 'Walking' },
  { value: 'bicycle', label: 'Bicycle or electric bike' },
  { value: 'motorbike', label: 'Motorbike or moped' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
];

/**
 * The half-filled form, kept for this tab (10 November 2026, ruling 100), so a reload, or the
 * phone clearing the page while the agreement is read, does not empty it. Only what is typed
 * here and the ways ticked: never the tick that agrees, which must be made afresh, and there is
 * no password, PIN or code on this form to keep. Forgotten once signed up.
 */
const DRAFT_KEY = 'ozidelivery.runner-sign-up.draft';

interface Draft {
  runnerName: string;
  runnerPhone: string;
  homePostcode: string;
  introducedBy: string;
  travelModes: string[];
}

function readDraft(): Draft | null {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? 'null') as
      | Partial<Draft>
      | null;
    if (!kept || typeof kept !== 'object') return null;
    const words = (value: unknown): string => (typeof value === 'string' ? value : '');
    return {
      runnerName: words(kept.runnerName),
      runnerPhone: words(kept.runnerPhone),
      homePostcode: words(kept.homePostcode),
      introducedBy: words(kept.introducedBy),
      travelModes: Array.isArray(kept.travelModes) ? kept.travelModes.map(String) : ['on_foot'],
    };
  } catch {
    return null;
  }
}

function keepDraft(form: HTMLFormElement | null): void {
  try {
    if (form === null) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    const data = new FormData(form);
    const draft: Draft = {
      runnerName: String(data.get('runnerName') ?? ''),
      runnerPhone: String(data.get('runnerPhone') ?? ''),
      homePostcode: String(data.get('homePostcode') ?? ''),
      introducedBy: String(data.get('introducedBy') ?? ''),
      travelModes: data.getAll('travelModes').map(String),
    };
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Nothing kept: the form is as it always was.
  }
}

/** What the screen and the assistant say to a Runner who is signed up and has documents to send. */
const SIGNED_UP_WORDS = 'You are signed up. Now your documents.';

/**
 * Signing up to run, all in the app, from anywhere in the UK (rulings of 2 October 2026).
 *
 * First a name, a mobile number, and every way they might deliver — tick all, so switching
 * later needs nothing new. Then, straight away, the documents, photographed with the phone:
 * a face photo, the right to work, a DBS certificate, and for a car, motorbike or van the
 * licence and insurance. The automatic check approves only documents that are clearly in order;
 * anything unclear is looked at by a person, and the screen says so before anybody fills
 * anything in (Anthony, 30 October 2026).
 *
 * Built the same way as the Shopper sign-up: real labels, hints joined to their fields,
 * problems listed in words at the top, taking focus.
 *
 * The documents step no longer lives only in this page's memory (10 November 2026, ruling 100).
 * The Runner's sign-in is saved the moment they sign up, but after any reload this page showed
 * the empty form again, and sending it again was refused with "There is already a Runner on that
 * phone number" and no way on: one Runner gave up there. Now a Runner already signed in on this
 * phone always sees the documents here; a number that is already a Runner's is told so plainly,
 * with "Sign in instead" beside it; and the half-filled form is kept for the tab.
 */
export function RunnerSignUp(): JSX.Element {
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  // Signed in as a Runner on this phone already: straight to the documents, whatever happened
  // to the page in between. The name is not known here, and is not needed.
  const [done, setDone] = useState<{ name: string; phone: string } | null>(() =>
    readRunnerToken() ? { name: '', phone: '' } : null,
  );
  const [news, setNews] = useState('');
  // The number that is already a Runner's, so the way to sign in sits beside the words.
  const [alreadyRunner, setAlreadyRunner] = useState<string | null>(null);
  const [draft] = useState(readDraft);
  const ozi = useOzi();
  const oziRef = useRef(ozi);
  oziRef.current = ozi;
  const signedUp = done !== null;

  useEffect(() => {
    // Said once, plainly, for somebody who cannot see that the screen has changed.
    if (signedUp) void oziRef.current.say(SIGNED_UP_WORDS);
  }, [signedUp]);
  const [params] = useSearchParams();
  // A Runner's link (`?ref=R…`), or a Shopper's referral link for a driver (`?via=shopper-…`,
  // 30 October 2026), so whoever invited them is recorded on the new Runner.
  const fromShopper = /^shopper-[A-Za-z0-9_-]{1,40}$/.exec(params.get('via') ?? '')?.[0];
  const referredBy = params.get('ref') ?? fromShopper ?? readReferral() ?? undefined;
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
    const homePostcode = String(data.get('homePostcode') ?? '').trim();
    const introducedBy = String(data.get('introducedBy') ?? '').trim();
    const travelModes = data.getAll('travelModes').map(String) as VehicleType[];
    const agreed = data.get('agreement') === 'yes';

    const found: Array<{ field: string; message: string }> = [];
    if (name === '') found.push({ field: 'runnerName', message: 'Please tell us your name.' });
    if (phone === '') {
      found.push({ field: 'runnerPhone', message: 'Please give us your mobile number.' });
    }
    if (homePostcode === '') {
      found.push({ field: 'homePostcode', message: 'Please give your home postcode.' });
    }
    if (travelModes.length === 0) {
      found.push({
        field: 'travelModes-on_foot',
        message: 'Please choose at least one way you will deliver.',
      });
    }
    if (!agreed) {
      found.push({
        field: 'agreement',
        message: 'Please tick to say you are 18 or over and agree to the Runner agreement.',
      });
    }
    if (found.length > 0) {
      setErrors(found);
      return;
    }

    setErrors([]);
    setAlreadyRunner(null);
    setSaving(true);
    try {
      const result = await registerRunner({
        name,
        phone,
        travelModes,
        ...(referredBy ? { referredBy } : {}),
        // Kept with the date and the version, before any job (ruling 55).
        agreement: { accepted: true, version: RUNNER_AGREEMENT_VERSION, channel: 'button' },
        // The same tick says they are 18 or over; the server keeps it with its time.
        adult: true,
        homePostcode,
        // "Did someone introduce you?" (30 October 2026): counted when no link was used.
        ...(introducedBy ? { introducedBy } : {}),
      });
      // Kept as the Runner's own sign-in, so any Shopper signed in here stays signed in.
      writeRunnerToken(result.token);
      keepDraft(null);
      setDone({ name: result.runner.name, phone });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // This number is a Runner's already (ruling 100): say what to do, and offer it.
        setAlreadyRunner(phone);
        setErrors([
          {
            field: 'runnerPhone',
            message:
              'There is already a Runner on that phone number. If that is you, there is no need to sign up again: sign in instead.',
          },
        ]);
        return;
      }
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
        <h1 className="text-display font-bold m-0">
          {done.name === '' ? 'You are signed up' : `Thank you, ${done.name}`}
        </h1>
        <p role="status" className="m-0 max-w-xl text-lead">
          {done.name === ''
            ? SIGNED_UP_WORDS
            : `You are signed up to run for ${storeConfig.productName}.`}{' '}
          {news}
        </p>
        <HomeScreenSignInNote />
        <section aria-labelledby="next-heading" className="space-y-3 max-w-xl">
          <h2 id="next-heading" className="text-lead font-bold">
            Now, your documents
          </h2>
          <p className="m-0">
            Take a photo of each with this phone. There is no need to scan anything or come to an
            office. {DOCUMENT_CHECK_WORDS} Nobody is offered a job until their documents are
            approved. You can stop and carry on later from your Runner page.
          </p>
        </section>
        <DocumentsChecklist onNews={setNews} />
        <Link to="/runner/home" className="control bg-highlight text-on-accent">
          Go to your Runner page
        </Link>
        {done.name === '' && (
          // A shared phone: somebody else's Runner sign-in is here, and this person is new.
          <Link to="/runner/sign-in" className="control bg-paper/10 text-paper underline">
            Not you? Sign in as a different Runner
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Sign up to run</h1>
      <p className="m-0 max-w-xl">
        This takes a few minutes, all on your phone. First your name, number and how you will
        deliver; then photos of your documents. Before you can be offered any job, we check your
        right to work in the UK and a DBS check, and for a car, motorbike or van your licence and
        insurance. {DOCUMENT_CHECK_WORDS}
      </p>
      <p className="m-0 max-w-xl">{ENHANCED_DBS_OPTIONAL}</p>
      {/* Another app called Ozi is in the app stores; ours is not yet (Anthony, 30 October 2026). */}
      <WrongAppWarning homeScreen />

      {errors.length > 0 && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl"
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
          {alreadyRunner !== null && (
            <Link
              to="/runner/sign-in"
              state={{ phone: alreadyRunner }}
              className="control bg-highlight text-ink mt-3"
            >
              Sign in instead
            </Link>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        onChange={(event) => {
          // Kept as it is typed, for this tab only (ruling 100).
          keepDraft(event.currentTarget);
        }}
        noValidate
        className="space-y-6 max-w-xl"
      >
        <Field
          id="runnerName"
          label="Your name"
          hint="The name on your documents, so the checks match."
          autoComplete="name"
          defaultValue={draft?.runnerName}
        />
        <Field
          id="runnerPhone"
          label="Your mobile number"
          hint="We will contact you on this number to arrange your checks, like 07700 900123."
          type="tel"
          autoComplete="tel"
          defaultValue={draft?.runnerPhone}
        />
        <Field
          id="homePostcode"
          label="Your home postcode"
          hint="Jobs are offered in your own area, from where you live, like ME7 1AA."
          autoComplete="postal-code"
          defaultValue={draft?.homePostcode}
        />
        <Field
          id="introducedBy"
          label="Did someone introduce you? Their code (optional)"
          hint="If a friend, a Runner or an Ozi Ambassador told you about us, type the code from their link. You can leave this empty."
          autoComplete="off"
          defaultValue={draft?.introducedBy}
        />

        <fieldset className="space-y-2 border-0 p-0 m-0" aria-describedby="ways-hint">
          <legend className="text-lead font-bold mb-2">How will you deliver?</legend>
          <p id="ways-hint" className="m-0 text-paper/90">
            Tick every way you might use. You can switch any day in your settings. Walking and
            cycling need no insurance; a car, motorbike or van needs a licence and insurance that
            covers delivery work.
          </p>
          {WAYS.map((way) => (
            <div key={way.value} className="flex items-center gap-3 min-h-control">
              <input
                type="checkbox"
                id={`travelModes-${way.value}`}
                name="travelModes"
                value={way.value}
                defaultChecked={
                  draft ? draft.travelModes.includes(way.value) : way.value === 'on_foot'
                }
                className="h-6 w-6"
              />
              <label htmlFor={`travelModes-${way.value}`} className="m-0">
                {way.label}
              </label>
            </div>
          ))}
        </fieldset>

        <p className="m-0">
          The Runner agreement says how you are paid, that you pay at the till with your own card
          and how we pay you back, and what happens if something goes wrong. Please read it before
          you agree.
        </p>
        {/* A new tab, so what has been typed here is still here afterwards (16 October 2026). */}
        <a
          href="/runner/agreement"
          target="_blank"
          rel="noopener"
          className="control bg-paper/10 text-paper underline"
        >
          Read the Runner agreement<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        <div className="flex items-center gap-3 min-h-control">
          <input type="checkbox" id="agreement" name="agreement" value="yes" className="h-6 w-6" />
          <label htmlFor="agreement" className="m-0">
            I am 18 or over, and I agree to the Runner agreement
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
        >
          {saving ? 'Signing you up…' : 'Sign me up to run'}
        </button>
      </form>
    </div>
  );
}
