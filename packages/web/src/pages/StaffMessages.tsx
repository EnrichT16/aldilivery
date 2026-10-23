import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { storeConfig } from '../config';
import { connectToCall, type CallConnection } from '../lib/call-connection';
import {
  ACCOUNT_KIND_WORDS,
  askForMessageCode,
  endCompanyCallByStaff,
  enterCallCode,
  fetchCallRecording,
  fetchCompanyCallState,
  fetchContactLog,
  fetchContactMe,
  fetchContactStaff,
  fetchStaffThread,
  fetchStaffThreads,
  issueContactCode,
  ringCompanyCallPhone,
  searchContactAccounts,
  sendCompanyMessage,
  startCompanyCall,
  whenWords,
  type AccountKind,
  type ContactAccount,
  type ContactLogEntry,
  type ContactMe,
  type StaffCallView,
  type StaffInboxMessage,
} from '../lib/inbox-api';
import { useOzi } from '../state/ozi';

/**
 * The admin panel's Messages tab (ruling 77): the company inbox from the staff side. Threads with
 * every account, unread replies first; writing to any Shopper, Runner, Shop Partner or
 * organisation; calling them; codes; and the messages and calls log.
 *
 * No staff member messages or calls at will: pressing Send asks for a message code, and calling
 * asks for the day's call code, unless the person is the owner or someone he lets authorise. A
 * staff member without a code can press "Ask for a code", which puts the message on Ozi's desk.
 */

const FIELD = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
const SECOND = 'control min-h-control border-paper bg-paper/10 text-paper';
const FIRST = 'control min-h-control bg-highlight text-on-accent';
/** Not answered in the app after this long: ring their phone instead, if it can be rung. */
const PHONE_FALLBACK_MS = 30_000;

function errorText(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

function authorisedWords(
  by: 'self' | 'code' | 'desk' | null,
  name: string | null,
  sender: string,
): string {
  if (by === 'code') return `with a code from ${name ?? 'an authoriser'}`;
  if (by === 'desk') return `approved on the desk by ${name ?? 'the owner'}`;
  if (by === 'self') return `by ${name ?? sender}, who needs no code`;
  return 'waiting for approval';
}

export function StaffMessages({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const [me, setMe] = useState<ContactMe | null>(null);
  const [problem, setProblem] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [chosen, setChosen] = useState<ContactAccount | null>(null);

  const reloadMe = useCallback(() => {
    fetchContactMe(staffKey)
      .then(setMe)
      .catch((failure: unknown) => setProblem(errorText(failure, 'That could not be loaded.')));
  }, [staffKey]);
  useEffect(reloadMe, [reloadMe]);

  const changed = (text: string): void => {
    onNews(text);
    setRefresh((value) => value + 1);
    reloadMe();
  };

  return (
    <section aria-labelledby="messages-heading" className="space-y-8 max-w-3xl">
      <h2 id="messages-heading" className="text-lead font-bold m-0">
        Messages
      </h2>
      <p className="m-0">
        Messages and calls between {storeConfig.productName} and every account. Accounts never
        message each other here.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {me && (
        <p className="m-0">
          {me.authoriser
            ? 'You may authorise: you send and call without a code, and you issue codes to others.'
            : `Each message needs a message code, and calls need today's call code. ${me.callCodeActive ? "Today's call code is in." : ''}`}{' '}
          {me.recordingOn
            ? 'Every call is recorded, and both sides are told.'
            : 'Calls are not recorded yet: recording storage is not set up.'}
        </p>
      )}
      <Threads key={`threads-${refresh}`} staffKey={staffKey} onChoose={setChosen} />
      <Compose
        staffKey={staffKey}
        me={me}
        chosen={chosen}
        onChoose={setChosen}
        onChanged={changed}
      />
      {me?.authoriser && <IssueCode staffKey={staffKey} onNews={onNews} />}
      <ContactLog key={`log-${refresh}`} staffKey={staffKey} />
    </section>
  );
}

/** The threads, newest first, each with how many replies are not read yet. */
function Threads({
  staffKey,
  onChoose,
}: {
  staffKey: string;
  onChoose: (account: ContactAccount) => void;
}): JSX.Element {
  const [threads, setThreads] = useState<Awaited<ReturnType<typeof fetchStaffThreads>> | null>(
    null,
  );
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<StaffInboxMessage[]>([]);
  const [problem, setProblem] = useState('');

  const load = useCallback(() => {
    fetchStaffThreads(staffKey)
      .then(setThreads)
      .catch((failure: unknown) => setProblem(errorText(failure, 'That could not be loaded.')));
  }, [staffKey]);
  useEffect(load, [load]);

  const openThread = (id: string): void => {
    fetchStaffThread(staffKey, id)
      .then((result) => {
        setOpen(id);
        setMessages(result.messages);
        onChoose({
          id: result.thread.accountId,
          kind: result.thread.accountKind,
          name: result.thread.accountName,
          word: result.thread.accountWord,
        });
        load();
      })
      .catch((failure: unknown) => setProblem(errorText(failure, 'That could not be opened.')));
  };

  return (
    <section aria-labelledby="threads-heading" className="space-y-3">
      <h3 id="threads-heading" className="m-0 font-bold">
        Conversations
      </h3>
      {problem !== '' && <p role="alert">{problem}</p>}
      {threads && (
        <p role="status" className="m-0">
          {threads.unread === 0
            ? 'No unread replies.'
            : `${threads.unread} unread ${threads.unread === 1 ? 'reply' : 'replies'}.`}
        </p>
      )}
      {threads?.threads.length === 0 && <p className="m-0">No conversations yet.</p>}
      <ul className="list-none m-0 p-0 space-y-2">
        {threads?.threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => openThread(thread.id)}
              aria-expanded={open === thread.id}
              className={`${SECOND} w-full !justify-start text-left`}
            >
              {thread.accountWord} {thread.accountName}
              {thread.unread > 0 ? `, ${thread.unread} unread` : ''}
              {thread.held > 0 ? `, ${thread.held} waiting for approval` : ''}
              {`, last ${whenWords(thread.lastMessageAt)}`}
            </button>
            {open === thread.id && (
              <ol
                className="list-none m-0 mt-2 p-0 space-y-2"
                aria-label={`Messages with ${thread.accountName}, oldest first`}
              >
                {messages.map((message) => (
                  <li key={message.id} className="border-2 border-paper rounded-2xl p-3">
                    <p className="m-0 font-bold">
                      {message.fromStaff
                        ? `${message.senderName}, ${message.status === 'sent' ? `sent ${whenWords(message.sentAt)}` : message.status === 'held' ? 'waiting for approval' : 'declined'}`
                        : `${thread.accountName}, ${whenWords(message.sentAt)}`}
                      {message.fromStaff && message.status === 'sent'
                        ? message.readAt
                          ? `, read ${whenWords(message.readAt)}`
                          : ', not read yet'
                        : ''}
                    </p>
                    <p className="m-0 whitespace-pre-wrap">{message.text}</p>
                    {message.fromStaff && (
                      <p className="m-0 extra">
                        Sent{' '}
                        {authorisedWords(
                          message.authorisedBy,
                          message.authorisedByName,
                          message.senderName,
                        )}
                        .
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Choosing an account, writing to it, and calling it. */
function Compose({
  staffKey,
  me,
  chosen,
  onChoose,
  onChanged,
}: {
  staffKey: string;
  me: ContactMe | null;
  chosen: ContactAccount | null;
  onChoose: (account: ContactAccount | null) => void;
  onChanged: (text: string) => void;
}): JSX.Element {
  const ozi = useOzi();
  const [kind, setKind] = useState<AccountKind>('runner');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<ContactAccount[] | null>(null);
  const [text, setText] = useState('');
  const [askingCode, setAskingCode] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (askingCode) codeRef.current?.focus();
  }, [askingCode]);

  const find = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setProblem('');
    searchContactAccounts(staffKey, kind, search.trim())
      .then((result) => setFound(result.accounts))
      .catch((failure: unknown) => setProblem(errorText(failure, 'That search did not work.')));
  };

  const send = async (withCode: boolean): Promise<void> => {
    if (!chosen) return;
    if (text.trim() === '') {
      setProblem('Please write the message first.');
      return;
    }
    // Pressing Send asks for the code, unless this person may authorise.
    if (!me?.authoriser && !withCode) {
      setAskingCode(true);
      setProblem('');
      void ozi.say('Please type your message code, then press Send with this code.');
      return;
    }
    setBusy(true);
    try {
      const result = await sendCompanyMessage(staffKey, {
        accountKind: chosen.kind,
        accountId: chosen.id,
        text: text.trim(),
        ...(withCode ? { code: code.trim() } : {}),
      });
      setText('');
      setCode('');
      setAskingCode(false);
      setProblem('');
      onChanged(result.words);
    } catch (failure) {
      setProblem(errorText(failure, 'That message was not sent.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const ask = async (): Promise<void> => {
    if (!chosen) return;
    if (text.trim() === '') {
      setProblem('Please write the message first, so the owner can hear it.');
      return;
    }
    setBusy(true);
    try {
      const result = await askForMessageCode(staffKey, {
        accountKind: chosen.kind,
        accountId: chosen.id,
        text: text.trim(),
      });
      setText('');
      setAskingCode(false);
      setProblem('');
      onChanged(result.words);
    } catch (failure) {
      setProblem(errorText(failure, 'That could not be asked.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="compose-heading" className="space-y-4">
      <h3 id="compose-heading" className="m-0 font-bold">
        Write to an account, or call them
      </h3>
      <form onSubmit={find} className="space-y-2" aria-label="Find an account">
        <label htmlFor="contact-kind" className="block font-bold">
          Which kind of account
        </label>
        <select
          id="contact-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as AccountKind)}
          className={FIELD}
        >
          {(Object.keys(ACCOUNT_KIND_WORDS) as AccountKind[]).map((value) => (
            <option key={value} value={value}>
              {ACCOUNT_KIND_WORDS[value]}
            </option>
          ))}
        </select>
        <label htmlFor="contact-search" className="block font-bold">
          Their name
        </label>
        <input
          id="contact-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={FIELD}
        />
        <button type="submit" className={FIRST}>
          <span aria-hidden="true">🔍 </span>
          Find
        </button>
      </form>
      {found && (
        <p role="status" className="m-0">
          {found.length === 0
            ? 'Nobody found by that name.'
            : `${found.length} found. Choose one below.`}
        </p>
      )}
      {found && found.length > 0 && (
        <ul className="list-none m-0 p-0 flex flex-wrap gap-2" aria-label="Accounts found">
          {found.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                aria-pressed={chosen?.id === account.id}
                onClick={() => onChoose(account)}
                className={SECOND}
              >
                {account.word} {account.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <div className="space-y-3 border-2 border-paper rounded-2xl p-4">
          <p className="m-0 font-bold">
            To {chosen.word} {chosen.name}
          </p>
          <label htmlFor="contact-text" className="block">
            Your message
          </label>
          <textarea
            id="contact-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            maxLength={2000}
            className={FIELD}
          />
          {askingCode && (
            <div className="space-y-2">
              <label htmlFor="message-code" className="block font-bold">
                Message code, 6 numbers
              </label>
              <input
                ref={codeRef}
                id="message-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                className={FIELD}
              />
              <p className="m-0 extra">
                Without a valid code, nothing is sent. A code works once, for you only, for{' '}
                {me?.messageCodeMinutes ?? 120} minutes.
              </p>
            </div>
          )}
          {problem !== '' && (
            <p role="alert" className="m-0">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(askingCode)}
              className={FIRST}
            >
              <span aria-hidden="true">➤ </span>
              {askingCode ? 'Send with this code' : 'Send'}
            </button>
            {!me?.authoriser && (
              <button type="button" disabled={busy} onClick={() => void ask()} className={SECOND}>
                <span aria-hidden="true">?</span> Ask for a code
              </button>
            )}
          </div>
          <StaffCallPanel staffKey={staffKey} me={me} account={chosen} onChanged={onChanged} />
        </div>
      )}
    </section>
  );
}

/** Calling the chosen account, with the day's call code if this person needs one. */
function StaffCallPanel({
  staffKey,
  me,
  account,
  onChanged,
}: {
  staffKey: string;
  me: ContactMe | null;
  account: ContactAccount;
  onChanged: (text: string) => void;
}): JSX.Element {
  const ozi = useOzi();
  const [call, setCall] = useState<StaffCallView | null>(null);
  const [phoneAvailable, setPhoneAvailable] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [muted, setMuted] = useState(false);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const connection = useRef<CallConnection | null>(null);
  const say = useRef(ozi.say);
  say.current = ozi.say;

  // While it rings: watch for an answer, and ring their phone if the app does not answer.
  useEffect(() => {
    if (!call || call.status === 'ended') return undefined;
    const started = Date.now();
    let rangPhone = call.phoneRung;
    const timer = window.setInterval(() => {
      fetchCompanyCallState(staffKey, call.id)
        .then(async ({ call: now }) => {
          if (now.status !== call.status) setCall(now);
          if (
            now.status === 'ringing' &&
            !rangPhone &&
            phoneAvailable &&
            Date.now() - started > PHONE_FALLBACK_MS
          ) {
            rangPhone = true;
            const rung = await ringCompanyCallPhone(staffKey, call.id);
            setNews(rung.words);
            void say.current(rung.words);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [call, phoneAvailable, staffKey]);

  useEffect(
    () => () => {
      void connection.current?.leave();
    },
    [],
  );

  const start = async (ringPhone = false): Promise<void> => {
    setProblem('');
    if (!me?.callsOn) {
      setProblem('Calls are not switched on yet.');
      return;
    }
    if (!me.callCodeActive && !needCode) {
      setNeedCode(true);
      void say.current("Please type today's call code, then press Call with this code.");
      return;
    }
    try {
      const result = await startCompanyCall(staffKey, {
        accountKind: account.kind,
        accountId: account.id,
        ...(needCode && code ? { code: code.trim() } : {}),
        ...(ringPhone ? { ringPhone: true } : {}),
      });
      setNeedCode(false);
      setCode('');
      setCall(result.call);
      setPhoneAvailable(result.phoneAvailable);
      setNews(result.words);
      // Both sides are told the call is recorded, before anything else.
      await say.current(result.words);
      connection.current = await connectToCall(result.join, {
        onOthersChanged: () => undefined,
        onDisconnected: () => {
          connection.current = null;
        },
      });
      onChanged(`Calling ${account.name}.`);
    } catch (failure) {
      setProblem(errorText(failure, 'The call could not be made.'));
      setCode('');
      if (failure instanceof Error && /call code/i.test(failure.message)) setNeedCode(true);
    }
  };

  const ringPhone = async (): Promise<void> => {
    if (!call) return;
    try {
      const rung = await ringCompanyCallPhone(staffKey, call.id);
      setCall(rung.call);
      setNews(rung.words);
      void say.current(rung.words);
    } catch (failure) {
      setProblem(errorText(failure, 'Their phone could not be rung.'));
    }
  };

  const end = async (): Promise<void> => {
    if (!call) return;
    await connection.current?.leave().catch(() => undefined);
    connection.current = null;
    try {
      const ended = await endCompanyCallByStaff(staffKey, call.id);
      setCall(null);
      setNews('');
      onChanged(
        ended.call.answeredAt
          ? `The call with ${account.name} ended after ${ended.call.durationSeconds} seconds.`
          : `${account.name} did not answer.`,
      );
    } catch (failure) {
      setProblem(errorText(failure, 'The call could not be ended.'));
    }
  };

  const live = call && call.status !== 'ended';
  return (
    <div className="space-y-2">
      {live && (
        <p role="alert" className="m-0 font-bold">
          This call is recorded.{' '}
          {call.status === 'ringing'
            ? `Ringing ${account.name}.`
            : `On the call with ${account.name}.`}
        </p>
      )}
      {news !== '' && (
        <p role="status" className="m-0">
          {news}
        </p>
      )}
      {needCode && !live && (
        <div className="space-y-2">
          <label htmlFor="call-code" className="block font-bold">
            Today&rsquo;s call code, 6 numbers
          </label>
          <input
            id="call-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            className={FIELD}
          />
        </div>
      )}
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!live && (
          <button type="button" onClick={() => void start()} className={SECOND}>
            <span aria-hidden="true">📞 </span>
            {needCode ? 'Call with this code' : `Call ${account.name}`}
          </button>
        )}
        {live && call.status === 'ringing' && phoneAvailable && !call.phoneRung && (
          <button type="button" onClick={() => void ringPhone()} className={SECOND}>
            <span aria-hidden="true">☎ </span>
            Ring their phone instead
          </button>
        )}
        {live && (
          <button
            type="button"
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              void connection.current?.setMuted(next);
            }}
            className={SECOND}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        {live && (
          <button type="button" onClick={() => void end()} className={FIRST}>
            <span aria-hidden="true">✕ </span>
            End call
          </button>
        )}
      </div>
      {me && me.callsOn && !me.callCodeActive && !needCode && !live && (
        <EnterCallCode staffKey={staffKey} onDone={onChanged} />
      )}
    </div>
  );
}

/** Entering the day's call code on its own, once: good until midnight. */
function EnterCallCode({
  staffKey,
  onDone,
}: {
  staffKey: string;
  onDone: (text: string) => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState('');
  return (
    <form
      className="space-y-2"
      aria-label="Enter today's call code"
      onSubmit={(event) => {
        event.preventDefault();
        enterCallCode(staffKey, code.trim())
          .then((result) => {
            setCode('');
            onDone(result.message);
          })
          .catch((failure: unknown) => {
            setCode('');
            setProblem(errorText(failure, 'That code did not work.'));
          });
      }}
    >
      <label htmlFor="day-call-code" className="block">
        Enter today&rsquo;s call code once, for your calls until midnight
      </label>
      <input
        id="day-call-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        className={FIELD}
      />
      {problem !== '' && <p role="alert">{problem}</p>}
      <button type="submit" className={SECOND}>
        Enter call code
      </button>
    </form>
  );
}

/** For the owner and authorisers: a message code, or a day's call code, for one person. */
function IssueCode({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const [staff, setStaff] = useState<Array<{ id: string; name: string; title: string }>>([]);
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<'message' | 'call'>('message');
  const [shown, setShown] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    fetchContactStaff(staffKey)
      .then((result) => {
        setStaff(result.staff);
        setWho((current) => current || result.staff[0]?.id || '');
      })
      .catch((failure: unknown) => setProblem(errorText(failure, 'That could not be loaded.')));
  }, [staffKey]);

  return (
    <form
      className="space-y-3"
      aria-labelledby="issue-code-heading"
      onSubmit={(event) => {
        event.preventDefault();
        setShown('');
        issueContactCode(staffKey, who, kind)
          .then((result) => {
            setShown(result.message);
            onNews('A code was issued. It is shown once.');
          })
          .catch((failure: unknown) => setProblem(errorText(failure, 'No code was issued.')));
      }}
    >
      <h3 id="issue-code-heading" className="m-0 font-bold">
        Issue a code
      </h3>
      <label htmlFor="code-for" className="block">
        For
      </label>
      <select
        id="code-for"
        value={who}
        onChange={(event) => setWho(event.target.value)}
        className={FIELD}
      >
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}, {member.title}
          </option>
        ))}
      </select>
      <fieldset className="space-y-2 border-0 p-0 m-0">
        <legend className="font-bold">Which code</legend>
        <label className="control min-h-control !justify-start gap-2 bg-paper/10 text-paper">
          <input
            type="radio"
            name="code-kind"
            checked={kind === 'message'}
            onChange={() => setKind('message')}
          />
          A message code: one message, for two hours
        </label>
        <label className="control min-h-control !justify-start gap-2 bg-paper/10 text-paper">
          <input
            type="radio"
            name="code-kind"
            checked={kind === 'call'}
            onChange={() => setKind('call')}
          />
          Today&rsquo;s call code: their calls until midnight
        </label>
      </fieldset>
      {problem !== '' && <p role="alert">{problem}</p>}
      {shown !== '' && (
        <p role="status" className="m-0 border-2 border-highlight rounded-2xl p-4">
          {shown}
        </p>
      )}
      <button type="submit" className={FIRST} disabled={who === ''}>
        Issue the code
      </button>
    </form>
  );
}

/** Every message and call by staff, newest first: who, to whom, when, and what authorised it. */
function ContactLog({ staffKey }: { staffKey: string }): JSX.Element {
  const [log, setLog] = useState<{ entries: ContactLogEntry[]; everyone: boolean } | null>(null);
  const [problem, setProblem] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      player.current?.pause();
    },
    [],
  );

  useEffect(() => {
    fetchContactLog(staffKey)
      .then(setLog)
      .catch((failure: unknown) => setProblem(errorText(failure, 'The log could not be loaded.')));
  }, [staffKey]);

  /** Plays through a link that works for a few minutes; pressed again, it stops. */
  const play = (id: string): void => {
    player.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    fetchCallRecording(staffKey, id)
      .then((result) => {
        const audio = new Audio(result.url);
        audio.onended = () => setPlaying(null);
        player.current = audio;
        setPlaying(id);
        return Promise.resolve(audio.play());
      })
      .catch((failure: unknown) => {
        setPlaying(null);
        setProblem(errorText(failure, 'That recording could not be played.'));
      });
  };

  const duration = (seconds: number): string =>
    seconds < 60
      ? `${seconds} seconds`
      : `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`;

  return (
    <section aria-labelledby="contact-log-heading" className="space-y-3">
      <h3 id="contact-log-heading" className="m-0 font-bold">
        Messages and calls log
      </h3>
      <p className="m-0 extra">
        {log?.everyone
          ? 'Every message and call by staff, newest first.'
          : 'Your own messages and calls, newest first.'}{' '}
        Everything here is in the audit log too.
      </p>
      {problem !== '' && <p role="alert">{problem}</p>}
      {log && log.entries.length === 0 && <p className="m-0">Nothing yet.</p>}
      {log && log.entries.length > 0 && (
        <ol className="list-none m-0 p-0 space-y-2" aria-label="Messages and calls, newest first">
          {log.entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="border-2 border-paper rounded-2xl p-3">
              {entry.kind === 'message' ? (
                <p className="m-0">
                  <strong>{whenWords(entry.at)}.</strong> Message from {entry.staffName} to{' '}
                  {entry.recipientWord} {entry.recipientName},{' '}
                  {entry.status === 'sent'
                    ? `sent ${authorisedWords(entry.authorisedBy, entry.authorisedByName, entry.staffName)}${entry.readAt ? `, read ${whenWords(entry.readAt)}` : ''}`
                    : entry.status === 'held'
                      ? 'waiting for approval on the desk'
                      : `declined by ${entry.authorisedByName ?? 'the owner'}`}
                  .
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="m-0">
                    <strong>{whenWords(entry.at)}.</strong> Call from {entry.staffName} to{' '}
                    {entry.recipientWord} {entry.recipientName}
                    {entry.phoneRung ? ', rung on their phone' : ''},{' '}
                    {authorisedWords(entry.authorisedBy, entry.authorisedByName, entry.staffName)}.{' '}
                    {entry.answered
                      ? `Answered ${whenWords(entry.answeredAt)}${entry.endedAt ? `, ended ${whenWords(entry.endedAt)}, ${duration(entry.durationSeconds)}` : ', still on'}.`
                      : entry.status === 'ended'
                        ? 'Not answered.'
                        : 'Ringing.'}{' '}
                    {entry.recording.status === 'saved'
                      ? 'Recorded.'
                      : entry.recording.note
                        ? `Recording: ${entry.recording.note}.`
                        : ''}
                  </p>
                  {entry.recording.playable && (
                    <button
                      type="button"
                      aria-pressed={playing === entry.id}
                      onClick={() => play(entry.id)}
                      className={SECOND}
                    >
                      <span aria-hidden="true">{playing === entry.id ? '■ ' : '▶ '}</span>
                      {playing === entry.id ? 'Stop the recording' : 'Play the recording'}
                      <span className="visually-hidden"> of the call to {entry.recipientName}</span>
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
