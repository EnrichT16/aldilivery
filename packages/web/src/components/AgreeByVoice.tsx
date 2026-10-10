import { useEffect, useRef, useState } from 'react';

import { storeConfig } from '../config';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { yesOrNo } from '../state/voice-sign-up';

/**
 * Agreeing to the Runner agreement by talking to Ozi (ruling 55), for a Runner who would rather
 * listen than read. Ozi says what matters most in it, in plain words, then asks for a yes or a
 * no, and asks again if it did not hear either. Only a clear yes agrees, and it is kept as a
 * spoken yes (channel "voice") with the date and the version, exactly as the tick is.
 *
 * The whole agreement is still one tap away, and "stop" stops at any point.
 */

const STOP = /\b(stop|cancel|never mind|not now)\b/i;

/** What Ozi says before asking. Everything in it comes from configuration. */
export function agreementSummary(): string {
  const { runnerPaymentPence, coolBag } = storeConfig.fees;
  const { recoveryPercentOfPay } = storeConfig.problems;
  return [
    `Here is the Runner agreement in short.`,
    `You are paid ${money(runnerPaymentPence)} for every delivery, whatever the basket, and ${money(storeConfig.fees.largeOrderRunnerPaymentPence)} for an order of ${money(storeConfig.fees.largeOrderFromPence)} or more delivered whole.`,
    `You pay at the till with your own card, and we pay you back the till total straight away.`,
    `We hold back a little of your first payments, up to ${money(coolBag.depositPence)}, as a cool bag deposit, and pay it all back after your ${coolBag.releaseAfterCompletedDeliveries}th delivery, or when you stop.`,
    `Nothing is ever taken from your pay automatically. Only if a person decides you were responsible for a refund, ${recoveryPercentOfPay}% of later jobs' pay goes towards it.`,
    `You decline any job you like, and you can stop at any time.`,
    `The whole agreement is on the screen if you want to hear it read.`,
  ].join(' ');
}

const QUESTION = 'Do you agree to the Runner agreement? Please say yes or no.';

export function AgreeByVoice({
  busy,
  onAgree,
}: {
  busy: boolean;
  onAgree: () => void;
}): JSX.Element {
  const ozi = useOzi();
  const [asking, setAsking] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const live = useRef({ ozi, onAgree });
  live.current = { ozi, onAgree };

  // Leaving the page stops the question, so nothing said later is taken as an answer.
  useEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );

  function ask(prompt: string): void {
    cancel.current = live.current.ozi.listenFor(prompt, (text) => {
      if (STOP.test(text)) {
        setAsking(false);
        void live.current.ozi.say(
          'All right. Nothing has been agreed. You can agree whenever you are ready.',
        );
        return;
      }
      const answer = yesOrNo(text);
      if (answer === 'yes') {
        setAsking(false);
        live.current.onAgree();
        return;
      }
      if (answer === 'no') {
        setAsking(false);
        void live.current.ozi.say(
          'All right. Nothing has been agreed, and no job will be offered until you do. You can ask us anything about it.',
        );
        return;
      }
      ask(`Sorry, I need a yes or a no. ${QUESTION}`);
    });
  }

  return (
    <button
      type="button"
      disabled={busy || asking}
      onClick={() => {
        setAsking(true);
        ask(`${agreementSummary()} ${QUESTION}`);
      }}
      className="control w-full bg-paper text-ink disabled:opacity-70"
    >
      {asking ? 'Ozi is asking…' : 'Agree by talking to Ozi'}
    </button>
  );
}
