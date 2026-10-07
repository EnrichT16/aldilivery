import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ShowWordsSwitch } from '../components/ShowWordsSwitch';
import { storeConfig } from '../config';
import {
  downloadBusinessStatement,
  fetchBusinessMe,
  fetchOrganisationDashboard,
  rememberBusinessToken,
  saveOrganisationSettings,
  setPersonOffice,
  type BusinessMe,
  type OrganisationDashboard as Dashboard,
} from '../lib/api';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { organisationHelp, understandOrganisation } from '../voice/business-voice';
import { everydayOr } from '../voice/phrases';
import { listWords } from '../voice/staff-voice';
import { DAYS } from './WeeklyShop';

const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

function day(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Every paid order as a spreadsheet, for the organisation's own accounts. */
export function statementCsv(data: Dashboard): string {
  const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const rows = data.orders.map((order) =>
    [
      new Date(order.createdAt).toISOString().slice(0, 10),
      quote(order.person),
      quote(order.office),
      order.items,
      (order.paidPence / 100).toFixed(2),
      order.status,
      order.id,
    ].join(','),
  );
  return ['Date,Person,Office,Items,Paid (GBP),Status,Order reference', ...rows].join('\n');
}

/** What Ozi says about the money, in one go. */
export function spendingWords(data: Dashboard): string {
  const t = data.totals;
  return (
    `This month, ${money(t.spentThisMonthPence)} on ${t.deliveriesThisMonth} deliver${t.deliveriesThisMonth === 1 ? 'y' : 'ies'}. ` +
    `Last month, ${money(t.spentLastMonthPence)}. Altogether, ${money(t.spentAllTimePence)}.`
  );
}

export function savedWords(data: Dashboard): string {
  const saved = data.totals.savedThisMonthPence;
  if (saved === null) {
    return 'To work out what you save, tell me what one of your own staff going to the shops costs you, in the box on the screen called "What a staff trip to the shops costs you".';
  }
  return `About ${money(saved)} saved this month: ${data.totals.deliveriesThisMonth} deliveries at ${money(data.deliveryFeePence)} each, instead of ${money(data.organisation.staffTripCostPence ?? 0)} for a staff trip.`;
}

export function budgetWords(data: Dashboard): string {
  const left = data.totals.budgetLeftPence;
  if (left === null) return 'You have not set a monthly budget. You can, on the screen.';
  return left >= 0
    ? `${money(left)} left of your ${money(data.organisation.monthlyBudgetPence ?? 0)} budget this month.`
    : `This month is ${money(-left)} over your ${money(data.organisation.monthlyBudgetPence ?? 0)} budget.`;
}

/**
 * An organisation's own area (7 October 2026): the people it supports who chose to link to it,
 * who looks after each, every order with who it was for and what it cost, spending by office,
 * budget, savings, what is coming up, and a statement to download. Ozi reads all of it aloud.
 */
export function OrganisationDashboard(): JSX.Element {
  const navigate = useNavigate();
  const ozi = useOzi();
  const [me, setMe] = useState<BusinessMe | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [news, setNews] = useState('');
  const latest = useRef({ ozi, data, navigate });
  const phraseTurn = useRef(0);
  latest.current = { ozi, data, navigate };

  const load = useCallback(
    () =>
      fetchOrganisationDashboard()
        .then((result) => {
          setData(result);
          return result;
        })
        .catch(() => {
          navigate('/business');
          return null;
        }),
    [navigate],
  );

  useEffect(() => {
    const say = (words: string): void => void latest.current.ozi.say(words);
    const handle = (text: string): boolean => {
      const command = understandOrganisation(text);
      const current = latest.current.data;
      if (!command) {
        everydayOr(
          text,
          phraseTurn,
          { kind: 'business' },
          say,
          `Sorry, I didn't catch that. ${organisationHelp()}`,
        );
        return true;
      }
      if (command.kind === 'help') return (say(organisationHelp()), true);
      if (command.kind === 'sign-out') {
        rememberBusinessToken(null);
        say('Signed out. Goodbye.');
        latest.current.navigate('/business');
        return true;
      }
      if (!current) return true;
      switch (command.kind) {
        case 'summary':
        case 'spent':
          say(spendingWords(current));
          break;
        case 'saved':
          say(savedWords(current));
          break;
        case 'budget':
          say(budgetWords(current));
          break;
        case 'orders': {
          const recent = current.orders
            .slice(0, 5)
            .map(
              (order) =>
                `${day(order.createdAt)}, for ${order.person}${order.office ? `, ${order.office}` : ''}, ${money(order.paidPence)}`,
            );
          say(
            recent.length === 0
              ? 'No orders yet.'
              : `The latest ${recent.length === 1 ? 'order' : `${recent.length} orders`}: ${recent.join('. ')}.`,
          );
          break;
        }
        case 'people':
          say(
            current.people.length === 0
              ? `Nobody has linked yet. Give people your code, ${(current.organisation.joinCode ?? '').split('').join(' ')}, to type in their Settings.`
              : `You support ${current.people.length}: ${listWords(current.people.map((person) => (person.office ? `${person.name}, ${person.office}` : person.name)))}.`,
          );
          break;
        case 'offices':
          say(
            current.byOffice.length === 0
              ? 'Nothing spent this month yet.'
              : `This month: ${listWords(current.byOffice.map((row) => `${row.office}, ${money(row.pence)}`))}.`,
          );
          break;
        case 'upcoming':
          say(
            current.upcoming.length === 0
              ? 'No weekly shops are booked.'
              : `Weekly shops booked: ${listWords(current.upcoming.map((row) => `${row.person} every ${DAYS[row.dayOfWeek - 1]}, about ${money(row.estimatePence)}`))}. About ${money(current.totals.upcomingWeeklyPence)} a week altogether.`,
          );
          break;
      }
      return true;
    };
    latest.current.ozi.setPageCommands(handle);
    void Promise.all([fetchBusinessMe().catch(() => null), load()]).then(([who, result]) => {
      if (who) setMe(who);
      if (!result) return;
      say(
        `Welcome${who ? `, ${who.name}` : ''}, to ${result.organisation.name}'s ${storeConfig.productName} area. ` +
          `${spendingWords(result)} ${result.totals.budgetLeftPence !== null ? budgetWords(result) : ''} Say "help" to hear what I can tell you.`,
      );
    });
    return () => latest.current.ozi.setPageCommands(null);
  }, [load]);

  const saveSettings = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const pence = (name: string): number | null => {
      const raw = String(values.get(name) ?? '').replace(/[£,\s]/g, '');
      return raw === '' ? null : Math.round(Number(raw) * 100);
    };
    void saveOrganisationSettings({
      monthlyBudgetPence: pence('budget'),
      staffTripCostPence: pence('trip'),
    }).then((result) => {
      setNews(result.message);
      void load();
    });
  };

  const download = (): void => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([statementCsv(data)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.organisation.name} statement.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setNews('Your statement is downloading.');
  };

  if (!data) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }
  const t = data.totals;
  const tiles: Array<[string, string]> = [
    ['Spent this month', money(t.spentThisMonthPence)],
    ['Deliveries this month', String(t.deliveriesThisMonth)],
    ['Spent last month', money(t.spentLastMonthPence)],
    ['Spent altogether', money(t.spentAllTimePence)],
    ['Left in the budget', t.budgetLeftPence === null ? 'No budget set' : money(t.budgetLeftPence)],
    [
      'Saved this month',
      t.savedThisMonthPence === null ? 'Add your staff trip cost' : money(t.savedThisMonthPence),
    ],
    ['Booked each week', money(t.upcomingWeeklyPence)],
  ];

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-display font-bold m-0">{data.organisation.name}</h1>
      <details className="max-w-xl">
        <summary className="control px-0 text-paper underline">The screen</summary>
        <ShowWordsSwitch />
      </details>
      {me && (
        <p className="m-0">
          Signed in as {me.name}
          {me.office ? `, ${me.office}` : ''}.
        </p>
      )}
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>

      <section aria-labelledby="money-heading" className="space-y-3">
        <h2 id="money-heading" className="text-lead font-bold m-0">
          At a glance
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">
          {tiles.map(([label, value]) => (
            <div key={label} className="border-2 border-paper rounded-xl p-4">
              <dt className="m-0">{label}</dt>
              <dd className="m-0 text-lead font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={() =>
            void downloadBusinessStatement('organisation', data.organisation.name)
              .then(() => setNews('Your statement is downloading, as a PDF.'))
              .catch(() => setNews('The statement could not be made just now.'))
          }
          className="control bg-highlight text-ink"
        >
          Download a statement (PDF)
        </button>{' '}
        <button type="button" onClick={download} className="control bg-paper text-ink">
          Download it as a spreadsheet (CSV)
        </button>
      </section>

      <section aria-labelledby="link-heading" className="space-y-2">
        <h2 id="link-heading" className="text-lead font-bold m-0">
          Linking the people you support
        </h2>
        <p className="m-0">
          Each person, or someone helping them, types your code in their {storeConfig.productName}{' '}
          Settings. They are told first that you will see their orders and what they cost, and they
          can stop it at any time.
        </p>
        {data.sharePath && (
          <>
            <p className="m-0">Or share this link with your staff and the people you support:</p>
            <p className="m-0 break-all">{`${window.location.origin}${data.sharePath}`}</p>
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}${data.sharePath}`;
                const done = (words: string): void => setNews(words);
                if (navigator.share) {
                  void navigator
                    .share({ title: data.organisation.name, url })
                    .then(() => done('Shared.'))
                    .catch(() => undefined);
                } else {
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => done('The link is copied. Paste it into an email or a message.'));
                }
              }}
              className="control bg-paper text-ink"
            >
              Share our link
            </button>
            <label htmlFor="org-meter" className="block font-bold">
              {data.referrals} of 100 people linked or joined through your link
            </label>
            <meter
              id="org-meter"
              min={0}
              max={100}
              value={Math.min(100, data.referrals)}
              className="w-full h-6"
            />
          </>
        )}
        <p className="m-0 text-lead font-bold">
          Your code:{' '}
          <span aria-label={(data.organisation.joinCode ?? '').split('').join(' ')}>
            {data.organisation.joinCode}
          </span>
        </p>
      </section>

      <section aria-labelledby="people-heading" className="space-y-3">
        <h2 id="people-heading" className="text-lead font-bold m-0">
          The people you support
        </h2>
        {data.people.length === 0 && <p className="m-0">Nobody has linked yet.</p>}
        <ul className="list-none m-0 p-0 space-y-2">
          {data.people.map((person) => (
            <li key={person.id} className="border-2 border-paper/40 rounded-xl p-3">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const office = String(new FormData(event.currentTarget).get('office') ?? '');
                  void setPersonOffice(person.id, office).then((result) => {
                    setNews(result.message);
                    void load();
                  });
                }}
                className="flex flex-wrap gap-2 items-end"
              >
                <label className="block flex-1">
                  <span className="block font-bold">{person.name}</span>
                  Office or team that looks after them
                  <input name="office" defaultValue={person.office} className={field} />
                </label>
                <button type="submit" className="control bg-paper text-ink">
                  Save<span className="visually-hidden"> {person.name}'s office</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="orders-heading" className="space-y-3">
        <h2 id="orders-heading" className="text-lead font-bold m-0">
          Orders
        </h2>
        {data.orders.length === 0 && <p className="m-0">No orders yet.</p>}
        <ul className="list-none m-0 p-0 space-y-2">
          {data.orders.map((order) => (
            <li key={order.id} className="border-2 border-paper/40 rounded-xl p-3">
              {day(order.createdAt)}: for {order.person}
              {order.office ? ` (${order.office})` : ''}, {order.items} item
              {order.items === 1 ? '' : 's'}, {money(order.paidPence)}.
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="offices-heading" className="space-y-2">
        <h2 id="offices-heading" className="text-lead font-bold m-0">
          Spending by office this month
        </h2>
        {data.byOffice.length === 0 ? (
          <p className="m-0">Nothing yet this month.</p>
        ) : (
          <ul className="m-0 ps-6">
            {data.byOffice.map((row) => (
              <li key={row.office}>
                {row.office}: {money(row.pence)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="upcoming-heading" className="space-y-2">
        <h2 id="upcoming-heading" className="text-lead font-bold m-0">
          Coming up: weekly shops
        </h2>
        {data.upcoming.length === 0 ? (
          <p className="m-0">None booked.</p>
        ) : (
          <ul className="m-0 ps-6">
            {data.upcoming.map((row, index) => (
              <li key={`${row.person}-${index}`}>
                {row.person}, every {DAYS[row.dayOfWeek - 1]}, about {money(row.estimatePence)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={saveSettings} className="space-y-3" aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="text-lead font-bold m-0">
          Budget and savings
        </h2>
        <label htmlFor="budget" className="block font-bold">
          Monthly budget, in pounds (optional)
        </label>
        <input
          id="budget"
          name="budget"
          inputMode="decimal"
          defaultValue={
            data.organisation.monthlyBudgetPence === null
              ? ''
              : (data.organisation.monthlyBudgetPence / 100).toFixed(2)
          }
          className={field}
        />
        <label htmlFor="trip" className="block font-bold">
          What a staff trip to the shops costs you, in pounds (optional)
        </label>
        <p className="m-0 text-paper/90">
          Staff time and travel for one trip. It is how we work out what you save.
        </p>
        <input
          id="trip"
          name="trip"
          inputMode="decimal"
          defaultValue={
            data.organisation.staffTripCostPence === null
              ? ''
              : (data.organisation.staffTripCostPence / 100).toFixed(2)
          }
          className={field}
        />
        <button type="submit" className="control bg-paper text-ink">
          Save
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          rememberBusinessToken(null);
          navigate('/business');
        }}
        className="control bg-paper/10 text-paper underline"
      >
        Sign out
      </button>
    </div>
  );
}
