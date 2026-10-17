import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Field, Radio } from '../components/FormFields';
import { storeConfig } from '../config';
import {
  fetchPartnerJoinOptions,
  fetchShop,
  isUkMobileNumber,
  joinAsPartner,
  rememberBusinessToken,
  requestSignInCode,
  verifySignInCode,
  type PartnerJoinInput,
  type PartnerJoinOptions,
  type PartnerKind,
} from '../lib/api';
import { money } from '../lib/money';
import { inPairs } from '../lib/phone-aloud';
import { useOzi } from '../state/ozi';

const KIND_WORDS: Record<PartnerKind, string> = {
  shop: 'A shop',
  food: 'A café or takeaway',
  service: 'A service (hairdresser, cleaner, dog walker, handyman, tutor and the like)',
};

/** What was said, as one of the three kinds, or null. */
export function heardKind(said: string): PartnerKind | null {
  const text = said.toLowerCase().replace(/[éè]/g, 'e');
  if (/\b(cafe|takeaway|take away|restaurant|food|coffee|bakery)\b/.test(text)) return 'food';
  if (
    /\b(service|hairdresser|barber|cleaner|cleaning|dog walker|handyman|tutor|plumber|electrician|gardener|salon)\b/.test(
      text,
    )
  ) {
    return 'service';
  }
  if (/\b(shop|store|grocer|newsagent|market|butcher|pharmacy)\b/.test(text)) return 'shop';
  return null;
}

/** The order Ozi asks the join form's questions in, each filling one field (ruling 65). */
export const JOIN_QUESTIONS: Array<{ field: string; ask: string }> = [
  { field: 'join-name', ask: 'What is the name of your business, as it is on the front?' },
  { field: 'join-kind', ask: 'Is it a shop, a café or takeaway, or a service?' },
  { field: 'join-address', ask: 'What is the address? The street and the town is plenty.' },
  { field: 'join-postcode', ask: 'And the postcode?' },
  { field: 'join-hours', ask: 'When are you open? For example, Monday to Saturday, nine to five.' },
  { field: 'join-contact', ask: 'Who should we speak to? Your name is fine.' },
  { field: 'join-mobile', ask: 'What is your mobile number? I will text a code to it.' },
  { field: 'join-about', ask: 'In a sentence, what do you sell or do? Or say skip.' },
];

/**
 * Joining as a shop, café, takeaway or service (ruling 65): from the "Shop Partner" door and
 * from the business sign-in. The mobile is confirmed with a code, like a Shopper's number. Ozi
 * offers to fill the form by voice, as it does for a Shopper's account, and the email and the
 * password are typed, because a password is never said out loud. The account works at once; the
 * page goes public once a person has checked it. An owner claiming a shop Ozi listed arrives
 * with its details already filled in.
 */
export function PartnerJoin(): JSX.Element {
  const navigate = useNavigate();
  const ozi = useOzi();
  const [params] = useSearchParams();
  const claimId = params.get('claim') ?? '';
  const [options, setOptions] = useState<PartnerJoinOptions | null>(null);
  const [kind, setKind] = useState<PartnerKind>('shop');
  const [plan, setPlan] = useState<'free' | 'plus'>('free');
  const [claimedName, setClaimedName] = useState('');
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [talking, setTalking] = useState(false);
  const [waiting, setWaiting] = useState<{ details: PartnerJoinInput; message: string } | null>(
    null,
  );
  const summary = useRef<HTMLDivElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const live = useRef({ ozi, navigate });
  live.current = { ozi, navigate };
  const assistant = storeConfig.assistantName;

  useEffect(() => {
    fetchPartnerJoinOptions()
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  // Claiming a shop Ozi listed: its name, address, hours and words are filled in already.
  useEffect(() => {
    if (!claimId) return;
    fetchShop(claimId)
      .then((page) => {
        if (!page.shop.claimable) return;
        setClaimedName(page.shop.name);
        setKind(page.shop.kind);
        const fill = (id: string, value: string): void => {
          const input = document.getElementById(id) as HTMLInputElement | null;
          if (input && input.value === '') input.value = value;
        };
        fill('join-name', page.shop.name);
        fill('join-address', page.shop.address);
        fill('join-hours', page.shop.hours);
        fill('join-about', page.shop.about);
      })
      .catch(() => undefined);
  }, [claimId]);

  useEffect(() => {
    if (errors.length > 0) summary.current?.focus();
  }, [errors]);
  useEffect(() => {
    if (waiting) codeField.current?.focus();
  }, [waiting]);

  const field = (id: string): string =>
    String(
      (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '',
    ).trim();

  const gather = (): PartnerJoinInput => ({
    name: field('join-name'),
    kind,
    address: field('join-address'),
    postcode: field('join-postcode'),
    hours: field('join-hours'),
    contactName: field('join-contact'),
    mobile: field('join-mobile'),
    email: field('join-email'),
    about: field('join-about'),
    username: field('join-username').toLowerCase(),
    password: field('join-password'),
    ...(claimId ? { claimShopId: claimId } : {}),
    ...(kind === 'shop' ? { plan } : {}),
  });

  const check = (details: PartnerJoinInput): Array<{ field: string; message: string }> => {
    const found: Array<{ field: string; message: string }> = [];
    if (details.name === '') found.push({ field: 'join-name', message: 'Please give the name.' });
    if (details.address === '')
      found.push({ field: 'join-address', message: 'Please give the address.' });
    if (details.postcode === '')
      found.push({ field: 'join-postcode', message: 'Please give the postcode.' });
    if (details.hours === '')
      found.push({ field: 'join-hours', message: 'Please say when you are open.' });
    if (details.contactName === '')
      found.push({ field: 'join-contact', message: 'Please say who we should speak to.' });
    if (!isUkMobileNumber(details.mobile))
      found.push({ field: 'join-mobile', message: 'Please give a UK mobile number, starting 07.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email))
      found.push({ field: 'join-email', message: 'Please give an email address.' });
    if (!/^[a-z][a-z0-9.]{2,29}$/.test(details.username))
      found.push({
        field: 'join-username',
        message: 'A username is 3 to 30 letters, numbers or dots, starting with a letter.',
      });
    if (details.password.length < 10)
      found.push({ field: 'join-password', message: 'A password is at least 10 characters.' });
    return found;
  };

  const finish = useCallback(async (details: PartnerJoinInput): Promise<void> => {
    setBusy(true);
    try {
      const result = await joinAsPartner(details);
      rememberBusinessToken(result.token);
      void live.current.ozi.say(result.message);
      live.current.navigate('/partner', { state: { welcome: result.message } });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setErrors([{ field: 'join-name', message }]);
      void live.current.ozi.say(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const details = gather();
    const found = check(details);
    if (found.length > 0) {
      setErrors(found);
      return;
    }
    setErrors([]);
    if (options?.mobileConfirmed) {
      setBusy(true);
      try {
        const sent = await requestSignInCode(details.mobile, {
          purpose: 'sign-up',
          role: 'partner',
        });
        setWaiting({ details, message: sent.message });
        void ozi.say(`${sent.message} Type the code from the text.`);
      } catch (failure) {
        setErrors([
          {
            field: 'join-mobile',
            message: failure instanceof Error ? failure.message : 'We could not send a code.',
          },
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }
    await finish(details);
  };

  const confirmCode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!waiting) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').replace(/\s/g, '');
    try {
      const result = await verifySignInCode(waiting.details.mobile, code, 'partner');
      if (!result.registrationRequired || !result.phoneProof) {
        setErrors([{ field: 'join-code', message: 'That code could not be checked. Try again.' }]);
        return;
      }
      const details = { ...waiting.details, phoneProof: result.phoneProof };
      setWaiting(null);
      await finish(details);
    } catch (failure) {
      setErrors([
        {
          field: 'join-code',
          message: failure instanceof Error ? failure.message : 'That code did not work.',
        },
      ]);
    }
  };

  /** Ozi asks each question in turn and fills the form as it goes, as it does for a Shopper. */
  const talk = (): void => {
    setTalking(true);
    const ask = (index: number): void => {
      const question = JOIN_QUESTIONS[index];
      if (!question) {
        setTalking(false);
        void live.current.ozi.say(
          'I have filled in the form. Type your email address, choose a username and a password on the screen, then press Join. For your privacy, I never ask for a password out loud.',
        );
        document.getElementById('join-email')?.focus();
        return;
      }
      live.current.ozi.listenFor(question.ask, (heard) => {
        const answer = heard.trim();
        if (question.field === 'join-kind') {
          const chosen = heardKind(answer);
          if (!chosen) return ask(index);
          setKind(chosen);
          return ask(index + 1);
        }
        if (question.field === 'join-about' && /^(skip|no|nothing|none)\b/i.test(answer)) {
          return ask(index + 1);
        }
        const input = document.getElementById(question.field) as
          HTMLInputElement | HTMLTextAreaElement | null;
        if (input) {
          input.value = question.field === 'join-mobile' ? answer.replace(/[^\d+]/g, '') : answer;
        }
        if (question.field === 'join-mobile') {
          live.current.ozi.listenFor(
            `I heard ${inPairs(answer.replace(/[^\d]/g, ''))}. Is that right?`,
            (yes) => (/\b(yes|yeah|right|correct)\b/i.test(yes) ? ask(index + 1) : ask(index)),
          );
          return;
        }
        ask(index + 1);
      });
    };
    ask(0);
  };

  const canTalk = ozi.presence === 'listening' || ozi.presence === 'muted';
  const input = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-display font-bold m-0">
        {claimedName ? `Claim ${claimedName}` : 'Join as a shop'}
      </h1>
      <p className="m-0">
        For shops, cafés, takeaways and services in the area. Fill this in, confirm your mobile with
        a code, and you can add your {kind === 'service' ? 'services' : 'products'} straight away.
        Your page goes public once we have checked it, usually within one working day.
      </p>
      {claimedName !== '' && (
        <p role="status" className="m-0 border-2 border-highlight rounded-2xl p-4">
          {assistant} listed {claimedName} from public details. Claiming it gives you its page to
          run yourself; we check the claim before it goes live again.
        </p>
      )}

      {options && (
        <section aria-labelledby="tiers-heading" className="space-y-2">
          <h2 id="tiers-heading" className="text-lead font-bold m-0">
            What it costs
          </h2>
          <ul className="m-0 ps-6 space-y-1">
            <li>
              <strong>Basic listing, free</strong>
              {options.freeListingsLeft > 0
                ? ` for ever for the next ${options.freeListingsLeft} shops to join`
                : ''}
              : your name, address, hours and up to {options.freeProductLimit} products.
            </li>
            <li>
              <strong>Partner Plus, {money(options.plusMonthlyPence)} a month</strong>
              {options.plusFirstMonthFree ? ', first month free' : ''}: the full catalogue with
              photos, offers, and Shop of the Month. Spotlight ({money(options.spotlightPence)}) and
              Spotlight Plus ({money(options.spotlightPlusPence)}) on top, if you want {assistant}{' '}
              to mention you.
            </li>
            <li>
              <strong>Cafés and takeaways: no monthly fee.</strong> {options.foodCommissionWords} of
              each order placed through {storeConfig.productName}, shown on your dashboard.
            </li>
            <li>
              <strong>Services: free.</strong> Shoppers ask you for a quote or a call back; no
              payment goes through {storeConfig.productName} for services yet. We cannot list{' '}
              {options.excludedServiceKinds.slice(0, 6).join(', ')}, or anything needing an FCA, SRA
              or MHRA licence.
            </li>
          </ul>
        </section>
      )}

      {canTalk && (
        <button
          type="button"
          disabled={talking}
          onClick={talk}
          className="control w-full bg-listening text-on-accent text-lead font-bold border-4 border-on-accent disabled:opacity-70"
        >
          {talking
            ? `${assistant} is filling the form with you`
            : `Join by talking to ${assistant}`}
        </button>
      )}

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
          onSubmit={(event) => void confirmCode(event)}
        >
          <h2 id="code-heading" className="text-lead font-bold m-0">
            Check it is your mobile
          </h2>
          <p role="status" className="m-0">
            {waiting.message}
          </p>
          <label htmlFor="join-code" className="block font-bold">
            The code from the text
          </label>
          <input
            ref={codeField}
            id="join-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${input} max-w-xs text-lead tracking-widest`}
          />
          <button type="submit" className="control w-full bg-highlight text-on-accent text-lead">
            Confirm and join
          </button>
        </form>
      )}

      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
        <Field
          id="join-name"
          label="The business’s name"
          hint="As it is on the front."
          autoComplete="organization"
        />
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend id="join-kind" className="text-lead font-bold">
            What kind of business is it?
          </legend>
          {(Object.keys(KIND_WORDS) as PartnerKind[]).map((option) => (
            <div key={option} className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                id={`join-kind-${option}`}
                name="join-kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="h-6 w-6"
              />
              <label htmlFor={`join-kind-${option}`} className="m-0">
                {KIND_WORDS[option]}
              </label>
            </div>
          ))}
        </fieldset>
        {kind === 'shop' && options && (
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-lead font-bold">Which plan?</legend>
            <div
              onChange={(event) =>
                setPlan((event.target as HTMLInputElement).value as 'free' | 'plus')
              }
            >
              <Radio
                name="join-plan"
                value="free"
                label={`Basic listing, free${options.freeListingsLeft > 0 ? ' for ever' : ' (while listings last)'}`}
                defaultChecked
              />
              <Radio
                name="join-plan"
                value="plus"
                label={`Partner Plus, ${money(options.plusMonthlyPence)} a month${options.plusFirstMonthFree ? ', first month free' : ''}`}
              />
            </div>
          </fieldset>
        )}
        <Field
          id="join-address"
          label="Address"
          hint="The street and the town."
          autoComplete="street-address"
          multiline
        />
        <Field
          id="join-postcode"
          label="Postcode"
          hint="Such as ME7 1ER."
          autoComplete="postal-code"
        />
        <Field
          id="join-hours"
          label="Opening hours"
          hint="In your own words: Monday to Saturday 9am to 5pm, closed Sundays."
          multiline
        />
        <Field
          id="join-contact"
          label="Who should we speak to?"
          hint="The name of the owner or manager."
          autoComplete="name"
        />
        <Field
          id="join-mobile"
          label="Mobile number"
          hint="We text a code to it now, and ring it only about your listing. It is never shown to anyone."
          type="tel"
          autoComplete="tel"
        />
        <Field
          id="join-email"
          label="Email address"
          hint="For your statements and anything in writing."
          type="email"
          autoComplete="email"
        />
        <Field
          id="join-about"
          label={kind === 'service' ? 'What do you do?' : 'What do you sell?'}
          hint="A sentence for your page. Shoppers see it."
          multiline
        />
        <Field
          id="join-username"
          label="Choose a username"
          hint="3 to 30 letters, numbers or dots. You sign in with it."
          autoComplete="username"
        />
        <Field
          id="join-password"
          label="Choose a password"
          hint={`At least 10 characters. Nobody at ${storeConfig.productName} will know it.`}
          type="password"
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={busy}
          className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
        >
          {busy ? 'One moment…' : claimedName ? 'Claim this shop' : 'Join'}
        </button>
      </form>
      <Link to="/business" className="control bg-paper/10 text-paper underline">
        Already joined? Sign in
      </Link>
    </div>
  );
}
