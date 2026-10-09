import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ShowWordsSwitch } from '../components/ShowWordsSwitch';
import { storeConfig } from '../config';
import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

import {
  acceptJob,
  agreeToRunnerAgreement,
  ApiUnavailableError,
  fetchRunnerDashboard,
  sendRunnerFeedback,
  setTravelMode,
  type RunnerDashboard,
  type VehicleType,
  askAboutItem,
  declineJob,
  fetchCurrentJob,
  fetchJobQuestions,
  fetchOfferedJobs,
  fetchMyPay,
  fetchRunnerMe,
  moveJobOn,
  setRunnerAvailability,
  startPaySetup,
  submitTillTotal,
  type CurrentJob,
  type ItemAnswer,
  type ItemQuestion,
  type OfferedJob,
  type RunnerAccount,
  type RunnerPay,
} from '../lib/api';
import { AgreeByVoice } from '../components/AgreeByVoice';
import { CallControls } from '../components/CallControls';
import { DocumentsChecklist } from '../components/DocumentsChecklist';
import { JobNavigation } from '../components/JobNavigation';
import { LeaveRunning } from '../components/LeaveRunning';
import { PayoutChoice } from '../components/PayoutChoice';
import { RunnerSos } from '../components/RunnerSos';
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
 *
 * While shopping, each thing on the list has a "Cannot find it" button. It asks the Shopper on
 * their own screen, and their answer comes back here and is said out loud. Nobody's phone
 * number is given to anybody (chosen by Anthony, 27 Sep 2026).
 */

const POLL_MS = 5000;

type TabKey = 'today' | 'jobs' | 'money' | 'training' | 'more';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'money', label: 'Money' },
  { key: 'training', label: 'Training' },
  { key: 'more', label: 'More' },
];

const TRAVEL_WORDS: Record<VehicleType, string> = {
  on_foot: 'Walking',
  bicycle: 'Bicycle',
  motorbike: 'Motorbike or moped',
  car: 'Car',
  van: 'Van',
};

/**
 * What a Runner does when something is not on the shelf (docs/BUILD_PROMPT.md, Section H): the
 * Shopper decides. Never a silent substitution, and never a Runner guessing.
 */
const NOT_ON_THE_SHELF =
  'If something is not on the shelf, ask the Shopper with the Cannot find it button, which also calls them. If they do not answer, leave it out. Never swap anything they have not agreed to.';

const ANSWER_WORDS: Record<ItemAnswer, string> = {
  similar: 'bring something similar',
  leave_out: 'leave it out',
};

function minutesLeft(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

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
  const [questions, setQuestions] = useState<ItemQuestion[]>([]);
  const heardAnswers = useRef<Set<string> | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const [tab, setTab] = useState<TabKey>('today');
  const [dashboard, setDashboard] = useState<RunnerDashboard | null>(null);
  // Raised by "Cannot find it", which starts the call in the same tap (Section H).
  const [ringNow, setRingNow] = useState(0);
  const problemRef = useRef<HTMLParagraphElement>(null);

  const approved = runner
    ? runner.rightToWorkVerified && runner.criminalRecordCheckVerified
    : false;

  const refresh = useCallback(async () => {
    try {
      const me = await fetchRunnerMe();
      setRunner(me.runner);
      // Earnings, jobs and travel. Never allowed to stop the rest of the page working.
      fetchRunnerDashboard()
        .then(setDashboard)
        .catch(() => undefined);
      const current = await fetchCurrentJob();
      setJob(current.job);
      if (current.job && current.job.status !== 'accepted') {
        const asked = (await fetchJobQuestions(current.job.orderId)).questions;
        setQuestions(asked);
        // An answer arriving while the Runner is at the shelf is said out loud, once. Answers
        // already there when the page opened are not news.
        const shopperName = current.job.shopperName;
        const opening = heardAnswers.current === null;
        heardAnswers.current ??= new Set();
        for (const question of asked) {
          if (question.answer === null || heardAnswers.current.has(question.id)) continue;
          heardAnswers.current.add(question.id);
          if (opening) continue;
          setNews(
            question.answeredBy === 'shopper'
              ? `${shopperName} says: ${ANSWER_WORDS[question.answer]}, for the ${question.itemName}.`
              : `No answer in time about the ${question.itemName}, so leave it out. ${shopperName} is not charged for it.`,
          );
        }
      } else {
        setQuestions([]);
      }
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
      if (done) setNews(done);
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
      <details className="max-w-xl">
        <summary className="control px-0 text-paper underline">The screen</summary>
        <ShowWordsSwitch />
      </details>

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

      <nav aria-label="Your Runner pages">
        <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
          {TABS.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={tab === item.key ? 'page' : undefined}
                onClick={() => setTab(item.key)}
                className={`control ${tab === item.key ? 'bg-highlight text-ink' : 'bg-paper/10 text-paper'}`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'today' && (
        <>
          {dashboard && approved && (
            <section aria-labelledby="today-heading" className="space-y-1 max-w-xl">
              <h2 id="today-heading" className="visually-hidden">
                Earned today
              </h2>
              <p className="m-0 text-display font-bold">
                {money(dashboard.earnings.todayPence)} today
              </p>
              <p className="m-0">
                {dashboard.earnings.jobsToday} {dashboard.earnings.jobsToday === 1 ? 'job' : 'jobs'}{' '}
                today. {money(dashboard.earnings.weekPence)} this week.
              </p>
            </section>
          )}
          {dashboard?.insurance && (
            <section aria-labelledby="insurance-heading" className="space-y-2 max-w-xl">
              <h2 id="insurance-heading" className="text-lead font-bold">
                Your motor insurance
              </h2>
              <p className="m-0">{dashboard.insurance.words}</p>
            </section>
          )}
          {dashboard && !job && (
            <TravelToday
              dashboard={dashboard}
              busy={busy}
              onChoose={(mode) => {
                void act(async () => {
                  const result = await setTravelMode(mode);
                  setNews(result.message);
                }, '');
              }}
            />
          )}
          {!approved ? (
            <section aria-labelledby="checks-heading" className="space-y-3 max-w-xl">
              <h2 id="checks-heading" className="text-lead font-bold">
                Waiting for your checks
              </h2>
              <p className="m-0">
                You can go on shift once a person at {storeConfig.productName} has seen both of
                these. We will contact you to arrange it.
              </p>
              <ul className="m-0 ps-6 space-y-2">
                <li>
                  Right to work in the United Kingdom:{' '}
                  {runner.rightToWorkVerified ? 'done' : 'not yet'}.
                </li>
                <li>
                  Criminal record check: {runner.criminalRecordCheckVerified ? 'done' : 'not yet'}.
                </li>
              </ul>
            </section>
          ) : job ? (
            <>
              <JobInHand
                job={job}
                questions={questions}
                busy={busy}
                act={act}
                onNews={setNews}
                travelling={dashboard?.travelling ?? 'on_foot'}
                onAsked={() => setRingNow((count) => count + 1)}
              />
              <CallControls
                orderId={job.orderId}
                as="runner"
                otherName={job.shopperName}
                ringNow={ringNow}
              />
              <RunnerSos />
              <Link
                to={`/runner/jobs/${encodeURIComponent(job.orderId)}/problem`}
                className="control bg-paper/10 text-paper underline"
              >
                Report a problem with this job
              </Link>
            </>
          ) : (
            <>
              {runner.agreementCurrent === false && (
                <AgreeFirst
                  busy={busy}
                  onAgree={(channel) => {
                    void act(async () => {
                      const result = await agreeToRunnerAgreement(
                        RUNNER_AGREEMENT_VERSION,
                        channel,
                      );
                      setNews(result.message);
                    }, '');
                  }}
                />
              )}
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
        </>
      )}

      {tab === 'jobs' && <JobHistory dashboard={dashboard} />}
      {tab === 'money' && (
        <>
          <Money dashboard={dashboard} />
          <div className="max-w-xl">
            <PayoutChoice onNews={setNews} />
          </div>
        </>
      )}
      {tab === 'training' && <Training />}
      {tab === 'more' && (
        <>
          <More dashboard={dashboard} onNews={setNews} />
          {!dashboard?.leftAt && (
            <div className="max-w-xl">
              <LeaveRunning
                onNews={(news) => {
                  setNews(news);
                  void refresh();
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function JobInHand({
  job,
  questions,
  busy,
  act,
  onNews,
  travelling,
  onAsked,
}: {
  job: CurrentJob;
  questions: ItemQuestion[];
  busy: boolean;
  act: (action: () => Promise<unknown>, done: string) => Promise<void>;
  onNews: (text: string) => void;
  /** How they are travelling today, for the directions. */
  travelling: VehicleType;
  /** "Cannot find it" was asked: the call to the Shopper starts in the same tap. */
  onAsked: () => void;
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
    // What we say back includes being paid back for the shopping (ruling 55), in plain words.
    void act(async () => {
      const result = await submitTillTotal(job.orderId, pence);
      onNews(`Thank you. The till total of ${money(pence)} is in. ${result.message}`);
    }, '');
  }

  return (
    <section aria-labelledby="job-heading" className="space-y-6 max-w-xl">
      <h2 id="job-heading" className="text-lead font-bold">
        Your job: shopping for {job.shopperName}
      </h2>

      <div className="space-y-2">
        <h3 className="text-lead font-bold m-0">The list</h3>
        <ul className="m-0 ps-6 space-y-3">
          {job.items.map((item) => {
            const question = questions.find((asked) => asked.orderItemId === item.id);
            return (
              <li key={item.id} className="space-y-2">
                <span>
                  {item.quantity} × {item.name}
                </span>
                {question && <p className="m-0">{questionWords(question, job.shopperName)}</p>}
                {job.status === 'shopping' && !question && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // One tap: the question on their screen, and the call (Section H).
                      void act(async () => {
                        await askAboutItem(job.orderId, item.id);
                        onAsked();
                      }, `We have asked ${job.shopperName} about the ${item.name}. Their answer will appear here.`);
                    }}
                    aria-label={`Cannot find it: ${item.name}`}
                    className="control bg-paper/10 text-paper underline disabled:opacity-70"
                  >
                    Cannot find it
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="m-0">{NOT_ON_THE_SHELF}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lead font-bold m-0">Where it goes</h3>
        <p className="m-0">{job.deliveryAddress}</p>
        {job.doorstepProtocol !== '' && (
          <p className="m-0">At the door, in their words: {job.doorstepProtocol}</p>
        )}
      </div>

      <JobNavigation
        address={job.deliveryAddress}
        mode={travelling}
        stage={job.status === 'accepted' || job.status === 'shopping' ? 'to-shop' : 'to-door'}
      />

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
              The total on the receipt, in pounds and pence. The Shopper is charged exactly this,
              and we pay it back to you straight away.
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

        {job.reimbursementStatus && job.reimbursementPence != null && (
          <p className="m-0">{payBackWords(job.reimbursementStatus, job.reimbursementPence)}</p>
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
              void act(async () => {
                const result = (await moveJobOn(job.orderId, 'delivered')) as {
                  notes?: string[];
                };
                onNews(
                  result.notes && result.notes.length > 0
                    ? `Delivered. Thank you. ${result.notes.join(' ')}`
                    : `Delivered. Thank you. You have earned ${money(job.runnerPaymentPence)} for this one.`,
                );
              }, '');
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

function questionWords(question: ItemQuestion, shopperName: string): string {
  if (question.answer === null) {
    return `Asked ${shopperName}. Waiting for an answer, ${minutesLeft(question.secondsLeft)} left. If there is no answer: ${ANSWER_WORDS[question.ifNoAnswer]}.`;
  }
  return question.answeredBy === 'shopper'
    ? `${shopperName} says: ${ANSWER_WORDS[question.answer]}.`
    : 'No answer in time, so leave it out. They are not charged for it.';
}

/**
 * Where a Runner's pay goes. Their bank details go into Stripe's own form, never into
 * the service: this only starts that, and says plainly what has been earned and what is waiting.
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
                  ? `Before we can pay you, we need to know where to send the money. You give your bank details to our payment company, Stripe, on their own page. ${storeConfig.productName} never sees them.`
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

/**
 * How they are delivering today (ruling, 2 October 2026). Walking or cycling can be chosen at
 * any time, whatever they signed up with. A car or motorbike needs their licence and insurance
 * checked and in date; the server says so if not.
 */
function TravelToday({
  dashboard,
  busy,
  onChoose,
}: {
  dashboard: RunnerDashboard;
  busy: boolean;
  onChoose: (mode: VehicleType) => void;
}): JSX.Element {
  const choices = [...new Set<VehicleType>(['on_foot', 'bicycle', ...dashboard.travelModes])];
  return (
    <section aria-labelledby="travel-heading" className="space-y-3 max-w-xl">
      <h2 id="travel-heading" className="text-lead font-bold">
        Today you are delivering: {TRAVEL_WORDS[dashboard.travelling].toLowerCase()}
      </h2>
      <div className="flex flex-wrap gap-2">
        {choices
          .filter((mode) => mode !== dashboard.travelling)
          .map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={busy}
              onClick={() => onChoose(mode)}
              className="control bg-paper text-ink disabled:opacity-70"
            >
              Switch to {TRAVEL_WORDS[mode].toLowerCase()}
            </button>
          ))}
      </div>
    </section>
  );
}

function day(at: string): string {
  return new Date(at).toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Every job they have done: when, where (the area only), what they earned, and its reference. */
function JobHistory({ dashboard }: { dashboard: RunnerDashboard | null }): JSX.Element {
  return (
    <section aria-labelledby="jobs-heading" className="space-y-3 max-w-xl">
      <h2 id="jobs-heading" className="text-lead font-bold">
        Jobs you have done
      </h2>
      {dashboard === null ? (
        <p className="m-0">Finding your jobs.</p>
      ) : dashboard.jobs.length === 0 ? (
        <p className="m-0">No jobs yet. They will be listed here, newest first.</p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-3">
          {dashboard.jobs.map((job) => (
            <li key={job.reference} className="border-2 border-paper/40 rounded-xl p-4">
              <p className="m-0 font-bold">
                {money(job.earnedPence)}, {day(job.deliveredAt)}
              </p>
              <p className="m-0">
                Area {job.area}. Order {job.reference}. {job.paid ? 'Paid.' : 'Not paid yet.'}
              </p>
              <Link
                to={`/runner/jobs/${encodeURIComponent(job.orderId)}/problem`}
                className="control bg-paper/10 text-paper underline mt-2"
              >
                Report a problem<span className="visually-hidden"> with order {job.reference}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What they have earned and what has been paid out, big and plain. */
/** Where paying a Runner back for the shopping has got to, in plain words (ruling 55). */
function payBackWords(status: 'paid' | 'waiting' | 'owed', pence: number): string {
  if (status === 'paid') return `You've been paid back ${money(pence)} for the shopping.`;
  if (status === 'waiting') {
    return `A person is checking the till total before we pay you back ${money(pence)} for the shopping.`;
  }
  return `We owe you ${money(pence)} for the shopping. It is sent as soon as your bank details are set up.`;
}

/**
 * Agreeing to the Runner agreement before the first job (ruling 55). A tick and a button, kept
 * with the date and the version. No job is offered until it is done.
 */
function AgreeFirst({
  busy,
  onAgree,
}: {
  busy: boolean;
  onAgree: (channel: 'button' | 'voice') => void;
}): JSX.Element {
  const [ticked, setTicked] = useState(false);
  const [problem, setProblem] = useState('');
  return (
    <section aria-labelledby="agree-heading" className="space-y-3 max-w-xl">
      <h2 id="agree-heading" className="text-lead font-bold">
        Before your first job
      </h2>
      <p className="m-0">
        Please read the Runner agreement and say you agree to it. It says how you are paid, that we
        pay you back for the shopping straight away, and what happens if something goes wrong. No
        job is offered to you until you have agreed.
      </p>
      <Link to="/runner/agreement" className="control bg-paper/10 text-paper underline">
        Read the Runner agreement
      </Link>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-3 rounded-xl">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-3 min-h-control">
        <input
          type="checkbox"
          id="agree-runner"
          checked={ticked}
          onChange={(event) => setTicked(event.target.checked)}
          className="h-6 w-6"
        />
        <label htmlFor="agree-runner" className="m-0">
          I have read the Runner agreement and I agree to it
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!ticked) {
            setProblem('Please tick the box to say you agree, or read the agreement first.');
            return;
          }
          setProblem('');
          onAgree('button');
        }}
        className="control w-full bg-highlight text-ink text-lead disabled:opacity-70"
      >
        I agree
      </button>
      <AgreeByVoice busy={busy} onAgree={() => onAgree('voice')} />
    </section>
  );
}

function Money({ dashboard }: { dashboard: RunnerDashboard | null }): JSX.Element {
  if (!dashboard) {
    return (
      <p role="status" className="m-0">
        Working out your money.
      </p>
    );
  }
  return (
    <div className="space-y-6 max-w-xl">
      <section aria-labelledby="earned-heading" className="space-y-2">
        <h2 id="earned-heading" className="text-lead font-bold">
          What you have earned
        </h2>
        <p className="m-0 text-display font-bold">{money(dashboard.earnings.todayPence)} today</p>
        <p className="m-0 text-lead font-bold">{money(dashboard.earnings.weekPence)} this week</p>
        <p className="m-0 text-lead font-bold">{money(dashboard.earnings.allTimePence)} in all</p>
      </section>
      {dashboard.owing && dashboard.owing.length > 0 && (
        <section aria-labelledby="owing-heading" className="space-y-2">
          <h2 id="owing-heading" className="text-lead font-bold">
            Being repaid
          </h2>
          <p className="m-0">
            After a decision that you were responsible for a refund,{' '}
            {dashboard.recoveryPercentOfPay ?? 10}% of each job&rsquo;s pay goes towards it until it
            is repaid. You always keep the rest.
          </p>
          <ul className="m-0 ps-6 space-y-2">
            {dashboard.owing.map((item) => (
              <li key={item.reference + item.amountPence}>
                Order {item.reference}: {money(item.remainingPence)} left of{' '}
                {money(item.amountPence)}. {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dashboard.paidBack && dashboard.paidBack.length > 0 && (
        <section aria-labelledby="paid-back-heading" className="space-y-2">
          <h2 id="paid-back-heading" className="text-lead font-bold">
            Paid back for the shopping
          </h2>
          <p className="m-0">
            Your own money, paid back for what you bought at the till. It is not counted as
            earnings. {money(dashboard.paidBackTotalPence ?? 0)} paid back so far.
          </p>
          <ul className="m-0 ps-6 space-y-2">
            {dashboard.paidBack.map((item) => (
              <li key={item.reference + item.at}>
                Order {item.reference}: {payBackWords(item.status, item.pence)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="paid-heading" className="space-y-2">
        <h2 id="paid-heading" className="text-lead font-bold">
          Paid out to you
        </h2>
        <p className="m-0">
          {money(dashboard.totalTransferredPence)} sent to your bank account so far.
        </p>
        {dashboard.payouts.length > 0 && (
          <ul className="m-0 ps-6 space-y-2">
            {dashboard.payouts.map((payout) => (
              <li key={payout.reference + payout.at}>
                {money(payout.transferredPence)} for order {payout.reference}, {day(payout.at)}
                {payout.coolBagWithheldPence > 0
                  ? `, after ${money(payout.coolBagWithheldPence)} towards your cool box, which you get back`
                  : ''}
                .
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Training (T11). The modules are being written; this is where they will be, each spoken and
 * written, with a record when passed. Some jobs will only be offered after the ones they need.
 */
const MODULES = [
  'Guiding and handing over to a blind or partially sighted person',
  'The door safe word',
  'The handover photograph, and asking first',
  'Calling the Shopper when something is not on the shelf',
  'Food hygiene and the cool box',
  'Working alone safely, and the SOS button',
  'What can and cannot be sent',
  'Safeguarding and the wellbeing check',
  "Looking after people's information",
  'Insurance for delivery work',
];

function Training(): JSX.Element {
  return (
    <section aria-labelledby="training-heading" className="space-y-3 max-w-xl">
      <h2 id="training-heading" className="text-lead font-bold">
        Training
      </h2>
      <p className="m-0">
        Short lessons, read aloud and written, to help you do this job well and grow. They are being
        written now. Each one will show here with a mark when you have passed it.
      </p>
      <ol className="m-0 ps-6 space-y-2">
        {MODULES.map((module) => (
          <li key={module}>{module}: coming soon.</li>
        ))}
      </ol>
    </section>
  );
}

/** Their ID and link, their documents, and a way to tell us things. */
function More({
  dashboard,
  onNews,
}: {
  dashboard: RunnerDashboard | null;
  onNews: (news: string) => void;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedbackProblem, setFeedbackProblem] = useState('');

  async function share(link: string): Promise<void> {
    const text = `Deliver with ${storeConfig.productName}: ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: storeConfig.productName, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      onNews('Your link is copied. You can paste it into a message.');
    } catch {
      // They closed the share sheet: nothing to say.
    }
  }

  return (
    <div className="space-y-8 max-w-xl">
      {dashboard && (
        <section aria-labelledby="id-heading" className="space-y-3">
          <h2 id="id-heading" className="text-lead font-bold">
            Your ID and your link
          </h2>
          <p className="m-0">
            Your Runner ID is{' '}
            <span className="font-bold">{dashboard.runnerId.split('').join(' ')}</span>.
          </p>
          <p className="m-0 break-all">{dashboard.shareLink}</p>
          <button
            type="button"
            onClick={() => {
              void share(dashboard.shareLink);
            }}
            className="control bg-highlight text-ink"
          >
            Share my link
          </button>
        </section>
      )}

      <section aria-labelledby="documents-heading" className="space-y-3">
        <h2 id="documents-heading" className="text-lead font-bold">
          Your documents
        </h2>
        <DocumentsChecklist onNews={onNews} />
      </section>

      <section aria-labelledby="feedback-heading" className="space-y-3">
        <h2 id="feedback-heading" className="text-lead font-bold">
          Tell us something
        </h2>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (message.trim() === '') {
              setFeedbackProblem('Please say what you would like to tell us.');
              return;
            }
            setSending(true);
            setFeedbackProblem('');
            sendRunnerFeedback(message.trim(), anonymous)
              .then((result) => {
                setMessage('');
                onNews(result.message);
              })
              .catch((failure: unknown) => {
                setFeedbackProblem(
                  failure instanceof Error ? failure.message : 'That did not send.',
                );
              })
              .finally(() => setSending(false));
          }}
        >
          <label htmlFor="feedback" className="block font-bold">
            What would you like to tell us?
          </label>
          <textarea
            id="feedback"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          <div className="flex items-center gap-3 min-h-control">
            <input
              id="feedback-anonymous"
              type="checkbox"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
              className="h-6 w-6"
            />
            <label htmlFor="feedback-anonymous">Send it without my name</label>
          </div>
          {feedbackProblem !== '' && (
            <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
              {feedbackProblem}
            </p>
          )}
          <button type="submit" disabled={sending} className="control bg-paper text-ink">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </section>
    </div>
  );
}
