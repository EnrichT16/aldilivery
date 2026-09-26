import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { storeConfig } from '../config';
import { fetchSignInAvailable, requestSignInCode, verifySignInCode } from '../lib/api';
import { useSession } from '../state/session';

/**
 * Signing back in, on a phone or computer somebody has not used Aldilivery on before.
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
 */
export function SignIn(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { shopper, signedIn } = useSession();
  // Where to go afterwards: back to the order if that is where they came from. Only a path on
  // this site, never an address somewhere else.
  const requested = params.get('next') ?? '';
  const next = /^\/[a-z-]*$/.test(requested) ? requested : '/shop';

  const [available, setAvailable] = useState<boolean | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const problem = useRef<HTMLParagraphElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSignInAvailable()
      .then((yes) => {
        if (!cancelled) setAvailable(yes);
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
      setError('Please give the mobile number you set up your account with.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await requestSignInCode(phone.trim());
      setSentMessage(result.message);
      setStep('code');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We could not send a code.');
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
    try {
      const result = await verifySignInCode(phone.trim(), code);
      if (result.registrationRequired) {
        setError(
          'There is no account on that number yet. You can set one up instead — it takes a minute.',
        );
        return;
      }
      await signedIn(result.token);
      navigate(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (shopper) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">You are signed in</h1>
        <p className="m-0 max-w-xl">You are signed in as {shopper.displayName}.</p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Sign in</h1>

      {available === false ? (
        <>
          <p role="status" className="border-2 border-paper p-4 rounded-xl m-0 max-w-xl">
            Signing in by text message is not switched on yet. For now, an account can only be used
            on the phone or computer it was set up on.
          </p>
          <Link to="/sign-up" className="control bg-highlight text-ink">
            Set up an account on this device
          </Link>
        </>
      ) : (
        <>
          <p className="m-0 max-w-xl">
            There is no password. We text a code to the mobile number you set up your account with,
            and you type it in here.
          </p>

          {error !== '' && (
            <p
              ref={problem}
              tabIndex={-1}
              role="alert"
              className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0 max-w-xl"
            >
              {error}
            </p>
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
                  Your mobile number
                </label>
                <p id="sign-in-phone-hint" className="m-0 text-paper/90">
                  The one you gave when you set up your account, like 07700 900123.
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
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
              </div>
              <button
                type="submit"
                disabled={busy || available === null}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
              >
                {busy ? 'Sending your code…' : 'Text me a code'}
              </button>
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
                {sentMessage} We sent it to {phone.trim()}.
              </p>
              <div className="space-y-2">
                <label htmlFor="sign-in-code" className="block text-lead font-bold">
                  The code from the text
                </label>
                <p id="sign-in-code-hint" className="m-0 text-paper/90">
                  The numbers in the text message. Nobody from {storeConfig.productName} will ever
                  phone you to ask for it.
                </p>
                <input
                  ref={codeField}
                  id="sign-in-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-describedby="sign-in-code-hint"
                  className="w-full max-w-xs min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 text-lead tracking-widest"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
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

          <Link to="/sign-up" className="control bg-paper/10 text-paper underline">
            New to {storeConfig.productName}? Set up an account
          </Link>
        </>
      )}
    </div>
  );
}
