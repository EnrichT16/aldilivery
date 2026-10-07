import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { PriceConfirm } from '../components/PriceConfirm';
import { storeConfig } from '../config';
import { buyPlus, fetchPlus, joinFamily, leaveFamily, type PlusState } from '../lib/api';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

function longDate(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Ozi Plus and the family plan (7 October 2026). A month at a time, agreed before it is taken,
 * never renewing by itself. It never makes delivery cheaper or dearer for anyone (Rule Four):
 * what it includes is Recipes and Ozi Finds It.
 */
export function Plus(): JSX.Element {
  const { shopper, replaceShopper } = useSession();
  // Loaded once per person: changing their details here must not reload over the answer.
  const shopperId = shopper?.id;
  const ozi = useOzi();
  const [state, setState] = useState<PlusState | null>(null);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const { plusPence, plusFamilyPence, plusDays, familyMaximum } = storeConfig.extras;
  const name = `${storeConfig.assistantName} Plus`;

  useEffect(() => {
    if (!shopperId) return;
    fetchPlus()
      .then(setState)
      .catch(() => undefined);
  }, [shopperId]);

  async function act(run: () => Promise<PlusState & { message: string }>): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await run();
      setState(result);
      setNews(result.message);
      if (shopper) {
        replaceShopper({
          ...shopper,
          plusUntil: result.plusUntil,
          ...(result.plusUntil && result.active ? { recipePassUntil: result.plusUntil } : {}),
        });
      }
      void ozi.say(result.message);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
      void ozi.say(message);
    } finally {
      setBusy(false);
    }
  }

  function join(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('family-code') ?? '');
    void act(() => joinFamily(code));
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">{name}</h1>
      <p className="m-0">
        For people who shop with us every week. {money(plusPence)} for {plusDays} days, or{' '}
        {money(plusFamilyPence)} for a family of up to {familyMaximum}. It never renews by itself:
        when the days run out, it simply stops, and you can get it again if you want.
      </p>
      <section aria-labelledby="includes" className="space-y-2">
        <h2 id="includes" className="text-lead font-bold m-0">
          What it includes
        </h2>
        <ul className="m-0 ps-6 space-y-1">
          <li>
            {storeConfig.assistantName} Recipes, read aloud, with every ingredient added in one go.
          </li>
          <li>{storeConfig.assistantName} Finds It, with no finder fee.</li>
          <li>On the family plan, all of that for everyone in it.</li>
        </ul>
        <p className="m-0">
          Delivery costs the same for everybody, with or without Plus. That is one of our rules.
        </p>
      </section>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}

      {!shopper ? (
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up an account first
        </Link>
      ) : (
        <>
          {state?.active && state.plusUntil && (
            <p className="m-0 text-lead font-bold">
              {state.joinedFamilyOf
                ? `You're on ${state.joinedFamilyOf}'s family plan, until ${longDate(state.plusUntil)}.`
                : `You have ${name} until ${longDate(state.plusUntil)}.`}
            </p>
          )}
          {state?.family && state.familyCode && (
            <section aria-labelledby="family" className="space-y-2">
              <h2 id="family" className="text-lead font-bold m-0">
                Your family
              </h2>
              <p className="m-0">
                Your family code is{' '}
                <strong aria-label={state.familyCode.split('').join(' ')}>
                  {state.familyCode}
                </strong>
                . Give it to up to {familyMaximum - 1} people to add them.
              </p>
              <p className="m-0">
                {state.members.length === 0
                  ? 'Nobody has joined yet.'
                  : `In your family: ${state.members.join(', ')}.`}
              </p>
            </section>
          )}
          {!state?.joinedFamilyOf && (
            <section aria-labelledby="get" className="space-y-4">
              <h2 id="get" className="text-lead font-bold m-0">
                {state?.active ? 'Add more days' : `Get ${name}`}
              </h2>
              <PriceConfirm
                key={`single-${state?.plusUntil ?? ''}`}
                start={`${name} for me, ${money(plusPence)}`}
                question={`${money(plusPence)} will be taken from your saved card now, for ${plusDays} days of ${name}. Is that all right?`}
                yes={`Yes, get ${name} for ${money(plusPence)}`}
                busy={busy}
                onAsk={(question) => void ozi.say(question)}
                onYes={() => void act(() => buyPlus('single'))}
              />
              <PriceConfirm
                key={`family-${state?.plusUntil ?? ''}`}
                start={`${name} for my family, ${money(plusFamilyPence)}`}
                question={`${money(plusFamilyPence)} will be taken from your saved card now, for ${plusDays} days of ${name} for up to ${familyMaximum} people. Is that all right?`}
                yes={`Yes, get the family plan for ${money(plusFamilyPence)}`}
                busy={busy}
                onAsk={(question) => void ozi.say(question)}
                onYes={() => void act(() => buyPlus('family'))}
              />
            </section>
          )}
          {state?.joinedFamilyOf ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(leaveFamily)}
              className="control bg-paper/10 text-paper underline"
            >
              Leave the family plan
            </button>
          ) : (
            !state?.family && (
              <form onSubmit={join} className="space-y-3" aria-labelledby="join">
                <h2 id="join" className="text-lead font-bold m-0">
                  Join a family plan
                </h2>
                <label htmlFor="family-code" className="block font-bold">
                  The family code you were given
                </label>
                <input
                  id="family-code"
                  name="family-code"
                  autoComplete="off"
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 uppercase"
                />
                <button type="submit" disabled={busy} className="control bg-paper text-ink">
                  Join
                </button>
              </form>
            )
          )}
        </>
      )}
    </div>
  );
}
