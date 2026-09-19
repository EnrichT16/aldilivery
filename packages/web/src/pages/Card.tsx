import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StripeCardElement } from '@stripe/stripe-js';

import { storeConfig } from '../config';
import { savePaymentMethod } from '../lib/api';
import { createCardPaymentMethod, prepareCardEntry } from '../lib/stripe';
import { useSession } from '../state/session';

/**
 * Saving a card.
 *
 * The fields below are not ours. Stripe draws them inside its own iframe, so the digits go
 * from the Shopper's keyboard to Stripe and never pass through Aldilivery — not through our
 * JavaScript, not through our server, not into any log. What we are given back, and all we
 * ever store, is an identifier and the last four digits.
 *
 * That has one consequence worth knowing: the card fields cannot be styled or labelled from
 * out here the way an ordinary input can, because they are not in this document. So the
 * label and the explanation above them are ours and are joined to the iframe's container by
 * `aria-describedby`, and the font size and colours are handed to Stripe explicitly rather
 * than inherited, so they match the rest of the screen at the size this product sets.
 *
 * Nothing on this screen charges anything. It says so, because a card field with a button
 * under it looks like a payment, and being asked for a card is the moment somebody is most
 * entitled to be suspicious.
 */
export function Card(): JSX.Element {
  const { shopper, restoring } = useSession();

  const mountPoint = useRef<HTMLDivElement>(null);
  const element = useRef<StripeCardElement | null>(null);

  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [unavailableReason, setUnavailableReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState<string>('');

  useEffect(() => {
    if (!shopper) return;

    let cancelled = false;

    void (async () => {
      const setup = await prepareCardEntry();
      if (cancelled) return;

      if (!setup.ready) {
        setState('unavailable');
        setUnavailableReason(
          setup.reason === 'rehearsal'
            ? 'Card payments are not switched on for this Aldilivery yet, so there is nothing to save a card to. Nothing you do here would be charged.'
            : setup.reason === 'no-key'
              ? 'Card payments are not finished being set up. We have not been given the key the browser needs, so we cannot take a card yet.'
              : 'The card form could not load. Something in the browser blocked it, or the connection dropped.',
        );
        return;
      }

      const elements = setup.stripe.elements();
      const card = elements.create('card', {
        // Handed over rather than inherited: the iframe cannot see our stylesheet.
        style: {
          base: {
            color: storeConfig.brand.colours.navy,
            fontSize: `${storeConfig.accessibility.baseFontSizePx}px`,
            fontFamily: 'system-ui, sans-serif',
            '::placeholder': { color: '#5A6B85' },
          },
        },
      });

      if (mountPoint.current) {
        card.mount(mountPoint.current);
        element.current = card;
        setState('ready');
      }
    })();

    return () => {
      cancelled = true;
      element.current?.unmount();
      element.current = null;
    };
  }, [shopper]);

  if (restoring) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }

  if (!shopper) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Set up your account first</h1>
        <p className="m-0 max-w-xl">
          We keep your card against your account, so there needs to be an account for it to belong
          to.
        </p>
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up my account
        </Link>
      </div>
    );
  }

  async function onSave(): Promise<void> {
    const card = element.current;
    const setup = await prepareCardEntry();
    if (!card || !setup.ready || saving) return;

    setSaving(true);
    setError('');
    try {
      const details = await createCardPaymentMethod(setup.stripe, card);
      const result = await savePaymentMethod({
        stripePaymentMethodId: details.stripePaymentMethodId,
        lastFour: details.lastFour,
        ...(details.brand ? { brand: details.brand } : {}),
        ...(details.region ? { region: details.region.toUpperCase() } : {}),
      });
      setSaved(result.message);
      card.clear();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That card was not accepted.');
    } finally {
      setSaving(false);
    }
  }

  if (saved !== '') {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your card is saved</h1>
        <p role="status" className="m-0 max-w-xl">
          {saved} Nothing has been charged. We will ask you before we ever take a penny.
        </p>
        <Link to="/shop" className="control bg-highlight text-ink">
          Find your shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Add a card</h1>

      <p className="m-0 max-w-xl">
        Nothing on this screen takes a payment. We are only keeping the card ready so that when you
        send an order you do not have to type it again.
      </p>

      {state === 'unavailable' ? (
        <>
          <p role="alert" className="border-2 border-paper p-4 rounded-xl m-0 max-w-xl">
            {unavailableReason}
          </p>
          <Link to="/shop" className="control bg-paper text-ink">
            Carry on without a card
          </Link>
        </>
      ) : (
        <div className="space-y-6 max-w-xl">
          {/*
            A named group rather than a label.
            
            `label` cannot name what is inside Stripe's iframe: a label names a form control
            in this document, and there is no control here — only an empty div Stripe mounts
            into. An `aria-describedby` on that div does nothing either, because a plain div
            is not in the accessibility tree as anything a screen reader would stop on.

            A group with `aria-labelledby` does work: moving into it announces "Your card
            details, group", and the description is read with it. The fields themselves carry
            Stripe's own labels — "Credit or debit card number", and so on — which is right,
            because Stripe owns that document and we cannot reach into it.
          */}
          <div
            role="group"
            aria-labelledby="card-label"
            aria-describedby="card-hint"
            className="space-y-2"
          >
            <span id="card-label" className="block text-lead font-bold">
              Your card details
            </span>
            <p id="card-hint" className="m-0 text-paper/90">
              Your card number goes straight to our payment company and never reaches{' '}
              {storeConfig.productName}. We only ever see the last four digits.
            </p>
            <div
              ref={mountPoint}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper p-3"
            />
            {state === 'loading' && (
              <p role="status" className="m-0">
                Getting the card form ready.
              </p>
            )}
          </div>

          {error !== '' && (
            <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={state !== 'ready' || saving}
            onClick={() => {
              void onSave();
            }}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            {saving ? 'Saving your card…' : 'Save my card'}
          </button>

          <Link to="/shop" className="control bg-paper/10 text-paper underline">
            Skip this for now
          </Link>
        </div>
      )}
    </div>
  );
}
