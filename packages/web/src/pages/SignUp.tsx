import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  fetchSignInOptions,
  isUkMobileNumber,
  registerShopper,
  requestSignInCode,
  verifySignInCode,
  type RegisterShopperInput,
  type SignInOptions,
} from '../lib/api';
import { Field } from '../components/FormFields';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';
import {
  useVoiceSignUp,
  yesOrNo,
  type NumberConfirmation,
  type SpokenDetails,
} from '../state/voice-sign-up';

/**
 * Signing up, for real.
 *
 * Every field has a real `label` joined to a real `input`. Every field says what it is for
 * underneath, joined with `aria-describedby`, because a hint that only appears on hover or
 * only in a placeholder is a hint that a screen reader user never gets.
 *
 * Errors are listed at the top, in text, and each one is a link to the field it is about.
 * Nothing is marked wrong with a red border alone. The summary takes focus when it appears,
 * so somebody who pressed the button and cannot see the screen is told what happened rather
 * than left wondering whether anything did.
 *
 * Whatever the server refuses — an account already on that phone number, a name somebody
 * else has — arrives here as a sentence and is shown in the same list as the checks done in
 * the browser. A refusal is a refusal, and it should not look different depending on which
 * side of the wire noticed.
 *
 * Or by talking (Anthony, 4 October 2026): Ozi offers, on arrival, to set the account up by
 * voice, and "create my account" said anywhere comes here and starts at once. Ozi fills in this
 * same form as it goes (state/voice-sign-up.ts).
 *
 * Once codes really go out, the number is confirmed with one before the account is opened
 * (ruling 33): a text to a mobile, or a phone call that says the code to a landline.
 */
export function SignUp(): JSX.Element {
  const navigate = useNavigate();
  const { shopper, signedUp } = useSession();
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const ozi = useOzi();
  const [params, setParams] = useSearchParams();
  const assistant = storeConfig.assistantName;
  const [codes, setCodes] = useState<SignInOptions | null>(null);
  // The proof from the code, and the details waiting for it, when confirming on the form.
  const proof = useRef<{ phone: string; token: string } | null>(null);
  const [waiting, setWaiting] = useState<{
    details: RegisterShopperInput;
    message: string;
    channel: 'text' | 'call';
  } | null>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSignInOptions()
      .then((options) => {
        if (!cancelled) setCodes(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (waiting) codeField.current?.focus();
  }, [waiting]);

  const sendCode = useCallback(
    async (phone: string): Promise<{ channel: 'text' | 'call'; message: string }> => {
      const channel = isUkMobileNumber(phone) ? 'text' : 'call';
      if (channel === 'call' && !codes?.byCall) {
        throw new Error('We can only check a mobile number for now. Please give a mobile number.');
      }
      const result = await requestSignInCode(phone, { channel, purpose: 'sign-up' });
      return { channel, message: result.message };
    },
    [codes],
  );

  const checkCode = useCallback(async (phone: string, code: string): Promise<true | string> => {
    try {
      const result = await verifySignInCode(phone, code);
      if (!result.registrationRequired) {
        return 'There is already an account on that number. You can sign in instead.';
      }
      if (!result.phoneProof) return 'That code could not be checked. Please try again.';
      proof.current = { phone, token: result.phoneProof };
      return true;
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'That code did not work.';
    }
  }, []);

  const withProof = (details: RegisterShopperInput): RegisterShopperInput =>
    proof.current && proof.current.phone === details.phone
      ? { ...details, phoneProof: proof.current.token }
      : details;

  const create = useCallback(
    async (details: SpokenDetails) => {
      try {
        const result = await registerShopper(withProof(details));
        signedUp(result.token, result.shopper);
        // The card page says this first, so the two are one message and neither cuts the other off.
        navigate('/card', { state: { welcome: result.shopper.displayName } });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'We could not set up your account.';
        setErrors([{ field: 'displayName', message }]);
        void ozi.say(
          `I'm sorry, the account wasn't created. ${message} What I heard is in the form on the screen.`,
        );
      }
    },
    [navigate, ozi, signedUp],
  );

  const confirmNumber: NumberConfirmation | undefined = codes?.confirmAtSignUp
    ? {
        send: async (phone) => (await sendCode(phone)).channel,
        check: checkCode,
      }
    : undefined;

  const talking = useVoiceSignUp({
    fill: (field, value) => {
      const input = document.getElementById(field) as HTMLInputElement | HTMLTextAreaElement | null;
      if (input) input.value = value;
    },
    finish: create,
    confirmNumber,
  });
  const canTalk = ozi.presence === 'listening' || ozi.presence === 'muted';

  // "Create my account" said anywhere lands here with ?talk=1: start straight away. Otherwise,
  // offer once a visit, as soon as Ozi can listen.
  const offered = useRef(false);
  const live = useRef({ talking, ozi, shopper });
  live.current = { talking, ozi, shopper };
  const wantsTalk = params.get('talk') === '1';

  useEffect(() => {
    const { talking: t, ozi: o, shopper: s } = live.current;
    if (s || !canTalk) return;
    if (wantsTalk) {
      offered.current = true;
      setParams({}, { replace: true });
      t.start();
      return;
    }
    // Turned off with the switch: no offer out loud. The button is still there.
    if (offered.current || !o.voiceOn) return;
    offered.current = true;
    try {
      if (window.sessionStorage.getItem('ozidelivery.signup.offered') === 'yes') return;
      window.sessionStorage.setItem('ozidelivery.signup.offered', 'yes');
    } catch {
      return;
    }
    o.listenFor(
      'Would you like to create your account by talking to me? Say yes. Or fill in the form on the screen.',
      (text) => {
        if (yesOrNo(text) === 'yes') live.current.talking.start();
        else void live.current.ozi.say('All right. The form is on the screen.');
      },
    );
  }, [canTalk, wantsTalk, setParams]);

  useEffect(() => {
    if (errors.length > 0) summary.current?.focus();
  }, [errors]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const displayName = String(data.get('displayName') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();
    const deliveryAddress = String(data.get('deliveryAddress') ?? '').trim();
    const doorstepProtocol = String(data.get('doorstepProtocol') ?? '').trim();

    const found: Array<{ field: string; message: string }> = [];
    if (displayName === '')
      found.push({ field: 'displayName', message: 'Please tell us your name.' });
    if (phone === '') found.push({ field: 'phone', message: 'Please give us a phone number.' });
    if (deliveryAddress === '') {
      found.push({
        field: 'deliveryAddress',
        message: 'Please tell us where your shopping should go.',
      });
    }

    if (found.length > 0) {
      setErrors(found);
      return;
    }

    setErrors([]);
    const details = { displayName, phone, deliveryAddress, doorstepProtocol };
    if (codes?.confirmAtSignUp && proof.current?.phone !== phone) {
      setSaving(true);
      try {
        const sent = await sendCode(phone);
        setWaiting({ details, ...sent });
      } catch (error) {
        setErrors([
          {
            field: 'phone',
            message: error instanceof Error ? error.message : 'We could not send a code.',
          },
        ]);
      } finally {
        setSaving(false);
      }
      return;
    }
    await register(details);
  }

  async function register(details: RegisterShopperInput): Promise<void> {
    setSaving(true);
    try {
      const result = await registerShopper(withProof(details));
      signedUp(result.token, result.shopper);
      // Straight on to the card, because that is the next thing standing between them and
      // being able to order. They can leave it and come back; nothing is charged there.
      navigate('/card');
    } catch (error) {
      setErrors([
        {
          field: 'displayName',
          message: error instanceof Error ? error.message : 'We could not set up your account.',
        },
      ]);
    } finally {
      setSaving(false);
    }
  }

  if (shopper) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">You are already set up</h1>
        <p className="m-0 max-w-xl">
          You are signed in as {shopper.displayName}. Your shopping goes to{' '}
          {shopper.deliveryAddress === '' ? 'nowhere yet' : shopper.deliveryAddress}.
        </p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Set up your account</h1>
      <p className="m-0 max-w-xl">
        There is no password. Setting up an account signs you in on this device and keeps you signed
        in.
      </p>

      {canTalk && (
        <button
          type="button"
          disabled={talking.active}
          onClick={talking.start}
          className="control w-full max-w-xl bg-[var(--colour-listening)] text-ink text-lead font-bold border-4 border-ink disabled:opacity-70"
        >
          {talking.active
            ? `${assistant} is setting up your account with you`
            : `Create my account by talking to ${assistant}`}
        </button>
      )}

      <Link to="/sign-in" className="control bg-paper/10 text-paper underline">
        Already set up on another phone or computer? Sign in
      </Link>

      {waiting && (
        <form
          aria-labelledby="confirm-heading"
          className="space-y-3 max-w-xl border-2 border-highlight rounded-xl p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(
              /\s/g,
              '',
            );
            void checkCode(waiting.details.phone, code).then((result) => {
              if (result === true) {
                const details = waiting.details;
                setWaiting(null);
                void register(details);
              } else {
                setErrors([{ field: 'confirm-code', message: result }]);
              }
            });
          }}
        >
          <h2 id="confirm-heading" className="text-lead font-bold m-0">
            Check it is your number
          </h2>
          <p role="status" className="m-0">
            {waiting.message}
          </p>
          <label htmlFor="confirm-code" className="block font-bold">
            {waiting.channel === 'call' ? 'The code the voice read out' : 'The code from the text'}
          </label>
          <input
            ref={codeField}
            id="confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full max-w-xs min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 text-lead tracking-widest"
          />
          <button type="submit" className="control w-full bg-highlight text-ink text-lead">
            Confirm and create my account
          </button>
          <button
            type="button"
            onClick={() => {
              void sendCode(waiting.details.phone).then((sent) =>
                setWaiting({ ...waiting, ...sent }),
              );
            }}
            className="control bg-paper/10 text-paper underline"
          >
            Send the code again
          </button>
        </form>
      )}

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
          id="displayName"
          label="Your name"
          hint="What would you like us to call you? A first name is plenty."
          autoComplete="name"
        />
        <Field
          id="phone"
          label="Your phone number"
          hint="This is how your Runner reaches you on the day. We never pass it to anybody else."
          type="tel"
          autoComplete="tel"
        />
        <Field
          id="deliveryAddress"
          label="Where should we bring your shopping?"
          hint="The full address, including the door number and the postcode. You only type this once, and we show it back to you before every order."
          autoComplete="street-address"
          multiline
        />
        <Field
          id="doorstepProtocol"
          label="What should your Runner do at the door?"
          hint="For example: knock loudly and wait, I am slow to the door. You can leave this empty. If you tell us about your health or a disability here, we use it only to help you at the door, and your Runner sees it."
          multiline
        />

        <button
          type="submit"
          disabled={saving}
          className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
        >
          {saving ? 'Setting up your account…' : 'Create my account'}
        </button>
      </form>

      <p className="m-0 text-paper/80 max-w-xl">
        {storeConfig.productName} will never take a payment without asking you first, and will never
        store your card number.
      </p>
    </div>
  );
}
