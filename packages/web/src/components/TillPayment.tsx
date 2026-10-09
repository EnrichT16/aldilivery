import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  chooseTillPayMethod,
  fetchRunnerCard,
  setUpRunnerCard,
  showCardDetails,
  type RunnerCardView,
} from '../lib/runner-card';
import { prepareCardEntry } from '../lib/stripe';

/**
 * "How you pay at the till" (Anthony, 9 October 2026): the spending card first and recommended,
 * so no Runner needs their own money to do a job; their own card, paid back straight away
 * (ruling 55), second. While the card is switched off on the server, only their own card is
 * offered, with a line saying the card is coming soon.
 *
 * Setting up the card: the cardholder terms accepted (kept with the date and internet address,
 * as Stripe requires), the billing address given to Stripe, then the card shown in Stripe's own
 * frames, never ours, with a guide to adding it to Apple Pay or Google Pay by hand.
 */
export function TillPayment({ onNews }: { onNews: (news: string) => void }): JSX.Element | null {
  const [view, setView] = useState<RunnerCardView | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  const load = useCallback(() => {
    fetchRunnerCard()
      .then(setView)
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  if (!view) return null;

  async function run(action: () => Promise<RunnerCardView & { message: string }>): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await action();
      setView(result);
      onNews(result.message);
      setSettingUp(false);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const name = view.cardName;
  const ownWords = 'My own card, paid back straight away';

  return (
    <section aria-labelledby="till-pay-heading" className="space-y-3 max-w-xl">
      <h2 id="till-pay-heading" className="text-lead font-bold">
        How you pay at the till
      </h2>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}

      {!view.enabled ? (
        <>
          <p className="m-0">{ownWords}.</p>
          <p className="m-0 extra">
            Pay at the till with your own card. When you put in the till total, we pay it back to
            your account straight away.
          </p>
          <p className="m-0">The {name} is coming soon.</p>
        </>
      ) : (
        <>
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="font-bold">Choose one</legend>
            <div className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                id="till-pay-card"
                name="till-pay"
                checked={view.payMethod === 'card'}
                disabled={busy}
                aria-describedby="till-pay-card-hint"
                onChange={() => {
                  if (view.card) void run(() => chooseTillPayMethod('card'));
                  else setSettingUp(true);
                }}
              />
              <label htmlFor="till-pay-card">{name} (recommended)</label>
            </div>
            <p id="till-pay-card-hint" className="m-0 extra">
              A card in your phone, paid for by us and loaded for each order. None of your own money
              is needed.
            </p>
            <div className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                id="till-pay-own"
                name="till-pay"
                checked={view.payMethod === 'own'}
                disabled={busy}
                onChange={() => {
                  setSettingUp(false);
                  void run(() => chooseTillPayMethod('own'));
                }}
              />
              <label htmlFor="till-pay-own">{ownWords}</label>
            </div>
          </fieldset>

          {!view.card && !settingUp && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setSettingUp(true)}
              className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
            >
              Set up my {name}
            </button>
          )}

          {!view.card && settingUp && (
            <CardSetup
              name={name}
              busy={busy}
              onCancel={() => setSettingUp(false)}
              onSubmit={(address) => {
                void run(() => setUpRunnerCard(address));
              }}
            />
          )}

          {view.card && (
            <>
              <p className="m-0">
                Your {name} ends {view.card.last4}.{' '}
                {view.card.status === 'active'
                  ? 'It is loaded for the order you are doing.'
                  : 'It is frozen until you take a job.'}
              </p>
              <ShowCard cardId={view.card.id} name={name} />
              <WalletGuide name={name} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function CardSetup({
  name,
  busy,
  onSubmit,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onSubmit: (address: { line1: string; line2?: string; city: string; postcode: string }) => void;
  onCancel: () => void;
}): JSX.Element {
  const [error, setError] = useState('');
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string): string => String(data.get(key) ?? '').trim();
    if (data.get('card-terms') !== 'yes') {
      setError('Please tick to say you accept the cardholder terms.');
      return;
    }
    if (!value('card-line1') || !value('card-city') || !value('card-postcode')) {
      setError('Please give your address and postcode. Stripe needs them for the card.');
      return;
    }
    setError('');
    const line2 = value('card-line2');
    onSubmit({
      line1: value('card-line1'),
      ...(line2 ? { line2 } : {}),
      city: value('card-city'),
      postcode: value('card-postcode'),
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="card-setup-heading"
      className="space-y-3 border-2 border-highlight rounded-xl p-4"
    >
      <h3 id="card-setup-heading" className="text-lead font-bold m-0">
        Set up your {name}
      </h3>
      <p className="m-0">
        The card is made by our payment company, Stripe. It belongs to the business and is only for
        the shopping on your orders. It stays frozen between jobs.
      </p>
      {error !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-3 rounded-xl">
          {error}
        </p>
      )}
      <label htmlFor="card-line1" className="block font-bold">
        Your address, first line
      </label>
      <input id="card-line1" name="card-line1" autoComplete="address-line1" className={field} />
      <label htmlFor="card-line2" className="block font-bold">
        Second line (if you have one)
      </label>
      <input id="card-line2" name="card-line2" autoComplete="address-line2" className={field} />
      <label htmlFor="card-city" className="block font-bold">
        Town or city
      </label>
      <input id="card-city" name="card-city" autoComplete="address-level2" className={field} />
      <label htmlFor="card-postcode" className="block font-bold">
        Postcode
      </label>
      <input
        id="card-postcode"
        name="card-postcode"
        autoComplete="postal-code"
        className={`${field} max-w-xs`}
      />
      <p className="m-0 extra">Your address goes to Stripe for the card. We do not keep it.</p>
      <div className="flex items-start gap-3 min-h-control">
        <input
          type="checkbox"
          id="card-terms"
          name="card-terms"
          value="yes"
          aria-describedby="card-terms-hint"
        />
        <label htmlFor="card-terms">
          I accept the cardholder terms of Stripe and the bank that issues the card
        </label>
      </div>
      <p id="card-terms-hint" className="m-0 extra">
        You use the card only for the shopping on orders you have taken. We record when you accepted
        and from which internet address, as Stripe asks.{' '}
        <a href="https://stripe.com/legal" target="_blank" rel="noreferrer" className="underline">
          Stripe&rsquo;s legal terms (opens in a new tab)
        </a>
      </p>
      <button
        type="submit"
        disabled={busy}
        className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
      >
        {busy ? 'Making your card…' : 'Accept and make my card'}
      </button>
      <button type="button" onClick={onCancel} className="control bg-paper/10 text-paper underline">
        Not now
      </button>
    </form>
  );
}

/** The card's details, shown only when asked for, in Stripe's own frames (Issuing Elements). */
function ShowCard({ cardId, name }: { cardId: string; name: string }): JSX.Element {
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState('');
  const number = useRef<HTMLDivElement>(null);
  const expiry = useRef<HTMLDivElement>(null);
  const cvc = useRef<HTMLDivElement>(null);
  const hide = useRef<(() => void) | null>(null);

  useEffect(() => () => hide.current?.(), []);

  async function show(): Promise<void> {
    setProblem('');
    try {
      const setup = await prepareCardEntry();
      if (!setup.ready) {
        setProblem('The card cannot be shown on this device just now. Please try again later.');
        return;
      }
      if (!number.current || !expiry.current || !cvc.current) return;
      hide.current = await showCardDetails(setup.stripe, cardId, {
        number: number.current,
        expiry: expiry.current,
        cvc: cvc.current,
      });
      setShown(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'The card could not be shown.');
    }
  }

  return (
    <div className="space-y-2">
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-3 rounded-xl">
          {problem}
        </p>
      )}
      <div hidden={!shown} className="space-y-2 bg-paper text-ink rounded-xl p-4">
        <p className="m-0 font-bold">Card number</p>
        <div ref={number} aria-label={`${name} number`} role="group" />
        <p className="m-0 font-bold">Expiry date</p>
        <div ref={expiry} aria-label={`${name} expiry date`} role="group" />
        <p className="m-0 font-bold">Security code</p>
        <div ref={cvc} aria-label={`${name} security code`} role="group" />
      </div>
      <button
        type="button"
        onClick={() => {
          if (shown) {
            hide.current?.();
            hide.current = null;
            setShown(false);
          } else {
            void show();
          }
        }}
        className="control bg-paper/10 text-paper underline"
      >
        {shown ? 'Hide my card details' : 'Show my card details'}
      </button>
      <p className="m-0 extra">
        The details are shown by Stripe. They never pass through us. Only show them somewhere
        private.
      </p>
    </div>
  );
}

/** Adding the card to the phone's wallet, by hand, until the store apps can do it in one tap. */
function WalletGuide({ name }: { name: string }): JSX.Element {
  return (
    <details>
      <summary className="control px-0 text-paper underline">
        Add it to Apple Pay or Google Pay
      </summary>
      <div className="space-y-2">
        <h3 className="font-bold m-0">On an iPhone (Apple Pay)</h3>
        <ol className="m-0 ps-6 space-y-1">
          <li>Press Show my card details above.</li>
          <li>Open the Wallet app and press the plus button.</li>
          <li>Choose Debit or Credit Card, then Enter Card Details Manually.</li>
          <li>Type in the number, expiry date and security code shown above.</li>
          <li>If you are asked to confirm, choose a text message to your phone.</li>
        </ol>
        <h3 className="font-bold m-0">On an Android phone (Google Pay)</h3>
        <ol className="m-0 ps-6 space-y-1">
          <li>Press Show my card details above.</li>
          <li>Open Google Wallet and press Add to Wallet, then Payment card.</li>
          <li>Choose to enter the details yourself, and type them in.</li>
          <li>If you are asked to confirm, choose a text message to your phone.</li>
        </ol>
        <p className="m-0">
          At the till, hold your phone near the card reader and choose your {name}, not your own
          card.
        </p>
        <p className="m-0 extra">
          A button that adds the card to your wallet in one tap comes with our apps in the App Store
          and Google Play.
        </p>
      </div>
    </details>
  );
}
