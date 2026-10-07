import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { moneyIn, moneyOut } from '../lib/alert';

import { NotifyMe } from '../components/NotifyMe';
import { PinGate } from '../components/PinGate';
import { storeConfig } from '../config';
import {
  createOrder,
  fetchBankTransferEnabled,
  fetchAddresses,
  listPaymentMethods,
  saveAddress,
  updateMe,
  type AddressBook,
  type PaymentMethod,
  type PlacedOrder,
} from '../lib/api';
import { money } from '../lib/money';
import { prepareCardEntry } from '../lib/stripe';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/**
 * The confirmation screen. Rule One made visible, and now real.
 *
 * There is exactly one button on this page that could ever lead to a payment, it is the
 * largest thing on the screen, and it says what it does. Everything above it is a plain
 * statement of what will happen and what it will cost. Nothing is pre-ticked, nothing is
 * assumed, and there is no second way to confirm hidden anywhere.
 *
 * The sentence next to the button is not decoration. It is sent to the server as the
 * `statement` on the confirmation and stored on the order, so what the Shopper was told they
 * were agreeing to is on the record next to the charge. The total is sent with it, and the
 * server prices the basket again from its own catalogue and refuses the whole order if the
 * figure has moved. A price that changed while somebody was deciding is a reason to ask
 * again, not a reason to charge a different amount.
 */
export function Confirm(): JSX.Element {
  const { lines, pricing, overMaximum, clear } = useBasket();
  const { shopper, restoring, replaceShopper } = useSession();

  const [cards, setCards] = useState<PaymentMethod[] | null>(null);
  const [placed, setPlaced] = useState<{ order: PlacedOrder; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState('');
  /**
   * Where it can go (docs/BUILD_PROMPT.md, Section D): the home address first, then any saved,
   * then "send to a different address", which asks afterwards whether to save it (with the
   * PIN) or use it this once (no PIN), the way a bank app asks about a payee.
   */
  const [book, setBook] = useState<AddressBook | null>(null);
  const [chosen, setChosen] = useState<string>('home');
  const [oneOff, setOneOff] = useState('');
  const [other, setOther] = useState<'closed' | 'typing' | 'asking' | 'saving'>('closed');
  const [typed, setTyped] = useState('');
  /**
   * The address the Shopper has said is right (docs/BUILD_PROMPT.md, Section D: before every
   * order, of every type, the actual address is put to them and they say yes). Changing the
   * address means saying yes again.
   */
  const [confirmedAddress, setConfirmedAddress] = useState<string | null>(null);
  const addressConfirmed = confirmedAddress !== null && confirmedAddress === address.trim();
  const ozi = useOzi();
  const spokenFor = useRef<string | null>(null);

  const home = book?.home ?? shopper?.deliveryAddress ?? '';
  useEffect(() => {
    if (chosen === 'home') setAddress(home);
    else if (chosen === 'once') setAddress(oneOff);
    else setAddress(book?.saved.find((saved) => saved.id === chosen)?.address ?? home);
  }, [chosen, home, oneOff, book]);

  useEffect(() => {
    if (!shopper) return;
    let cancelled = false;
    fetchAddresses()
      .then((found) => {
        if (!cancelled) setBook(found);
      })
      .catch(() => {
        // Without the list, the home address on the account is still there to send to.
      });
    return () => {
      cancelled = true;
    };
  }, [shopper]);

  // Ozi says the address aloud, once for each address shown, and waits for the yes below.
  const askAboutAddress =
    shopper !== null && lines.length > 0 && !placed && !editingAddress && other === 'closed';
  useEffect(() => {
    const where = address.trim();
    if (!askAboutAddress || where === '' || addressConfirmed || spokenFor.current === where) return;
    spokenFor.current = where;
    void ozi.say(
      `Before you send it: this order will go to ${where}. If that is right, press Yes, this is the right address.`,
    );
  }, [askAboutAddress, address, addressConfirmed, ozi]);

  useEffect(() => {
    if (!shopper) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await listPaymentMethods();
        if (!cancelled) setCards(result.paymentMethods);
      } catch {
        // Treated as "no card we can see" rather than an error of its own. The screen below
        // already has something sensible to say when there is no card.
        if (!cancelled) setCards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopper]);

  // Paying by bank transfer to the business account, when switched on (ruling 50).
  const [bankOn, setBankOn] = useState(false);
  const [payBy, setPayBy] = useState<'card' | 'bank'>('card');
  useEffect(() => {
    let cancelled = false;
    fetchBankTransferEnabled()
      .then((on) => {
        if (!cancelled) setBankOn(on);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const statement = `Send my order. About ${money(pricing.totalPence)} altogether, including our fee of ${money(pricing.feePence)}.`;

  async function onSend(): Promise<void> {
    const card = cards?.find((method) => method.isDefault) ?? cards?.[0];
    const byBank = bankOn && payBy === 'bank';
    if ((!card && !byBank) || sending || address.trim() === '' || overMaximum || !addressConfirmed)
      return;

    setSending(true);
    setError('');
    try {
      const result = await createOrder({
        lines: lines.map((line) => ({
          catalogueItemId: line.item.id,
          quantity: line.quantity,
        })),
        deliveryAddress: address.trim(),
        ...(byBank || !card ? { payBy: 'bank' as const } : { paymentMethodId: card.id }),
        confirmation: { statement, agreedTotalPence: pricing.totalPence, addressConfirmed: true },
      });
      if (result.bank) {
        clear();
        setPlaced({ order: result.order, message: result.message });
        return;
      }

      /**
       * A card in the United Kingdom usually has to be authenticated by the Shopper's bank.
       * When it does, the server leaves the order unpaid and hands back a client secret, and
       * this is where the bank's own screen is opened. Stripe tells us how it went, and the
       * order is settled by the webhook rather than by anything we could claim here.
       */
      if (result.payment?.requiresAction && result.payment.clientSecret) {
        const setup = await prepareCardEntry();
        if (setup.ready) {
          const outcome = await setup.stripe.handleNextAction({
            clientSecret: result.payment.clientSecret,
          });
          if (outcome.error) {
            setError(
              outcome.error.message ??
                'Your bank did not approve the payment. Nothing has been taken, and your order has not been sent.',
            );
            return;
          }
        }
      }

      clear();
      // A till's "ka-ching": the money has gone. And coins back, if gift card money returned.
      moneyOut();
      if (result.order.creditAppliedPence) window.setTimeout(moneyIn, 700);
      setPlaced({ order: result.order, message: result.message });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Something went wrong. Nothing has been charged.',
      );
    } finally {
      setSending(false);
    }
  }

  /** The very first home address, given here without a PIN as it would be at sign up. */
  async function onSaveAddress(): Promise<void> {
    try {
      const result = await updateMe({ deliveryAddress: address.trim() });
      replaceShopper(result.shopper);
      setBook((previous) =>
        previous ? { ...previous, home: result.shopper.deliveryAddress } : previous,
      );
      setEditingAddress(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We could not save that address.');
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * The states that come before the button
   * ---------------------------------------------------------------------------------- */

  if (placed) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your order is sent</h1>
        <p role="status" className="m-0 max-w-xl text-lead">
          {placed.message}
        </p>
        <p className="m-0 max-w-xl">
          We are finding you a Runner now. They will have your doorstep instructions exactly as you
          wrote them.
        </p>
        <p className="m-0 max-w-xl">
          If your Runner cannot find something, they will ask you on your order page, and you choose
          what they do. Nobody is given your phone number.
        </p>
        <NotifyMe />
        <p className="m-0 text-paper/80">Your order number is {placed.order.id}.</p>
        <Link to="/my-order" className="control bg-highlight text-ink">
          Follow your order
        </Link>
        <Link to="/" className="control bg-paper/10 text-paper underline">
          Back to the start
        </Link>
      </div>
    );
  }

  if (restoring) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Send your order</h1>
        <p className="m-0">There is nothing in your basket yet.</p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  if (!shopper) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">We need to know who you are</h1>
        <p className="m-0 max-w-xl">
          Your basket is safe. Setting up an account takes a moment, and then we can bring this to
          your door.
        </p>
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up my account
        </Link>
        <Link to="/sign-in?next=/confirm" className="control bg-paper/10 text-paper underline">
          I already have an account: sign in
        </Link>
        <p className="m-0">
          <Link to="/basket" className="underline">
            Go back to my basket
          </Link>
        </p>
      </div>
    );
  }

  const card = cards?.find((method) => method.isDefault) ?? cards?.[0];
  const byBank = bankOn && payBy === 'bank';
  const ready =
    (card !== undefined || byBank) && address.trim() !== '' && !overMaximum && addressConfirmed;

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Send your order</h1>

      <section aria-labelledby="what-heading" className="space-y-3">
        <h2 id="what-heading" className="text-lead font-bold">
          What you are asking for
        </h2>
        <ul className="list-none m-0 p-0 space-y-2">
          {lines.map((line) => (
            <li key={line.item.id} className="m-0">
              {line.quantity} × {line.item.name}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cost-heading" className="space-y-3">
        <h2 id="cost-heading" className="text-lead font-bold">
          What it will cost
        </h2>
        <p className="m-0">Your shopping, about {money(pricing.goodsPence)}.</p>
        <p className="m-0">Our fee, {money(pricing.feePence)}. That is the only fee.</p>
        <p className="m-0 text-lead font-bold">Altogether, about {money(pricing.totalPence)}.</p>
        <p className="m-0">
          You pay what the till says for the shopping, so this may change a little. Your Runner gets{' '}
          {money(storeConfig.fees.runnerPaymentPence)} of the fee.
        </p>
      </section>

      <section aria-labelledby="where-heading" className="space-y-3">
        <h2 id="where-heading" className="text-lead font-bold">
          Where it is going
        </h2>
        {editingAddress ? (
          <div className="space-y-2 max-w-xl">
            <label htmlFor="deliveryAddress" className="block font-bold">
              Your home address
            </label>
            <textarea
              id="deliveryAddress"
              name="deliveryAddress"
              rows={3}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <button
              type="button"
              onClick={() => {
                void onSaveAddress();
              }}
              className="control bg-paper text-ink"
            >
              Save this address
            </button>
          </div>
        ) : other === 'typing' ? (
          <form
            className="space-y-2 max-w-xl"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim().length < 5) return;
              setOther('asking');
            }}
          >
            <label htmlFor="otherAddress" className="block font-bold">
              The address to send it to
            </label>
            <p id="otherAddress-hint" className="m-0 text-paper/90">
              The house number, street, town and postcode.
            </p>
            <textarea
              id="otherAddress"
              rows={3}
              value={typed}
              aria-describedby="otherAddress-hint"
              onChange={(event) => setTyped(event.target.value)}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="control bg-highlight text-ink">
                Next
              </button>
              <button
                type="button"
                onClick={() => setOther('closed')}
                className="control bg-paper/10 text-paper underline"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : other === 'asking' ? (
          <div className="space-y-3 max-w-xl">
            <p className="m-0">{typed.trim()}</p>
            <p className="m-0 font-bold">Save it for next time, or use it this once?</p>
            <p className="m-0">Saving it needs your PIN. Using it once does not.</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOther('saving')}
                className="control bg-paper text-ink"
              >
                Save it for next time
              </button>
              <button
                type="button"
                onClick={() => {
                  setOneOff(typed.trim());
                  setChosen('once');
                  setOther('closed');
                }}
                className="control bg-paper text-ink"
              >
                Use it once, for this order only
              </button>
            </div>
          </div>
        ) : other === 'saving' ? (
          <div className="space-y-3">
            <p className="m-0">Saving {typed.trim()}</p>
            <PinGate
              hasPin={book?.hasPin ?? shopper.hasPin ?? false}
              setHasPin={(hasPin) => {
                setBook((previous) => (previous ? { ...previous, hasPin } : previous));
              }}
              purpose="to save this address"
              onCancel={() => setOther('asking')}
              action={async (pin) => {
                const result = await saveAddress({ address: typed.trim(), pin });
                setBook((previous) =>
                  previous ? { ...previous, saved: [...previous.saved, result.address] } : previous,
                );
                setChosen(result.address.id);
                setOther('closed');
              }}
            />
          </div>
        ) : (
          <>
            {(book?.saved.length ?? 0) > 0 || chosen === 'once' ? (
              <fieldset className="border-2 border-paper/40 rounded-xl p-4 m-0 space-y-2 max-w-xl">
                <legend className="px-2 font-bold">Choose where it goes</legend>
                {[
                  { key: 'home', label: 'Your home address', where: home },
                  ...(book?.saved ?? []).map((saved) => ({
                    key: saved.id,
                    label: saved.label || 'Saved address',
                    where: saved.address,
                  })),
                  ...(oneOff !== ''
                    ? [{ key: 'once', label: 'This order only', where: oneOff }]
                    : []),
                ].map((option) => (
                  <div key={option.key} className="flex items-start gap-3 min-h-control">
                    <input
                      id={`where-${option.key}`}
                      type="radio"
                      name="where"
                      checked={chosen === option.key}
                      onChange={() => setChosen(option.key)}
                      className="h-7 w-7 mt-1 shrink-0"
                    />
                    <label htmlFor={`where-${option.key}`}>
                      <span className="font-bold">{option.label}:</span> {option.where}
                    </label>
                  </div>
                ))}
              </fieldset>
            ) : (
              <p className="m-0">
                {address === '' ? 'You have not given us an address yet.' : address}
              </p>
            )}
            {address.trim() !== '' &&
              (addressConfirmed ? (
                <p role="status" className="m-0 font-bold">
                  You said this is the right address.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmedAddress(address.trim())}
                  className="control bg-highlight text-ink"
                >
                  Yes, this is the right address
                </button>
              ))}
            {home === '' ? (
              <button
                type="button"
                onClick={() => setEditingAddress(true)}
                className="control bg-paper text-ink"
              >
                Add an address
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTyped('');
                  setOther('typing');
                }}
                className="control bg-paper text-ink"
              >
                Send to a different address
              </button>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="card-heading" className="space-y-3">
        <h2 id="card-heading" className="text-lead font-bold">
          How you are paying
        </h2>
        {bankOn && (
          <fieldset className="border-2 border-paper/40 rounded-xl p-4 m-0 space-y-2">
            <legend className="px-2 font-bold">Pay by</legend>
            <div className="flex items-center gap-3 min-h-control">
              <input
                id="pay-card"
                type="radio"
                name="pay-by"
                checked={payBy === 'card'}
                onChange={() => setPayBy('card')}
                className="h-7 w-7 shrink-0"
              />
              <label htmlFor="pay-card">My card</label>
            </div>
            <div className="flex items-center gap-3 min-h-control">
              <input
                id="pay-bank"
                type="radio"
                name="pay-by"
                checked={payBy === 'bank'}
                onChange={() => setPayBy('bank')}
                aria-describedby="pay-bank-hint"
                className="h-7 w-7 shrink-0"
              />
              <label htmlFor="pay-bank">Bank transfer to us</label>
            </div>
            <p id="pay-bank-hint" className="m-0">
              We give you our bank details and a reference. A Runner is sent once your transfer
              arrives, usually within a working day. A refund to a bank transfer takes longer than
              to a card.
            </p>
          </fieldset>
        )}
        {byBank ? null : cards === null ? (
          <p role="status" className="m-0">
            Checking which card you have saved.
          </p>
        ) : card ? (
          <p className="m-0">
            Your {card.brand ?? 'card'} ending {card.lastFour}.
          </p>
        ) : (
          <>
            <p className="m-0">You have not saved a card yet, so there is nothing to pay with.</p>
            <Link to="/card" className="control bg-paper text-ink">
              Add a card
            </Link>
          </>
        )}
      </section>

      <section aria-labelledby="promise-heading" className="space-y-3">
        <h2 id="promise-heading" className="text-lead font-bold">
          Before you press it
        </h2>
        <p className="m-0">
          Pressing the button below is the only thing that will ever take a payment. Nothing before
          it has charged you a penny, and nothing after it will charge you again without asking.
        </p>
      </section>

      {error !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {error}
        </p>
      )}
      {error.startsWith('Please add your card again') && (
        <Link to="/card" className="control bg-paper text-ink">
          Add my card again
        </Link>
      )}

      {overMaximum && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          This comes to about {money(pricing.goodsPence)} of shopping, and one delivery carries up
          to {money(storeConfig.fees.maximumGoodsPence)}. Go back to your basket, take some things
          out to send as one delivery, and order the rest as a second delivery.
        </p>
      )}

      <button
        type="button"
        disabled={!ready || sending}
        onClick={() => {
          void onSend();
        }}
        className="control w-full bg-highlight text-ink text-display py-8 disabled:opacity-70"
      >
        {sending ? 'Sending your order…' : 'Send my order'}
      </button>

      <p className="m-0">
        <span className="visually-hidden">You are agreeing to this: </span>
        {statement}
      </p>

      <Link to="/basket" className="control bg-paper text-ink">
        Go back and change something
      </Link>
    </div>
  );
}
