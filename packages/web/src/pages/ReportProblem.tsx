import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { storeConfig } from '../config';
import { addProblemEvidence, fetchProblems, reportProblem, type ProblemReport } from '../lib/api';
import { money } from '../lib/money';
import { preparePhoto } from '../lib/photo';

/**
 * Report a problem with a job, from the Runner's own account (rulings of 2 October 2026).
 *
 * Say what went wrong, then add to it: voice notes, recorded right here; photos, from the camera;
 * and written notes. A person decides within two working days and writes the decision down; it
 * appears here, and the Runner can answer it by adding more. Nothing is ever taken from a Runner's
 * pay without that written decision.
 */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('That recording could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function when(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

const KIND_WORDS = { voice_note: 'Voice note', photo: 'Photo', note: 'Note' } as const;

export function ReportProblem({ as = 'runner' }: { as?: 'runner' | 'shopper' }): JSX.Element {
  const other = as === 'runner' ? 'the Shopper' : 'your Runner';
  const [refund, setRefund] = useState('');
  const { orderId = '' } = useParams();
  const [reports, setReports] = useState<ProblemReport[] | null>(null);
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const canRecord =
    typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const load = useCallback(async () => {
    try {
      setReports((await fetchProblems(orderId, as)).reports);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'We could not load this order.');
    }
  }, [orderId, as]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = reports?.[0];

  async function run(action: () => Promise<{ message: string }>): Promise<void> {
    setSending(true);
    setProblem('');
    try {
      const result = await action();
      setNews(result.message);
      await load();
    } catch (failure) {
      setProblem(
        failure instanceof Error ? failure.message : 'That did not send. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  async function startRecording(): Promise<void> {
    setProblem('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];
      media.ondataavailable = (event) => chunks.current.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' });
        if (!current) return;
        void run(async () =>
          addProblemEvidence(
            current.id,
            { kind: 'voice_note', data: await blobToBase64(blob), contentType: blob.type },
            as,
          ),
        );
      };
      recorder.current = media;
      media.start();
      setRecording(true);
      setNews('Recording. Press Stop and send when you have finished.');
    } catch {
      setProblem(
        'The microphone could not be used. Please allow it in your settings, or write a note instead.',
      );
    }
  }

  function stopRecording(): void {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Report a problem</h1>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p
          role="alert"
          className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0 max-w-xl"
        >
          {problem}
        </p>
      )}

      {reports === null ? (
        problem === '' && <p className="m-0">One moment.</p>
      ) : !current || current.status === 'decided' ? (
        <form
          className="space-y-3 max-w-xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (summary.trim() === '') {
              setProblem('Please say what went wrong.');
              return;
            }
            const pounds = refund.replace(/[£,\s]/g, '');
            if (pounds !== '' && !/^\d+(\.\d{1,2})?$/.test(pounds)) {
              setProblem('Please write the amount in pounds and pence, like 2.50.');
              return;
            }
            void run(async () => {
              const result = await reportProblem(
                orderId,
                {
                  summary: summary.trim(),
                  ...(pounds !== ''
                    ? { refundRequestedPence: Math.round(Number(pounds) * 100) }
                    : {}),
                },
                as,
              );
              setSummary('');
              setRefund('');
              return result;
            });
          }}
        >
          <label htmlFor="summary" className="block text-lead font-bold">
            What went wrong?
          </label>
          <p id="summary-hint" className="m-0 text-paper/90">
            Say it plainly, in your own words. After you send it, you can add voice notes and
            photos. A person at {storeConfig.productName} will look at it.
          </p>
          <textarea
            id="summary"
            rows={4}
            value={summary}
            aria-describedby="summary-hint"
            onChange={(event) => setSummary(event.target.value)}
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
          />
          {as === 'shopper' && (
            <>
              <label htmlFor="refund" className="block font-bold">
                How much would you like back? (you can leave this empty)
              </label>
              <p id="refund-hint" className="m-0 text-paper/90">
                In pounds and pence, like 2.50. {money(storeConfig.problems.instantRefundUpToPence)}{' '}
                or less is refunded straight away.
              </p>
              <input
                id="refund"
                inputMode="decimal"
                value={refund}
                aria-describedby="refund-hint"
                onChange={(event) => setRefund(event.target.value)}
                className="w-40 min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
              />
            </>
          )}
          <button type="submit" disabled={sending} className="control bg-highlight text-ink">
            {sending ? 'Sending…' : 'Send the report'}
          </button>
        </form>
      ) : (
        <section aria-labelledby="add-heading" className="space-y-4 max-w-xl">
          <h2 id="add-heading" className="text-lead font-bold">
            Add to your report
          </h2>
          <p className="m-0">A person will decide by {when(current.decideBy)}.</p>

          {canRecord ? (
            recording ? (
              <button
                type="button"
                onClick={stopRecording}
                className="control bg-highlight text-ink"
              >
                Stop and send the voice note
              </button>
            ) : (
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  void startRecording();
                }}
                className="control bg-highlight text-ink"
              >
                Record a voice note
              </button>
            )
          ) : (
            <p className="m-0">
              This phone cannot record a voice note here. You can write a note instead.
            </p>
          )}

          <label className="control bg-paper text-ink cursor-pointer focus-within:outline focus-within:outline-4 focus-within:outline-offset-2">
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={sending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void run(async () => {
                  const photo = await preparePhoto(file);
                  return addProblemEvidence(
                    current.id,
                    { kind: 'photo', data: photo.base64, contentType: photo.contentType },
                    as,
                  );
                });
              }}
              className="visually-hidden"
            />
          </label>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim() === '') {
                setProblem('Please write the note.');
                return;
              }
              void run(async () => {
                const result = await addProblemEvidence(
                  current.id,
                  { kind: 'note', text: note.trim() },
                  as,
                );
                setNote('');
                return result;
              });
            }}
          >
            <label htmlFor="note" className="block font-bold">
              Write a note
            </label>
            <textarea
              id="note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <button type="submit" disabled={sending} className="control bg-paper text-ink">
              Send the note
            </button>
          </form>
        </section>
      )}

      {reports && reports.length > 0 && (
        <section aria-labelledby="reports-heading" className="space-y-4 max-w-xl">
          <h2 id="reports-heading" className="text-lead font-bold">
            Reports about this job
          </h2>
          <ul className="list-none m-0 p-0 space-y-4">
            {reports.map((report) => (
              <li key={report.id} className="border-2 border-paper/40 rounded-xl p-4 space-y-2">
                <p className="m-0 font-bold">
                  {report.reportedBy === as
                    ? 'You reported'
                    : `${other[0]!.toUpperCase()}${other.slice(1)} reported`}
                  : {report.summary}
                </p>
                {report.status === 'decided' ? (
                  <p className="m-0">
                    Decided: {report.decisionWords} {report.decisionNote}
                    {report.refundPence > 0
                      ? ` ${as === 'shopper' ? 'You were' : 'The Shopper was'} refunded ${money(report.refundPence)}.`
                      : ''}
                  </p>
                ) : (
                  <p className="m-0">Waiting for a decision, due by {when(report.decideBy)}.</p>
                )}
                {report.evidence.length > 0 && (
                  <ul className="m-0 ps-6">
                    {report.evidence.map((item) => (
                      <li key={item.id}>
                        {KIND_WORDS[item.kind]} from {item.addedBy === as ? 'you' : other}
                        {item.text ? `: ${item.text}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {current?.status === 'decided' && (
            <p className="m-0">
              If you disagree with a decision, send a new report saying why. A person will look at
              it again.
            </p>
          )}
        </section>
      )}

      <Link
        to={as === 'runner' ? '/runner/home' : '/orders'}
        className="control bg-paper/10 text-paper underline"
      >
        {as === 'runner' ? 'Back to your Runner page' : 'Back to your orders'}
      </Link>
    </div>
  );
}
