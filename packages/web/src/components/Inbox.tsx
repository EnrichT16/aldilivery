import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { connectToCall, type CallConnection } from '../lib/call-connection';
import {
  READ_MESSAGES,
  answerCompanyCall,
  endCompanyCall,
  fetchCompanyCall,
  fetchInbox,
  fetchInboxUnread,
  markInboxRead,
  readMessagesAloud,
  replyToInbox,
  whenWords,
  type CompanyCall,
  type InboxAs,
  type InboxMessage,
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
export function useInboxUnread(as: InboxAs, on = true): { unread: number; ringing: boolean } {
  const [state, setState] = useState({ unread: 0, ringing: false });
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
  const { unread, ringing } = useInboxUnread(as);
  return (
    <Link to={to} className={className}>
      <span aria-hidden="true">✉ </span>
      Messages
      {unread > 0 ? `, ${unread} new` : ''}
      {ringing ? `. ${storeConfig.productName} is calling` : ''}
    </Link>
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
