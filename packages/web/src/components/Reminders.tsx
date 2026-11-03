import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ukParts, ukWallTimeToDate } from '@aldilivery/core';

import { storeConfig } from '../config';
import {
  cancelReminder,
  createReminder,
  fetchReminders,
  markReminderHeard,
  type ReminderChannel,
  type ReminderRepeat,
  type ReminderRow,
  type RemindersAs,
  type RemindersPage,
} from '../lib/reminders-api';

const REPEAT_WORDS: Record<ReminderRepeat, string> = {
  none: 'Once',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

const CHANNEL_WORDS: Record<ReminderChannel, string> = {
  notification: 'A notification on this device',
  text: 'A text to my phone',
  call: 'A phone call from Ozi',
};

/** Today's UK date, as a date field wants it. */
function todayValue(): string {
  const { year, month, day } = ukParts(new Date());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The Reminders section on every dashboard (Anthony, 3 November 2026, ruling 93): the reminders
 * waiting, soonest first, with Cancel; the last few sent, with "I've heard it"; and a form to set
 * one: the words, the day, the time (UK time), how often and how. A phone call is offered only
 * with the plan that brings it; without it the choice is shown but cannot be chosen, with the
 * server's own kind sentence naming the plan and never a price. Every control is labelled and
 * large; nothing here is read out on its own.
 *
 * By voice: "remind me tomorrow at ten to call the bank" does the same, read back and set on yes.
 */
export function Reminders({ as, id = 'reminders' }: { as: RemindersAs; id?: string }): JSX.Element {
  const [page, setPage] = useState<RemindersPage | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [day, setDay] = useState(todayValue);
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState<ReminderRepeat>('none');
  const [channel, setChannel] = useState<ReminderChannel>('notification');
  const assistant = storeConfig.assistantName;

  const load = useCallback((): void => {
    fetchReminders(as)
      .then((result) => {
        setPage(result);
        setProblem('');
      })
      .catch((failure: unknown) => {
        setPage(null);
        setProblem(failure instanceof Error ? failure.message : 'Reminders cannot be read now.');
      });
  }, [as]);
  useEffect(load, [load]);

  const fail = (failure: unknown): void =>
    setProblem(failure instanceof Error ? failure.message : 'That did not work.');

  const set = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (text.trim() === '') {
      setProblem('Please say what to remind you about.');
      return;
    }
    const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dayMatch || !timeMatch) {
      setProblem('Please choose the day and the time.');
      return;
    }
    const dueAt = ukWallTimeToDate(
      Number(dayMatch[1]),
      Number(dayMatch[2]),
      Number(dayMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
    );
    setProblem('');
    setBusy(true);
    createReminder(as, { text: text.trim(), dueAt: dueAt.toISOString(), repeat, channel })
      .then((result) => {
        setNews(result.message);
        setText('');
        setTime('');
        load();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const cancel = (row: ReminderRow): void => {
    setBusy(true);
    cancelReminder(as, row.id)
      .then((result) => {
        setNews(result.message);
        load();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const heard = (row: ReminderRow): void => {
    setBusy(true);
    markReminderHeard(as, row.id)
      .then(() => {
        setNews('Marked as heard.');
        load();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  };

  const waiting = page?.reminders.filter((row) => row.status === 'scheduled') ?? [];
  const sent = page?.reminders.filter((row) => row.status !== 'scheduled') ?? [];
  const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
  const callAllowed = page?.callAllowed ?? false;

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 max-w-xl">
      <h2 id={`${id}-heading`} className="text-lead font-bold m-0">
        Reminders
      </h2>
      <p className="m-0">
        {assistant} reminds you when the time comes: a notification, a text or a phone call. You can
        also just say it: &ldquo;remind me tomorrow at ten to call the bank&rdquo;.
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-highlight rounded-2xl p-3">
          {problem}
        </p>
      )}

      {page && (
        <>
          <h3 className="text-lead font-bold m-0">Waiting</h3>
          {waiting.length === 0 ? (
            <p className="m-0">No reminders waiting.</p>
          ) : (
            <ul className="list-none m-0 p-0 space-y-3">
              {waiting.map((row) => (
                <li key={row.id} className="border-2 border-paper rounded-2xl p-4 space-y-2">
                  <p className="m-0 font-bold">{row.text}</p>
                  <p className="m-0">
                    {row.whenWords.charAt(0).toUpperCase()}
                    {row.whenWords.slice(1)}. {CHANNEL_WORDS[row.channel]}.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => cancel(row)}
                    className="control border-paper bg-paper/10 text-paper"
                  >
                    Cancel this reminder
                  </button>
                </li>
              ))}
            </ul>
          )}

          {sent.length > 0 && (
            <>
              <h3 className="text-lead font-bold m-0">Sent</h3>
              <ul className="list-none m-0 p-0 space-y-3">
                {sent.map((row) => (
                  <li key={row.id} className="border-2 border-paper/50 rounded-2xl p-4 space-y-2">
                    <p className="m-0 font-bold">{row.text}</p>
                    <p className="m-0">
                      {row.status === 'heard' ? 'Heard.' : 'Sent.'}{' '}
                      {row.sentAt
                        ? new Date(row.sentAt).toLocaleString('en-GB', {
                            timeZone: 'Europe/London',
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </p>
                    {row.status === 'sent' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => heard(row)}
                        className="control border-paper bg-paper/10 text-paper"
                      >
                        I&rsquo;ve heard it
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <form onSubmit={set} className="space-y-4" aria-labelledby={`${id}-new-heading`}>
            <h3 id={`${id}-new-heading`} className="text-lead font-bold m-0">
              Set a reminder
            </h3>
            <div className="space-y-1">
              <label htmlFor={`${id}-text`} className="block font-bold">
                What to remind you about
              </label>
              <p id={`${id}-text-hint`} className="m-0 extra">
                A few words. Numbers and addresses are left out, so it can be read aloud.
              </p>
              <input
                id={`${id}-text`}
                type="text"
                value={text}
                maxLength={page.maxTextLength}
                aria-describedby={`${id}-text-hint`}
                onChange={(event) => setText(event.target.value)}
                className={field}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-day`} className="block font-bold">
                  Day
                </label>
                <input
                  id={`${id}-day`}
                  type="date"
                  value={day}
                  onChange={(event) => setDay(event.target.value)}
                  className={field}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-time`} className="block font-bold">
                  Time (UK time)
                </label>
                <input
                  id={`${id}-time`}
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className={field}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-repeat`} className="block font-bold">
                How often
              </label>
              <select
                id={`${id}-repeat`}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as ReminderRepeat)}
                className={field}
              >
                {page.repeats.map((option) => (
                  <option key={option} value={option}>
                    {REPEAT_WORDS[option]}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="border-2 border-paper/40 rounded-2xl p-4 m-0 space-y-2">
              <legend className="px-2 font-bold">How to remind you</legend>
              {!callAllowed && page.callPlanWords && (
                <p id={`${id}-call-hint`} className="m-0 extra">
                  {page.callPlanWords}
                </p>
              )}
              {page.channels.map((option) => {
                const disabled = option === 'call' && !callAllowed;
                return (
                  <div key={option} className="flex items-center gap-3 min-h-control">
                    <input
                      id={`${id}-channel-${option}`}
                      type="radio"
                      name={`${id}-channel`}
                      value={option}
                      checked={channel === option}
                      disabled={disabled}
                      aria-describedby={disabled ? `${id}-call-hint` : undefined}
                      onChange={() => setChannel(option)}
                      className="h-7 w-7 shrink-0"
                    />
                    <label htmlFor={`${id}-channel-${option}`}>{CHANNEL_WORDS[option]}</label>
                  </div>
                );
              })}
            </fieldset>
            <button type="submit" disabled={busy} className="control bg-highlight text-on-accent">
              Set reminder
            </button>
          </form>
        </>
      )}
    </section>
  );
}
