import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  ApiError,
  ApiUnavailableError,
  fetchSignInOptions,
  requestSignInCode,
  verifySignInCode,
} from '../lib/api';
import { writeRunnerToken } from '../lib/session';
import { useSession } from '../state/session';

/**
 * Signing back in, on a phone or computer somebody has not used the app on before.
 *
 * Two steps, one question each: the phone number, then the code that was texted to it. There
 * is no password, and never will be — a password is a poor fit for somebody who cannot see
 * the screen, and a barrier for somebody who finds reading hard.
 *
 * The code field asks the browser for `one-time-code`, so a phone can offer the code from the
 * text straight away, and it is a text field with a numeric keypad rather than a number
 * field, because a number field drops leading noughts and offers arrows to step through
 * codes, neither of which anybody wants.
 *
 * Like the sign-up form, a problem is said in words at the top and takes focus, so somebody
 * who cannot see the screen is told what happened.
 *
 * The same two steps sign a Runner in on a new phone (16 October 2026): the server already
 * sends Runner codes; `as="runner"` asks for one, keeps the token as the Runner's own, and
 * goes to their Runner page.
 */
export function SignIn({ as: role = 'shopper' }: { as?: 'shopper' | 'runner' }): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { shopper, signedIn } = useSession();
  const asRunner = role === 'runner';
  // Where to go afterwards: back to the order if that is where they came from. Only a path on
  // this site, never an address somewhere else.
  const requested = params.get('next') ?? '';
  // Two parts at most, so applying to be an Ambassador (/ambassador/apply) comes back too.
  const next = asRunner
    ? '/runner/home'
    : /^\/[a-z-]*(\/[a-z-]+)?$/.test(requested)
      ? requested
      : '/shop';

  const [available, setAvailable] = useState<boolean | null>(null);
  const [byCall, setByCall] = useState(false);
  const [channel, setChannel] = useState<'text' | 'call'>('text');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  // The technical reason behind an error, folded away under "Details" so the screen stays
  // tidy and a screenshot can still say exactly what failed.
  const [errorDetail, setErrorDetail] = useState('');
  // No account on that number: the way to set one up sits inside the message itself.
  const [noAccount, setNoAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = useRef<HTMLParagraphElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSignInOptions()
      .then((options) => {
        if (cancelled) return;
        setAvailable(options.byText || options.byCall);
        setByCall(options.byCall);
      })
      .catch(() => {
        // Cannot reach us at all. Offer the form anyway: asking for a code will say so.
        if (!cancelled) setAvailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (error !== '') problem.current?.focus();
  }, [error]);

  useEffect(() => {
    if (step === 'code') codeField.current?.focus();
  }, [step]);

  async function sendCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (phone.trim() === '') {
      setError('Please give the phone number you set up your account with.');
      return;
    }
    // Whichever button was pressed: a text, or a phone call that says the code.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const how = submitter?.value === 'call' ? 'call' : 'text';
    setChannel(how);
    setBusy(true);
    setError('');
    setErrorDetail('');
    try {
      const result = await requestSignInCode(phone.trim(), { channel: how, role });
      setSentMessage(result.message);
      setStep('code');
    } catch (failure) {
      const problem = describeProblem(failure, 'We could not send a code.');
      setError(problem.words);
      setErrorDetail(problem.detail);
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    if (code === '') {
      setError('Please type the code from the text message.');
      return;
    }
    setBusy(true);
    setError('');
    setErrorDetail('');
    setNoAccount(false);
    try {
      const result = await verifySignInCode(phone.trim(), code, role);
      if (result.registrationRequired) {
        setNoAccount(true);
        setError(
          asRunner
            ? 'There is no Runner account on that number yet. You can sign up to run instead.'
            : 'There is no account on that number yet. You can set one up instead — it takes a minute.',
        );
        return;
      }
      if (asRunner) {
        // The Runner's own sign-in: any Shopper signed in on this phone stays signed in.
        writeRunnerToken(result.token);
      } else {
        await signedIn(result.token);
      }
      navigate(next);
    } catch (failure) {
      const problem = describeProblem(failure, 'That code did not work.');
      setError(problem.words);
      setErrorDetail(problem.detail);
    } finally {
      setBusy(false);
    }
  }

  if (shopper && !asRunner) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">You are signed in</h1>
        <p className="m-0 max-w-xl">You are signed in as {shopper.displayName}.</p>
        <Link to="/shop" className="control bg-highlight text-on-accent">
          Find your shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">{asRunner ? 'Runner sign in' : 'Sign in'}</h1>

      {available === false ? (
        <>
          <p role="status" className="border-2 border-paper p-4 rounded-2xl m-0 max-w-xl">
            Signing in by text message is not switched on yet. For now, an account can only be used
            on the phone or computer it was set up on.
          </p>
          <Link
            to={asRunner ? '/runner/sign-up' : '/sign-up'}
            className="control bg-highlight text-on-accent"
          >
            {asRunner ? 'Sign up to run on this device' : 'Set up an account on this device'}
          </Link>
        </>
      ) : (
        <>
          <p className="m-0 max-w-xl">
            There is no password. We text a code to the mobile number you{' '}
            {asRunner ? 'signed up to run with' : 'set up your account with'}, and you type it in
            here.
            {byCall &&
              ' With a landline, choose a phone call instead, and a voice will read you the code.'}
          </p>

          {error !== '' && (
            <div
              ref={problem}
              tabIndex={-1}
              role="alert"
              className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0 max-w-xl"
            >
              <p className="m-0">{error}</p>
              {noAccount && (
                <Link to="/sign-up" className="control bg-highlight text-ink mt-3">
                  Set up an account
                </Link>
              )}
              {errorDetail !== '' && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-bold">Details</summary>
                  <p className="m-0 mt-1 break-words">{errorDetail}</p>
                </details>
              )}
            </div>
          )}

          {step === 'phone' ? (
            <form
              onSubmit={(event) => {
                void sendCode(event);
              }}
              noValidate
              className="space-y-6 max-w-xl"
            >
              <div className="space-y-2">
                <label htmlFor="sign-in-phone" className="block text-lead font-bold">
                  Your phone number
                </label>
                <p id="sign-in-phone-hint" className="m-0 text-paper/90">
                  The one you gave when you {asRunner ? 'signed up to run' : 'set up your account'},
                  like 07700 900123
                  {byCall ? ', or your landline' : ''}.
                </p>
                <input
                  id="sign-in-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  aria-describedby="sign-in-phone-hint"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                  }}
                  className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
                />
              </div>
              <button
                type="submit"
                disabled={busy || available === null}
                className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
              >
                {busy ? 'Sending your code…' : 'Text me a code'}
              </button>
              {byCall && (
                <button
                  type="submit"
                  name="channel"
                  value="call"
                  disabled={busy || available === null}
                  className="control w-full bg-paper text-ink text-lead disabled:opacity-70"
                >
                  Call me with the code
                </button>
              )}
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                void checkCode(event);
              }}
              noValidate
              className="space-y-6 max-w-xl"
            >
              <p role="status" className="m-0">
                {sentMessage} {channel === 'call' ? 'We are calling' : 'We sent it to'}{' '}
                {phone.trim()}.
              </p>
              <div className="space-y-2">
                <label htmlFor="sign-in-code" className="block text-lead font-bold">
                  {channel === 'call' ? 'The code from the phone call' : 'The code from the text'}
                </label>
                <p id="sign-in-code-hint" className="m-0 text-paper/90">
                  {channel === 'call'
                    ? 'The numbers the voice read out.'
                    : 'The numbers in the text message.'}{' '}
                  Nobody from {storeConfig.productName} will ever phone you to ask for it.
                </p>
                <input
                  ref={codeField}
                  id="sign-in-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-describedby="sign-in-code-hint"
                  className="w-full max-w-xs min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3 text-lead tracking-widest"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
              >
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setError('');
                }}
                className="control bg-paper/10 text-paper underline"
              >
                Use a different number, or send the code again
              </button>
            </form>
          )}

          {asRunner ? (
            <Link to="/runner/sign-up" className="control bg-paper/10 text-paper underline">
              New to running for {storeConfig.productName}? Sign up to run
            </Link>
          ) : (
            <Link to="/sign-up" className="control bg-paper/10 text-paper underline">
              New to {storeConfig.productName}? Set up an account
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What went wrong, in words, and the technical reason apart from them. The reason is shown
 * folded away, so a screenshot of a failed sign-in can say which part failed without the words
 * on the screen getting any longer (16 October 2026: a sign-in that never reached the server
 * looked the same as one the server could not answer).
 */
function describeProblem(failure: unknown, fallback: string): { words: string; detail: string } {
  if (failure instanceof ApiUnavailableError) {
    const status = failure.status === undefined ? '' : `, status ${failure.status}`;
    return { words: failure.message, detail: `${failure.reason}${status}` };
  }
  if (failure instanceof ApiError && failure.details?.['provider'] === 'twilio') {
    return { words: failure.message, detail: `Twilio error ${String(failure.details['code'])}` };
  }
  return { words: failure instanceof Error ? failure.message : fallback, detail: '' };
}
