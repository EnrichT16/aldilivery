import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  createOrder,
  listPaymentMethods,
  updateMe,
  type PaymentMethod,
  type PlacedOrder,
} from '../lib/api';
import { money } from '../lib/money';
import { prepareCardEntry } from '../lib/stripe';
import { useBasket } from '../state/basket';
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
  const { lines, pricing, clear } = useBasket();
  const { shopper, restoring, replaceShopper } = useSession();

  const [cards, setCards] = useState<PaymentMethod[] | null>(null);
  const [placed, setPlaced] = useState<{ order: PlacedOrder; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState('');

  useEffect(() => {
    setAddress(shopper?.deliveryAddress ?? '');
  }, [shopper]);

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

  const statement = `Send my order. About ${money(pricing.totalPence)} altogether, including our fee of ${money(pricing.feePence)}.`;

  async function onSend(): Promise<void> {
    const card = cards?.find((method) => method.isDefault) ?? cards?.[0];
    if (!card || sending || address.trim() === '') return;

    setSending(true);
    setError('');
    try {
      const result = await createOrder({
        lines: lines.map((line) => ({
          catalogueItemId: line.item.id,
          quantity: line.quantity,
        })),
        deliveryAddress: address.trim(),
        paymentMethodId: card.id,
        confirmation: { statement, agreedTotalPence: pricing.totalPence },
      });

      /**
       * A card in the United Kingdom usually has to be authenticated by the Shopper's bank.
       * When it does, the server leaves the order unpaid and hands back a client secret, and
       * this is where the bank's own screen is opened. Stripe tells us how it went, and the
       * order is settled by the webhook rather than by anything we could claim here.
       */
      if (result.payment.requiresAction && result.payment.clientSecret) {
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

  async function onSaveAddress(): Promise<void> {
    try {
      const result = await updateMe({ deliveryAddress: address.trim() });
      replaceShopper(result.shopper);
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
        <p className="m-0 text-paper/80">Your order number is {placed.order.id}.</p>
        <Link to="/" className="control bg-highlight text-ink">
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
        <p className="m-0">
          <Link to="/basket" className="underline">
            Go back to my basket
          </Link>
        </p>
      </div>
    );
  }

  const card = cards?.find((method) => method.isDefault) ?? cards?.[0];
  const ready = card !== undefined && address.trim() !== '';

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
              Your address
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
        ) : (
          <>
            <p className="m-0">
              {address === '' ? 'You have not given us an address yet.' : address}
            </p>
            <button
              type="button"
              onClick={() => setEditingAddress(true)}
              className="control bg-paper text-ink"
            >
              {address === '' ? 'Add an address' : 'Change this address'}
            </button>
          </>
        )}
      </section>

      <section aria-labelledby="card-heading" className="space-y-3">
        <h2 id="card-heading" className="text-lead font-bold">
          How you are paying
        </h2>
        {cards === null ? (
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
