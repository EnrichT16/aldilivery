import { useId, useState, type FormEvent } from 'react';

import {
  openReferralVoucher,
  sendReferralVoucher,
  type StaffReferrerRow,
  type StaffVoucher,
} from '../lib/api';

/**
 * Sending a referral reward voucher, on the staff Referrals page (Anthony, 30 October 2026). For a
 * level reached with no voucher yet: paste the code, and a link if there is one, and press "Send
 * voucher"; it goes to the person's own inbox. For one sent: Sent, Opened or Used with the times,
 * who sent it, the code's last four only, and Ozi's reminder calls. "Show the code" opens the
 * record, which is written in the audit log, and shows the code in full.
 */

const FIELD = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

type Level = StaffReferrerRow['levels'][number];

function when(at: string): string {
  return new Date(at).toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS_WORDS: Record<StaffVoucher['status'], string> = {
  sent: 'Sent',
  opened: 'Opened',
  used: 'Used',
};

export function VoucherForLevel({
  staffKey,
  level,
  personName,
  by,
  onSent,
}: {
  staffKey: string;
  level: Level;
  personName: string;
  by: string;
  onSent: (message: string) => void;
}): JSX.Element {
  const id = useId();
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const voucher = level.voucher ?? null;

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (code.trim() === '') {
      setProblem('Please paste the voucher code.');
      return;
    }
    setBusy(true);
    setProblem('');
    sendReferralVoucher(staffKey, level.id, {
      code: code.trim(),
      ...(link.trim() !== '' ? { link: link.trim() } : {}),
      by,
    })
      .then((result) => {
        setCode('');
        setLink('');
        onSent(result.message);
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'The voucher did not send.'),
      )
      .finally(() => setBusy(false));
  };

  if (voucher) {
    return (
      <div className="space-y-1 border-2 border-paper/40 rounded-2xl p-3">
        <p className="m-0 font-bold">
          The {level.label}: {STATUS_WORDS[voucher.status]}
        </p>
        <ul className="m-0 ps-6 space-y-1">
          <li>
            Sent by {voucher.sentByName}, {when(voucher.sentAt)}.
          </li>
          {voucher.openedAt && <li>Opened {when(voucher.openedAt)}.</li>}
          {voucher.usedAt && (
            <li>
              Used {when(voucher.usedAt)}, by the person&rsquo;s own word: Amazon cannot tell us.
            </li>
          )}
          <li>
            {voucher.erased ? (
              'The code was removed with the account.'
            ) : (
              <>
                Code <span aria-hidden="true">{voucher.codeMasked}</span>
                <span className="visually-hidden">ending {voucher.codeLastFour}</span>.
              </>
            )}
          </li>
          {voucher.reminders.map((reminder) => (
            <li key={reminder.number}>
              Reminder {reminder.number}, {when(reminder.at)}: {reminder.words}.
            </li>
          ))}
          {voucher.nextReminderAt && <li>Next reminder {when(voucher.nextReminderAt)}.</li>}
        </ul>
        {!voucher.erased &&
          (full === null ? (
            <button
              type="button"
              onClick={() =>
                openReferralVoucher(staffKey, voucher.id)
                  .then((result) => setFull(result.voucher.code))
                  .catch((failure: unknown) =>
                    setProblem(failure instanceof Error ? failure.message : 'It did not open.'),
                  )
              }
              className="control border-paper bg-paper/10 text-paper"
            >
              Show the code<span className="visually-hidden"> for {personName}</span>
            </button>
          ) : (
            <p className="m-0">
              The code: <code className="font-bold break-all">{full}</code>
            </p>
          ))}
        {problem !== '' && (
          <p role="alert" className="m-0">
            {problem}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={send} className="space-y-2" aria-labelledby={`${id}-heading`}>
      <p id={`${id}-heading`} className="m-0 font-bold">
        Send the {level.label} to {personName}
      </p>
      <label htmlFor={`${id}-code`} className="block">
        Voucher code
      </label>
      <input
        id={`${id}-code`}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className={FIELD}
      />
      <label htmlFor={`${id}-link`} className="block">
        Link to the voucher, if you have one
      </label>
      <input
        id={`${id}-link`}
        type="url"
        value={link}
        onChange={(event) => setLink(event.target.value)}
        autoComplete="off"
        className={FIELD}
      />
      {problem !== '' && (
        <p role="alert" className="m-0">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="control bg-highlight text-on-accent disabled:opacity-70"
      >
        {busy ? 'One moment…' : 'Send voucher'}
        <span className="visually-hidden">
          : the {level.label} for {personName}
        </span>
      </button>
    </form>
  );
}
