import { useCallback, useEffect, useState } from 'react';

import { money } from '../lib/money';

import {
  decideAmbassadorApplication,
  fetchStaffAmbassadorApplication,
  fetchStaffAmbassadorApplications,
  fetchStaffFile,
  reviewAmbassadorDocument,
  type StaffAmbassadorApplication,
} from '../lib/api';
import { HeldShares } from '../components/StaffAmbassadorChecks';

/**
 * The staff Ambassadors page (Anthony, 30 October 2026), for the founder and the operations
 * manager: every Ambassador application by status. Opening one shows its documents (Show photo or
 * PDF), what the automatic check found, Accept or Send back for each, "Chat done" with notes, and
 * Approve, Decline (with a reason the person sees) and Suspend. Nobody is approved without a
 * person pressing Approve after the chat.
 *
 * 31 October 2026: how the face is to be checked ("Check by a person: face not compared
 * automatically" unless they said yes); any note from an earlier decline or removal that matches
 * the applicant; and, to end a suspension, "Lift the suspension" (everything held released) or
 * "Remove for fraud", marking the businesses that were fraudulent, or all of them, whose unpaid
 * shares are cancelled. A date of birth from the ID may be kept on the note, if staff have it.
 */

function when(at: string | null): string {
  if (!at) return 'not yet';
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Failure({ text }: { text: string }): JSX.Element | null {
  if (text === '') return null;
  return (
    <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
      {text}
    </p>
  );
}

const fail =
  (set: (text: string) => void) =>
  (failure: unknown): void =>
    set(failure instanceof Error ? failure.message : 'That did not work.');

export function StaffAmbassadors({
  staffKey,
  by,
  onNews,
}: {
  staffKey: string;
  by: string;
  onNews: (words: string) => void;
}): JSX.Element {
  const [groups, setGroups] = useState<
    Awaited<ReturnType<typeof fetchStaffAmbassadorApplications>>['groups'] | null
  >(null);
  const [open, setOpen] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  const load = useCallback(() => {
    fetchStaffAmbassadorApplications(staffKey)
      .then((found) => {
        setGroups(found.groups);
        setProblem('');
      })
      .catch(fail(setProblem));
  }, [staffKey]);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="ambassadors-heading" className="space-y-6 max-w-3xl">
      <h2 id="ambassadors-heading" className="text-lead font-bold m-0">
        Ambassador applications
      </h2>
      <Failure text={problem} />
      <HeldShares staffKey={staffKey} by={by} onNews={onNews} />
      {groups?.map((group) => (
        <section key={group.status} aria-labelledby={`amb-${group.status}`} className="space-y-2">
          <h3 id={`amb-${group.status}`} className="font-bold m-0">
            {group.words} ({group.applications.length})
          </h3>
          {group.applications.length === 0 ? (
            <p className="m-0">None.</p>
          ) : (
            <ul className="m-0 ps-6 space-y-2">
              {group.applications.map((row) => (
                <li key={row.id} className="space-y-2">
                  <p className="m-0">
                    {row.name}, {row.kindWords}, {row.area}. Applied {when(row.agreedAt)}.
                    {row.waitingDocuments > 0
                      ? ` ${row.waitingDocuments} document${row.waitingDocuments === 1 ? '' : 's'} waiting.`
                      : ''}
                  </p>
                  <button
                    type="button"
                    aria-expanded={open === row.id}
                    onClick={() => setOpen(open === row.id ? null : row.id)}
                    className="control border-paper bg-paper/10 text-paper"
                  >
                    {open === row.id ? `Close ${row.name}` : `Open ${row.name}`}
                  </button>
                  {open === row.id && (
                    <Application
                      staffKey={staffKey}
                      id={row.id}
                      by={by}
                      onDone={(words) => {
                        onNews(words);
                        load();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </section>
  );
}

function Application({
  staffKey,
  id,
  by,
  onDone,
}: {
  staffKey: string;
  id: string;
  by: string;
  onDone: (words: string) => void;
}): JSX.Element {
  const [application, setApplication] = useState<StaffAmbassadorApplication | null>(null);
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [born, setBorn] = useState('');
  const [fraudShops, setFraudShops] = useState<string[]>([]);
  const [allShops, setAllShops] = useState(false);

  const load = useCallback(() => {
    fetchStaffAmbassadorApplication(staffKey, id)
      .then((found) => {
        setApplication(found.application);
        setNotes(found.application.chatNotes);
      })
      .catch(fail(setProblem));
  }, [staffKey, id]);
  useEffect(load, [load]);

  if (!application) return <Failure text={problem} />;

  const act = (
    action: 'chat-done' | 'approve' | 'decline' | 'suspend' | 'lift' | 'remove-for-fraud',
  ): void => {
    setProblem('');
    const needsReason =
      action === 'decline' || action === 'suspend' || action === 'remove-for-fraud';
    if (needsReason && reason.trim() === '') {
      setProblem('Please give the reason they will see.');
      return;
    }
    if (action === 'remove-for-fraud' && !allShops && fraudShops.length === 0) {
      setProblem('Please mark the businesses that were fraudulent, or choose all of them.');
      return;
    }
    decideAmbassadorApplication(staffKey, id, action, {
      by,
      ...(action === 'chat-done' ? { notes: notes.trim() } : {}),
      ...(needsReason ? { reason: reason.trim() } : {}),
      ...((action === 'decline' || action === 'remove-for-fraud') && born !== ''
        ? { dateOfBirth: born }
        : {}),
      ...(action === 'remove-for-fraud' ? { shops: allShops ? ('all' as const) : fraudShops } : {}),
    })
      .then((result) => {
        onDone(result.message);
        load();
      })
      .catch(fail(setProblem));
  };

  const heading = `${application.name}'s application`;
  return (
    <article
      aria-labelledby={`app-${id}`}
      className="space-y-4 border-2 border-paper rounded-2xl p-4"
    >
      <h4 id={`app-${id}`} className="font-bold m-0">
        {heading}
      </h4>
      <ul className="m-0 ps-6 space-y-1">
        <li>Status: {application.statusWords}</li>
        <li>
          Agreed to the terms {when(application.agreedAt)} (version {application.termsVersion})
        </li>
        <li>Documents sent: {when(application.documentsSentAt)}</li>
        <li>Documents checked: {when(application.documentsCheckedAt)}</li>
        <li>
          Chat:{' '}
          {application.chatDoneAt
            ? `done ${when(application.chatDoneAt)}, by ${application.chatDoneBy ?? 'staff'}`
            : 'not yet'}
        </li>
        {application.faceCheck && <li>Face photo: {application.faceCheck}</li>}
        {application.decisionReason && <li>Reason given: {application.decisionReason}</li>}
        {application.stillNeeded.length > 0 && (
          <li>Still needed: {application.stillNeeded.map((row) => row.name).join(', ')}</li>
        )}
      </ul>
      {(application.identityMatches ?? []).length > 0 && (
        <section aria-label={`Earlier notes that match ${application.name}`} className="space-y-1">
          <p className="m-0 font-bold">
            Please check: an earlier note matches this name or account.
          </p>
          <ul className="m-0 ps-6 space-y-1">
            {(application.identityMatches ?? []).map((match) => (
              <li key={match.id}>{match.words}</li>
            ))}
          </ul>
        </section>
      )}
      <Failure text={problem} />

      <h5 className="font-bold m-0">Documents</h5>
      {application.documents.length === 0 ? (
        <p className="m-0">Nothing sent yet.</p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-4">
          {application.documents.map((document) => (
            <li key={document.id}>
              <DocumentReview
                staffKey={staffKey}
                document={document}
                who={application.name}
                by={by}
                onDone={(words) => {
                  onDone(words);
                  load();
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <h5 className="font-bold m-0">The chat with the founder</h5>
      <label htmlFor={`notes-${id}`} className="block font-bold">
        Notes from the chat
      </label>
      <textarea
        id={`notes-${id}`}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
      />
      <button
        type="button"
        disabled={!application.canRecordChat}
        onClick={() => act('chat-done')}
        className="control bg-highlight text-on-accent disabled:opacity-60"
      >
        Chat done
      </button>
      {!application.canRecordChat && application.status !== 'approved' && (
        <p className="m-0">The chat can be recorded once every document is checked.</p>
      )}

      <h5 className="font-bold m-0">Decision</h5>
      <label htmlFor={`reason-${id}`} className="block font-bold">
        Reason, for Decline, Suspend or Remove for fraud (they see it)
      </label>
      <textarea
        id={`reason-${id}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
      />
      <label htmlFor={`born-${id}`} className="block font-bold">
        Date of birth on their ID, for the note kept after Decline or Remove for fraud (only if you
        have it)
      </label>
      <input
        id={`born-${id}`}
        type="date"
        value={born}
        onChange={(event) => setBorn(event.target.value)}
        className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!application.canApprove}
          onClick={() => act('approve')}
          className="control bg-highlight text-on-accent disabled:opacity-60"
        >
          Approve
        </button>
        {application.canDecline !== false && (
          <button
            type="button"
            onClick={() => act('decline')}
            className="control border-paper bg-paper/10 text-paper"
          >
            Decline
          </button>
        )}
        {application.canSuspend !== false && (
          <button
            type="button"
            onClick={() => act('suspend')}
            className="control border-paper bg-paper/10 text-paper"
          >
            Suspend
          </button>
        )}
      </div>

      {(application.canLift || application.canRemoveForFraud) && (
        <section aria-labelledby={`end-${id}`} className="space-y-3">
          <h5 id={`end-${id}`} className="font-bold m-0">
            End the suspension
          </h5>
          <p className="m-0">
            Lift it if there was no problem: everything they earned from real, completed orders is
            released. Or remove them for fraud: the unpaid shares from the businesses you mark are
            cancelled, and they can never apply again.
          </p>
          {application.canLift && (
            <button
              type="button"
              onClick={() => act('lift')}
              className="control bg-highlight text-on-accent"
            >
              Lift the suspension
            </button>
          )}
          {application.canRemoveForFraud && (
            <fieldset className="space-y-2 border-2 border-paper/40 rounded-2xl p-3 m-0">
              <legend className="font-bold">Which businesses were fraudulent?</legend>
              <div className="flex items-center gap-3 min-h-control">
                <input
                  type="checkbox"
                  id={`fraud-all-${id}`}
                  checked={allShops}
                  onChange={(event) => setAllShops(event.target.checked)}
                  className="h-6 w-6"
                />
                <label htmlFor={`fraud-all-${id}`} className="m-0">
                  All of them: cancel every unpaid share
                </label>
              </div>
              {(application.businesses ?? []).map((business) => (
                <div key={business.id} className="flex items-center gap-3 min-h-control">
                  <input
                    type="checkbox"
                    id={`fraud-${id}-${business.id}`}
                    checked={allShops || fraudShops.includes(business.id)}
                    disabled={allShops}
                    onChange={(event) =>
                      setFraudShops((now) =>
                        event.target.checked
                          ? [...now, business.id]
                          : now.filter((one) => one !== business.id),
                      )
                    }
                    className="h-6 w-6"
                  />
                  <label htmlFor={`fraud-${id}-${business.id}`} className="m-0">
                    {business.name}: {money(business.unpaidPence)} unpaid
                  </label>
                </div>
              ))}
              <button
                type="button"
                onClick={() => act('remove-for-fraud')}
                className="control border-paper bg-paper/10 text-paper"
              >
                Remove for fraud
              </button>
            </fieldset>
          )}
        </section>
      )}
    </article>
  );
}

function DocumentReview({
  staffKey,
  document,
  who,
  by,
  onDone,
}: {
  staffKey: string;
  document: StaffAmbassadorApplication['documents'][number];
  who: string;
  by: string;
  onDone: (words: string) => void;
}): JSX.Element {
  const [file, setFile] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const pdf = document.contentType === 'application/pdf';
  const decided = document.status !== 'submitted';

  const decide = (decision: 'accept' | 'reject'): void => {
    setProblem('');
    reviewAmbassadorDocument(staffKey, document.id, {
      decision,
      by,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
      .then(() =>
        onDone(
          `${document.name}, from ${who}: ${decision === 'accept' ? 'accepted' : 'sent back'}.`,
        ),
      )
      .catch(fail(setProblem));
  };

  return (
    <section
      aria-label={`${document.name}, from ${who}`}
      className="space-y-2 border-2 border-paper/40 rounded-2xl p-3"
    >
      <p className="m-0 font-bold">
        {document.name}:{' '}
        {document.status === 'accepted'
          ? 'checked'
          : document.status === 'rejected'
            ? 'sent back'
            : 'waiting'}
      </p>
      {document.checkedAt && (
        <p className="m-0">
          The automatic check:{' '}
          {document.checkPassed ? 'clearly fine.' : (document.checkNote ?? 'not sure.')}
          {document.checkName ? ` Name read: ${document.checkName}.` : ''}
          {document.checkIssuedOn ? ` Dated ${document.checkIssuedOn}.` : ''}
        </p>
      )}
      {document.reviewedBy && <p className="m-0">Decided by {document.reviewedBy}.</p>}
      {document.shareCode ? (
        <p className="m-0">
          Share code: {document.shareCode}. Check it on the government website before accepting.
        </p>
      ) : !document.hasFile ? (
        <p className="m-0">The file has been removed.</p>
      ) : file && pdf ? (
        <a
          href={file}
          target="_blank"
          rel="noreferrer"
          className="control border-paper bg-paper/10 text-paper"
        >
          Open the PDF of {document.name}, from {who}
        </a>
      ) : file ? (
        <img src={file} alt={`${document.name}, from ${who}`} className="max-w-full" />
      ) : (
        <button
          type="button"
          onClick={() => {
            fetchStaffFile(
              staffKey,
              `/staff/ambassador-documents/${encodeURIComponent(document.id)}/file`,
            )
              .then(setFile)
              .catch(() => setProblem('The file could not be opened.'));
          }}
          className="control border-paper bg-paper/10 text-paper"
        >
          {pdf ? 'Show PDF' : 'Show photo'}
        </button>
      )}
      <Failure text={problem} />
      {!decided && (
        <>
          <label htmlFor={`note-${document.id}`} className="block font-bold">
            Note (needed when sending it back, so they know what to send instead)
          </label>
          <textarea
            id={`note-${document.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => decide('accept')}
              className="control bg-highlight text-on-accent"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => decide('reject')}
              className="control border-paper bg-paper/10 text-paper"
            >
              Send back
            </button>
          </div>
        </>
      )}
    </section>
  );
}
