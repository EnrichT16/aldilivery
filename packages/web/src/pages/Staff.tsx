import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  checkStaffKey,
  decideProblem,
  fetchStaffDocuments,
  fetchStaffFeedback,
  fetchStaffFile,
  fetchStaffProblems,
  fetchStaffRecoveries,
  reviewDocument,
  writeOffRunner,
  type ProblemDecision,
  type StaffDocument,
  type StaffFeedback,
  type StaffProblem,
  type StaffRecovery,
} from '../lib/api';
import { money } from '../lib/money';

/**
 * The admin panel, for the people who run the service: Runner documents waiting, problems to
 * decide, money Runners owe, and Runner feedback. Built to the same accessibility rules as the
 * rest, because the people running it include a blind owner.
 *
 * It signs in with the staff key (STAFF_API_KEY), kept only for this browser tab. Every decision
 * records the name of whoever made it.
 */

const KEY = 'ozidelivery.staff.key';
const NAME = 'ozidelivery.staff.name';

type TabKey = 'documents' | 'problems' | 'owed' | 'feedback';
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'documents', label: 'Documents' },
  { key: 'problems', label: 'Problems' },
  { key: 'owed', label: 'Money owed' },
  { key: 'feedback', label: 'Feedback' },
];

function remembered(name: string): string {
  try {
    return window.sessionStorage.getItem(name) ?? '';
  } catch {
    return '';
  }
}

function remember(name: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(name);
    else window.sessionStorage.setItem(name, value);
  } catch {
    // Private browsing: they sign in again next time.
  }
}

export function Staff(): JSX.Element {
  const [key, setKey] = useState(() => remembered(KEY));
  const [by, setBy] = useState(() => remembered(NAME));
  const [tab, setTab] = useState<TabKey>('documents');
  const [news, setNews] = useState('');

  if (key === '' || by === '') {
    return (
      <SignIn
        onSignedIn={(signedKey, name) => {
          remember(KEY, signedKey);
          remember(NAME, name);
          setKey(signedKey);
          setBy(name);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Admin</h1>
      <p className="m-0">
        Signed in as {by}.{' '}
        <button
          type="button"
          onClick={() => {
            remember(KEY, null);
            remember(NAME, null);
            setKey('');
            setBy('');
          }}
          className="underline bg-transparent text-paper"
        >
          Sign out
        </button>
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      <nav aria-label="Admin pages">
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
      {tab === 'documents' && <Documents staffKey={key} by={by} onNews={setNews} />}
      {tab === 'problems' && <Problems staffKey={key} by={by} onNews={setNews} />}
      {tab === 'owed' && <Owed staffKey={key} by={by} onNews={setNews} />}
      {tab === 'feedback' && <Feedback staffKey={key} />}
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (key: string, name: string) => void }): JSX.Element {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim() === '' || key.trim() === '') {
      setProblem('Please give your name and the staff key.');
      return;
    }
    setBusy(true);
    setProblem('');
    checkStaffKey(key.trim())
      .then(() => onSignedIn(key.trim(), name.trim()))
      .catch(() => {
        setProblem('That staff key was not accepted.');
        setBusy(false);
      });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <h1 className="text-display font-bold m-0">Admin sign in</h1>
      <label htmlFor="staff-name" className="block font-bold">
        Your name, recorded with each decision
      </label>
      <input
        id="staff-name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      />
      <label htmlFor="staff-key" className="block font-bold">
        Staff key
      </label>
      <input
        id="staff-key"
        type="password"
        autoComplete="current-password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      />
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      <button type="submit" disabled={busy} className="control w-full bg-highlight text-ink">
        Sign in
      </button>
    </form>
  );
}

interface PanelProps {
  staffKey: string;
  by: string;
  onNews: (news: string) => void;
}

/** Loads a list, and loads it again after each decision. */
function useList<T>(load: () => Promise<T>): {
  data: T | null;
  problem: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState('');
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(() => {
    loader
      .current()
      .then((result) => {
        setData(result);
        setProblem('');
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That list could not be loaded.'),
      );
  }, []);
  useEffect(reload, [reload]);
  return { data, problem, reload };
}

function Failure({ text }: { text: string }): JSX.Element | null {
  if (text === '') return null;
  return (
    <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
      {text}
    </p>
  );
}

/* ----------------------------------------------------------------------------- documents */

function Documents({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const list = useList(() => fetchStaffDocuments(staffKey));
  const documents = list.data?.documents;
  return (
    <section aria-labelledby="documents-heading" className="space-y-4 max-w-2xl">
      <h2 id="documents-heading" className="text-lead font-bold">
        Documents waiting {documents ? `(${documents.length})` : ''}
      </h2>
      <Failure text={list.problem} />
      {documents?.length === 0 && <p className="m-0">Nothing is waiting.</p>}
      {documents?.map((document) => (
        <DocumentReview
          key={document.id}
          document={document}
          staffKey={staffKey}
          by={by}
          onDone={(words) => {
            onNews(words);
            list.reload();
          }}
        />
      ))}
    </section>
  );
}

function DocumentReview({
  document,
  staffKey,
  by,
  onDone,
}: {
  document: StaffDocument;
  staffKey: string;
  by: string;
  onDone: (news: string) => void;
}): JSX.Element {
  const [photo, setPhoto] = useState('');
  const [note, setNote] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [problem, setProblem] = useState('');
  const who = document.runner
    ? `${document.runner.name} (${document.runner.runnerId})`
    : 'A Runner';
  const heading = `${document.name}, from ${who}`;
  const id = `doc-${document.id}`;

  const decide = (decision: 'accept' | 'reject'): void => {
    setProblem('');
    reviewDocument(staffKey, document.id, {
      decision,
      by,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    })
      .then(() => onDone(`${heading}: ${decision === 'accept' ? 'accepted' : 'sent back'}.`))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  return (
    <article aria-labelledby={id} className="space-y-3 border-2 border-paper rounded-xl p-4">
      <h3 id={id} className="font-bold m-0">
        {heading}
      </h3>
      {document.sentAs === 'share code' ? (
        <p className="m-0">
          Share code: {document.shareCode}. Check it on the government website before accepting.
        </p>
      ) : photo ? (
        <img src={photo} alt={`${document.name}, sent by ${who}`} className="max-w-full" />
      ) : (
        <button
          type="button"
          onClick={() => {
            fetchStaffFile(staffKey, `/staff/documents/${encodeURIComponent(document.id)}/image`)
              .then(setPhoto)
              .catch(() => setProblem('The photo could not be opened.'));
          }}
          className="control bg-paper text-ink"
        >
          Show the photo
        </button>
      )}
      {document.kind === 'insurance' && (
        <>
          <label htmlFor={`${id}-expires`} className="block font-bold">
            The date the insurance runs out
          </label>
          <input
            id={`${id}-expires`}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
        </>
      )}
      <label htmlFor={`${id}-note`} className="block font-bold">
        Note (needed when sending it back, so the Runner knows what to send instead)
      </label>
      <textarea
        id={`${id}-note`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      />
      <Failure text={problem} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide('accept')}
          className="control bg-highlight text-ink"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => decide('reject')}
          className="control bg-paper text-ink"
        >
          Send back
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------------------ problems */

const DECISIONS: Array<{ value: ProblemDecision; label: string }> = [
  { value: 'runner_at_fault', label: 'The Runner was responsible' },
  { value: 'shop_at_fault', label: 'The shop was responsible' },
  { value: 'platform_at_fault', label: 'We were responsible' },
  { value: 'shopper_at_fault', label: 'The Shopper was responsible (no refund)' },
  { value: 'no_fault', label: 'Nobody was at fault' },
];

function Problems({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const list = useList(() => fetchStaffProblems(staffKey));
  const reports = list.data?.reports;
  return (
    <section aria-labelledby="problems-heading" className="space-y-4 max-w-2xl">
      <h2 id="problems-heading" className="text-lead font-bold">
        Problems to decide {reports ? `(${reports.length})` : ''}
      </h2>
      <Failure text={list.problem} />
      {reports?.length === 0 && <p className="m-0">Nothing to decide.</p>}
      {reports?.map((report) => (
        <ProblemDecide
          key={report.id}
          report={report}
          staffKey={staffKey}
          by={by}
          onDone={(words) => {
            onNews(words);
            list.reload();
          }}
        />
      ))}
    </section>
  );
}

function ProblemDecide({
  report,
  staffKey,
  by,
  onDone,
}: {
  report: StaffProblem;
  staffKey: string;
  by: string;
  onDone: (news: string) => void;
}): JSX.Element {
  const [decision, setDecision] = useState<ProblemDecision | ''>('');
  const [refund, setRefund] = useState(
    report.refundRequestedPence ? (report.refundRequestedPence / 100).toFixed(2) : '0',
  );
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const id = `problem-${report.id}`;
  const due = new Date(report.decideBy).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const pence = Math.round(Number(refund) * 100);
    if (decision === '') return setProblem('Please choose who was responsible.');
    if (!Number.isFinite(pence) || pence < 0)
      return setProblem('Please give the refund in pounds.');
    if (note.trim() === '') return setProblem('Please write the decision down.');
    setProblem('');
    decideProblem(staffKey, report.id, { decision, refundPence: pence, note: note.trim(), by })
      .then(() => onDone(`Decided. ${pence > 0 ? `${money(pence)} refunded.` : 'No refund.'}`))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  return (
    <article aria-labelledby={id} className="space-y-3 border-2 border-paper rounded-xl p-4">
      <h3 id={id} className="font-bold m-0">
        From the {report.reportedBy === 'runner' ? 'Runner' : 'Shopper'}: {report.summary}
      </h3>
      <p className="m-0">
        {report.overdue ? 'Overdue: it was due' : 'Decide by'} {due}.
        {report.refundRequestedPence
          ? ` They asked for ${money(report.refundRequestedPence)} back.`
          : ''}
      </p>
      {report.evidence.length > 0 && (
        <ul className="m-0 ps-6 space-y-2">
          {report.evidence.map((item, index) => {
            const label = `${item.kind === 'voice_note' ? 'Voice note' : item.kind === 'photo' ? 'Photo' : 'Note'} ${index + 1}, from the ${item.addedBy === 'runner' ? 'Runner' : 'Shopper'}`;
            if (item.kind === 'note') {
              return (
                <li key={item.id}>
                  {label}: {item.text}
                </li>
              );
            }
            const file = files[item.id];
            return (
              <li key={item.id} className="space-y-2">
                {file ? (
                  item.kind === 'voice_note' ? (
                    <VoiceNote src={file} label={label} />
                  ) : (
                    <img src={file} alt={label} className="max-w-full" />
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      fetchStaffFile(staffKey, `/staff/evidence/${encodeURIComponent(item.id)}`)
                        .then((url) => setFiles((was) => ({ ...was, [item.id]: url })))
                        .catch(() => setProblem('That could not be opened.'));
                    }}
                    className="control bg-paper text-ink"
                  >
                    {item.kind === 'voice_note' ? 'Play' : 'Show'} {label.toLowerCase()}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-3">
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="font-bold">Who was responsible?</legend>
          {DECISIONS.map((choice) => (
            <label key={choice.value} className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                name={`${id}-decision`}
                value={choice.value}
                checked={decision === choice.value}
                onChange={() => {
                  setDecision(choice.value);
                  if (choice.value === 'shopper_at_fault') setRefund('0');
                }}
                className="w-6 h-6"
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${id}-refund`} className="block font-bold">
          Refund, in pounds
        </label>
        <input
          id={`${id}-refund`}
          inputMode="decimal"
          value={refund}
          onChange={(event) => setRefund(event.target.value)}
          className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
        />
        <label htmlFor={`${id}-note`} className="block font-bold">
          The decision, in words the Runner and Shopper will read
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
        />
        <Failure text={problem} />
        <button type="submit" className="control w-full bg-highlight text-ink">
          Save the decision
        </button>
      </form>
    </article>
  );
}

/**
 * A voice note, played with plain buttons. Voice notes have no written captions to offer, so this
 * is a Play and Stop pair rather than a media player with an empty captions track.
 */
function VoiceNote({ src, label }: { src: string; label: string }): JSX.Element {
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const play = useCallback(() => {
    if (!player.current) {
      player.current = new Audio(src);
      player.current.onended = () => setPlaying(false);
    }
    setPlaying(true);
    Promise.resolve(player.current.play()).catch(() => setPlaying(false));
  }, [src]);

  // It was opened to be heard: start straight away, so it is one press, not two.
  useEffect(() => {
    play();
    return () => {
      player.current?.pause();
    };
  }, [play]);

  return (
    <button
      type="button"
      aria-pressed={playing}
      onClick={() => {
        if (playing && player.current) {
          player.current.pause();
          player.current.currentTime = 0;
          setPlaying(false);
        } else {
          play();
        }
      }}
      className="control bg-paper text-ink"
    >
      {playing ? 'Stop' : 'Play'} {label.toLowerCase()}
    </button>
  );
}

/* ---------------------------------------------------------------------------- money owed */

function Owed({ staffKey, by, onNews }: PanelProps): JSX.Element {
  const list = useList(() => fetchStaffRecoveries(staffKey));
  const [problem, setProblem] = useState('');
  const rows: StaffRecovery[] | undefined = list.data?.recoveries;
  return (
    <section aria-labelledby="owed-heading" className="space-y-4 max-w-2xl">
      <h2 id="owed-heading" className="text-lead font-bold">
        Money Runners owe
      </h2>
      {list.data && (
        <p className="m-0">
          This is taken back a little from each job. If a Runner leaves owing{' '}
          {money(list.data.writeOffUpToPence)} or less, it can be written off here. More than that,
          please ask them for it.
        </p>
      )}
      <Failure text={list.problem || problem} />
      {rows?.length === 0 && <p className="m-0">No Runner owes anything.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {rows?.map((row) => (
          <li key={row.runner.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <p className="m-0">
              {row.runner.name}
              {row.runner.runnerId ? ` (${row.runner.runnerId})` : ''} owes{' '}
              {money(row.remainingPence)}.
            </p>
            {row.canWriteOff && (
              <button
                type="button"
                onClick={() => {
                  setProblem('');
                  writeOffRunner(staffKey, row.runner.id, by)
                    .then((result) => {
                      onNews(`${row.runner.name}: ${result.message}`);
                      list.reload();
                    })
                    .catch((failure: unknown) =>
                      setProblem(failure instanceof Error ? failure.message : 'That failed.'),
                    );
                }}
                className="control bg-paper text-ink"
              >
                They have left: write off {money(row.remainingPence)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------------ feedback */

function Feedback({ staffKey }: { staffKey: string }): JSX.Element {
  const list = useList(() => fetchStaffFeedback(staffKey));
  const rows: StaffFeedback[] | undefined = list.data?.feedback;
  return (
    <section aria-labelledby="feedback-heading" className="space-y-4 max-w-2xl">
      <h2 id="feedback-heading" className="text-lead font-bold">
        Runner feedback
      </h2>
      <Failure text={list.problem} />
      {rows?.length === 0 && <p className="m-0">No feedback yet.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className="border-2 border-paper rounded-xl p-4 space-y-1">
            <p className="m-0">{row.message}</p>
            <p className="m-0">
              {row.runner
                ? `From ${row.runner.name} (${row.runner.runnerId})`
                : 'Sent without a name'}
              , {new Date(row.createdAt).toLocaleDateString('en-GB')}.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
