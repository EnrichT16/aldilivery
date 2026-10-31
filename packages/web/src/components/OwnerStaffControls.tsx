import { useEffect, useState } from 'react';

import {
  fetchOwnerStaff,
  switchAllStaffOff,
  switchStaffAccount,
  type OwnerStaffEntry,
} from '../lib/owner-controls-api';

function seenWords(member: OwnerStaffEntry): string {
  if (member.signedInNow) return 'Signed in now.';
  if (!member.lastSeenAt) return 'Not signed in. Never seen yet.';
  const when = new Date(member.lastSeenAt).toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Not signed in. Last seen ${when}.`;
}

/**
 * The owner's staff list (ruling 85): each account's name and job, on or switched off, signed in
 * now or when last seen, and roughly where. Each account has its own switch, and one switch turns
 * off everyone but him. Switching off signs that account out everywhere at once. Shown only to
 * the owner; if the list cannot be read, nothing is shown.
 */
export function OwnerStaffControls({
  staffKey,
  onNews,
}: {
  staffKey: string;
  onNews: (text: string) => void;
}): JSX.Element | null {
  const [staff, setStaff] = useState<OwnerStaffEntry[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    fetchOwnerStaff(staffKey)
      .then((result) => setStaff(Array.isArray(result.staff) ? result.staff : null))
      .catch(() => setStaff(null));
  }, [staffKey]);

  if (!staff) return null;

  const run = (action: Promise<{ message: string; staff: OwnerStaffEntry[] }>): void => {
    setProblem('');
    setBusy(true);
    action
      .then((result) => {
        setStaff(result.staff);
        onNews(result.message);
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => {
        setBusy(false);
        setConfirmAll(false);
      });
  };

  const others = staff.filter((member) => !member.isOwner);

  return (
    <section aria-labelledby="owner-staff-heading" className="space-y-4">
      <h3 id="owner-staff-heading" className="text-lead font-bold m-0">
        All staff, and their sign-ins
      </h3>
      <p className="m-0">
        Who is on, who is signed in now, and roughly where they were last. Switching an account off
        signs it out everywhere at once, phones included. Your own account is never switched off.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <ul className="m-0 p-0 list-none space-y-3">
        {staff.map((member) => (
          <li key={member.id} className="border-2 border-paper rounded-2xl p-4 space-y-2">
            <h4 className="m-0 font-bold">
              {member.name}, {member.title}
            </h4>
            <p className="m-0">
              {member.active ? 'Switched on.' : 'Switched off.'} {seenWords(member)} Place:{' '}
              {member.place}.
            </p>
            {!member.isOwner && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(switchStaffAccount(staffKey, member.id, !member.active))}
                className="control border-paper bg-paper/10 text-paper"
              >
                {member.active ? 'Switch off' : 'Switch back on'} {member.name}&rsquo;s account
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="space-y-2 border-2 border-paper rounded-2xl p-4">
          <h4 className="m-0 font-bold">Switch off all staff except me</h4>
          <p className="m-0">
            Every other account is switched off and signed out at once. Nothing is deleted, and you
            can switch each one back on here.
          </p>
          {confirmAll ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => run(switchAllStaffOff(staffKey))}
                className="control bg-highlight text-on-accent"
              >
                Yes, switch off all staff except me
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="control border-paper bg-paper/10 text-paper"
              >
                No, leave them on
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmAll(true)}
              className="control bg-highlight text-on-accent"
            >
              Switch off all staff except me
            </button>
          )}
        </div>
      )}
    </section>
  );
}
