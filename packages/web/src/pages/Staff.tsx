import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ReceiptPhoto, TillCases } from '../components/TillCases';

import {
  addBusinessUser,
  addStaffOrganisation,
  addStaffPartner,
  addTeamMember,
  addViewer,
  changePasscode,
  fetchOwnerExists,
  fetchOwnerMoney,
  fetchStaffOverview,
  fetchViewers,
  killSwitch,
  setUpOwner,
  setViewer,
  type OwnerMoney,
  type StaffOverview,
  type Viewer,
  decideStaffPartnerProduct,
  fetchStaffPartnerProducts,
  fetchStaffPartners,
  fetchStaffAnalytics,
  recordStaffPartnerPayment,
  type StaffAnalytics,
  changeStaffPassword,
  checkStaffKey,
  fetchStaffMe,
  fetchStaffRoles,
  fetchTeam,
  resetTeamPassword,
  resetTeamTwoStep,
  type StaffTwoStep,
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
  fetchStaffShareLink,
  decideLearning,
  fetchLearning,
  type LearningRow,
  fetchBankPayments,
  markBankPayment,
  fetchReimbursements,
  approveReimbursement,
  type ReimbursementRow,
  type BankPaymentRow,
} from '../lib/api';
import { ShowWordsSwitch } from '../components/ShowWordsSwitch';
import { ShareCard } from '../components/ShareCard';
import { StaffVoice } from '../components/StaffVoice';
import {
  ActiveSos,
  ReferralRewards,
  RemoveRunner,
  WaitingDeposits,
} from '../components/StaffRunnerSafety';
import {
  AuditLog,
  Orders,
  Reports,
  RunnersNow,
  ShopperAccounts,
  TwoStepCodes,
  TwoStepRequired,
} from './StaffAdmin';
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

type TabKey = StaffArea | 'mine' | 'twostep';
type StaffMe = Awaited<ReturnType<typeof fetchStaffMe>>;
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'money', label: 'Money' },
  { key: 'payments', label: 'Payments' },
  { key: 'documents', label: 'Documents' },
  { key: 'problems', label: 'Problems' },
  { key: 'orders', label: 'Orders' },
  { key: 'runners', label: 'Runners' },
  { key: 'owed', label: 'Money owed' },
  { key: 'finds', label: 'Finds It' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'partners', label: 'Shops and organisations' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'learning', label: 'Learning' },
  { key: 'reports', label: 'Reports' },
  { key: 'accounts', label: 'Shopper accounts' },
  { key: 'audit', label: 'Audit log' },
  { key: 'team', label: 'Team' },
  { key: 'twostep', label: 'Two-step codes' },
  { key: 'mine', label: 'My settings' },
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

  // "My settings" is the owner's alone: his passcode, two-step codes, the kill switch, and who
  // sees his dashboard. Everyone else with their own account, family and investors too, has
  // their two-step codes.
  const allowed = (key: TabKey): boolean =>
    key === 'mine'
      ? me.isOwner === true
      : key === 'twostep'
        ? me.account && me.isOwner !== true
        : me.areas.includes(key);
  const freshSession = (token: string): void => {
    remember(KEY, token);
    setKey(token);
  };
  const tabs = TABS.filter((item) => allowed(item.key));
  const shown = tab && allowed(tab) ? tab : (tabs[0]?.key ?? null);

  return (
    <div className="space-y-6">
      <h1 className="text-display font-bold m-0">Admin</h1>
      <p className="m-0">
        Signed in as {by}, {me.isOwner ? 'Founder and owner' : me.title}.
        {me.viewOnly ? ' You can look, but not change anything.' : ''}{' '}
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
      ) : me.twoStep?.setupNeeded ? (
        <TwoStepRequired
          staffKey={key}
          state={me.twoStep}
          owner={me.isOwner === true}
          onNews={setNews}
          onSession={freshSession}
        />
      ) : (
        <>
          <StaffVoice
            staffKey={key}
            by={by}
            name={me.account ? me.name : by}
            title={me.title}
            areas={me.areas}
            address={me.isOwner ? (me.address ?? null) : null}
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
            {shown === 'documents' && <RemoveRunner staffKey={key} by={by} onNews={setNews} />}
            {shown === 'problems' && <ActiveSos staffKey={key} by={by} onNews={setNews} />}
            {shown === 'problems' && <Problems staffKey={key} by={by} onNews={setNews} />}
            {shown === 'owed' && <Owed staffKey={key} by={by} onNews={setNews} />}
            {shown === 'owed' && <WaitingDeposits staffKey={key} by={by} onNews={setNews} />}
            {shown === 'finds' && <Finds staffKey={key} onNews={setNews} />}
            {shown === 'enquiries' && <Enquiries staffKey={key} onNews={setNews} />}
            {shown === 'feedback' && <Feedback staffKey={key} />}
            {shown === 'learning' && <Learning staffKey={key} onNews={setNews} />}
            {shown === 'payments' && <Payments staffKey={key} onNews={setNews} />}
            {shown === 'partners' && <Partners staffKey={key} onNews={setNews} />}
            {shown === 'analytics' && <Analytics staffKey={key} />}
            {shown === 'overview' && <Overview staffKey={key} />}
            {shown === 'money' && <Money staffKey={key} />}
            {shown === 'money' && <ReferralRewards staffKey={key} by={by} onNews={setNews} />}
            {shown === 'orders' && <Orders staffKey={key} />}
            {shown === 'runners' && <RunnersNow staffKey={key} />}
            {shown === 'reports' && <Reports staffKey={key} />}
            {shown === 'accounts' && <ShopperAccounts staffKey={key} />}
            {shown === 'audit' && <AuditLog staffKey={key} />}
            {shown === 'twostep' && (
              <TwoStepCodes
                staffKey={key}
                state={me.twoStep}
                level={2}
                onNews={setNews}
                onSession={freshSession}
              />
            )}
            {shown === 'mine' && (
              <MySettings
                staffKey={key}
                twoStep={me.twoStep ?? null}
                onNews={setNews}
                onSignOut={signOut}
                onSession={freshSession}
              />
            )}
            {shown === 'team' && (
              <>
                {!me.account && <OwnerSetup staffKey={key} onNews={setNews} />}
                <Team staffKey={key} onNews={setNews} />
              </>
            )}
          </div>
          <ShareCard load={() => fetchStaffShareLink(key)} onNews={setNews} />
          <section aria-labelledby="staff-screen-heading" className="space-y-3 max-w-xl">
            <h2 id="staff-screen-heading" className="text-lead font-bold">
              The screen
            </h2>
            <ShowWordsSwitch />
          </section>
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
  // The owner's account asks for the passcode, and a two-step code if turned on, after the
  // password. The username and password stay in the boxes meanwhile.
  const [needs, setNeeds] = useState<string[]>([]);

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
    staffSignIn(value('staff-username'), String(data.get('staff-password') ?? ''), {
      ...(needs.includes('passcode') ? { passcode: String(data.get('staff-passcode') ?? '') } : {}),
      ...(needs.includes('code') ? { code: value('staff-code') } : {}),
    })
      .then((result) => onSignedIn(result.token, result.name))
      .catch((failure: unknown) => {
        const asked = (failure as { details?: { needs?: unknown } }).details?.needs;
        if (Array.isArray(asked)) setNeeds(asked.map(String));
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
          {needs.includes('passcode') && (
            <>
              <label htmlFor="staff-passcode" className="block font-bold">
                Your passcode: six numbers, then your special character
              </label>
              <input
                id="staff-passcode"
                name="staff-passcode"
                type="password"
                autoComplete="off"
                maxLength={7}
                className={field}
              />
            </>
          )}
          {needs.includes('code') && (
            <>
              <label htmlFor="staff-code" className="block font-bold">
                The 6-digit code from your authenticator app, or a recovery code
              </label>
              <input
                id="staff-code"
                name="staff-code"
                autoComplete="one-time-code"
                maxLength={9}
                className={field}
              />
            </>
          )}
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

/**
 * Payments (ruling 50): orders paid by bank transfer to the business account. Check each
 * reference and amount against the bank, then mark it as received; only then is a Runner sent.
 */
function Payments({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchBankPayments(staffKey));
  const mark = (row: BankPaymentRow, outcome: 'received' | 'cancel'): void => {
    void markBankPayment(staffKey, row.orderId, outcome)
      .then((result) => {
        onNews(result.message);
        list.reload();
      })
      .catch((failure: unknown) =>
        onNews(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  return (
    <section aria-labelledby="payments-heading" className="space-y-4 max-w-2xl">
      <h2 id="payments-heading" className="text-lead font-bold">
        Payments
      </h2>
      <p className="m-0 extra">
        Orders paid by bank transfer. Check the reference and the amount in the business bank
        account, then mark it as received, and the order goes to a Runner.
      </p>
      <Failure text={list.problem} />
      <h3 className="m-0 font-bold">Waiting to arrive</h3>
      {list.data?.waiting.length === 0 && <p className="m-0">None waiting.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {list.data?.waiting.map((row) => (
          <li key={row.orderId} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <p className="m-0 font-bold">
              {money(row.amountPence)}, reference {row.reference}
            </p>
            <p className="m-0">
              From {row.shopperName}, ordered{' '}
              {new Date(row.placedAt).toLocaleString('en-GB', {
                weekday: 'long',
                hour: 'numeric',
                minute: '2-digit',
              })}
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => mark(row, 'received')}
                className="control bg-highlight text-ink"
              >
                It has arrived<span className="visually-hidden">: {row.reference}</span>
              </button>
              <button
                type="button"
                onClick={() => mark(row, 'cancel')}
                className="control bg-paper text-ink"
              >
                Cancel this order<span className="visually-hidden">: {row.reference}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <h3 className="m-0 font-bold">Received lately</h3>
      {list.data?.received.length === 0 && <p className="m-0">None yet.</p>}
      <ul className="m-0 p-0 list-none space-y-2">
        {list.data?.received.map((row) => (
          <li key={row.orderId}>
            {money(row.amountPence)}, reference {row.reference}, from {row.shopperName}.
          </li>
        ))}
      </ul>
      <TillCases staffKey={staffKey} onNews={onNews} />
      <PayBacks staffKey={staffKey} onNews={onNews} />
    </section>
  );
}

/** Why a pay-back is waiting for a person, in words. */
const PAY_BACK_REASONS: Record<string, string> = {
  'over the limit': 'the till came to a lot more than the estimate',
  'over what one delivery carries': 'the till came to more than one delivery carries',
  'bank transfer': 'the Shopper paid by bank transfer, and the difference is settled by hand',
  'refund failed': 'the Shopper’s refund did not go through',
  'charge failed': 'the extra could not be taken from the Shopper’s card',
  'no receipt photo':
    'there is no photo of the receipt, and it is more than is paid back without one',
};

/**
 * Runners paid back for the shopping (ruling 55). Most go by themselves when the till total is
 * in; these need a person first. Approving sends the money straight to the Runner and tells them.
 */
function PayBacks({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchReimbursements(staffKey));
  const approve = (row: ReimbursementRow): void => {
    void approveReimbursement(staffKey, row.orderId)
      .then((result) => {
        onNews(result.message);
        list.reload();
      })
      .catch((failure: unknown) =>
        onNews(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  return (
    <>
      <h3 className="m-0 font-bold">Runners to pay back for the shopping</h3>
      <p className="m-0 extra">
        A Runner pays at the till with their own card and is paid back straight away. These need a
        person to look first. Approving pays the till total, never more than one delivery carries,
        straight to the Runner.
      </p>
      <Failure text={list.problem} />
      {list.data?.waiting.length === 0 && <p className="m-0">None waiting.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {list.data?.waiting.map((row) => (
          <li key={row.orderId} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <p className="m-0 font-bold">
              {money(row.amountPence)} to {row.runnerName}, order {row.reference}
            </p>
            <p className="m-0">
              The till said {money(row.receiptTotalPence ?? 0)}; the estimate was{' '}
              {money(row.goodsEstimatePence)}. Waiting because{' '}
              {PAY_BACK_REASONS[row.reason ?? ''] ?? row.reason ?? 'a person must look'}.
            </p>
            <ReceiptPhoto
              staffKey={staffKey}
              orderId={row.orderId}
              has={row.hasReceiptPhoto}
              label={`order ${row.reference}`}
            />
            <button
              type="button"
              onClick={() => approve(row)}
              className="control bg-highlight text-ink"
            >
              Approve and pay back<span className="visually-hidden">: order {row.reference}</span>
            </button>
          </li>
        ))}
      </ul>
      {(list.data?.owed.length ?? 0) > 0 && (
        <>
          <h3 className="m-0 font-bold">Owed, waiting for the Runner’s payout account</h3>
          <ul className="m-0 p-0 list-none space-y-2">
            {list.data?.owed.map((row) => (
              <li key={row.orderId}>
                {money(row.amountPence)} to {row.runnerName}, order {row.reference}.
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="m-0 font-bold">Paid back lately</h3>
      {list.data?.paid.length === 0 && <p className="m-0">None yet.</p>}
      <ul className="m-0 p-0 list-none space-y-2">
        {list.data?.paid.map((row) => (
          <li key={row.orderId}>
            {money(row.amountPence)} to {row.runnerName}, order {row.reference}
            {row.approvedBy ? `, approved by ${row.approvedBy}` : ''}.
          </li>
        ))}
      </ul>
    </>
  );
}

/** Who each question was asked of, in words. */
const ACCOUNT_WORDS: Record<string, string> = {
  shopper: 'a Shopper',
  runner: 'a Runner',
  partner: 'a Shop Partner',
  organisation: 'an organisation',
  staff: 'staff',
  family: 'family',
  investor: 'an investor',
  owner: 'the owner',
};

/**
 * Learning (ruling 49): what Ozi was asked and could not answer, most asked first. A person
 * writes the answer and approves it, and Ozi gives it from then on; or turns it down. Swearing
 * and anything personal never reach this list.
 */
function Learning({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element {
  const list = useList(() => fetchLearning(staffKey));
  const rows: LearningRow[] | undefined = list.data?.waiting;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const decide = (row: LearningRow, approve: boolean): void => {
    void decideLearning(
      staffKey,
      row.id,
      approve ? { approve, reply: answers[row.id] ?? '' } : { approve },
    )
      .then((result) => {
        onNews(result.message);
        list.reload();
      })
      .catch((failure: unknown) =>
        onNews(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };
  return (
    <section aria-labelledby="learning-heading" className="space-y-4 max-w-2xl">
      <h2 id="learning-heading" className="text-lead font-bold">
        Learning
      </h2>
      <p className="m-0 extra">
        What people asked Ozi that it could not answer, most asked first. Write the answer and
        approve it, and Ozi gives it from then on. Turn down anything Ozi should not learn.
      </p>
      <Failure text={list.problem} />
      {rows?.length === 0 && <p className="m-0">Nothing waiting. Ozi understood everything.</p>}
      <ul className="m-0 p-0 list-none space-y-3">
        {rows?.map((row) => (
          <li key={row.id} className="border-2 border-paper rounded-xl p-4 space-y-2">
            <h3 className="m-0 font-bold">&ldquo;{row.text}&rdquo;</h3>
            <p className="m-0">
              Asked by {ACCOUNT_WORDS[row.account] ?? row.account}, {row.timesHeard}{' '}
              {row.timesHeard === 1 ? 'time' : 'times'}.
            </p>
            <label htmlFor={`answer-${row.id}`} className="block font-bold">
              Ozi&rsquo;s answer
            </label>
            <textarea
              id={`answer-${row.id}`}
              value={answers[row.id] ?? ''}
              onChange={(event) => setAnswers({ ...answers, [row.id]: event.target.value })}
              maxLength={400}
              rows={2}
              className="w-full rounded-xl p-3 text-ink"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => decide(row, true)}
                className="control bg-highlight text-ink"
              >
                Approve<span className="visually-hidden">: {row.text}</span>
              </button>
              <button
                type="button"
                onClick={() => decide(row, false)}
                className="control bg-paper text-ink"
              >
                Turn down<span className="visually-hidden">: {row.text}</span>
              </button>
            </div>
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
              {member.twoStepOn ? 'Two-step codes on. ' : 'Two-step codes not set up yet. '}
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
              {member.twoStepOn && !member.title.includes('owner') && (
                <button
                  type="button"
                  onClick={() =>
                    void resetTeamTwoStep(staffKey, member.id)
                      .then((result) => {
                        setPassword(result.message);
                        list.reload();
                      })
                      .catch((failure: unknown) =>
                        setProblem(
                          failure instanceof Error ? failure.message : 'That did not work.',
                        ),
                      )
                  }
                  className="control bg-paper text-ink"
                >
                  Reset two-step codes
                  <span className="visually-hidden"> for {member.name}</span>
                </button>
              )}
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
                {shop.spotlightActive ? 'On Spotlight. ' : ''}
                {shop.live} live, {shop.waiting} waiting. Sign-ins:{' '}
                {shop.users.length
                  ? shop.users.map((user) => user.username).join(', ')
                  : 'none yet'}
                .
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['plan', `Plan, ${money(list.data?.partnerMonthlyPence ?? 0)}`],
                    ['spotlight', `Spotlight, ${money(list.data?.spotlightPence ?? 0)}`],
                    ['plus', `Spotlight Plus, ${money(list.data?.spotlightPlusPence ?? 0)}`],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() =>
                      void recordStaffPartnerPayment(staffKey, shop.id, kind)
                        .then(() => {
                          onNews(
                            `${shop.name}: a month of ${label.split(',')[0]} recorded as paid.`,
                          );
                          list.reload();
                        })
                        .catch(fail)
                    }
                    className="control bg-paper text-ink"
                  >
                    Record a month paid: {label}
                    <span className="visually-hidden"> for {shop.name}</span>
                  </button>
                ))}
              </div>
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

/**
 * Business analysis (ruling 42): what is bought, where and when, with no names. Any group of
 * fewer than ten people is left out, so nobody can be picked out.
 */
function Analytics({ staffKey }: { staffKey: string }): JSX.Element {
  const [period, setPeriod] = useState<StaffAnalytics['period']>('month');
  const [data, setData] = useState<StaffAnalytics | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    fetchStaffAnalytics(staffKey, period)
      .then(setData)
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'The numbers could not be loaded.'),
      );
  }, [staffKey, period]);

  const download = (): void => {
    if (!data) return;
    const rows = [
      'Section,Name,Purchases,Items,Shopping (GBP),People',
      ...data.shops.map(
        (row) =>
          `Shop,"${row.shop}",${row.purchases},${row.items},${(row.goodsPence / 100).toFixed(2)},${row.people ?? 'fewer than 10'}`,
      ),
      ...data.ageBands.rows.map(
        (row) =>
          `Age group,${row.key},${row.purchases},${row.items},${(row.goodsPence / 100).toFixed(2)},${row.people}`,
      ),
      ...data.areas.rows.map(
        (row) =>
          `Area,${row.key},${row.purchases},${row.items},${(row.goodsPence / 100).toFixed(2)},${row.people}`,
      ),
      ...data.categories.map((row) => `Category,"${row.category}",${row.purchases},${row.items},,`),
      ...data.routes.map((row) => `Route,"${row.route}",${row.deliveries},,,`),
      ...data.unmetSearches.map((row) => `Wanted but not found,"${row.term}",${row.count},,,`),
    ];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `analysis, last ${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const table = (
    caption: string,
    head: string[],
    rows: Array<Array<string | number>>,
  ): JSX.Element => (
    <table className="w-full border-collapse">
      <caption className="text-left font-bold py-2">{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col" className="text-left border-b-2 border-paper p-2">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="p-2">
              Nothing yet.
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th
                    key={cellIndex}
                    scope="row"
                    className="text-left font-normal border-b border-paper/40 p-2"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex} className="border-b border-paper/40 p-2">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <section aria-labelledby="analytics-heading" className="space-y-6 max-w-3xl">
      <h2 id="analytics-heading" className="text-lead font-bold">
        Business analysis
      </h2>
      <p className="m-0">
        No names, telephone numbers or addresses: people are one-way codes, places are postcode
        districts. A group of fewer than {data?.minimumGroup ?? 10} people is left out.
      </p>
      <Failure text={problem} />
      <label htmlFor="analytics-period" className="block font-bold">
        Period
      </label>
      <select
        id="analytics-period"
        value={period}
        onChange={(event) => setPeriod(event.target.value as StaffAnalytics['period'])}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      >
        <option value="day">The last day</option>
        <option value="week">The last week</option>
        <option value="month">The last month</option>
        <option value="year">The last year</option>
      </select>
      {data && (
        <>
          <p className="m-0 text-lead">
            {data.totals.purchases} purchases, {money(data.totals.goodsPence)} of shopping
            {data.totals.shoppers !== null ? `, ${data.totals.shoppers} Shoppers` : ''},{' '}
            {data.totals.runners} Runners, {data.totals.throughOrganisations} through organisations.
          </p>
          <button type="button" onClick={download} className="control bg-highlight text-ink">
            Download as a spreadsheet (CSV)
          </button>
          {table(
            'Purchases in the last…',
            ['Window', 'Purchases', 'Shopping'],
            data.windows.map((row) => [row.window, row.purchases, money(row.goodsPence)]),
          )}
          {table(
            'By shop',
            ['Shop', 'Purchases', 'Items', 'Shopping', 'People'],
            data.shops.map((row) => [
              row.shop,
              row.purchases,
              row.items,
              money(row.goodsPence),
              row.people ?? 'fewer than 10',
            ]),
          )}
          {table(
            'By age group',
            ['Age group', 'Purchases', 'Shopping', 'People'],
            data.ageBands.rows.map((row) => [
              row.key.replace('_', ' to ').replace('plus', 'and over'),
              row.purchases,
              money(row.goodsPence),
              row.people,
            ]),
          )}
          {table(
            'By area (postcode district)',
            ['Area', 'Purchases', 'Shopping', 'People'],
            data.areas.rows.map((row) => [
              row.key,
              row.purchases,
              money(row.goodsPence),
              row.people,
            ]),
          )}
          {table(
            'By kind of thing',
            ['Category', 'Purchases', 'Items'],
            data.categories.map((row) => [row.category, row.purchases, row.items]),
          )}
          {table(
            'By hour of the day',
            ['Hour', 'Purchases'],
            data.hours
              .filter((row) => row.purchases > 0)
              .map((row) => [`${row.hour}:00`, row.purchases]),
          )}
          {table(
            'By day of the week',
            ['Day', 'Purchases'],
            data.weekdays.map((row) => [row.day, row.purchases]),
          )}
          {table(
            'Runner routes: shop to area',
            ['Route', 'Deliveries'],
            data.routes.map((row) => [row.route, row.deliveries]),
          )}
          {table(
            'How Runners travel',
            ['Way', 'Deliveries'],
            data.travel.map((row) => [row.mode, row.deliveries]),
          )}
          {table(
            'Most searched',
            ['Search', 'Times'],
            data.topSearches.map((row) => [row.term, row.count]),
          )}
          {table(
            'Wanted, but nobody has it',
            ['Search', 'Times'],
            data.unmetSearches.map((row) => [row.term, row.count]),
          )}
        </>
      )}
    </section>
  );
}

/** People and work at a glance, with no money in it. */
function Overview({ staffKey }: { staffKey: string }): JSX.Element {
  const list = useList(() => fetchStaffOverview(staffKey));
  const data: StaffOverview | null = list.data;
  const tiles: Array<[string, number]> = data
    ? [
        ['Shoppers', data.people.shoppers],
        ['Runners', data.people.runners],
        ['Runners on shift now', data.people.runnersOnShiftNow],
        ['Shop Partners', data.people.shopPartners],
        ['Organisations', data.people.organisations],
        ['Staff', data.people.staff],
        ['Orders in the last day', data.work.ordersLastDay],
        ['Orders in the last week', data.work.ordersLastWeek],
        ['Complaints waiting', data.work.problemsWaiting],
        ['Runner documents waiting', data.work.documentsWaiting],
        ['Shop products waiting', data.work.shopProductsWaiting],
        ['Finds It waiting', data.work.findItWaiting],
      ]
    : [];
  return (
    <section aria-labelledby="overview-heading" className="space-y-4 max-w-3xl">
      <h2 id="overview-heading" className="text-lead font-bold">
        Overview
      </h2>
      <Failure text={list.problem} />
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0">
        {tiles.map(([label, value]) => (
          <div key={label} className="border-2 border-paper rounded-xl p-4">
            <dt className="m-0">{label}</dt>
            <dd className="m-0 text-lead font-bold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The money: for the owner's own account alone, signed in with the passcode. */
function Money({ staffKey }: { staffKey: string }): JSX.Element {
  const list = useList(() => fetchOwnerMoney(staffKey));
  const data: OwnerMoney | null = list.data;
  const periods: Array<
    [string, keyof Pick<OwnerMoney, 'today' | 'week' | 'month' | 'year' | 'allTime'>]
  > = [
    ['Today', 'today'],
    ['The last week', 'week'],
    ['The last month', 'month'],
    ['The last year', 'year'],
    ['Altogether', 'allTime'],
  ];
  return (
    <section aria-labelledby="money-heading" className="space-y-4 max-w-3xl">
      <h2 id="money-heading" className="text-lead font-bold">
        Money
      </h2>
      <p className="m-0">Only you see this. Not staff, not family, not investors.</p>
      <Failure text={list.problem} />
      {data && (
        <>
          <p className="m-0">
            Payment gateways:{' '}
            {data.gateways
              .map((row) => `${row.name}${row.connected ? '' : ' (not live)'}`)
              .join(', ')}
            . Flutterwave, Paystack and others appear here when they are connected.
          </p>
          <table className="w-full border-collapse">
            <caption className="text-left font-bold py-2">Money in and out</caption>
            <thead>
              <tr>
                {['Period', 'In', 'Given back', 'Kept'].map((cell) => (
                  <th key={cell} scope="col" className="text-left border-b-2 border-paper p-2">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map(([label, key]) => (
                <tr key={key}>
                  <th scope="row" className="text-left font-normal border-b border-paper/40 p-2">
                    {label}
                  </th>
                  <td className="border-b border-paper/40 p-2">{money(data[key].inPence)}</td>
                  <td className="border-b border-paper/40 p-2">{money(data[key].outPence)}</td>
                  <td className="border-b border-paper/40 p-2">{money(data[key].netPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.runnerPayBack && (
            <>
              <h3 className="font-bold m-0">Runners paid back for the shopping</h3>
              <p className="m-0">
                Runners pay at the till with their own card and are paid back straight away. It
                passes straight through to them. Today {money(data.runnerPayBack.todayPence)}, the
                last week {money(data.runnerPayBack.weekPence)}, the last month{' '}
                {money(data.runnerPayBack.monthPence)}, altogether{' '}
                {money(data.runnerPayBack.allTimePence)}.
              </p>
              <p className="m-0">
                Waiting for you to approve: {data.runnerPayBack.waitingCount} (
                {money(data.runnerPayBack.waitingPence)}), in the Payments tab. Owed until a
                Runner&rsquo;s payout account is ready: {data.runnerPayBack.owedCount} (
                {money(data.runnerPayBack.owedPence)}).
              </p>
            </>
          )}
          {data.runnerCards && <RunnerCards cards={data.runnerCards} />}
          <h3 className="font-bold m-0">The last month, by what it was for</h3>
          <ul className="m-0 ps-6">
            {data.month.byKind.map((row) => (
              <li key={row.name}>
                {row.name}: {money(row.pence)}
              </li>
            ))}
          </ul>
          <h3 className="font-bold m-0">The latest 50</h3>
          <ul className="m-0 ps-6">
            {data.recent.map((row, index) => (
              <li key={`${row.reference}-${index}`}>
                {new Date(row.at).toLocaleString('en-GB')}: {row.kind}, {money(row.amountPence)},{' '}
                {row.gateway}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The Runner spending cards (Stripe Issuing): each card's last four digits and whether it is
 * frozen, what each card order was loaded with and spent, and the latest declines with reasons.
 */
function RunnerCards({
  cards,
}: {
  cards: NonNullable<OwnerMoney['runnerCards']>;
}): JSX.Element {
  const cell = 'border-b border-paper/40 p-2';
  return (
    <>
      <h3 className="font-bold m-0">Runner spending cards</h3>
      <p className="m-0">
        {cards.enabled
          ? 'Runners who choose the card pay at the till with it, loaded for each order. The business pays the shop; nothing is paid back.'
          : 'The card is switched off (STRIPE_ISSUING_ENABLED). Runners pay with their own card and are paid back.'}
      </p>
      {cards.cards.length === 0 ? (
        <p className="m-0">No Runner has a card yet.</p>
      ) : (
        <ul className="m-0 ps-6">
          {cards.cards.map((card) => (
            <li key={card.runnerId}>
              {card.name}: card ending {card.last4 ?? '????'},{' '}
              {card.status === 'active' ? 'loaded for an order' : 'frozen'}
              {card.chosen === 'own' ? ', paying with their own card for now' : ''}
            </li>
          ))}
        </ul>
      )}
      {cards.orders.length > 0 && (
        <table className="w-full border-collapse">
          <caption className="text-left font-bold py-2">Card orders, the last month</caption>
          <thead>
            <tr>
              {['Order', 'Runner', 'Loaded', 'Spent', 'Shop', 'Receipt'].map((heading) => (
                <th key={heading} scope="col" className="text-left border-b-2 border-paper p-2">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cards.orders.map((order) => (
              <tr key={order.orderId}>
                <th scope="row" className={`text-left font-normal ${cell}`}>
                  {order.orderId}
                </th>
                <td className={cell}>{order.runnerName}</td>
                <td className={cell}>
                  {order.loadedPence === null ? 'none' : money(order.loadedPence)}
                </td>
                <td className={cell}>
                  {order.spentPence === null ? 'nothing yet' : money(order.spentPence)}
                </td>
                <td className={cell}>{order.merchant ?? ''}</td>
                <td className={cell}>
                  {order.receiptPence === null ? 'not in yet' : money(order.receiptPence)}
                  {order.needsPerson ? ' (needs you, on the till screen)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4 className="font-bold m-0">Declined at the till</h4>
      {cards.declines.length === 0 ? (
        <p className="m-0">None.</p>
      ) : (
        <ul className="m-0 ps-6">
          {cards.declines.map((row, index) => (
            <li key={`${row.at}-${index}`}>
              {new Date(row.at).toLocaleString('en-GB')}: {row.runnerName || 'unknown card'},{' '}
              {money(row.amountPence)}
              {row.merchant ? ` at ${row.merchant}` : ''}. {row.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Making the owner's own account, once, signed in with the staff key. */
function OwnerSetup({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element | null {
  const exists = useList(() => fetchOwnerExists(staffKey));
  const [problem, setProblem] = useState('');
  if (!exists.data || exists.data.ownerExists) return null;
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (name: string): string => String(data.get(name) ?? '');
        setProblem('');
        setUpOwner(staffKey, {
          name: value('owner-name').trim(),
          username: value('owner-username').trim(),
          password: value('owner-password'),
          passcode: value('owner-passcode'),
        })
          .then((result) => {
            onNews(result.message);
            exists.reload();
          })
          .catch((failure: unknown) =>
            setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
          );
      }}
      className="space-y-3 max-w-xl border-2 border-highlight rounded-xl p-4"
      aria-labelledby="owner-setup-heading"
    >
      <h2 id="owner-setup-heading" className="text-lead font-bold m-0">
        Set up your owner&rsquo;s account
      </h2>
      <p className="m-0">
        Your own account, the only one that ever sees the money. You sign in with a username, a
        password and your passcode. This is done once.
      </p>
      <Failure text={problem} />
      <label htmlFor="owner-name" className="block font-bold">
        Your name
      </label>
      <input id="owner-name" name="owner-name" autoComplete="name" className={field} />
      <label htmlFor="owner-username" className="block font-bold">
        Your username
      </label>
      <input id="owner-username" name="owner-username" autoComplete="username" className={field} />
      <label htmlFor="owner-password" className="block font-bold">
        Your password, at least 10 characters
      </label>
      <input
        id="owner-password"
        name="owner-password"
        type="password"
        autoComplete="new-password"
        className={field}
      />
      <label htmlFor="owner-passcode" className="block font-bold">
        Your passcode: six numbers, then one special character, such as 123456#
      </label>
      <input
        id="owner-passcode"
        name="owner-passcode"
        type="password"
        autoComplete="off"
        maxLength={7}
        className={field}
      />
      <button type="submit" className="control bg-highlight text-ink">
        Make my owner&rsquo;s account
      </button>
    </form>
  );
}

const VIEWER_AREA_WORDS: Record<string, string> = {
  overview: 'Overview: how many Shoppers, Runners, Shop Partners, organisations and staff',
  analytics: 'Business analysis',
  team: 'The team, and what each person does',
  documents: 'Runner documents',
  problems: 'Complaints',
  feedback: 'Feedback',
  finds: 'Finds It',
  enquiries: 'Enquiries',
  partners: 'Shops and organisations',
};

/** The owner's own settings: passcode, two-step codes, the kill switch, and who sees what. */
function MySettings({
  staffKey,
  twoStep,
  onNews,
  onSignOut,
  onSession,
}: {
  staffKey: string;
  twoStep: StaffTwoStep | null;
  onNews: (text: string) => void;
  onSignOut: () => void;
  onSession: (token: string) => void;
}): JSX.Element {
  const viewers = useList(() => fetchViewers(staffKey));
  const [problem, setProblem] = useState('');
  const [password, setPassword] = useState('');
  const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
  const fail = (failure: unknown): void =>
    setProblem(failure instanceof Error ? failure.message : 'That did not work.');
  const values = (event: FormEvent<HTMLFormElement>): ((name: string) => string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    return (name) => String(data.get(name) ?? '');
  };
  const change = (viewer: Viewer, update: { areas?: StaffArea[]; all?: boolean }): void => {
    setViewer(staffKey, viewer.id, update)
      .then(() => {
        onNews(
          update.all === true
            ? `Everything is on for ${viewer.name}, except the money.`
            : update.all === false
              ? `Everything is off for ${viewer.name}.`
              : `Saved for ${viewer.name}.`,
        );
        viewers.reload();
      })
      .catch(fail);
  };

  return (
    <section aria-labelledby="mine-heading" className="space-y-8 max-w-2xl">
      <h2 id="mine-heading" className="text-lead font-bold">
        My settings
      </h2>
      <Failure text={problem} />
      {password !== '' && (
        <p role="status" className="border-2 border-highlight rounded-xl p-4 m-0">
          {password}
        </p>
      )}

      <section aria-labelledby="viewers-heading" className="space-y-4">
        <h3 id="viewers-heading" className="text-lead font-bold m-0">
          Who sees my dashboard
        </h3>
        <p className="m-0">
          Family, such as your wife, and investors, each with their own sign-in. They see only what
          you switch on, they can look but never change anything, and nobody but you ever sees the
          money.
        </p>
        {viewers.data?.viewers.length === 0 && <p className="m-0">Nobody yet.</p>}
        <ul className="list-none m-0 p-0 space-y-4">
          {viewers.data?.viewers.map((viewer) => (
            <li key={viewer.id} className="border-2 border-paper rounded-xl p-4 space-y-3">
              <h4 className="m-0 font-bold">
                {viewer.name}, {viewer.kind === 'family' ? 'family' : 'investor'} (signs in as{' '}
                {viewer.username})
              </h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => change(viewer, { all: true })}
                  className="control bg-highlight text-ink"
                >
                  Switch all on<span className="visually-hidden"> for {viewer.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => change(viewer, { all: false })}
                  className="control bg-paper text-ink"
                >
                  Switch all off<span className="visually-hidden"> for {viewer.name}</span>
                </button>
              </div>
              <ul className="list-none m-0 p-0 space-y-1">
                {(viewers.data?.areas ?? []).map((area) => {
                  const on = viewer.areas.includes(area);
                  return (
                    <li key={area}>
                      <label className="flex items-center gap-3 min-h-control">
                        <input
                          type="checkbox"
                          role="switch"
                          aria-checked={on}
                          checked={on}
                          onChange={() =>
                            change(viewer, {
                              areas: on
                                ? viewer.areas.filter((one) => one !== area)
                                : [...viewer.areas, area],
                            })
                          }
                          className="w-6 h-6"
                        />
                        {VIEWER_AREA_WORDS[area] ?? area}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="m-0">The money: always off. Only you see it.</p>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            const value = values(event);
            const form = event.currentTarget;
            addViewer(staffKey, {
              name: value('viewer-name').trim(),
              username: value('viewer-username').trim(),
              kind: value('viewer-kind') === 'investor' ? 'investor' : 'family',
            })
              .then((result) => {
                setPassword(result.message);
                form.reset();
                viewers.reload();
              })
              .catch(fail);
          }}
          className="space-y-2"
          aria-labelledby="add-viewer-heading"
        >
          <h4 id="add-viewer-heading" className="font-bold m-0">
            Add someone
          </h4>
          <label htmlFor="viewer-name" className="block">
            Their name
          </label>
          <input id="viewer-name" name="viewer-name" className={field} />
          <label htmlFor="viewer-username" className="block">
            Their username
          </label>
          <input id="viewer-username" name="viewer-username" autoComplete="off" className={field} />
          <label htmlFor="viewer-kind" className="block">
            Who they are
          </label>
          <select id="viewer-kind" name="viewer-kind" className={field} defaultValue="family">
            <option value="family">Family (such as my wife)</option>
            <option value="investor">Investor</option>
          </select>
          <button type="submit" className="control bg-highlight text-ink">
            Add them
          </button>
        </form>
      </section>

      <form
        onSubmit={(event) => {
          const value = values(event);
          changePasscode(staffKey, value('current-passcode'), value('new-passcode'))
            .then((result) => onNews(result.message))
            .catch(fail);
        }}
        className="space-y-2"
        aria-labelledby="passcode-heading"
      >
        <h3 id="passcode-heading" className="text-lead font-bold m-0">
          Change my passcode
        </h3>
        <label htmlFor="current-passcode" className="block">
          My passcode now
        </label>
        <input
          id="current-passcode"
          name="current-passcode"
          type="password"
          maxLength={7}
          className={field}
        />
        <label htmlFor="new-passcode" className="block">
          My new passcode: six numbers, then a special character
        </label>
        <input
          id="new-passcode"
          name="new-passcode"
          type="password"
          maxLength={7}
          className={field}
        />
        <button type="submit" className="control bg-paper text-ink">
          Change my passcode
        </button>
      </form>

      <TwoStepCodes
        staffKey={staffKey}
        state={twoStep}
        owner
        onNews={onNews}
        onSession={onSession}
      />

      <form
        onSubmit={(event) => {
          const value = values(event);
          killSwitch(staffKey, value('kill-passcode'))
            .then((result) => {
              onNews(result.message);
              onSignOut();
            })
            .catch(fail);
        }}
        className="space-y-2 border-2 border-paper rounded-xl p-4"
        aria-labelledby="kill-heading"
      >
        <h3 id="kill-heading" className="text-lead font-bold m-0">
          Kill switch
        </h3>
        <p className="m-0">
          Switches everything off for everyone who sees your dashboard, and signs every admin
          session out, yours too. Nothing is deleted. Your passcode is needed.
        </p>
        <label htmlFor="kill-passcode" className="block">
          My passcode
        </label>
        <input
          id="kill-passcode"
          name="kill-passcode"
          type="password"
          maxLength={7}
          className={field}
        />
        <button type="submit" className="control bg-highlight text-ink">
          Use the kill switch
        </button>
      </form>
    </section>
  );
}
