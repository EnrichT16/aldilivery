import { safeNextPath } from '@aldilivery/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { FREE_JOINING_WORDS } from '../components/FreeJoiningNotice';
import { storeConfig } from '../config';
import {
  ambassadorCheckPhotoUrl,
  checkAmbassador,
  reportAmbassadorCheck,
  type AmbassadorCheck as Check,
} from '../lib/api';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

/**
 * "Check an Ambassador" (Anthony, 31 October 2026), for anybody: type the code from an
 * Ambassador's card or flyer, or scan its QR code, which comes here first. It shows only their
 * first name, their face photo while they are active, whether they are active and the day they
 * were approved: never a surname, a phone number or an email. Somebody suspended or removed shows
 * "Not active", with a button to report it. Every printed QR code comes here, so a suspension
 * takes effect at once on paper already printed; with `?next=` the page offers to carry on to the
 * sign-up once the check shows the Ambassador is active.
 */
export function AmbassadorCheck(): JSX.Element {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNextPath(params.get('next'));
  const [found, setFound] = useState<Check | null>(null);
  const [problem, setProblem] = useState('');
  const [reported, setReported] = useState('');
  const [reporting, setReporting] = useState(false);
  const result = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setFound(null);
    setProblem('');
    setReported('');
    if (code === '') return;
    checkAmbassador(code)
      .then((answer) => {
        setFound(answer);
        window.setTimeout(() => result.current?.focus(), 0);
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be checked.'),
      );
  }, [code]);

  const lookUp = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('code') ?? '')
      .trim()
      .toUpperCase();
    if (typed === '') {
      setProblem('Please type the code from the card or flyer.');
      return;
    }
    navigate(`/ambassador/check/${encodeURIComponent(typed)}`);
  };

  const report = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get('note') ?? '');
    setReporting(true);
    reportAmbassadorCheck(code, note)
      .then((answer) => setReported(answer.message))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be sent.'),
      )
      .finally(() => setReporting(false));
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-display font-bold m-0">Check an Ambassador</h1>
      <p className="m-0">
        Every {storeConfig.assistantName} Ambassador has a code on their card and flyers. Type it
        here to see whether they are active.
      </p>

      <form onSubmit={lookUp} className="space-y-3" aria-label="Check a code">
        <label htmlFor="check-code" className="block font-bold">
          The Ambassador&rsquo;s code
        </label>
        <input
          id="check-code"
          name="code"
          defaultValue={code.toUpperCase()}
          autoComplete="off"
          autoCapitalize="characters"
          className={`${field} max-w-xs text-lead tracking-widest`}
        />
        <button type="submit" className="control bg-highlight text-on-accent">
          Check
        </button>
      </form>

      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}

      {found && !found.known && (
        <section aria-labelledby="check-result" className="space-y-2">
          <h2 id="check-result" ref={result} tabIndex={-1} className="text-lead font-bold m-0">
            {found.words}
          </h2>
          <p className="m-0">
            Please check the code. If somebody gave it to you as an Ambassador, ring us on{' '}
            {storeConfig.contact.telephonePlaceholder}.
          </p>
        </section>
      )}

      {found?.known && found.active && (
        <section
          aria-labelledby="check-result"
          className="space-y-3 border-4 border-highlight rounded-2xl p-4"
        >
          <h2 id="check-result" ref={result} tabIndex={-1} className="text-lead font-bold m-0">
            Active: {found.firstName}
          </h2>
          {found.hasPhoto && (
            <img
              src={ambassadorCheckPhotoUrl(found.code)}
              alt={`${found.firstName}, the Ambassador with this code`}
              className="w-40 h-40 object-cover rounded-2xl"
            />
          )}
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-bold">First name</dt>
            <dd className="m-0">{found.firstName}</dd>
            <dt className="font-bold">Active</dt>
            <dd className="m-0">Yes</dd>
            {found.approvedWords && (
              <>
                <dt className="font-bold">Approved on</dt>
                <dd className="m-0">{found.approvedWords}</dd>
              </>
            )}
          </dl>
          <p className="m-0">{FREE_JOINING_WORDS}</p>
          {next && (
            <Link to={next} className="control bg-highlight text-on-accent">
              Carry on
            </Link>
          )}
        </section>
      )}

      {found?.known && !found.active && (
        <section
          aria-labelledby="check-result"
          className="space-y-3 border-4 border-paper rounded-2xl p-4"
        >
          <h2 id="check-result" ref={result} tabIndex={-1} className="text-lead font-bold m-0">
            {found.words}
          </h2>
          <p className="m-0">Code {found.code}.</p>
          {reported !== '' ? (
            <p role="status" className="m-0 font-bold">
              {reported}
            </p>
          ) : (
            <form onSubmit={report} className="space-y-3">
              <label htmlFor="report-note" className="block font-bold">
                What happened (optional)
              </label>
              <textarea id="report-note" name="note" rows={3} className={field} />
              <button
                type="submit"
                disabled={reporting}
                className="control bg-highlight text-on-accent"
              >
                Report it
              </button>
            </form>
          )}
          <p className="m-0">
            You can still use {storeConfig.assistantName} yourself, on our website. Never pay
            anybody to join.
          </p>
        </section>
      )}
    </div>
  );
}
