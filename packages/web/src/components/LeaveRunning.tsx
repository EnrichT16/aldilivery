import { useState } from 'react';

import { leaveRunning } from '../lib/runner-api';

/**
 * Stopping being a Runner (the Runner agreement, "Stopping, and changes"). Asked twice. Anything
 * still owed for jobs is paid as normal, and the cool bag deposit held is paid back straight
 * away unless money is owed after a decision, when a person writes to them within 14 days.
 */
export function LeaveRunning({ onNews }: { onNews: (news: string) => void }): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  return (
    <section aria-labelledby="leave-heading" className="space-y-3">
      <h2 id="leave-heading" className="text-lead font-bold">
        Stop being a Runner
      </h2>
      <p className="m-0 extra">
        You can stop at any time. We pay what is owed for your jobs, and pay back any cool bag
        deposit we hold.
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {asking ? (
        <div role="alert" className="space-y-3 border-2 border-paper rounded-xl p-4">
          <p className="m-0">Close your Runner account? You will not be offered any more jobs.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem('');
              leaveRunning()
                .then((result) => {
                  setAsking(false);
                  onNews(result.message);
                })
                .catch((failure: unknown) =>
                  setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
                )
                .finally(() => setBusy(false));
            }}
            className="control w-full bg-paper text-ink disabled:opacity-70"
          >
            Yes, close my Runner account
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="control bg-paper/10 text-paper underline"
          >
            No, keep it
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="control bg-paper/10 text-paper underline"
        >
          Close my Runner account
        </button>
      )}
    </section>
  );
}
