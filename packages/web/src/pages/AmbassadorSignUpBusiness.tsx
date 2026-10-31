import { PARTNER_KIND_WORDS, type PartnerKind } from '@aldilivery/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/FormFields';
import { FreeJoiningNotice } from '../components/FreeJoiningNotice';
import { storeConfig } from '../config';
import {
  fetchSignInOptions,
  requestSignInCode,
  signUpBusinessNow,
  verifySignInCode,
  type SignUpBusinessInput,
} from '../lib/api';
import { ambassadorAs } from '../lib/ambassador';
import { PartnerTerms } from './PartnerTerms';

/**
 * "Sign up this business now" (Anthony, 30 October 2026): an approved Ambassador fills this in
 * with the owner beside them. First the business, the owner and the agreed mark-up and discount,
 * within the caps in the settings. Then the Ambassador hands over the phone: the OWNER reads the
 * Shop Partner terms on this same screen, ticks "I am the owner or manager and I agree", types
 * their name, and chooses the business's own sign-in.
 *
 * It makes the same pending application as /business/join, tied to the Ambassador, with the
 * mark-up and discount kept as proposals for staff to confirm, and a reference for the printed
 * agreement sheet. The owner's phone or email may not be the Ambassador's own: the server refuses.
 */

type Problem = { field: string; message: string };

export function AmbassadorSignUpBusiness(): JSX.Element {
  const [params] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [kind, setKind] = useState<PartnerKind>('food');
  const [ownerAgrees, setOwnerAgrees] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [errors, setErrors] = useState<Problem[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; message: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [waiting, setWaiting] = useState<{ details: SignUpBusinessInput; message: string } | null>(
    null,
  );
  const summary = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLHeadingElement>(null);
  const { maximumMarkupPercent, maximumDiscountPercent, preferredDiscountPercent } =
    storeConfig.restaurants;

  useEffect(() => {
    fetchSignInOptions()
      .then((options) => setConfirm(options.confirmAtSignUp))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (errors.length > 0) summary.current?.focus();
  }, [errors]);
  useEffect(() => {
    if (done) result.current?.focus();
  }, [done]);

  if (!as) {
    return (
      <div className="space-y-4">
        <h1 className="text-display font-bold m-0">Sign up this business now</h1>
        <p className="m-0">Please sign in to use your Ambassador Toolkit.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 ref={result} tabIndex={-1} className="text-display font-bold m-0">
          Signed up and waiting for approval
        </h1>
        <p role="status" className="m-0">
          {done.message}
        </p>
        <p className="m-0 font-bold">
          Next, the owner signs in to their partner dashboard on their own phone or computer and
          types the code we texted to the business. Never type it in for them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/ambassador/print/agreement/${done.reference}?action=print`}
            className="control bg-highlight text-on-accent"
          >
            Print the agreement sheet
          </Link>
          <Link
            to="/ambassador/home?tab=toolkit"
            className="control border-paper bg-paper/10 text-paper"
          >
            Back to the Toolkit
          </Link>
        </div>
      </div>
    );
  }

  const value = (id: string): string =>
    String(
      (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '',
    ).trim();
  const percent = (id: string): number => {
    const typed = value(id);
    return typed === '' ? 0 : Number(typed);
  };

  function gather(): SignUpBusinessInput {
    return {
      name: value('biz-name'),
      kind,
      address: value('biz-address'),
      postcode: value('biz-postcode'),
      hours: value('biz-hours'),
      contactName: value('biz-owner'),
      mobile: value('biz-mobile'),
      email: value('biz-email'),
      username: value('biz-username').toLowerCase(),
      password: value('biz-password'),
      agreedMarkupPercent: percent('biz-markup'),
      agreedDiscountPercent: percent('biz-discount'),
      termsAgreed: true,
      ownerAgrees: true,
      ownerName: value('biz-owner-signs'),
    };
  }

  function check(details: SignUpBusinessInput): Problem[] {
    const found: Problem[] = [];
    if (details.name === '')
      found.push({ field: 'biz-name', message: 'Please give the business’s name.' });
    if (details.address === '')
      found.push({ field: 'biz-address', message: 'Please give the address.' });
    if (details.postcode === '')
      found.push({ field: 'biz-postcode', message: 'Please give the postcode.' });
    if (details.hours === '')
      found.push({ field: 'biz-hours', message: 'Please give the opening hours.' });
    if (details.contactName === '')
      found.push({ field: 'biz-owner', message: 'Please give the owner’s name.' });
    if (details.mobile === '')
      found.push({ field: 'biz-mobile', message: 'Please give the owner’s mobile.' });
    if (details.email === '')
      found.push({ field: 'biz-email', message: 'Please give the owner’s email.' });
    const markup = details.agreedMarkupPercent;
    if (!Number.isInteger(markup) || markup < 0 || markup > maximumMarkupPercent) {
      found.push({
        field: 'biz-markup',
        message: `The mark-up must be a whole number from 0 to ${maximumMarkupPercent}%.`,
      });
    }
    const discount = details.agreedDiscountPercent;
    if (!Number.isInteger(discount) || discount < 0 || discount > maximumDiscountPercent) {
      found.push({
        field: 'biz-discount',
        message: `The discount must be a whole number from 0 to ${maximumDiscountPercent}%.`,
      });
    }
    if (!termsAgreed) {
      found.push({
        field: 'biz-terms',
        message: 'The owner needs to tick to agree to the Shop Partner terms.',
      });
    }
    if (!ownerAgrees) {
      found.push({
        field: 'biz-owner-agrees',
        message: 'The owner needs to tick "I am the owner or manager and I agree".',
      });
    }
    if (details.ownerName === '') {
      found.push({ field: 'biz-owner-signs', message: 'The owner needs to type their name.' });
    }
    if (details.username === '')
      found.push({ field: 'biz-username', message: 'Please choose a username.' });
    if (details.password.length < 10) {
      found.push({
        field: 'biz-password',
        message: 'Please choose a password of at least 10 characters.',
      });
    }
    return found;
  }

  async function send(details: SignUpBusinessInput): Promise<void> {
    if (!as) return;
    setBusy(true);
    try {
      const made = await signUpBusinessNow(as, details);
      setDone({ reference: made.reference, message: made.message });
    } catch (failure) {
      setErrors([
        {
          field: 'biz-name',
          message: failure instanceof Error ? failure.message : 'That did not work.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const details = gather();
    const found = check(details);
    setErrors(found);
    if (found.length > 0) return;
    if (confirm) {
      setBusy(true);
      try {
        const sent = await requestSignInCode(details.mobile, {
          purpose: 'sign-up',
          role: 'partner',
        });
        setWaiting({ details, message: sent.message });
      } catch (failure) {
        setErrors([
          {
            field: 'biz-mobile',
            message: failure instanceof Error ? failure.message : 'We could not send a code.',
          },
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }
    await send(details);
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Sign up this business now</h1>
      {/* The payment warning, before any field, for the owner to read (31 October 2026). */}
      <FreeJoiningNotice />
      <p className="m-0">
        Fill this in with the owner or manager beside you. Then hand them the phone to read the
        terms and agree in their own name.
      </p>

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
        </div>
      )}

      {waiting && (
        <form
          aria-labelledby="code-heading"
          className="space-y-3 border-2 border-highlight rounded-2xl p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(
              /\s/g,
              '',
            );
            void verifySignInCode(waiting.details.mobile, code, 'partner')
              .then((verified) => {
                if (!verified.registrationRequired || !verified.phoneProof) {
                  setErrors([{ field: 'biz-code', message: 'That code did not work.' }]);
                  return;
                }
                const details = { ...waiting.details, phoneProof: verified.phoneProof };
                setWaiting(null);
                void send(details);
              })
              .catch((failure: unknown) =>
                setErrors([
                  {
                    field: 'biz-code',
                    message: failure instanceof Error ? failure.message : 'That code did not work.',
                  },
                ]),
              );
          }}
        >
          <h2 id="code-heading" className="text-lead font-bold m-0">
            Check the owner&rsquo;s mobile
          </h2>
          <p role="status" className="m-0">
            {waiting.message}
          </p>
          <label htmlFor="biz-code" className="block font-bold">
            The code from the text to the owner&rsquo;s mobile
          </label>
          <input
            id="biz-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full max-w-xs min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
          />
          <button type="submit" className="control bg-highlight text-on-accent">
            Confirm and sign up
          </button>
        </form>
      )}

      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8">
        <section aria-labelledby="business-heading" className="space-y-6">
          <h2 id="business-heading" className="text-lead font-bold m-0">
            The business
          </h2>
          <Field
            id="biz-name"
            label="The business’s name"
            hint="As it is on the front."
            autoComplete="organization"
          />
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-lead font-bold">What kind of business is it?</legend>
            {(Object.keys(PARTNER_KIND_WORDS) as PartnerKind[]).map((option) => (
              <div key={option} className="flex items-center gap-3 min-h-control">
                <input
                  type="radio"
                  id={`biz-kind-${option}`}
                  name="biz-kind"
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="h-6 w-6"
                />
                <label htmlFor={`biz-kind-${option}`} className="m-0">
                  {option === 'food' ? 'Restaurant, café or takeaway' : PARTNER_KIND_WORDS[option]}
                </label>
              </div>
            ))}
          </fieldset>
          <Field
            id="biz-address"
            label="Address"
            hint="The street and the town."
            autoComplete="street-address"
            multiline
          />
          <Field
            id="biz-postcode"
            label="Postcode"
            hint="Such as ME7 1ER."
            autoComplete="postal-code"
          />
          <Field
            id="biz-hours"
            label="Opening hours"
            hint="In the owner's words: every day 11am to 10pm."
            multiline
          />
        </section>

        <section aria-labelledby="owner-heading" className="space-y-6">
          <h2 id="owner-heading" className="text-lead font-bold m-0">
            The owner or manager
          </h2>
          <Field
            id="biz-owner"
            label="Their name"
            hint="The person we speak to."
            autoComplete="off"
          />
          <Field
            id="biz-mobile"
            label="Their mobile number"
            hint="The owner's own, never yours. We may text a code to it now."
            type="tel"
            autoComplete="off"
          />
          <Field
            id="biz-email"
            label="Their email address"
            hint="The owner's own, never yours."
            type="email"
            autoComplete="off"
          />
        </section>

        <section aria-labelledby="price-heading" className="space-y-6">
          <h2 id="price-heading" className="text-lead font-bold m-0">
            What you agreed
          </h2>
          <Field
            id="biz-markup"
            label="Agreed mark-up, as a percentage"
            hint={`A whole number from 0 to ${maximumMarkupPercent}. Customers pay this on top of the business's own price; the business is paid its own price.`}
            type="number"
          />
          <Field
            id="biz-discount"
            label="Agreed discount, as a percentage (optional)"
            hint={`A whole number from 0 to ${maximumDiscountPercent}. ${preferredDiscountPercent}% or more makes it a Preferred Partner. Leave it empty for none.`}
            type="number"
          />
          <p className="m-0">Our staff confirm these when they approve the business.</p>
        </section>

        <section
          aria-labelledby="hand-over-heading"
          className="space-y-6 border-4 border-highlight rounded-2xl p-4"
        >
          <h2 id="hand-over-heading" className="text-lead font-bold m-0">
            For the owner: please read and agree
          </h2>
          <p className="m-0">Please hand the phone to the owner or manager now.</p>
          <div className="border-2 border-paper/40 rounded-2xl p-4">
            <PartnerTerms embedded />
          </div>
          <div className="flex items-start gap-3">
            <input
              id="biz-terms"
              type="checkbox"
              checked={termsAgreed}
              onChange={(event) => setTermsAgreed(event.target.checked)}
              className="w-8 h-8 shrink-0"
            />
            <label htmlFor="biz-terms" className="m-0 font-bold">
              I have read the Shop Partner terms
            </label>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="biz-owner-agrees"
              type="checkbox"
              checked={ownerAgrees}
              onChange={(event) => setOwnerAgrees(event.target.checked)}
              className="w-8 h-8 shrink-0"
            />
            <label htmlFor="biz-owner-agrees" className="m-0 font-bold">
              I am the owner or manager and I agree
            </label>
          </div>
          <Field
            id="biz-owner-signs"
            label="Type your name"
            hint="The owner or manager, in your own name."
            autoComplete="name"
          />
          <Field
            id="biz-username"
            label="Choose a username for the business"
            hint="3 to 30 letters, numbers or dots. You sign in with it at the business sign-in."
            autoComplete="off"
          />
          <Field
            id="biz-password"
            label="Choose a password"
            hint={`At least 10 characters. Nobody at ${storeConfig.productName}, and not the Ambassador, will know it.`}
            type="password"
            autoComplete="new-password"
          />
        </section>

        <button
          type="submit"
          disabled={busy}
          className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
        >
          {busy ? 'Signing up…' : 'Agree and sign up the business'}
        </button>
      </form>
    </div>
  );
}
