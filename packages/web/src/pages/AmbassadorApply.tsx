import { AMBASSADOR_TERMS_VERSION } from '@aldilivery/core';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PhotoChoice } from '../components/PhotoChoice';
import { storeConfig } from '../config';
import {
  becomeAmbassador,
  fetchAmbassadorApplication,
  sendAmbassadorDocument,
  type AmbassadorAddressType,
  type AmbassadorApplication,
  type AmbassadorDocumentKind,
  type AmbassadorIdType,
  type ReferralAs,
} from '../lib/api';
import { ambassadorAs } from '../lib/ambassador';
import { isPdf, preparePdf, preparePhoto } from '../lib/photo';

/**
 * Applying to be an Ozi Ambassador (Anthony, 30 October 2026), in three steps, each its own
 * heading:
 *
 * 1. Read and agree to the Ambassador terms (the tick, and the version kept by the server).
 * 2. Send the documents from the phone, as a Runner does (PhotoChoice: take a photo, or choose a
 *    photo or a PDF): a photo ID (passport, driving licence or biometric residence card), the
 *    front and for a card the back; a proof of address from the last three months; a face photo;
 *    and, for somebody who is not British, a Home Office share code if they wish.
 * 3. "We'll contact you to have a short chat before you start."
 *
 * Then a person approves them. Somebody who opted in before applications sees, plainly, that their
 * link and earnings carry on and the Toolkit and withdrawals wait for this.
 */

const ID_WORDS: Record<AmbassadorIdType, string> = {
  passport: 'Passport',
  driving_licence: 'Driving licence (photocard)',
  residence_card: 'Biometric residence card',
};

const ADDRESS_WORDS: Record<AmbassadorAddressType, string> = {
  utility_bill: 'A utility bill (gas, electricity, water or broadband)',
  bank_letter: 'A bank letter or statement',
  council_tax: 'A council tax letter',
};

const STATUS_WORDS = {
  submitted: 'sent, being checked',
  accepted: 'checked',
  rejected: 'not accepted',
} as const;

export function AmbassadorApply(): JSX.Element {
  const [params] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [application, setApplication] = useState<AmbassadorApplication | null | undefined>(
    undefined,
  );
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!as) return;
    fetchAmbassadorApplication(as)
      .then((found) => setApplication(found.application))
      .catch((failure: unknown) => {
        setApplication(null);
        setProblem(failure instanceof Error ? failure.message : 'We could not load it.');
      });
  }, [as]);
  useEffect(load, [load]);

  if (!as) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-display font-bold m-0">Apply to be an Ozi Ambassador</h1>
        <p className="m-0">
          First, set up your free account with your phone number, or sign in. Then you come straight
          back here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/sign-up?next=/ambassador/apply"
            className="control bg-highlight text-on-accent"
          >
            Set up my account
          </Link>
          <Link
            to="/sign-in?next=/ambassador/apply"
            className="control border-paper bg-paper/10 text-paper"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  function apply(): void {
    if (!agreed) {
      setProblem('Please tick to agree to the Ozi Ambassador terms first.');
      return;
    }
    if (!as) return;
    setProblem('');
    setBusy(true);
    becomeAmbassador(as, AMBASSADOR_TERMS_VERSION)
      .then((result) => {
        setNews(result.message);
        load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  }

  const status = application?.status;
  const closed = status === 'declined' || status === 'suspended';

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">Apply to be an Ozi Ambassador</h1>
      <p role="status" className="m-0 font-bold">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}
      {application && (
        <section aria-labelledby="where" className="space-y-2">
          <h2 id="where" className="text-lead font-bold m-0">
            Where your application is
          </h2>
          <p className="m-0">Status: {application.statusWords}.</p>
          <p className="m-0">{application.message}</p>
          {application.approved && (
            <Link to="/ambassador/home" className="control bg-highlight text-on-accent">
              Open my Ambassador dashboard
            </Link>
          )}
        </section>
      )}

      {application === null && (
        <section aria-labelledby="step-1" className="space-y-3">
          <h2 id="step-1" className="text-lead font-bold m-0">
            Step 1: read and agree to the terms
          </h2>
          <p className="m-0">
            <Link to="/ambassador/terms" className="underline">
              Read the Ozi Ambassador terms
            </Link>
          </p>
          <div className="flex items-start gap-3">
            <input
              id="ambassador-terms"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="w-8 h-8 shrink-0"
            />
            <label htmlFor="ambassador-terms" className="m-0 font-bold">
              I have read and agree to the Ozi Ambassador terms
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={apply}
            className="control bg-highlight text-on-accent"
          >
            {busy ? 'One moment…' : 'Apply to be an Ambassador'}
          </button>
        </section>
      )}

      {application && !application.approved && !closed && (
        <DocumentsStep
          as={as}
          application={application}
          onSent={(message, next) => {
            setApplication(next);
            setProblem('');
            setNews(message);
          }}
          onProblem={setProblem}
        />
      )}

      {application && application.documentsIn && !application.approved && !closed && (
        <section aria-labelledby="step-3" className="space-y-2">
          <h2 id="step-3" className="text-lead font-bold m-0">
            Step 3: talk with the founder
          </h2>
          <p className="m-0">
            {application.chatDone
              ? 'Thank you for the chat. The founder will approve your application soon.'
              : "We'll contact you to have a short chat before you start."}
          </p>
        </section>
      )}
    </div>
  );
}

function DocumentsStep({
  as,
  application,
  onSent,
  onProblem,
}: {
  as: ReferralAs;
  application: AmbassadorApplication;
  onSent: (message: string, next: AmbassadorApplication) => void;
  onProblem: (problem: string) => void;
}): JSX.Element {
  const [idType, setIdType] = useState<AmbassadorIdType>(application.idType ?? 'passport');
  const [addressType, setAddressType] = useState<AmbassadorAddressType>('utility_bill');
  const [shareCode, setShareCode] = useState('');
  const [sending, setSending] = useState(false);
  const months = storeConfig.ambassador.addressWithinMonths;

  async function send(input: Parameters<typeof sendAmbassadorDocument>[1], name: string) {
    setSending(true);
    try {
      const result = await sendAmbassadorDocument(as, input);
      onSent(`${name}: ${result.message}`, result.application);
    } catch (failure) {
      onProblem(
        failure instanceof Error ? failure.message : 'That did not send. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  async function onFile(kind: AmbassadorDocumentKind, name: string, file: File): Promise<void> {
    let ready;
    try {
      ready =
        kind !== 'face_photo' && isPdf(file) ? await preparePdf(file) : await preparePhoto(file);
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : 'That file could not be read.');
      return;
    }
    await send(
      {
        kind,
        image: ready.base64,
        contentType: ready.contentType,
        ...(kind === 'photo_id_front' ? { idType } : {}),
        ...(kind === 'proof_of_address' ? { addressType } : {}),
      },
      name,
    );
  }

  const needs = (kind: AmbassadorDocumentKind): boolean =>
    application.stillNeeded.some((row) => row.kind === kind);
  const howFor: Record<string, string> = {
    photo_id_front:
      'The page with your photo, or the front of the card, flat, in good light, with all four corners showing.',
    photo_id_back: 'The back of the card, flat, with all four corners showing.',
    proof_of_address: `A letter with your name and home address, dated within the last ${months} months. A photo, or the PDF it came as.`,
    face_photo:
      'Look straight at the camera, in good light, with nothing covering your face. We compare it with your photo ID.',
  };

  return (
    <section aria-labelledby="step-2" className="space-y-6">
      <h2 id="step-2" className="text-lead font-bold m-0">
        Step 2: send your documents
      </h2>
      {application.stillNeeded.length === 0 ? (
        <p className="m-0 font-bold">You have sent everything we need. Thank you.</p>
      ) : (
        <p className="m-0">
          Still needed: {application.stillNeeded.map((row) => row.name).join(', ')}.
        </p>
      )}

      {needs('photo_id_front') && (
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="font-bold text-lead">Which photo ID will you send?</legend>
          {(Object.keys(ID_WORDS) as AmbassadorIdType[]).map((option) => (
            <div key={option} className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                id={`id-type-${option}`}
                name="id-type"
                checked={idType === option}
                onChange={() => setIdType(option)}
                className="h-6 w-6"
              />
              <label htmlFor={`id-type-${option}`} className="m-0">
                {ID_WORDS[option]}
              </label>
            </div>
          ))}
        </fieldset>
      )}
      {needs('proof_of_address') && (
        <fieldset className="space-y-2 border-0 p-0 m-0">
          <legend className="font-bold text-lead">What is your proof of address?</legend>
          {(Object.keys(ADDRESS_WORDS) as AmbassadorAddressType[]).map((option) => (
            <div key={option} className="flex items-center gap-3 min-h-control">
              <input
                type="radio"
                id={`address-type-${option}`}
                name="address-type"
                checked={addressType === option}
                onChange={() => setAddressType(option)}
                className="h-6 w-6"
              />
              <label htmlFor={`address-type-${option}`} className="m-0">
                {ADDRESS_WORDS[option]}
              </label>
            </div>
          ))}
        </fieldset>
      )}

      <ul className="list-none m-0 p-0 space-y-6">
        {application.stillNeeded.map((row) => (
          <li key={row.kind}>
            <DocumentRow
              name={row.name}
              how={howFor[row.kind] ?? ''}
              face={row.kind === 'face_photo'}
              sending={sending}
              onFile={(file) => void onFile(row.kind, row.name, file)}
            />
          </li>
        ))}
      </ul>

      <form
        aria-labelledby="share-code-heading"
        className="space-y-2 border-2 border-paper/40 rounded-2xl p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (shareCode.trim() === '') {
            onProblem('Please type the share code.');
            return;
          }
          void send({ kind: 'share_code', shareCode: shareCode.trim() }, 'Your share code');
        }}
      >
        <h3 id="share-code-heading" className="font-bold m-0">
          If you are not British: a Home Office share code (optional)
        </h3>
        <p id="share-code-how" className="m-0">
          You can get one from GOV.UK. It helps us check your right to be in the UK.
        </p>
        <label htmlFor="share-code" className="block font-bold">
          Your share code
        </label>
        <input
          id="share-code"
          value={shareCode}
          autoComplete="off"
          autoCapitalize="characters"
          aria-describedby="share-code-how"
          onChange={(event) => setShareCode(event.target.value)}
          className="w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3"
        />
        <button
          type="submit"
          disabled={sending}
          className="control border-paper bg-paper/10 text-paper"
        >
          Send the share code
        </button>
      </form>

      {application.documents.length > 0 && (
        <section aria-labelledby="sent-heading" className="space-y-2">
          <h3 id="sent-heading" className="font-bold m-0">
            What you have sent
          </h3>
          <ul className="m-0 ps-6 space-y-2">
            {application.documents.map((document) => (
              <li key={document.id}>
                {document.name}: {STATUS_WORDS[document.status]}.
                {document.status === 'rejected' && document.reviewNote
                  ? ` ${document.reviewNote}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function DocumentRow({
  name,
  how,
  face,
  sending,
  onFile,
}: {
  name: string;
  how: string;
  face: boolean;
  sending: boolean;
  onFile: (file: File) => void;
}): JSX.Element {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-name`}
      className="space-y-3 border-2 border-paper/40 rounded-2xl p-4"
    >
      <h3 id={`${id}-name`} className="font-bold m-0">
        {name}
      </h3>
      <p id={`${id}-how`} className="m-0">
        {how}
      </p>
      <PhotoChoice
        takeLabel={sending ? 'Sending…' : face ? 'Take a photo of my face' : 'Take a photo'}
        chooseLabel={face ? 'Choose a photo' : 'Choose a photo or PDF'}
        camera={face ? 'user' : 'environment'}
        accept={face ? 'image/*' : 'image/*,application/pdf'}
        disabled={sending}
        describedBy={`${id}-how`}
        onFile={onFile}
      />
    </section>
  );
}
