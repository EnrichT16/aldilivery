import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  addBusinessUser,
  addStaffOrganisation,
  addStaffPartner,
  addTeamMember,
  decideStaffPartnerProduct,
  fetchStaffPartnerProducts,
  fetchStaffPartners,
  renewStaffPartner,
  changeStaffPassword,
  checkStaffKey,
  fetchStaffMe,
  fetchStaffRoles,
  fetchTeam,
  resetTeamPassword,
  staffSignIn,
  updateTeamMember,
  decideFind,
  decideProblem,
  fetchStaffEnquiries,
  fetchStaffFinds,
  markEnquiryHandled,
  fetchStaffDocuments,
  fetchStaffFeedback,
  fetchStaffFile,
  fetchStaffProblems,
  fetchStaffRecoveries,
  reviewDocument,
  writeOffRunner,
  type ProblemDecision,
  type StaffArea,
  type StaffRoleInfo,
  type TeamMember,
  type StaffEnquiry,
  type StaffFindRequest,
  type StaffDocument,
  type StaffFeedback,
  type StaffProblem,
  type StaffRecovery,
} from '../lib/api';
import { StaffVoice } from '../components/StaffVoice';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { nameHeardIn } from '../voice/name';

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

type TabKey = StaffArea;
type StaffMe = Awaited<ReturnType<typeof fetchStaffMe>>;
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'documents', label: 'Documents' },
  { key: 'problems', label: 'Problems' },
  { key: 'owed', label: 'Money owed' },
  { key: 'finds', label: 'Finds It' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'partners', label: 'Shops and organisations' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'team', label: 'Team' },
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
  const [me, setMe] = useState<StaffMe | null>(null);
  const [tab, setTab] = useState<TabKey | null>(null);
  const [news, setNews] = useState('');
  // Bumped after a decision made by voice, so the lists on the screen load again too.
  const [refresh, setRefresh] = useState(0);

  const signOut = useCallback(() => {
    remember(KEY, null);
    remember(NAME, null);
    setKey('');
    setBy('');
    setMe(null);
    setTab(null);
  }, []);

  // Who this is and what their job lets them see, asked of the server each time: a role
  // changed, or an account turned off, applies straight away.
  useEffect(() => {
    if (key === '') return;
    fetchStaffMe(key)
      .then((result) => {
        setMe(result);
        if (result.account) setBy(result.name);
      })
      .catch(signOut);
  }, [key, signOut]);

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

  if (!me) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }

  const tabs = TABS.filter((item) => me.areas.includes(item.key));
  const shown = tab && me.areas.includes(tab) ? tab : (tabs[0]?.key ?? null);

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Admin</h1>
      <p className="m-0">
        Signed in as {by}, {me.title}.{' '}
        <button type="button" onClick={signOut} className="underline bg-transparent text-paper">
          Sign out
        </button>
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {me.mustChangePassword ? (
        <ChangePassword
          staffKey={key}
          onChanged={(message) => {
            setNews(message);
            setMe({ ...me, mustChangePassword: false });
          }}
        />
      ) : (
        <>
          <StaffVoice
            staffKey={key}
            by={by}
            name={me.account ? me.name : by}
            title={me.title}
            areas={me.areas}
            onOpen={setTab}
            onChanged={(text) => {
              setNews(text);
              setRefresh((value) => value + 1);
            }}
            onSignOut={signOut}
          />
          <nav aria-label="Admin pages">
            <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
              {tabs.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    aria-current={shown === item.key ? 'page' : undefined}
                    onClick={() => setTab(item.key)}
                    className={`control ${shown === item.key ? 'bg-highlight text-ink' : 'bg-paper/10 text-paper'}`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div key={refresh}>
            {shown === 'documents' && <Documents staffKey={key} by={by} onNews={setNews} />}
            {shown === 'problems' && <Problems staffKey={key} by={by} onNews={setNews} />}
            {shown === 'owed' && <Owed staffKey={key} by={by} onNews={setNews} />}
            {shown === 'finds' && <Finds staffKey={key} onNews={setNews} />}
            {shown === 'enquiries' && <Enquiries staffKey={key} onNews={setNews} />}
            {shown === 'feedback' && <Feedback staffKey={key} />}
            {shown === 'partners' && <Partners staffKey={key} onNews={setNews} />}
            {shown === 'team' && <Team staffKey={key} onNews={setNews} />}
          </div>
        </>
      )}
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (key: string, name: string) => void }): JSX.Element {
  const [withKey, setWithKey] = useState(false);
  const ozi = useOzi();
  const voice = useRef(ozi);
  voice.current = ozi;

  // Ozi says what to do here. Nothing said on this screen is taken as a shopping order, and a
  // password is never asked for aloud, so nobody nearby hears it.
  useEffect(() => {
    const words =
      'Admin sign in. Type your username, then your password. For your privacy, I never ask you to say a password out loud.';
    voice.current.setPageCommands((text) => {
      if (nameHeardIn(text) || /\b(help|what do i do|how)\b/i.test(text))
        void voice.current.say(words);
      return true;
    });
    void voice.current.say(words);
    return () => voice.current.setPageCommands(null);
  }, []);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string): string => String(data.get(name) ?? '').trim();
    setProblem('');
    if (withKey) {
      if (value('staff-name') === '' || value('staff-key') === '') {
        setProblem('Please give your name and the staff key.');
        return;
      }
      setBusy(true);
      checkStaffKey(value('staff-key'))
        .then(() => onSignedIn(value('staff-key'), value('staff-name')))
        .catch(() => {
          setProblem('That staff key was not accepted.');
          setBusy(false);
        });
      return;
    }
    if (value('staff-username') === '' || value('staff-password') === '') {
      setProblem('Please give your username and password.');
      return;
    }
    setBusy(true);
    staffSignIn(value('staff-username'), String(data.get('staff-password') ?? ''))
      .then((result) => onSignedIn(result.token, result.name))
      .catch((failure: unknown) => {
        setProblem(failure instanceof Error ? failure.message : 'That did not work.');
        setBusy(false);
      });
  };

  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <h1 className="text-display font-bold m-0">Admin sign in</h1>
      {withKey ? (
        <>
          <label htmlFor="staff-name" className="block font-bold">
            Your name, recorded with each decision
          </label>
          <input id="staff-name" name="staff-name" autoComplete="name" className={field} />
          <label htmlFor="staff-key" className="block font-bold">
            Staff key
          </label>
          <input
            id="staff-key"
            name="staff-key"
            type="password"
            autoComplete="current-password"
            className={field}
          />
        </>
      ) : (
        <>
          <label htmlFor="staff-username" className="block font-bold">
            Username
          </label>
          <input
            id="staff-username"
            name="staff-username"
            autoComplete="username"
            className={field}
          />
          <label htmlFor="staff-password" className="block font-bold">
            Password
          </label>
          <input
            id="staff-password"
            name="staff-password"
            type="password"
            autoComplete="current-password"
            className={field}
          />
        </>
      )}
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      <button type="submit" disabled={busy} className="control w-full bg-highlight text-ink">
        Sign in
      </button>
      <button
        type="button"
        onClick={() => {
          setWithKey(!withKey);
          setProblem('');
        }}
        className="control bg-paper/10 text-paper underline"
      >
        {withKey ? 'Sign in with a username instead' : 'Founder: sign in with the staff key'}
      </button>
    </form>
  );
}

/** The first sign-in with a password someone was given: they choose their own. */
function ChangePassword({
  staffKey,
  onChanged,
}: {
  staffKey: string;
  onChanged: (message: string) => void;
}): JSX.Element {
  const [problem, setProblem] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const current = String(data.get('current-password') ?? '');
    const chosen = String(data.get('new-password') ?? '');
    if (chosen !== String(data.get('repeat-password') ?? '')) {
      setProblem('The two new passwords are not the same.');
      return;
    }
    changeStaffPassword(staffKey, current, chosen)
      .then((result) => onChanged(result.message))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl" aria-labelledby="choose-heading">
      <h2 id="choose-heading" className="text-lead font-bold m-0">
        Choose your own password
      </h2>
      <p className="m-0">
        At least 10 characters. Nobody else, including the founder, will know it.
      </p>
      <Failure text={problem} />
      <label htmlFor="current-password" className="block font-bold">
        The password you were given
      </label>
      <input
        id="current-password"
        name="current-password"
        type="password"
        autoComplete="current-password"
        className={field}
      />
      <label htmlFor="new-password" className="block font-bold">
        Your new password
      </label>
      <input
        id="new-password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        className={field}
      />
      <label htmlFor="repeat-password" className="block font-bold">
        Your new password again
      </label>
      <input
        id="repeat-password"
        name="repeat-password"
        type="password"
        autoComplete="new-password"
        className={field}
      />
      <button type="submit" className="control w-full bg-highlight text-ink">
        Save my password
      </button>
    </form>
  );
}

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

/** Ozi Finds It: what Shoppers asked for, found or not. Found goes in the catalogue. */
function Finds({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchStaffFinds(staffKey));
  const rows: StaffFindRequest[] | undefined = list.data?.requests;
  const [problem, setProblem] = useState('');

  const decide = (
    row: StaffFindRequest,
    event: FormEvent<HTMLFormElement>,
    found: boolean,
  ): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string): string => String(data.get(name) ?? '').trim();
    const pounds = Number(value('price').replace(/[£\s]/g, ''));
    if (
      found &&
      (!Number.isFinite(pounds) || pounds <= 0 || value('name') === '' || value('shop') === '')
    ) {
      setProblem('Please give what was found, the shop, and the price in pounds, like 2.50.');
      return;
    }
    setProblem('');
    decideFind(
      staffKey,
      row.id,
      found
        ? {
            found: true,
            name: value('name'),
            shop: value('shop'),
            pricePence: Math.round(pounds * 100),
            note: value('note') || undefined,
          }
        : { found: false, note: value('note') || undefined },
    )
      .then(() => {
        onNews(found ? `Marked found: ${value('name')}.` : 'Marked not found. The fee goes back.');
        list.reload();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  return (
    <section aria-labelledby="finds-heading" className="space-y-4 max-w-2xl">
      <h2 id="finds-heading" className="text-lead font-bold">
        Finds It: still looking
      </h2>
      <Failure text={list.problem || problem} />
      {rows?.length === 0 && <p className="m-0">Nothing waiting.</p>}
      <ul className="m-0 p-0 list-none space-y-4">
        {rows?.map((row) => (
          <li key={row.id} className="border-2 border-paper rounded-xl p-4 space-y-3">
            <h3 className="m-0 font-bold">{row.description}</h3>
            <p className="m-0">
              For {row.shopperName}
              {row.area ? `, near ${row.area}` : ''}. Look in up to {list.data?.shops ?? 3} shops.
              {row.feePence > 0 ? ` They paid ${money(row.feePence)}.` : ' Included in Plus.'}
            </p>
            <form onSubmit={(event) => decide(row, event, true)} className="space-y-2">
              <label className="block">
                What was found
                <input
                  name="name"
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
              </label>
              <label className="block">
                Which shop
                <input
                  name="shop"
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
              </label>
              <label className="block">
                Price in pounds
                <input
                  name="price"
                  inputMode="decimal"
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
              </label>
              <label className="block">
                Note for the Shopper (optional)
                <input
                  name="note"
                  className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
                />
              </label>
              <button type="submit" className="control bg-highlight text-ink">
                Found it<span className="visually-hidden">: {row.description}</span>
              </button>
            </form>
            <form onSubmit={(event) => decide(row, event, false)}>
              <input type="hidden" name="note" value="None of the shops had it." />
              <button type="submit" className="control bg-paper/10 text-paper underline">
                Not found, give the fee back
                <span className="visually-hidden">: {row.description}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Organisations and shops asking to work with us. A person rings each one back. */
function Enquiries({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchStaffEnquiries(staffKey));
  const rows: StaffEnquiry[] | undefined = list.data?.enquiries;
  return (
    <section aria-labelledby="enquiries-heading" className="space-y-4 max-w-2xl">
      <h2 id="enquiries-heading" className="text-lead font-bold">
        Enquiries
      </h2>
      <Failure text={list.problem} />
      {rows?.length === 0 && <p className="m-0">No enquiries yet.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className="border-2 border-paper rounded-xl p-4 space-y-1">
            <h3 className="m-0 font-bold">
              {row.organisation}
              {row.handled ? ', rung back' : ''}
            </h3>
            <p className="m-0">
              {row.contactName},{' '}
              <a href={`tel:${row.telephone.replace(/\s/g, '')}`}>{row.telephone}</a>
              {row.email ? `, ${row.email}` : ''}.
            </p>
            {row.people && <p className="m-0">People supported: {row.people}.</p>}
            {row.message && <p className="m-0">{row.message}</p>}
            {!row.handled && (
              <button
                type="button"
                onClick={() =>
                  void markEnquiryHandled(staffKey, row.id).then(() => {
                    onNews(`${row.organisation} marked as rung back.`);
                    list.reload();
                  })
                }
                className="control bg-paper text-ink"
              >
                Mark as rung back<span className="visually-hidden">: {row.organisation}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The founder's tab: everybody who runs the service, their job, and their sign-in. */
function Team({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchTeam(staffKey));
  const roles = useList(fetchStaffRoles);
  const rows: TeamMember[] | undefined = list.data?.team;
  const jobs: StaffRoleInfo[] = roles.data?.roles ?? [];
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string): string => String(data.get(name) ?? '').trim();
    setProblem('');
    addTeamMember(staffKey, {
      name: value('member-name'),
      username: value('member-username'),
      role: value('member-role'),
    })
      .then((result) => {
        setPassword(result.message);
        onNews(`${result.member.name} added.`);
        form.reset();
        list.reload();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  const change = (member: TeamMember, patch: { role?: string; active?: boolean }): void => {
    setProblem('');
    updateTeamMember(staffKey, member.id, patch)
      .then(() => {
        onNews(
          patch.active === false
            ? `${member.name} can no longer sign in.`
            : patch.active === true
              ? `${member.name} can sign in again.`
              : `${member.name}'s job is changed.`,
        );
        list.reload();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be saved.'),
      );
  };

  return (
    <section aria-labelledby="team-heading" className="space-y-6 max-w-2xl">
      <h2 id="team-heading" className="text-lead font-bold">
        Your team
      </h2>
      <Failure text={list.problem || problem} />
      {password !== '' && (
        <p role="status" className="border-2 border-highlight rounded-xl p-4 m-0">
          {password}
        </p>
      )}
      <section aria-labelledby="jobs-heading" className="space-y-2">
        <h3 id="jobs-heading" className="font-bold m-0">
          The jobs, and what each one sees
        </h3>
        <ul className="m-0 ps-6 space-y-1">
          {jobs.map((job) => (
            <li key={job.role}>
              {job.title}:{' '}
              {job.areas
                .map((area) => TABS.find((item) => item.key === area)?.label ?? area)
                .join(', ')}
              .
            </li>
          ))}
        </ul>
      </section>
      {rows?.length === 0 && <p className="m-0">Nobody added yet.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {rows?.map((member) => (
          <li key={member.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <h3 className="m-0 font-bold">
              {member.name}, {member.title}
              {member.active ? '' : ', turned off'}
            </h3>
            <p className="m-0">
              Signs in as {member.username}.{' '}
              {member.lastSignInAt
                ? `Last signed in ${new Date(member.lastSignInAt).toLocaleDateString('en-GB')}.`
                : 'Has not signed in yet.'}
            </p>
            <label className="block">
              Job
              <select
                value={member.role}
                onChange={(event) => change(member, { role: event.target.value })}
                className={field}
              >
                {jobs.map((job) => (
                  <option key={job.role} value={job.role}>
                    {job.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void resetTeamPassword(staffKey, member.id)
                    .then((result) => setPassword(result.message))
                    .catch((failure: unknown) =>
                      setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
                    )
                }
                className="control bg-paper text-ink"
              >
                New password<span className="visually-hidden"> for {member.name}</span>
              </button>
              <button
                type="button"
                onClick={() => change(member, { active: !member.active })}
                className="control bg-paper/10 text-paper underline"
              >
                {member.active ? 'Turn off' : 'Turn back on'}
                <span className="visually-hidden"> {member.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-3" aria-labelledby="add-heading">
        <h3 id="add-heading" className="font-bold m-0">
          Add someone
        </h3>
        <label htmlFor="member-name" className="block">
          Their name
        </label>
        <input id="member-name" name="member-name" className={field} />
        <label htmlFor="member-username" className="block">
          Their username, for signing in (letters, numbers or dots)
        </label>
        <input id="member-username" name="member-username" autoComplete="off" className={field} />
        <label htmlFor="member-role" className="block">
          Their job
        </label>
        <select id="member-role" name="member-role" className={field} defaultValue="customer_care">
          {jobs.map((job) => (
            <option key={job.role} value={job.role}>
              {job.title}
            </option>
          ))}
        </select>
        <button type="submit" className="control bg-highlight text-ink">
          Add to the team
        </button>
      </form>
    </section>
  );
}
interface PanelProps {
  staffKey: string;
  by: string;
  onNews: (news: string) => void;
}

/**
 * Shop Partners and organisations (7 October 2026): products waiting to be checked, each shop's
 * plan and sign-ins, and each organisation's code and sign-ins.
 */
function Partners({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchStaffPartners(staffKey));
  const pending = useList(() => fetchStaffPartnerProducts(staffKey));
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
  const fail = (failure: unknown): void =>
    setProblem(failure instanceof Error ? failure.message : 'That could not be saved.');
  const values = (event: FormEvent<HTMLFormElement>): ((name: string) => string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    return (name) => String(data.get(name) ?? '').trim();
  };

  return (
    <section aria-labelledby="partners-heading" className="space-y-6 max-w-2xl">
      <h2 id="partners-heading" className="text-lead font-bold">
        Shops and organisations
      </h2>
      <Failure text={list.problem || pending.problem || problem} />
      {password !== '' && (
        <p role="status" className="border-2 border-highlight rounded-xl p-4 m-0">
          {password}
        </p>
      )}

      <section aria-labelledby="pending-heading" className="space-y-3">
        <h3 id="pending-heading" className="font-bold m-0">
          Products waiting to be checked
        </h3>
        {pending.data?.products.length === 0 && <p className="m-0">Nothing waiting.</p>}
        <ul className="m-0 p-0 list-none space-y-3">
          {pending.data?.products.map((product) => (
            <li key={product.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
              <h4 className="m-0 font-bold">
                {product.name}, {money(product.pricePence)}, from {product.shopName}
              </h4>
              <p className="m-0">
                {product.tags ? `Labels: ${product.tags}. ` : ''}
                {product.expiresOn
                  ? `Best before ${new Date(product.expiresOn).toLocaleDateString('en-GB')}.`
                  : ''}
              </p>
              {product.hasPhoto &&
                (photos[product.id] ? (
                  <img
                    src={photos[product.id]}
                    alt={product.name}
                    className="max-h-64 rounded-lg"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void fetchStaffFile(
                        staffKey,
                        `/staff/partner-products/${encodeURIComponent(product.id)}/photo`,
                      )
                        .then((url) => setPhotos((before) => ({ ...before, [product.id]: url })))
                        .catch(fail)
                    }
                    className="control bg-paper/10 text-paper underline"
                  >
                    Show the photo<span className="visually-hidden"> of {product.name}</span>
                  </button>
                ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void decideStaffPartnerProduct(staffKey, product.id, true)
                      .then(() => {
                        onNews(`${product.name} is live.`);
                        pending.reload();
                      })
                      .catch(fail)
                  }
                  className="control bg-highlight text-ink"
                >
                  Accept<span className="visually-hidden"> {product.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void decideStaffPartnerProduct(
                      staffKey,
                      product.id,
                      false,
                      'Please check the name, price and photo, and send it again.',
                    )
                      .then(() => {
                        onNews(`${product.name} turned down.`);
                        pending.reload();
                      })
                      .catch(fail)
                  }
                  className="control bg-paper/10 text-paper underline"
                >
                  Turn down<span className="visually-hidden"> {product.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="shops-heading" className="space-y-3">
        <h3 id="shops-heading" className="font-bold m-0">
          Shop Partners ({money(list.data?.partnerMonthlyPence ?? 0)} a month)
        </h3>
        <ul className="m-0 p-0 list-none space-y-3">
          {list.data?.shops.map((shop) => (
            <li key={shop.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
              <h4 className="m-0 font-bold">{shop.name}</h4>
              <p className="m-0">
                {shop.paid && shop.paidUntil
                  ? `Paid until ${new Date(shop.paidUntil).toLocaleDateString('en-GB')}.`
                  : 'Not paid: their products are hidden.'}{' '}
                {shop.live} live, {shop.waiting} waiting. Sign-ins:{' '}
                {shop.users.length
                  ? shop.users.map((user) => user.username).join(', ')
                  : 'none yet'}
                .
              </p>
              <button
                type="button"
                onClick={() =>
                  void renewStaffPartner(staffKey, shop.id, 1)
                    .then(() => {
                      onNews(`${shop.name}: one more month recorded as paid.`);
                      list.reload();
                    })
                    .catch(fail)
                }
                className="control bg-paper text-ink"
              >
                Record a month paid<span className="visually-hidden"> for {shop.name}</span>
              </button>
              <form
                onSubmit={(event) => {
                  const value = values(event);
                  addBusinessUser(staffKey, 'partners', shop.id, {
                    name: value('name'),
                    username: value('username'),
                  })
                    .then((result) => {
                      setPassword(result.message);
                      list.reload();
                    })
                    .catch(fail);
                }}
                className="flex flex-wrap gap-2 items-end"
              >
                <label className="block">
                  Their name
                  <input name="name" className={field} />
                </label>
                <label className="block">
                  Username
                  <input name="username" autoComplete="off" className={field} />
                </label>
                <button type="submit" className="control bg-paper/10 text-paper underline">
                  Give a sign-in<span className="visually-hidden"> for {shop.name}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            const value = values(event);
            const form = event.currentTarget;
            addStaffPartner(staffKey, {
              name: value('shop-name'),
              address: value('shop-address'),
              telephone: value('shop-telephone'),
              about: value('shop-about'),
              paidMonths: Number(value('shop-months') || '1'),
            })
              .then(() => {
                onNews(`${value('shop-name')} added as a Shop Partner.`);
                form.reset();
                list.reload();
              })
              .catch(fail);
          }}
          className="space-y-2"
          aria-labelledby="add-shop-heading"
        >
          <h4 id="add-shop-heading" className="font-bold m-0">
            Add a Shop Partner
          </h4>
          <label htmlFor="shop-name" className="block">
            Shop name
          </label>
          <input id="shop-name" name="shop-name" className={field} />
          <label htmlFor="shop-address" className="block">
            Address
          </label>
          <input id="shop-address" name="shop-address" className={field} />
          <label htmlFor="shop-telephone" className="block">
            Telephone
          </label>
          <input id="shop-telephone" name="shop-telephone" type="tel" className={field} />
          <label htmlFor="shop-about" className="block">
            A line about the shop, for its page
          </label>
          <input id="shop-about" name="shop-about" className={field} />
          <label htmlFor="shop-months" className="block">
            Months already paid
          </label>
          <input
            id="shop-months"
            name="shop-months"
            inputMode="numeric"
            defaultValue="1"
            className={field}
          />
          <button type="submit" className="control bg-highlight text-ink">
            Add the shop
          </button>
        </form>
      </section>

      <section aria-labelledby="orgs-heading" className="space-y-3">
        <h3 id="orgs-heading" className="font-bold m-0">
          Organisations
        </h3>
        <ul className="m-0 p-0 list-none space-y-3">
          {list.data?.organisations.map((organisation) => (
            <li key={organisation.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
              <h4 className="m-0 font-bold">{organisation.name}</h4>
              <p className="m-0">
                Code {organisation.joinCode}. {organisation.people} people linked. Sign-ins:{' '}
                {organisation.users.length
                  ? organisation.users
                      .map((user) => `${user.username}${user.office ? ` (${user.office})` : ''}`)
                      .join(', ')
                  : 'none yet'}
                .
              </p>
              <form
                onSubmit={(event) => {
                  const value = values(event);
                  addBusinessUser(staffKey, 'organisations', organisation.id, {
                    name: value('name'),
                    username: value('username'),
                    office: value('office'),
                  })
                    .then((result) => {
                      setPassword(result.message);
                      list.reload();
                    })
                    .catch(fail);
                }}
                className="flex flex-wrap gap-2 items-end"
              >
                <label className="block">
                  Their name
                  <input name="name" className={field} />
                </label>
                <label className="block">
                  Office or team
                  <input name="office" className={field} />
                </label>
                <label className="block">
                  Username
                  <input name="username" autoComplete="off" className={field} />
                </label>
                <button type="submit" className="control bg-paper/10 text-paper underline">
                  Give a sign-in<span className="visually-hidden"> for {organisation.name}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            const value = values(event);
            const form = event.currentTarget;
            addStaffOrganisation(staffKey, {
              name: value('org-name'),
              contactName: value('org-contact'),
              contactEmail: value('org-email'),
              contactPhone: value('org-phone') || undefined,
            })
              .then(() => {
                onNews(`${value('org-name')} added.`);
                form.reset();
                list.reload();
              })
              .catch(fail);
          }}
          className="space-y-2"
          aria-labelledby="add-org-heading"
        >
          <h4 id="add-org-heading" className="font-bold m-0">
            Add an organisation
          </h4>
          <label htmlFor="org-name" className="block">
            Organisation name
          </label>
          <input id="org-name" name="org-name" className={field} />
          <label htmlFor="org-contact" className="block">
            Main contact
          </label>
          <input id="org-contact" name="org-contact" className={field} />
          <label htmlFor="org-email" className="block">
            Their email
          </label>
          <input id="org-email" name="org-email" type="email" className={field} />
          <label htmlFor="org-phone" className="block">
            Their telephone
          </label>
          <input id="org-phone" name="org-phone" type="tel" className={field} />
          <button type="submit" className="control bg-highlight text-ink">
            Add the organisation
          </button>
        </form>
      </section>
    </section>
  );
}
