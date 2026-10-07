import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { moneyIn, moneyOut } from '../lib/alert';

import { PriceConfirm } from '../components/PriceConfirm';
import { storeConfig } from '../config';
import { buyGiftCard, fetchGiftCards, redeemGiftCard, type GiftCardBought } from '../lib/api';
import { money } from '../lib/money';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';

/** "ABCD-EFGH-JKMN" read a letter at a time, in its three groups. */
function codeAloud(code: string): string {
  return code
    .split('-')
    .map((group) => group.split('').join(' '))
    .join(', ');
}

/**
 * Gift cards (7 October 2026): bought for an agreed amount, given as a code, and used as money
 * off the next order. The card still pays as usual, and the gift card money goes straight back
 * to it once the order is paid.
 */
export function GiftCards(): JSX.Element {
  const { shopper, replaceShopper } = useSession();
  // Loaded once per person: changing their details here must not reload over the answer.
  const shopperId = shopper?.id;
  const ozi = useOzi();
  const amounts = storeConfig.extras.giftCardPence;
  const [amount, setAmount] = useState<number>(amounts[1] ?? amounts[0] ?? 1000);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [bought, setBought] = useState<GiftCardBought[]>([]);
  const [credit, setCredit] = useState(0);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shopperId) return;
    fetchGiftCards()
      .then((result) => {
        setBought(result.bought);
        setCredit(result.creditPence);
      })
      .catch(() => undefined);
  }, [shopperId]);

  async function run<T extends { message: string }>(
    action: () => Promise<T>,
    after: (result: T) => void,
    spoken: (result: T) => string = (result) => result.message,
  ): Promise<void> {
    setBusy(true);
    setProblem('');
    try {
      const result = await action();
      after(result);
      setNews(result.message);
      if (/was taken from your card/.test(result.message)) moneyOut();
      else if (/has been added/.test(result.message)) moneyIn();
      void ozi.say(spoken(result));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setProblem(message);
      void ozi.say(message);
    } finally {
      setBusy(false);
    }
  }

  function redeem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('gift-code') ?? '');
    void run(
      () => redeemGiftCard(code),
      (result) => {
        setCredit(result.creditPence);
        if (shopper) replaceShopper({ ...shopper, creditPence: result.creditPence });
      },
    );
  }

  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">Gift cards</h1>
      <p className="m-0">
        Give someone their shopping, brought to their door. They type the code into{' '}
        {storeConfig.productName}, and it comes off their next order.
      </p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {!shopper ? (
        <Link to="/sign-up" className="control bg-highlight text-ink">
          Set up an account first
        </Link>
      ) : (
        <>
          {credit > 0 && (
            <p className="m-0 text-lead font-bold">
              You have {money(credit)} of gift card money. It comes off your next order.
            </p>
          )}
          <form onSubmit={redeem} className="space-y-3" aria-labelledby="use-heading">
            <h2 id="use-heading" className="text-lead font-bold m-0">
              Use a gift card
            </h2>
            <label htmlFor="gift-code" className="block font-bold">
              The gift card code
            </label>
            <input
              id="gift-code"
              name="gift-code"
              autoComplete="off"
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 uppercase"
            />
            <button type="submit" disabled={busy} className="control bg-paper text-ink">
              Use this gift card
            </button>
          </form>

          <section aria-labelledby="buy-heading" className="space-y-4">
            <h2 id="buy-heading" className="text-lead font-bold m-0">
              Buy a gift card
            </h2>
            <fieldset className="space-y-2 border-0 p-0 m-0">
              <legend className="font-bold">How much?</legend>
              {amounts.map((value) => (
                <label key={value} className="flex items-center gap-3 min-h-control">
                  <input
                    type="radio"
                    name="gift-amount"
                    checked={amount === value}
                    onChange={() => setAmount(value)}
                    className="w-6 h-6"
                  />
                  {money(value)}
                </label>
              ))}
            </fieldset>
            <label htmlFor="gift-for" className="block font-bold">
              Who is it for? (optional)
            </label>
            <input
              id="gift-for"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <label htmlFor="gift-message" className="block font-bold">
              A message (optional)
            </label>
            <textarea
              id="gift-message"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
            />
            <PriceConfirm
              key={bought.length}
              start={`Buy a ${money(amount)} gift card`}
              question={`${money(amount)} will be taken from your saved card now, for a gift card. Is that all right?`}
              yes={`Yes, buy it for ${money(amount)}`}
              busy={busy}
              onAsk={(question) => void ozi.say(question)}
              onYes={() =>
                void run(
                  () =>
                    buyGiftCard({ amountPence: amount, recipientName: recipient, message: note }),
                  (result) => setBought((before) => [result.giftCard, ...before]),
                  (result) =>
                    `${result.message.replace(result.giftCard.code, codeAloud(result.giftCard.code))} I'll say the code once more: ${codeAloud(result.giftCard.code)}.`,
                )
              }
            />
          </section>

          {bought.length > 0 && (
            <section aria-labelledby="bought-heading" className="space-y-3">
              <h2 id="bought-heading" className="text-lead font-bold m-0">
                Gift cards you bought
              </h2>
              <ul className="list-none m-0 p-0 space-y-3">
                {bought.map((card) => (
                  <li key={card.code} className="border-2 border-paper/40 rounded-xl p-4 space-y-1">
                    <p className="m-0 font-bold">
                      {money(card.amountPence)}
                      {card.recipientName ? ` for ${card.recipientName}` : ''}
                      {card.used ? ', used' : ', not used yet'}
                    </p>
                    <p className="m-0">
                      Code: <span aria-label={codeAloud(card.code)}>{card.code}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
