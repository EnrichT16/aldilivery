import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { connectToCall, type CallConnection } from '../lib/call-connection';
import {
  READ_MESSAGES,
  answerCompanyCall,
  answerVoucherRing,
  endCompanyCall,
  fetchCompanyCall,
  fetchInbox,
  fetchInboxUnread,
  markInboxRead,
  markVoucherUsed,
  readMessagesAloud,
  replyToInbox,
  whenWords,
  type CompanyCall,
  type InboxAs,
  type InboxMessage,
  type InboxVoucher,
  type OziVoucherRing,
} from '../lib/inbox-api';
import { useOzi } from '../state/ozi';

/**
 * The company inbox (ruling 77): messages from the company to this account, how many are new, and
 * a reply, typed or said. Read aloud by Ozi when asked ("read my messages"). Accounts never message
 * each other here: every message is between the company and this one account.
 */

const UNREAD_POLL_MS = 30_000;
const CALL_POLL_MS = 5_000;

/** How many messages are new: for the link on each account's main page. */
export function useInboxUnread(
  as: InboxAs,
  on = true,
): { unread: number; ringing: boolean; ozi: OziVoucherRing | null } {
  const [state, setState] = useState<{
    unread: number;
    ringing: boolean;
    ozi: OziVoucherRing | null;
  }>({ unread: 0, ringing: false, ozi: null });
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const ask = (): void => {
      fetchInboxUnread(as)
        .then((result) => {
          if (live && result && typeof result.unread === 'number') {
            setState({
              unread: result.unread,
              ringing: result.call !== null && result.call !== undefined,
              ozi: result.ozi ?? null,
            });
          }
        })
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, UNREAD_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [as, on]);
  return state;
}

/** "Messages, 2 new": a link to the inbox, with words beside any mark, never colour alone. */
export function InboxLink({
  as,
  to,
  className = 'control bg-paper/10 text-paper',
}: {
  as: InboxAs;
  to: string;
  className?: string;
}): JSX.Element {
  const { unread, ringing, ozi } = useInboxUnread(as);
  const [done, setDone] = useState<string | null>(null);
  return (
    <>
      <Link to={to} className={className}>
        <span aria-hidden="true">✉ </span>
        Messages
        {unread > 0 ? `, ${unread} new` : ''}
        {ringing || (ozi && ozi.id !== done) ? `. ${storeConfig.productName} is calling` : ''}
      </Link>
      {ozi && ozi.id !== done && <OziVoucherCall as={as} ring={ozi} onDone={setDone} />}
    </>
  );
}

/**
 * Ozi ringing in the app about a voucher the person has not opened (Anthony, 30 October 2026):
 * announced to a screen reader, Answer or Not now. Answered, Ozi says the words aloud and they
 * stay on the screen.
 */
export function OziVoucherCall({
  as,
  ring,
  onDone,
}: {
  as: InboxAs;
  ring: OziVoucherRing;
  onDone: (id: string) => void;
}): JSX.Element {
  const ozi = useOzi();
  const [heard, setHeard] = useState<string | null>(null);
  const reply = (answer: 'answer' | 'decline'): void => {
    answerVoucherRing(as, ring.id, answer)
      .then((result) => {
        if (answer === 'answer') {
          setHeard(result.words);
          void ozi.say(result.words);
        } else onDone(ring.id);
      })
      .catch(() => onDone(ring.id));
  };
  return (
    <section
      aria-labelledby={`ozi-ring-${ring.id}`}
      className="border-2 border-highlight rounded-2xl p-4 space-y-3"
    >
      <h2 id={`ozi-ring-${ring.id}`} className="text-lead font-bold m-0">
        {ring.from} is calling
      </h2>
      {heard ? (
        <>
          <p role="status" className="m-0">
            {heard}
          </p>
          <button
            type="button"
            onClick={() => onDone(ring.id)}
            className="control min-h-control bg-highlight text-on-accent"
          >
            End call
          </button>
        </>
      ) : (
        <>
          <p role="alert" className="m-0">
            {ring.from} is calling you about a thank-you voucher.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => reply('answer')}
              className="control min-h-control bg-highlight text-on-accent"
            >
              <span aria-hidden="true">📞 </span>
              Answer
            </button>
            <button
              type="button"
              onClick={() => reply('decline')}
              className="control min-h-control border-paper bg-paper/10 text-paper"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** One character at a time, for a screen reader: "G I F T dash A B C D". */
function spelledOut(code: string): string {
  return [...code].map((char) => (char === '-' ? 'dash' : char === ' ' ? 'space' : char)).join(' ');
}

/**
 * A referral reward voucher in a message (Anthony, 30 October 2026): the code shown clearly, read
 * one character at a time by a screen reader, a "Copy code" button, the link if there is one, how
 * long the gift card lasts, and "I've used it".
 */
export function VoucherCard({
  as,
  voucher,
  onChanged,
}: {
  as: InboxAs;
  voucher: InboxVoucher;
  onChanged: (voucher: InboxVoucher, words: string) => void;
}): JSX.Element {
  const [said, setSaid] = useState('');
  const codeId = `voucher-code-${voucher.id}`;
  const copy = (): void => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard) {
      setSaid('Copying is not possible here. Please write the code down.');
      return;
    }
    clipboard
      .writeText(voucher.code)
      .then(() => setSaid('The code is copied.'))
      .catch(() => setSaid('The code could not be copied. Please write it down.'));
  };
  const used = (): void => {
    markVoucherUsed(as, voucher.id)
      .then((result) => {
        setSaid(result.words);
        onChanged(result.voucher, result.words);
      })
      .catch((failure: unknown) =>
        setSaid(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  return (
    <section
      aria-labelledby={`${codeId}-title`}
      className="border-2 border-highlight rounded-2xl p-4 space-y-3"
    >
      <h2 id={`${codeId}-title`} className="text-lead font-bold m-0">
        {voucher.title}
      </h2>
      <p className="m-0" id={codeId}>
        Your code:{' '}
        <code aria-hidden="true" className="text-display font-bold break-all">
          {voucher.code}
        </code>
        <span className="visually-hidden">{spelledOut(voucher.code)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          aria-describedby={codeId}
          className="control min-h-control bg-highlight text-on-accent"
        >
          Copy code
        </button>
        {voucher.link && (
          <a
            href={voucher.link}
            target="_blank"
            rel="noopener noreferrer"
            className="control min-h-control border-paper bg-paper/10 text-paper"
          >
            Open the voucher<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        )}
        {!voucher.usedAt && (
          <button
            type="button"
            onClick={used}
            className="control min-h-control border-paper bg-paper/10 text-paper"
          >
            I&rsquo;ve used it
          </button>
        )}
      </div>
      <p className="m-0">{voucher.lastsWords}</p>
      {voucher.usedAt && (
        <p className="m-0">You told us you used it, {whenWords(voucher.usedAt)}.</p>
      )}
      <p role="status" className="m-0 min-h-control">
        {said}
      </p>
    </section>
  );
}

/** The inbox itself: the messages, the count, Ozi reading them, a reply, and any call. */
export function Inbox({ as, title = 'Messages' }: { as: InboxAs; title?: string }): JSX.Element {
  const ozi = useOzi();
  const product = storeConfig.productName;
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef({ ozi });
  latest.current = { ozi };

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await fetchInbox(as);
      setMessages(result.messages);
      const fresh = result.messages
        .filter((message) => message.from === 'company' && message.readAt === null)
        .map((message) => message.id);
      if (fresh.length > 0) {
        // Opening the page is reading them; the marks stay on the screen for this visit.
        setNewIds((before) => [...new Set([...before, ...fresh])]);
        await markInboxRead(as).catch(() => undefined);
      }
      setProblem('');
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'Your messages could not be opened.');
    }
  }, [as]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Read my messages", said on this page: Ozi reads them and offers a reply.
  useEffect(() => {
    const handle = (text: string): boolean => {
      if (!READ_MESSAGES.test(text)) return false;
      void readMessagesAloud(as, latest.current.ozi, product, () => void load());
      return true;
    };
    latest.current.ozi.setPageCommands(handle);
    return () => latest.current.ozi.setPageCommands(null);
  }, [as, product, load]);

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text === '') {
      setProblem('Please write your reply first.');
      return;
    }
    setBusy(true);
    replyToInbox(as, text)
      .then((result) => {
        setDraft('');
        setNews(result.words);
        void ozi.say(result.words);
        void load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'Your reply did not send.'),
      )
      .finally(() => setBusy(false));
  };

  const sayReply = (): void => {
    ozi.listenFor('Say your reply, and I will write it in the box.', (heard) => {
      setDraft(heard);
      void ozi.say(`I wrote: ${heard}. Press Send reply when it is right.`);
    });
  };

  const fromCompany = (messages ?? []).filter((message) => message.from === 'company');
  const unreadCount = newIds.length;

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-display font-bold m-0">{title}</h1>
      <p className="m-0">
        Messages between you and {product}. Only {product} writes to you here, and only {product}{' '}
        reads your replies.
      </p>
      <CompanyCallBanner as={as} />
      <p role="status" className="m-0 min-h-control">
        {messages === null
          ? 'One moment.'
          : unreadCount > 0
            ? `You have ${unreadCount} new ${unreadCount === 1 ? 'message' : 'messages'}.`
            : fromCompany.length === 0
              ? `No messages from ${product} yet.`
              : 'No new messages.'}
        {news !== '' ? ` ${news}` : ''}
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}
      <button
        type="button"
        onClick={() => void readMessagesAloud(as, ozi, product, () => void load())}
        className="control min-h-control bg-highlight text-on-accent"
      >
        <span aria-hidden="true">🔊 </span>
        Read my messages aloud
      </button>
      {messages && messages.length > 0 && (
        <ol className="list-none m-0 p-0 space-y-3" aria-label="Your messages, oldest first">
          {messages.map((message) => (
            <li key={message.id} className="border-2 border-paper rounded-2xl p-4 space-y-1">
              <p className="m-0 font-bold">
                {newIds.includes(message.id) && <span>New. </span>}
                {message.from === 'company' ? `From ${message.fromName}` : 'Your reply'}
                {message.sentAt ? `, ${whenWords(message.sentAt)}` : ''}
              </p>
              <p className="m-0 whitespace-pre-wrap">{message.text}</p>
              {message.voucher && (
                <VoucherCard
                  as={as}
                  voucher={message.voucher}
                  onChanged={(voucher) =>
                    setMessages((before) =>
                      (before ?? []).map((row) =>
                        row.id === message.id ? { ...row, voucher } : row,
                      ),
                    )
                  }
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={send} className="space-y-3" aria-labelledby="inbox-reply-heading">
        <h2 id="inbox-reply-heading" className="text-lead font-bold m-0">
          Reply to {product}
        </h2>
        <label htmlFor="inbox-reply" className="block">
          Your reply
        </label>
        <textarea
          id="inbox-reply"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          maxLength={2000}
          className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="control min-h-control bg-highlight text-on-accent"
          >
            <span aria-hidden="true">➤ </span>
            Send reply
          </button>
          <button
            type="button"
            onClick={sayReply}
            className="control min-h-control border-paper bg-paper/10 text-paper"
          >
            <span aria-hidden="true">🎤 </span>
            Say my reply
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * "{product name} is calling": a call from the company, answered in the app. Both sides are told the
 * call is recorded before anything else.
 */
export function CompanyCallBanner({ as }: { as: InboxAs }): JSX.Element | null {
  const ozi = useOzi();
  const [call, setCall] = useState<CompanyCall | null>(null);
  const [inCall, setInCall] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState('');
  const connection = useRef<CallConnection | null>(null);
  const announced = useRef<string | null>(null);
  const say = useRef(ozi.say);
  say.current = ozi.say;

  useEffect(() => {
    if (inCall) return undefined;
    let live = true;
    const ask = (): void => {
      fetchCompanyCall(as)
        .then((result) => {
          if (!live || !result) return;
          setCall(result.call ?? null);
          if (result.call && announced.current !== result.call.id) {
            announced.current = result.call.id;
            void say.current(
              `${result.call.words} ${result.call.notice} Press Answer to answer it.`,
            );
          }
        })
        .catch(() => undefined);
    };
    ask();
    const timer = window.setInterval(ask, CALL_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [as, inCall]);

  useEffect(
    () => () => {
      void connection.current?.leave();
    },
    [],
  );

  if (!call && !inCall) return null;

  const answer = async (): Promise<void> => {
    if (!call) return;
    setProblem('');
    try {
      const result = await answerCompanyCall(as, call.id);
      await ozi.say(result.notice);
      connection.current = await connectToCall(result.join, {
        onOthersChanged: () => undefined,
        onDisconnected: () => {
          connection.current = null;
          setInCall(null);
          setCall(null);
        },
      });
      setInCall(call.id);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'The call could not be answered.');
    }
  };

  const end = async (): Promise<void> => {
    const id = inCall ?? call?.id;
    await connection.current?.leave().catch(() => undefined);
    connection.current = null;
    if (id) await endCompanyCall(as, id).catch(() => undefined);
    setInCall(null);
    setCall(null);
  };

  return (
    <section
      aria-labelledby="company-call-heading"
      className="border-2 border-highlight rounded-2xl p-4 space-y-3"
    >
      <h2 id="company-call-heading" className="text-lead font-bold m-0">
        {inCall
          ? `On a call with ${storeConfig.productName}`
          : `${storeConfig.productName} is calling`}
      </h2>
      <p role="alert" className="m-0 font-bold">
        This call is recorded.
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!inCall && (
          <button
            type="button"
            onClick={() => void answer()}
            className="control min-h-control bg-highlight text-on-accent"
          >
            <span aria-hidden="true">📞 </span>
            Answer
          </button>
        )}
        {inCall && (
          <button
            type="button"
            aria-pressed={muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              void connection.current?.setMuted(next);
            }}
            className="control min-h-control border-paper bg-paper/10 text-paper"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void end()}
          className="control min-h-control border-paper bg-paper/10 text-paper"
        >
          <span aria-hidden="true">✕ </span>
          {inCall ? 'End call' : 'Decline'}
        </button>
      </div>
    </section>
  );
}
