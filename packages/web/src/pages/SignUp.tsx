import { useState, type FormEvent } from 'react';

import { storeConfig } from '../config';

/**
 * Signing up.
 *
 * Every field has a real `label` joined to a real `input`. Every field says what it is for
 * underneath, joined with `aria-describedby`, because a hint that only appears on hover or
 * only in a placeholder is a hint that a screen reader user never gets.
 *
 * Errors are listed at the top, in text, and each one is a link to the field it is about.
 * Nothing is marked wrong with a red border alone.
 */
export function SignUp(): JSX.Element {
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('displayName') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();

    const found: Array<{ field: string; message: string }> = [];
    if (name === '') found.push({ field: 'displayName', message: 'Please tell us your name.' });
    if (phone === '') found.push({ field: 'phone', message: 'Please give us a phone number.' });

    setErrors(found);
    setSubmitted(found.length === 0);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Set up your account</h1>
      <p className="m-0 max-w-xl">
        There is no password. We send you a short code when you want to sign in, and you can
        ask us to read it out.
      </p>

      {errors.length > 0 && (
        <div role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl">
          <h2 className="text-lead font-bold m-0">
            There {errors.length === 1 ? 'is 1 problem' : `are ${errors.length} problems`} to fix
          </h2>
          <ul className="m-0 mt-2 ps-6">
            {errors.map((error) => (
              <li key={error.field}>
                <a href={`#${error.field}`} className="underline">
                  {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitted && (
        <p role="status" className="border-2 border-paper p-4 rounded-xl m-0">
          Thank you. Signing up is not switched on yet, so nothing has been saved and nothing
          has been charged. This is the shape of the screen, not the finished thing.
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-6 max-w-xl">
        <Field
          id="displayName"
          label="Your name"
          hint="What would you like us to call you? A first name is plenty."
          autoComplete="name"
        />
        <Field
          id="phone"
          label="Your phone number"
          hint="We send your sign in code here. We never pass it to anybody else."
          type="tel"
          autoComplete="tel"
        />
        <Field
          id="doorstepProtocol"
          label="What should your Runner do at the door?"
          hint="For example: knock loudly and wait, I am slow to the door."
          multiline
        />

        <fieldset className="border-2 border-paper/40 rounded-xl p-4 m-0">
          <legend className="px-2 font-bold">If something is not on the shelf</legend>
          <Radio
            name="substitutionDefault"
            value="ask_me"
            label="Ask me first"
            defaultChecked
          />
          <Radio name="substitutionDefault" value="similar_item" label="Bring something similar" />
          <Radio name="substitutionDefault" value="no_substitutes" label="Leave it out" />
        </fieldset>

        <button type="submit" className="control w-full bg-highlight text-ink text-lead">
          Create my account
        </button>
      </form>

      <p className="m-0 text-paper/80 max-w-xl">
        {storeConfig.productName} will never take a payment without asking you first, and will
        never store your card number.
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
        <textarea {...shared} rows={3} />
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
