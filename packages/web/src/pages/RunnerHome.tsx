import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  acceptJob,
  ApiUnavailableError,
  declineJob,
  fetchCurrentJob,
  fetchOfferedJobs,
  fetchMyPay,
  fetchRunnerMe,
  moveJobOn,
  setRunnerAvailability,
  startPaySetup,
  submitTillTotal,
  type CurrentJob,
  type OfferedJob,
  type RunnerAccount,
  type RunnerPay,
  type SubstitutionChoice,
} from '../lib/api';
import { money } from '../lib/money';
import { clearRunnerToken, readRunnerToken } from '../lib/session';

/**
 * A Runner's page: their checks, going on shift, a job being offered, and the job in hand.
 *
 * One thing on the screen at a time, in the order a Runner meets them. While they are on shift
 * the page asks the server every few seconds whether a job has been offered, because nobody
 * should have to keep pressing refresh to earn. A new offer arrives as an alert, so a screen
 * reader says it the moment it appears; the seconds left are shown but not read out over and
 * over.
 *
 * The job steps are the lifecycle the server enforces, one button each: start shopping, put
 * in what the till said, set off, and delivered. The till total has to go in before setting
 * off, because that is what the Shopper is charged.
 */

const POLL_MS = 5000;

const SUBSTITUTIONS: Record<SubstitutionChoice, string> = {
  ask_me: 'If something is not there, ask them before swapping it.',
  similar_item: 'If something is not there, bring something similar.',
  no_substitutes: 'If something is not there, leave it out.',
};

/** "12.34", "£12.34" or "12" in, pence out. Null for anything that is not an amount. */
export function penceFrom(typed: string): number | null {
  const cleaned = typed.replace(/[£,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function RunnerHome(): JSX.Element {
  const signedIn = readRunnerToken() !== null;
  const [runner, setRunner] = useState<RunnerAccount | null>(null);
  const [offers, setOffers] = useState<OfferedJob[]>([]);
  const [job, setJob] = useState<CurrentJob | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const problemRef = useRef<HTMLParagraphElement>(null);

  const approved = runner
    ? runner.rightToWorkVerified && runner.criminalRecordCheckVerified
    : false;

  const refresh = useCallback(async () => {
    try {
      const me = await fetchRunnerMe();
      setRunner(me.runner);
      const current = await fetchCurrentJob();
      setJob(current.job);
      if (!current.job && me.runner.available) {
        setOffers((await fetchOfferedJobs()).offers);
      } else {
        setOffers([]);
      }
    } catch (failure) {
      if (failure instanceof ApiUnavailableError) {
        // Down is not the same as refused: keep the sign-in and say so.
        setProblem(failure.message);
      } else if (failure instanceof Error && /sign in/i.test(failure.message)) {
        // The server no longer accepts this sign-in. Forget it rather than fail on every step.
        clearRunnerToken();
        setRunner(null);
      } else {
        setProblem(failure instanceof Error ? failure.message : 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [signedIn, refresh]);

  useEffect(() => {
    if (problem !== '') problemRef.current?.focus();
  }, [problem]);

  async function act(action: () => Promise<unknown>, done: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await action();
      setNews(done);
      await refresh();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn || (!loading && !runner)) {
    return (
      <div className="space-y-6">
        <h1 className="text-display font-bold m-0">Your Runner page</h1>
        <p className="m-0 max-w-xl">
          You are not signed in as a Runner on this device. For now, a Runner stays signed in on the
          phone or computer they signed up on.
        </p>
        <Link to="/runner/sign-up" className="control bg-highlight text-ink">
          Sign up to run
        </Link>
      </div>
    );
  }

  if (loading || !runner) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }

  const offer = offers[0];

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Hello, {runner.name}</h1>

      <p role="status" className="m-0 min-h-control">
        {news}
      </p>

      {problem !== '' && (
        <p
          ref={problemRef}
          tabIndex={-1}
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0 max-w-xl"
        >
          {problem}
        </p>
      )}

      {!approved ? (
        <section aria-labelledby="checks-heading" className="space-y-3 max-w-xl">
          <h2 id="checks-heading" className="text-lead font-bold">
            Waiting for your checks
          </h2>
          <p className="m-0">
            You can go on shift once a person at {storeConfig.productName} has seen both of these.
            We will contact you to arrange it.
          </p>
          <ul className="m-0 ps-6 space-y-2">
            <li>
              Right to work in the United Kingdom: {runner.rightToWorkVerified ? 'done' : 'not yet'}
              .
            </li>
            <li>
              Criminal record check: {runner.criminalRecordCheckVerified ? 'done' : 'not yet'}.
            </li>
          </ul>
        </section>
      ) : job ? (
        <JobInHand job={job} busy={busy} act={act} />
      ) : (
        <>
          <section aria-labelledby="shift-heading" className="space-y-3 max-w-xl">
            <h2 id="shift-heading" className="text-lead font-bold">
              {runner.available ? 'You are on shift' : 'You are off shift'}
            </h2>
            <p className="m-0">
              {runner.available
                ? 'Jobs near you will appear here. You do not need to keep refreshing.'
                : 'Go on shift when you are ready to take jobs.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const next = !runner.available;
                void act(
                  () => setRunnerAvailability(next),
                  next ? 'You are on shift.' : 'You are off shift.',
                );
              }}
              className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
            >
              {runner.available ? 'Go off shift' : 'Go on shift'}
            </button>
          </section>

          {runner.available && offer?.job && (
            <section
              role="alert"
              aria-labelledby="offer-heading"
              className="space-y-3 max-w-xl border-2 border-highlight rounded-xl p-4"
            >
              <h2 id="offer-heading" className="text-lead font-bold m-0">
                A job for you
              </h2>
              <p className="m-0">
                {offer.job.itemCount} {offer.job.itemCount === 1 ? 'thing' : 'things'}, about{' '}
                {money(offer.job.goodsEstimatePence)} of shopping
                {offer.job.distanceMiles !== null
                  ? `, ${offer.job.distanceMiles.toFixed(1)} miles away`
                  : ''}
                . You get {money(offer.job.runnerPaymentPence)}.
              </p>
              <p className="m-0">About {offer.secondsLeft} seconds left to say yes.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void act(() => acceptJob(offer.offer.id), 'The job is yours.');
                }}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
              >
                Take this job
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void act(
                    () => declineJob(offer.offer.id),
                    'No problem. It will go to somebody else.',
                  );
                }}
                className="control bg-paper/10 text-paper underline"
              >
                Not this one
              </button>
            </section>
          )}
        </>
      )}

      {approved && <HowYouGetPaid />}
    </div>
  );
}

function JobInHand({
  job,
  busy,
  act,
}: {
  job: CurrentJob;
  busy: boolean;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
}): JSX.Element {
  const [tillError, setTillError] = useState('');

  function onTill(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('till') ?? '');
    const pence = penceFrom(typed);
    if (pence === null) {
      setTillError('Please type the total from the receipt, like 12.34.');
      return;
    }
    setTillError('');
    void act(
      () => submitTillTotal(job.orderId, pence),
      `Thank you. The till total of ${money(pence)} is in.`,
    );
  }

  return (
    <section aria-labelledby="job-heading" className="space-y-6 max-w-xl">
      <h2 id="job-heading" className="text-lead font-bold">
        Your job: shopping for {job.shopperName}
      </h2>

      <div className="space-y-2">
        <h3 className="text-lead font-bold m-0">The list</h3>
        <ul className="m-0 ps-6 space-y-1">
          {job.items.map((item) => (
            <li key={item.id}>
              {item.quantity} × {item.name}
            </li>
          ))}
        </ul>
        <p className="m-0">{SUBSTITUTIONS[job.substitutionDefault]}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lead font-bold m-0">Where it goes</h3>
        <p className="m-0">{job.deliveryAddress}</p>
        {job.doorstepProtocol !== '' && (
          <p className="m-0">At the door, in their words: {job.doorstepProtocol}</p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-lead font-bold m-0">Next</h3>
        {job.status === 'accepted' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act(() => moveJobOn(job.orderId, 'shopping'), 'You are shopping.');
            }}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            I have started shopping
          </button>
        )}

        {job.status === 'shopping' && (
          <form onSubmit={onTill} noValidate className="space-y-3">
            <label htmlFor="till" className="block text-lead font-bold">
              What did the till say?
            </label>
            <p id="till-hint" className="m-0 text-paper/90">
              The total on the receipt, in pounds and pence. The Shopper is charged exactly this.
            </p>
            {tillError !== '' && (
              <p
                role="alert"
                className="m-0 border-2 border-paper bg-paper text-ink p-3 rounded-xl"
              >
                {tillError}
              </p>
            )}
            <input
              id="till"
              name="till"
              type="text"
              inputMode="decimal"
              aria-describedby="till-hint"
              className="w-full max-w-xs min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <button
              type="submit"
              disabled={busy}
              className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
            >
              Put in the till total
            </button>
          </form>
        )}

        {job.status === 'receipt_submitted' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act(() => moveJobOn(job.orderId, 'delivering'), 'You are on your way.');
            }}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            I am on my way
          </button>
        )}

        {job.status === 'delivering' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act(
                () => moveJobOn(job.orderId, 'delivered'),
                `Delivered. Thank you. You have earned ${money(job.runnerPaymentPence)} for this one.`,
              );
            }}
            className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
          >
            I have delivered it
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Where a Runner's pay goes. Their bank details go into Stripe's own form, never into
 * Aldilivery: this only starts that, and says plainly what has been earned and what is waiting.
 */
function HowYouGetPaid(): JSX.Element {
  const [pay, setPay] = useState<RunnerPay | null>(null);
  const [problem, setProblem] = useState('');
  const [going, setGoing] = useState(false);
  const back = new URLSearchParams(window.location.search).get('pay');

  useEffect(() => {
    fetchMyPay()
      .then(setPay)
      .catch((failure: unknown) => {
        setProblem(failure instanceof Error ? failure.message : 'We could not check your pay.');
      });
  }, []);

  async function setUp(): Promise<void> {
    setGoing(true);
    setProblem('');
    try {
      const { url } = await startPaySetup();
      window.location.assign(url);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'We could not open the form.');
      setGoing(false);
    }
  }

  return (
    <section aria-labelledby="pay-heading" className="space-y-3 max-w-xl">
      <h2 id="pay-heading" className="text-lead font-bold">
        How you get paid
      </h2>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {pay === null ? (
        problem === '' && <p className="m-0">Checking.</p>
      ) : (
        <>
          <p className="m-0">
            You have earned {money(pay.totalEarnedPence)} from {pay.completedDeliveryCount}{' '}
            {pay.completedDeliveryCount === 1 ? 'delivery' : 'deliveries'}.
            {pay.owedPence > 0 &&
              ` ${money(pay.owedPence)} more is owed to you and is sent as soon as your bank details are set up.`}
          </p>
          {pay.setup === 'ready' ? (
            <p role={back ? 'status' : undefined} className="m-0">
              Your pay goes straight to your own bank account, through our payment company, Stripe.
            </p>
          ) : (
            <>
              <p role={back ? 'status' : undefined} className="m-0">
                {pay.setup === 'not_started'
                  ? 'Before we can pay you, we need to know where to send the money. You give your bank details to our payment company, Stripe, on their own page. Aldilivery never sees them.'
                  : 'You have started setting up where your pay goes, but Stripe needs a little more from you before it can send money.'}
              </p>
              <button
                type="button"
                disabled={going}
                onClick={() => {
                  void setUp();
                }}
                className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
              >
                {going
                  ? 'Opening Stripe…'
                  : pay.setup === 'not_started'
                    ? 'Set up how you get paid'
                    : 'Finish setting up how you get paid'}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
