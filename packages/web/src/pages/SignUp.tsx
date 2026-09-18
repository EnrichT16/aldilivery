import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import { registerShopper, type SubstitutionChoice } from '../lib/api';
import { useSession } from '../state/session';

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
 */
export function SignUp(): JSX.Element {
  const navigate = useNavigate();
  const { shopper, signedUp } = useSession();
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

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
    const substitutionDefault = String(
      data.get('substitutionDefault') ?? 'ask_me',
    ) as SubstitutionChoice;

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
    setSaving(true);
    try {
      const result = await registerShopper({
        displayName,
        phone,
        deliveryAddress,
        doorstepProtocol,
        substitutionDefault,
      });
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
          hint="For example: knock loudly and wait, I am slow to the door. You can leave this empty."
          multiline
        />

        <fieldset className="border-2 border-paper/40 rounded-xl p-4 m-0">
          <legend className="px-2 font-bold">If something is not on the shelf</legend>
          <Radio name="substitutionDefault" value="ask_me" label="Ask me first" defaultChecked />
          <Radio name="substitutionDefault" value="similar_item" label="Bring something similar" />
          <Radio name="substitutionDefault" value="no_substitutes" label="Leave it out" />
        </fieldset>

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

function Field({
  id,
  label,
  hint,
  type = 'text',
  autoComplete,
  multiline = false,
}: {
  id: string;
  label: string;
  hint: string;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
}): JSX.Element {
  const hintId = `${id}-hint`;
  const shared = {
    id,
    name: id,
    'aria-describedby': hintId,
    className: 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3',
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-lead font-bold">
        {label}
      </label>
      <p id={hintId} className="m-0 text-paper/90">
        {hint}
      </p>
      {multiline ? (
        <textarea {...shared} rows={3} autoComplete={autoComplete} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
    </div>
  );
}

function Radio({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}): JSX.Element {
  const id = `${name}-${value}`;
  return (
    <div className="flex items-center gap-3 min-h-control">
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-6 w-6"
      />
      <label htmlFor={id} className="m-0">
        {label}
      </label>
    </div>
  );
}
