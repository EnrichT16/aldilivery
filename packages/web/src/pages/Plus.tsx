import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { moneyOut } from '../lib/alert';

import { PriceConfirm } from '../components/PriceConfirm';
import { storeConfig } from '../config';
import {
  buyPlus,
  cancelPlan,
  decideFamilyOrder,
  fetchFamilyOrders,
  fetchPlus,
  joinFamily,
  leaveFamily,
  setApprovalLimit,
  type FamilyOrder,
  type PlanName,
  type PlusState,
} from '../lib/api';
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

/** The plans, their prices and what each includes, all from config/store.json (ruling 58). */
export function planDetails() {
  const { extras, fees, assistantName } = storeConfig;
  const delivery = fees.delivery;
  return [
    {
      plan: 'membership' as PlanName,
      name: `${assistantName} Membership`,
      pence: extras.membershipPence,
      includes: [
        `Delivery ${money(delivery.membershipPence)} on every order, whatever its size.`,
        `The Recipe Pass is included free (worth ${money(extras.recipePassPence)}).`,
        `One free “${assistantName} Finds It” each month (worth ${money(extras.findItPence)}).`,
        `${assistantName} remembers your favourites and your usual order.`,
      ],
    },
    {
      plan: 'plus' as PlanName,
      name: `${assistantName} Plus`,
      pence: extras.plusPence,
      includes: [
        'Everything in Membership.',
        `Delivery ${money(delivery.plusPence)} on every order.`,
        'My regular Runner: the same trusted Runner whenever possible.',
        'Priority at busy times.',
        'No adverts, ever.',
        'A friendly check-in message if you have not ordered for a while.',
      ],
    },
    {
      plan: 'family' as PlanName,
      name: `${assistantName} Family and Carer`,
      pence: extras.familyPence,
      includes: [
        `Everything in Plus, for up to ${extras.familyMaximum} people in different homes.`,
        'The family member or carer sees every order, and is told when it is ordered, on its way and delivered.',
        'They can approve orders above a limit they choose.',
        'One card pays for everyone on the plan.',
        'A weekly summary, read aloud or sent by text.',
        'They can order for their loved one from their own phone.',
      ],
    },
  ];
}

/**
 * The monthly plans (ruling 58, 9 October 2026): Ozi Membership, Ozi Plus, and Ozi Family and
 * Carer. Every price is said before anything is taken; a plan is taken monthly only when the
 * Shopper chooses to join, and cancelling is one button, as easy as joining. The first month
 * of membership is free for everyone, with pay-as-you-go delivery.
 */
export function Plus(): JSX.Element {
  const { shopper, replaceShopper } = useSession();
  // Loaded once per person: changing their details here must not reload over the answer.
  const shopperId = shopper?.id;
  const ozi = useOzi();
  const [state, setState] = useState<PlusState | null>(null);
  const [familyOrders, setFamilyOrders] = useState<FamilyOrder[]>([]);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const { fees, extras, assistantName } = storeConfig;
  const delivery = fees.delivery;
  const plans = planDetails();

  useEffect(() => {
    if (!shopperId) return;
    fetchPlus()
      .then((loaded) => {
        setState(loaded);
        if (loaded.plan === 'family' && loaded.familyCode) {
          fetchFamilyOrders()
            .then((result) => setFamilyOrders(result.orders))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [shopperId]);

  async function act(run: () => Promise<PlusState & { message: string }>): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await run();
      setState(result);
      setNews(result.message);
      if (/was taken from your card/.test(result.message)) moneyOut();
      if (shopper) {
        replaceShopper({
          ...shopper,
          plan: result.plan,
          planUntil: result.planUntil,
          activePlan: result.plan,
          deliveryPlan: result.deliveryPlan,
          membershipExtras: result.plan !== null || shopper.inFreeMonth === true,
          plusExtras: result.plan === 'plus' || result.plan === 'family',
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

  function saveLimit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('approval-limit') ?? '').trim();
    const pounds = Number(typed.replace(/[£,\s]/g, ''));
    const limit = typed === '' ? null : Math.round(pounds * 100);
    if (limit !== null && (!Number.isFinite(pounds) || limit < 0)) {
      setProblem('Please give the limit in pounds, like 40, or leave it empty for no limit.');
      return;
    }
    void act(() => setApprovalLimit(limit));
  }

  async function decide(order: FamilyOrder, approve: boolean): Promise<void> {
    setBusy(true);
    try {
      const result = await decideFamilyOrder(order.id, approve);
      const words =
        result.message ??
        (approve ? `${order.person}'s order is approved and on its way to a Runner.` : '');
      setNews(words);
      void ozi.say(words);
      setFamilyOrders((await fetchFamilyOrders()).orders);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
    } finally {
      setBusy(false);
    }
  }

  const current = state?.plan ? plans.find((entry) => entry.plan === state.plan) : null;
  const payer = state?.plan === 'family' && state.familyCode !== null;

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">{assistantName} plans</h1>
      <p className="m-0">
        Your first month of membership is free, and you pay as you go:{' '}
        {money(delivery.payAsYouGoSmallOrderPence)} delivery for shopping of{' '}
        {money(delivery.payAsYouGoSmallOrderUpToPence)} or less, {money(delivery.payAsYouGoPence)}{' '}
        above that. Before it ends we remind you. A plan is taken monthly only if you choose to
        join, and you can cancel at any time with one button, or by saying “cancel my membership”.
        Nobody has to join.
      </p>
      <p className="m-0">
        Every product has a small item charge, already included in the prices we show: from{' '}
        {money(fees.itemCharge.basePence)}, and {money(fees.itemCharge.stepPence)} more for every{' '}
        {money(fees.itemCharge.everyPence)} of its shop price. It is the same on every plan.
      </p>

      {plans.map((entry) => (
        <section key={entry.plan} aria-labelledby={`plan-${entry.plan}`} className="space-y-2">
          <h2 id={`plan-${entry.plan}`} className="text-lead font-bold m-0">
            {entry.name}: {money(entry.pence)} a month
          </h2>
          <ul className="m-0 ps-6 space-y-1">
            {entry.includes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}

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
          {state?.freeMonthUntil && !state.plan && (
            <p className="m-0 text-lead font-bold">
              Your free month runs until {longDate(state.freeMonthUntil)}. Nothing will be taken
              unless you choose to join.
            </p>
          )}
          {current && state?.planUntil && (
            <p className="m-0 text-lead font-bold">
              {state.joinedFamilyOf
                ? `You're on ${state.joinedFamilyOf}'s family plan, until ${longDate(state.planUntil)}.`
                : state.renews
                  ? `You're on ${current.name}, ${money(current.pence)} a month. It renews on ${longDate(state.planUntil)}.`
                  : `You have ${current.name} until ${longDate(state.planUntil)}. It is cancelled, so nothing more will be taken.`}
            </p>
          )}
          {state?.renews && !state.joinedFamilyOf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(cancelPlan)}
              className="control bg-paper text-ink"
            >
              Cancel my plan
            </button>
          )}

          {payer && state?.familyCode && (
            <section aria-labelledby="family" className="space-y-3">
              <h2 id="family" className="text-lead font-bold m-0">
                Your family
              </h2>
              <p className="m-0">
                Your family code is{' '}
                <strong aria-label={state.familyCode.split('').join(' ')}>
                  {state.familyCode}
                </strong>
                . Give it to up to {extras.familyMaximum - 1} people to add them.
              </p>
              <p className="m-0">
                {state.members.length === 0
                  ? 'Nobody has joined yet.'
                  : `In your family: ${state.members.map((member) => member.name).join(', ')}.`}
              </p>
              <form onSubmit={saveLimit} className="space-y-2" aria-labelledby="limit">
                <h3 id="limit" className="font-bold m-0">
                  Orders that wait for your yes
                </h3>
                <label htmlFor="approval-limit" className="block">
                  Ask me first about orders over this many pounds (leave empty for no limit)
                </label>
                <input
                  id="approval-limit"
                  name="approval-limit"
                  inputMode="decimal"
                  defaultValue={
                    state.approvalLimitPence === null ? '' : String(state.approvalLimitPence / 100)
                  }
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
                <button type="submit" disabled={busy} className="control bg-paper text-ink">
                  Save the limit
                </button>
              </form>
              {familyOrders.length > 0 && (
                <ul className="m-0 ps-6 space-y-2" aria-label="Your family's orders">
                  {familyOrders.map((order) => (
                    <li key={order.id}>
                      {order.person}: {order.items} items, {money(order.totalPence)},{' '}
                      {order.approvalStatus === 'waiting' ? 'waiting for your yes' : order.status}.
                      {order.approvalStatus === 'waiting' && (
                        <span className="flex gap-2 mt-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(order, true)}
                            className="control bg-highlight text-ink"
                          >
                            Approve {order.person}'s order
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(order, false)}
                            className="control bg-paper/10 text-paper underline"
                          >
                            Not this time
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!state?.joinedFamilyOf && (
            <section aria-labelledby="get" className="space-y-4">
              <h2 id="get" className="text-lead font-bold m-0">
                {state?.plan ? 'Change your plan' : 'Join a plan'}
              </h2>
              {plans
                .filter((entry) => entry.plan !== state?.plan || !state.renews)
                .map((entry) => {
                  const freeNow =
                    entry.plan === 'membership' && state?.freeMonthUntil && !state.plan;
                  return (
                    <PriceConfirm
                      key={`${entry.plan}-${state?.planUntil ?? ''}`}
                      start={`Join ${entry.name}, ${money(entry.pence)} a month`}
                      question={
                        freeNow && state?.freeMonthUntil
                          ? `${entry.name} is ${money(entry.pence)} a month. Nothing is taken now: your free month carries on, and the first ${money(entry.pence)} is taken from your saved card on ${longDate(state.freeMonthUntil)}, then each month until you cancel. Is that all right?`
                          : `${money(entry.pence)} will be taken from your saved card now, and each month until you cancel, for ${entry.name}. Is that all right?`
                      }
                      yes={`Yes, join ${entry.name} for ${money(entry.pence)} a month`}
                      busy={busy}
                      onAsk={(question) => void ozi.say(question)}
                      onYes={() => void act(() => buyPlus(entry.plan))}
                    />
                  );
                })}
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
            !payer && (
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
