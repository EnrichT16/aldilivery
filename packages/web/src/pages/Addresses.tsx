import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PinGate } from '../components/PinGate';
import { storeConfig } from '../config';
import {
  changeHomeAddress,
  fetchAddresses,
  removeAddress,
  saveAddress,
  updateMe,
  type AddressBook,
} from '../lib/api';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

const FIELD = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

/**
 * Your addresses (docs/BUILD_PROMPT.md, Section D).
 *
 * The registered home address: every account has one, every order by voice goes there, and it
 * changes only here, only with the PIN, and the owner is told by text every time. Then as many
 * other addresses as anybody wants — three children at three universities, a friend across
 * town, a seller's customers — each saved with the PIN.
 *
 * The control to add one is a plus with ADD AN ADDRESS written under it (the icon rule), and
 * Ozi says it is there when the page opens. "Add an address", said to Ozi anywhere, opens this
 * page with the form already open.
 */
export function Addresses(): JSX.Element {
  const { shopper, restoring, replaceShopper } = useSession();
  const ozi = useOzi();
  const assistant = storeConfig.assistantName;
  const [params] = useSearchParams();

  const [book, setBook] = useState<AddressBook | null>(null);
  const [loadError, setLoadError] = useState('');
  const [news, setNews] = useState('');
  const [adding, setAdding] = useState(params.get('add') === '1');
  const [changingHome, setChangingHome] = useState(false);
  const announced = useRef(false);

  useEffect(() => {
    if (!shopper) return;
    let cancelled = false;
    fetchAddresses()
      .then((found) => {
        if (!cancelled) setBook(found);
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setLoadError(failure instanceof Error ? failure.message : 'We could not load them.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shopper]);

  useEffect(() => {
    if (!shopper || announced.current) return;
    announced.current = true;
    void ozi.say(
      params.get('add') === '1'
        ? 'Here is the form to add an address. Type it in, then you will need your PIN.'
        : `This is Your addresses. To add one, press the plus button marked Add an address, or say "${assistant}, add an address".`,
    );
  }, [shopper, ozi, params, assistant]);

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
        <h1 className="text-display font-bold m-0">Your addresses</h1>
        <p className="m-0">Sign in to see and change your addresses.</p>
        <Link to="/sign-in?next=/addresses" className="control bg-highlight text-ink">
          Sign in
        </Link>
      </div>
    );
  }

  const home = book?.home ?? shopper.deliveryAddress;
  const hasPin = book?.hasPin ?? shopper.hasPin ?? false;
  const setHasPin = (value: boolean): void => {
    setBook((previous) => (previous ? { ...previous, hasPin: value } : previous));
  };

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Your addresses</h1>

      <p role="status" className="m-0 min-h-control">
        {news}
      </p>

      <section aria-labelledby="home-heading" className="space-y-3">
        <h2 id="home-heading" className="text-lead font-bold">
          Your home address
        </h2>
        <p className="m-0">{home === '' ? 'You have not given us a home address yet.' : home}</p>
        <p className="m-0 text-paper/80">
          An order you make by voice always comes here. Changing it needs your PIN, and we text you
          every time it changes.
        </p>
        {changingHome ? (
          <HomeForm
            hasHome={home !== ''}
            hasPin={hasPin}
            setHasPin={setHasPin}
            onCancel={() => setChangingHome(false)}
            onDone={(address, message) => {
              replaceShopper({ ...shopper, deliveryAddress: address });
              setBook((previous) => (previous ? { ...previous, home: address } : previous));
              setChangingHome(false);
              setNews(message);
              void ozi.say(message);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setChangingHome(true)}
            className="control bg-paper text-ink"
          >
            {home === '' ? 'Add your home address' : 'Change your home address'}
          </button>
        )}
      </section>

      <section aria-labelledby="saved-heading" className="space-y-4">
        <h2 id="saved-heading" className="text-lead font-bold">
          Other addresses
        </h2>
        {loadError !== '' && (
          <p role="alert" className="m-0">
            {loadError}
          </p>
        )}
        {book === null && loadError === '' ? (
          <p className="m-0">Finding your addresses.</p>
        ) : book && book.saved.length > 0 ? (
          <ul className="list-none m-0 p-0 space-y-4">
            {book.saved.map((saved) => (
              <li key={saved.id} className="border-2 border-paper/40 rounded-xl p-4 space-y-2">
                {saved.label !== '' && <p className="m-0 font-bold">{saved.label}</p>}
                <p className="m-0">{saved.address}</p>
                <button
                  type="button"
                  onClick={() => {
                    void removeAddress(saved.id)
                      .then((result) => {
                        setBook((previous) =>
                          previous
                            ? {
                                ...previous,
                                saved: previous.saved.filter((a) => a.id !== saved.id),
                              }
                            : previous,
                        );
                        setNews(result.message);
                      })
                      .catch((failure: unknown) => {
                        setNews(
                          failure instanceof Error ? failure.message : 'We could not remove it.',
                        );
                      });
                  }}
                  className="control bg-paper/10 text-paper underline"
                >
                  Remove<span className="visually-hidden"> {saved.label || saved.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          book && <p className="m-0">None yet. You can save as many as you like.</p>
        )}

        {adding ? (
          <AddForm
            hasPin={hasPin}
            setHasPin={setHasPin}
            onCancel={() => setAdding(false)}
            onDone={(saved, message) => {
              setBook((previous) =>
                previous ? { ...previous, saved: [...previous.saved, saved] } : previous,
              );
              setAdding(false);
              setNews(message);
              void ozi.say(message);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="control bg-highlight text-ink flex-col py-4 px-8"
          >
            <span aria-hidden="true" className="text-display leading-none font-bold">
              +
            </span>
            <span className="uppercase font-bold">Add an address</span>
          </button>
        )}
      </section>

      <Link to="/settings" className="control bg-paper/10 text-paper underline">
        Back to Settings
      </Link>
    </div>
  );
}

/** First the address, then the PIN. */
function AddForm({
  hasPin,
  setHasPin,
  onCancel,
  onDone,
}: {
  hasPin: boolean;
  setHasPin: (value: boolean) => void;
  onCancel: () => void;
  onDone: (saved: AddressBook['saved'][number], message: string) => void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');

  if (ready) {
    return (
      <div className="space-y-3">
        <p className="m-0">
          Saving{label.trim() !== '' ? ` ${label.trim()}:` : ''} {address.trim()}
        </p>
        <PinGate
          hasPin={hasPin}
          setHasPin={setHasPin}
          purpose="to save this address"
          onCancel={() => setReady(false)}
          action={async (pin) => {
            const result = await saveAddress({
              address: address.trim(),
              label: label.trim(),
              pin,
            });
            onDone(result.address, 'Saved. You can choose it when you send an order.');
          }}
        />
      </div>
    );
  }

  return (
    <form
      className="space-y-4 max-w-xl"
      aria-labelledby="add-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (address.trim().length < 5) {
          setProblem('Please type the whole address, with the postcode.');
          return;
        }
        setProblem('');
        setReady(true);
      }}
    >
      <h3 id="add-heading" className="text-lead font-bold m-0">
        Add an address
      </h3>
      <div className="space-y-2">
        <label htmlFor="new-label" className="block font-bold">
          A name for it (you can leave this empty)
        </label>
        <p id="new-label-hint" className="m-0 text-paper/90">
          So you know which it is, like Mum, or Tom&rsquo;s halls.
        </p>
        <input
          id="new-label"
          value={label}
          maxLength={60}
          aria-describedby="new-label-hint"
          onChange={(event) => setLabel(event.target.value)}
          className={FIELD}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="new-address" className="block font-bold">
          The address
        </label>
        <p id="new-address-hint" className="m-0 text-paper/90">
          The house number, street, town and postcode.
        </p>
        <textarea
          id="new-address"
          rows={3}
          value={address}
          autoComplete="street-address"
          aria-describedby="new-address-hint"
          onChange={(event) => setAddress(event.target.value)}
          className={FIELD}
        />
      </div>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-xl">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="control bg-highlight text-ink">
          Next
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="control bg-paper/10 text-paper underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The home address. The very first one is given without a PIN, as at sign up; changing it
 * after that needs the PIN.
 */
function HomeForm({
  hasHome,
  hasPin,
  setHasPin,
  onCancel,
  onDone,
}: {
  hasHome: boolean;
  hasPin: boolean;
  setHasPin: (value: boolean) => void;
  onCancel: () => void;
  onDone: (address: string, message: string) => void;
}): JSX.Element {
  const [address, setAddress] = useState('');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');

  if (ready && hasHome) {
    return (
      <div className="space-y-3">
        <p className="m-0">Your new home address: {address.trim()}</p>
        <PinGate
          hasPin={hasPin}
          setHasPin={setHasPin}
          purpose="to change your home address"
          onCancel={() => setReady(false)}
          action={async (pin) => {
            const result = await changeHomeAddress(address.trim(), pin);
            onDone(result.home, result.message);
          }}
        />
      </div>
    );
  }

  return (
    <form
      className="space-y-4 max-w-xl"
      aria-labelledby="home-form-heading"
      onSubmit={(event) => {
        event.preventDefault();
        if (address.trim().length < 5) {
          setProblem('Please type the whole address, with the postcode.');
          return;
        }
        setProblem('');
        if (hasHome) {
          setReady(true);
          return;
        }
        void updateMe({ deliveryAddress: address.trim() })
          .then((result) => onDone(result.shopper.deliveryAddress, 'Your home address is saved.'))
          .catch((failure: unknown) => {
            setProblem(failure instanceof Error ? failure.message : 'We could not save it.');
          });
      }}
    >
      <h3 id="home-form-heading" className="text-lead font-bold m-0">
        {hasHome ? 'Change your home address' : 'Add your home address'}
      </h3>
      <div className="space-y-2">
        <label htmlFor="home-address" className="block font-bold">
          {hasHome ? 'Your new home address' : 'Your home address'}
        </label>
        <p id="home-address-hint" className="m-0 text-paper/90">
          The house number, street, town and postcode.
        </p>
        <textarea
          id="home-address"
          rows={3}
          value={address}
          autoComplete="street-address"
          aria-describedby="home-address-hint"
          onChange={(event) => setAddress(event.target.value)}
          className={FIELD}
        />
      </div>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-xl">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="control bg-highlight text-ink">
          {hasHome ? 'Next' : 'Save my home address'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="control bg-paper/10 text-paper underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
