import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import {
  clearSignInCodes,
  fetchLockedOut,
  findToUnlock,
  resetShopperPin,
  resetStaffPassword,
  unlockLocked,
  unlockShopperPin,
  unlockStaff,
  type LockedPerson,
  type UnlockPerson,
  type UnlockResult,
} from '../lib/unlock-api';

const FIELD = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

function clock(at: string): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'That did not work.';
}

/**
 * What a tool said, in a status line, and a temporary password, shown once in its own box. The
 * password is never kept anywhere: it goes when the screen does.
 */
function Outcome({ result, problem }: { result: UnlockResult | null; problem: string }) {
  return (
    <>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      <p role="status" className="m-0">
        {result?.password ? '' : (result?.message ?? '')}
      </p>
      {result?.password && (
        <p role="status" className="border-2 border-highlight rounded-2xl p-4 m-0">
          {result.message}
        </p>
      )}
    </>
  );
}

/**
 * The tools for one person (ruling 81): for a Shopper, unlock their PIN, reset it (asked twice,
 * because they will have to choose a new one) and clear the limits on sign-in codes; for a
 * Runner, the sign-in codes; for staff, unlock them and give them a temporary password. Each
 * button says what it does, with the person's name for a screen reader.
 */
export function PersonTools({
  staffKey,
  person,
  owner = false,
  onDone,
}: {
  staffKey: string;
  person: UnlockPerson;
  /** The owner: only he may reset his own account's password. */
  owner?: boolean;
  onDone?: (result: UnlockResult) => void;
}): JSX.Element {
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState<'pin' | 'password' | null>(null);
  const [working, setWorking] = useState(false);

  const run = (tool: () => Promise<UnlockResult>): void => {
    setProblem('');
    setConfirming(null);
    setWorking(true);
    tool()
      .then((done) => {
        setResult(done);
        onDone?.(done);
      })
      .catch((failure: unknown) => setProblem(failureText(failure)))
      .finally(() => setWorking(false));
  };

  const name = person.name;
  const button = 'control border-paper bg-paper/10 text-paper';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {person.account === 'shopper' && (
          <>
            <button
              type="button"
              disabled={working}
              onClick={() => run(() => unlockShopperPin(staffKey, person.id))}
              className={button}
            >
              Unlock PIN<span className="visually-hidden"> for {name}</span>
            </button>
            {confirming === 'pin' ? (
              <>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => run(() => resetShopperPin(staffKey, person.id))}
                  className="control bg-highlight text-on-accent"
                >
                  Yes, reset {name}&rsquo;s PIN
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="control bg-paper/10 text-paper underline"
                >
                  Cancel<span className="visually-hidden"> resetting {name}&rsquo;s PIN</span>
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming('pin')} className={button}>
                Reset PIN<span className="visually-hidden"> for {name}</span>
              </button>
            )}
          </>
        )}
        {person.account !== 'staff' && (
          <button
            type="button"
            disabled={working}
            onClick={() => run(() => clearSignInCodes(staffKey, person.account, person.id))}
            className={button}
          >
            Clear sign-in code limits<span className="visually-hidden"> for {name}</span>
          </button>
        )}
        {person.account === 'staff' && (
          <>
            <button
              type="button"
              disabled={working}
              onClick={() => run(() => unlockStaff(staffKey, person.id))}
              className={button}
            >
              Unlock<span className="visually-hidden"> {name}</span>
            </button>
            {(!person.isOwner || owner) &&
              (confirming === 'password' ? (
                <>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => run(() => resetStaffPassword(staffKey, person.id))}
                    className="control bg-highlight text-on-accent"
                  >
                    Yes, give {name} a new password
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="control bg-paper/10 text-paper underline"
                  >
                    Cancel<span className="visually-hidden"> the new password for {name}</span>
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming('password')} className={button}>
                  New password<span className="visually-hidden"> for {name}</span>
                </button>
              ))}
          </>
        )}
      </div>
      {confirming === 'pin' && (
        <p className="m-0">
          {name} will be asked to choose a new PIN the next time one is needed, and we text them to
          say so.
        </p>
      )}
      <Outcome result={result} problem={problem} />
    </div>
  );
}

function stateWords(person: UnlockPerson): string {
  const parts: string[] = [];
  if (person.account === 'shopper') {
    parts.push('a Shopper');
    if (person.phoneEnding) parts.push(`phone ${person.phoneEnding}`);
    parts.push(person.hasPin ? (person.pinLocked ? 'PIN locked' : 'has a PIN') : 'no PIN yet');
    if (person.signInCodesLocked) parts.push('sign-in codes at their limit');
  } else if (person.account === 'runner') {
    parts.push('a Runner');
    if (person.phoneEnding) parts.push(`phone ${person.phoneEnding}`);
    if (person.signInCodesLocked) parts.push('sign-in codes at their limit');
  } else {
    parts.push(person.isOwner ? 'the owner' : 'staff');
    if (person.signInLocked) parts.push('locked out of signing in');
    if (person.codesLocked) parts.push('locked out of message and call codes');
  }
  return parts.join(', ');
}

/**
 * "Locked out", on Needs you now (ruling 81), for the owner and the staff he lets unlock:
 * everyone locked out of anything now, each with an Unlock button, and a way to find anybody to
 * unlock or reset who is not on the list.
 */
export function LockedOut({
  staffKey,
  owner = false,
  onNews = () => undefined,
}: {
  staffKey: string;
  owner?: boolean;
  onNews?: (news: string) => void;
}): JSX.Element {
  const id = useId();
  const [locks, setLocks] = useState<LockedPerson[] | null>(null);
  const [problem, setProblem] = useState('');
  const [said, setSaid] = useState('');
  const [found, setFound] = useState<UnlockPerson[] | null>(null);

  const reload = useCallback(() => {
    fetchLockedOut(staffKey)
      .then((result) => {
        setLocks(result.lockedOut);
        setProblem('');
      })
      .catch((failure: unknown) => setProblem(failureText(failure)));
  }, [staffKey]);
  useEffect(reload, [reload]);

  const unlock = (lock: LockedPerson): void => {
    setProblem('');
    unlockLocked(staffKey, lock)
      .then((result) => {
        setSaid(result.message);
        onNews(result.message);
        reload();
      })
      .catch((failure: unknown) => setProblem(failureText(failure)));
  };

  const search = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('unlock-search') ?? '').trim();
    setProblem('');
    findToUnlock(staffKey, text)
      .then((result) => setFound(result.people))
      .catch((failure: unknown) => setProblem(failureText(failure)));
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4 max-w-3xl">
      <h2 id={`${id}-heading`} className="text-lead font-bold">
        Locked out
      </h2>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {locks && (
        <p role="status" className="m-0">
          {said !== '' ? `${said} ` : ''}
          {locks.length === 0
            ? 'Nobody is locked out.'
            : `${locks.length === 1 ? 'One lock' : `${locks.length} locks`} on now.`}
        </p>
      )}
      {locks && locks.length > 0 && (
        <ul className="list-none m-0 p-0 space-y-2">
          {locks.map((lock) => (
            <li key={lock.key} className="border-2 border-paper rounded-2xl p-4 space-y-2">
              <p className="m-0">
                {lock.words}. Opens by itself at {clock(lock.until)}.
              </p>
              <button
                type="button"
                onClick={() => unlock(lock)}
                className="control bg-highlight text-on-accent"
              >
                Unlock<span className="visually-hidden"> {lock.words}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={search} className="space-y-2" aria-labelledby={`${id}-find-heading`}>
        <h3 id={`${id}-find-heading`} className="m-0 font-bold">
          Find someone to unlock or reset
        </h3>
        <label htmlFor={`${id}-search`} className="block">
          Their name, username, or the last numbers of their phone
        </label>
        <input id={`${id}-search`} name="unlock-search" type="search" className={FIELD} />
        <button type="submit" className="control bg-highlight text-on-accent">
          Find
        </button>
      </form>
      {found && found.length === 0 && (
        <p role="status" className="m-0">
          Nobody matches.
        </p>
      )}
      {found && found.length > 0 && (
        <ul className="list-none m-0 p-0 space-y-3">
          {found.map((person) => (
            <li
              key={`${person.account}:${person.id}`}
              className="border-2 border-paper rounded-2xl p-4 space-y-2"
            >
              <h4 className="m-0 font-bold">
                {person.name}, {stateWords(person)}
              </h4>
              <PersonTools
                staffKey={staffKey}
                person={person}
                owner={owner}
                onDone={(result) => {
                  // A temporary password is shown once, beside the person, and nowhere else.
                  onNews(
                    result.password
                      ? `${person.name} has a new password, shown once below their name.`
                      : result.message,
                  );
                  reload();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
