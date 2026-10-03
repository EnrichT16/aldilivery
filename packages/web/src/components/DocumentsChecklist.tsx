import { useCallback, useEffect, useId, useState } from 'react';

import {
  fetchRunnerDocuments,
  sendRunnerDocument,
  type RunnerDocumentKind,
  type RunnerDocuments,
} from '../lib/api';
import { preparePhoto } from '../lib/photo';

/**
 * A Runner's documents, sent from the phone (rulings of 2 October 2026). Nobody comes to an office.
 *
 * One row for each thing still needed. Each has a button that opens the camera — the front
 * camera for the face photo, the back one for documents — and, for the right to work and the
 * DBS check, a box for a share code instead. Insurance asks for the date it runs out. Below, what
 * has been sent and what a person decided, with the reason if one was turned down.
 */

const HOW: Record<RunnerDocumentKind, string> = {
  face_photo:
    'Look straight at the camera, in good light, with nothing covering your face. Shoppers see this photo so they know it is you at the door.',
  right_to_work:
    'Type your Home Office share code, which you get from GOV.UK. Or take a photo of the photo page of your British or Irish passport.',
  dbs: 'Take a photo of your basic DBS certificate, the whole page, flat and in good light. Or type its share code.',
  driving_licence_front:
    'The front of your photocard licence, flat, with all four corners showing.',
  driving_licence_back: 'The back of your licence, flat, with all four corners showing.',
  insurance:
    'Your motor insurance certificate. It must cover delivery work, sometimes called business use or hire and reward.',
};

const STATUS_WORDS = {
  submitted: 'sent, being checked',
  accepted: 'accepted',
  rejected: 'not accepted',
} as const;

export function DocumentsChecklist({ onNews }: { onNews?: (news: string) => void }): JSX.Element {
  const [state, setState] = useState<RunnerDocuments | null>(null);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await fetchRunnerDocuments());
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'We could not load your documents.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 max-w-xl">
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {state === null ? (
        problem === '' && <p className="m-0">Finding your documents.</p>
      ) : state.stillNeeded.length === 0 ? (
        <p className="m-0 font-bold">
          You have sent everything we need. We will let you know when it has been checked.
        </p>
      ) : (
        <ul className="list-none m-0 p-0 space-y-6">
          {state.stillNeeded.map((item) => (
            <li key={item.kind}>
              <DocumentRow
                kind={item.kind}
                name={item.name}
                onSent={(message, next) => {
                  setState(next);
                  setProblem('');
                  onNews?.(message);
                }}
                onProblem={setProblem}
              />
            </li>
          ))}
        </ul>
      )}
      {state && state.documents.length > 0 && (
        <section aria-labelledby="sent-heading" className="space-y-2">
          <h3 id="sent-heading" className="font-bold m-0">
            What you have sent
          </h3>
          <ul className="m-0 ps-6 space-y-2">
            {state.documents.map((document) => (
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
    </div>
  );
}

function DocumentRow({
  kind,
  name,
  onSent,
  onProblem,
}: {
  kind: RunnerDocumentKind;
  name: string;
  onSent: (message: string, next: RunnerDocuments) => void;
  onProblem: (problem: string) => void;
}): JSX.Element {
  const id = useId();
  const [shareCode, setShareCode] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [sending, setSending] = useState(false);
  const allowsCode = kind === 'right_to_work' || kind === 'dbs';

  async function send(input: Parameters<typeof sendRunnerDocument>[0]): Promise<void> {
    setSending(true);
    try {
      const result = await sendRunnerDocument(input);
      onSent(`${name}: ${result.message}`, result);
    } catch (failure) {
      onProblem(
        failure instanceof Error ? failure.message : 'That did not send. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  async function onPhoto(file: File | undefined): Promise<void> {
    if (!file) return;
    if (kind === 'insurance' && expiresOn === '') {
      onProblem('Please give the date your insurance runs out first.');
      return;
    }
    const photo = await preparePhoto(file);
    await send({
      kind,
      image: photo.base64,
      contentType: photo.contentType,
      ...(kind === 'insurance' ? { expiresOn } : {}),
    });
  }

  return (
    <section
      aria-labelledby={`${id}-name`}
      className="space-y-3 border-2 border-paper/40 rounded-xl p-4"
    >
      <h3 id={`${id}-name`} className="font-bold text-lead m-0">
        {name}
      </h3>
      <p id={`${id}-how`} className="m-0">
        {HOW[kind]}
      </p>

      {kind === 'insurance' && (
        <div className="space-y-2">
          <label htmlFor={`${id}-expires`} className="block font-bold">
            The date it runs out
          </label>
          <input
            id={`${id}-expires`}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
        </div>
      )}

      {/* A real file input inside its label, styled as the big button, with the focus ring on the
          button when the input has focus. It opens the camera on a phone. */}
      <label
        className={`control bg-highlight text-ink cursor-pointer focus-within:outline focus-within:outline-4 focus-within:outline-offset-2 ${sending ? 'opacity-70' : ''}`}
      >
        {sending ? 'Sending…' : kind === 'face_photo' ? 'Take a photo of my face' : 'Take a photo'}
        <input
          type="file"
          accept="image/*"
          capture={kind === 'face_photo' ? 'user' : 'environment'}
          aria-describedby={`${id}-how`}
          disabled={sending}
          onChange={(event) => {
            void onPhoto(event.target.files?.[0]);
            event.target.value = '';
          }}
          className="visually-hidden"
        />
      </label>

      {allowsCode && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (shareCode.trim() === '') {
              onProblem('Please type the share code.');
              return;
            }
            void send({ kind, shareCode: shareCode.trim() });
          }}
        >
          <label htmlFor={`${id}-code`} className="block font-bold">
            Or type the share code
          </label>
          <input
            id={`${id}-code`}
            value={shareCode}
            autoComplete="off"
            autoCapitalize="characters"
            onChange={(event) => setShareCode(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          <button type="submit" disabled={sending} className="control bg-paper text-ink">
            Send the share code
          </button>
        </form>
      )}
    </section>
  );
}
