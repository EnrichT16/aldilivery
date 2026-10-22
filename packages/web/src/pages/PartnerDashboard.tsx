import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { ProductScanner } from '../components/ProductScanner';
import { ShowWordsSwitch } from '../components/ShowWordsSwitch';
import { storeConfig } from '../config';
import {
  addPartnerProduct,
  answerPartnerEnquiry,
  confirmPartnerCheckout,
  downloadBusinessStatement,
  fetchPartnerDashboard,
  PARTNER_RECEIPT_KEY,
  rememberBusinessToken,
  removePartnerProduct,
  setPartnerPrice,
  startPartnerCheckout,
  type PartnerDashboard as Dashboard,
  type PartnerProductRow,
} from '../lib/api';
import { click } from '../lib/alert';
import { money } from '../lib/money';
import { preparePhoto } from '../lib/photo';
import { useOzi } from '../state/ozi';
import { partnerHelp, understandPartner } from '../voice/business-voice';
import { everydayOr } from '../voice/phrases';
import { listWords, spokenMoney } from '../voice/staff-voice';
import { spokenDate } from '../components/StaffVoice';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';
const YES = /\b(yes|yeah|yep|correct|that'?s right|go ahead|confirm|do it|ok|okay)\b/i;
const STATUS_WORDS: Record<PartnerProductRow['status'], string> = {
  pending: 'waiting to be checked',
  approved: 'live',
  rejected: 'not accepted',
  removed: 'taken off',
};

function longDate(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** The receipt for a Checkout page, kept until Stripe sends the shop back (ruling 65). */
const RECEIPT = PARTNER_RECEIPT_KEY;

/**
 * A Shop Partner's own area (7 October 2026; ruling 65): what they pay and paying it here, their
 * products or services and prices, adding one with a photo (checked by us before Shoppers see it),
 * a café's commission, a service's enquiries, and a link to share. Ozi helps here too, with this
 * dashboard's own commands only.
 */
export function PartnerDashboard(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const ozi = useOzi();
  const [data, setData] = useState<Dashboard | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState((location.state as { welcome?: string } | null)?.welcome ?? '');
  const [busy, setBusy] = useState(false);
  const latest = useRef({ ozi, data, navigate });
  const phraseTurn = useRef(0);
  latest.current = { ozi, data, navigate };
  // While products are being scanned, what Ozi hears about the list is handled there first.
  const scanVoice = useRef<((text: string) => boolean) | null>(null);
  const registerScanVoice = useCallback((handler: ((text: string) => boolean) | null) => {
    scanVoice.current = handler;
  }, []);
  const sayIt = useCallback((words: string) => void latest.current.ozi.say(words), []);
  const confirmIt = useCallback((question: string, then: (yes: boolean) => void) => {
    latest.current.ozi.listenFor(question, (answer) => then(YES.test(answer)));
  }, []);

  const load = useCallback(
    () =>
      fetchPartnerDashboard()
        .then((result) => {
          setData(result);
          return result;
        })
        .catch(() => {
          navigate('/business');
          return null;
        }),
    [navigate],
  );

  const shareUrl = data ? `${window.location.origin}${data.sharePath}` : '';

  /** Paying for Partner Plus or Spotlight: the free first month at once, or off to Stripe's page. */
  const pay = useCallback(
    async (kind: 'plan' | 'spotlight' | 'plus'): Promise<void> => {
      setBusy(true);
      setProblem('');
      try {
        const result = await startPartnerCheckout({ kind, months: 1, returnTo: '/partner' });
        if (result.url && result.receipt) {
          try {
            window.sessionStorage.setItem(RECEIPT, result.receipt);
          } catch {
            // Private browsing: the payment is still recorded by hand if the receipt is lost.
          }
          setNews(result.message);
          window.location.assign(result.url);
          return;
        }
        setNews(result.message);
        void latest.current.ozi.say(result.message);
        await load();
      } catch (failure) {
        setProblem(failure instanceof Error ? failure.message : 'That did not work.');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Back from Stripe with ?paid=<session>: record it, once, with the receipt kept before leaving.
  useEffect(() => {
    const sessionId = params.get('paid');
    if (!sessionId) return;
    let receipt = '';
    try {
      receipt = window.sessionStorage.getItem(RECEIPT) ?? '';
      window.sessionStorage.removeItem(RECEIPT);
    } catch {
      receipt = '';
    }
    setParams({}, { replace: true });
    if (!receipt) {
      setProblem('Thank you for paying. If your plan does not show as paid shortly, ring us.');
      return;
    }
    confirmPartnerCheckout(receipt, sessionId)
      .then((result) => {
        setNews(result.message);
        void latest.current.ozi.say(result.message);
        void load();
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  }, [params, setParams, load]);

  const share = useCallback(async (): Promise<string> => {
    const current = latest.current.data;
    if (!current) return '';
    const url = `${window.location.origin}${current.sharePath}`;
    const text = `${current.shop.name} on ${storeConfig.productName}: order from us and have it brought to your door.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.shop.name, text, url });
        return 'Shared.';
      }
      await navigator.clipboard?.writeText(url);
      return 'Your link is copied. Paste it into a message, WhatsApp or an email.';
    } catch {
      return `Your link is ${url}`;
    }
  }, []);

  useEffect(() => {
    const say = (words: string): void => void latest.current.ozi.say(words);
    const ask = (question: string, then: (answer: string) => void): void => {
      latest.current.ozi.listenFor(question, then);
    };
    const find = (name: string): PartnerProductRow | undefined =>
      latest.current.data?.products.find((product) =>
        product.name.toLowerCase().includes(name.toLowerCase().replace(/^the /, '')),
      );

    const handle = (text: string): boolean => {
      if (scanVoice.current?.(text)) return true;
      const command = understandPartner(text);
      const current = latest.current.data;
      if (!command) {
        everydayOr(
          text,
          phraseTurn,
          { kind: 'business' },
          say,
          `Sorry, I didn't catch that. ${partnerHelp()}`,
        );
        return true;
      }
      switch (command.kind) {
        case 'help':
          say(partnerHelp());
          return true;
        case 'sign-out':
          rememberBusinessToken(null);
          say('Signed out. Goodbye.');
          latest.current.navigate('/business');
          return true;
        case 'plan':
          if (current) {
            say(
              `${current.plan.words}${current.shop.kind === 'shop' ? ' To pay or renew, use the button under Your plan on the screen, or ring us.' : ''}`,
            );
          }
          return true;
        case 'share':
          void share().then(say);
          return true;
        case 'payments':
          if (current) {
            say(
              current.payments.length === 0
                ? 'No payments are recorded yet.'
                : `${listWords(current.payments.slice(0, 5).map((row) => `${longDate(row.paidAt)}, ${row.what}, ${money(row.amountPence)}`))}. To download your statement, use the button on the screen.`,
            );
          }
          return true;
        case 'numbers':
          if (current) {
            say(
              `This week, ${current.numbers.purchasesThisWeek} purchase${current.numbers.purchasesThisWeek === 1 ? '' : 's'} from your shop. This month, ${current.numbers.purchasesThisMonth}, with ${current.numbers.itemsThisMonth} items. ${current.referrals} ${current.referrals === 1 ? 'person has' : 'people have'} joined through your link.`,
            );
          }
          return true;
        case 'spotlight':
          if (current) {
            const level = current.spotlight.level;
            say(
              level === 'none'
                ? `You are not on Spotlight. With Spotlight, at ${money(current.spotlight.prices.spotlightPence)} a month, I mention your shop to Shoppers looking for what you sell, up to once a week each; Spotlight Plus, at ${money(current.spotlight.prices.plusPence)}, up to ${current.spotlight.prices.plusPerWeek} times. ${current.shop.kind === 'shop' && current.plan.tier === 'plus' && current.plan.paid ? 'Use the buttons under Spotlight on the screen, or speak to us.' : 'Spotlight is for shops on paid Partner Plus.'}`
                : `You are on ${level === 'plus' ? 'Spotlight Plus' : 'Spotlight'}${current.spotlight.until ? ` until ${longDate(current.spotlight.until)}` : ''}. I have mentioned your shop ${current.spotlight.mentionsThisMonth} time${current.spotlight.mentionsThisMonth === 1 ? '' : 's'} this month.`,
            );
          }
          return true;
        case 'products': {
          if (!current) return true;
          const { live, waiting, notAccepted } = current.counts;
          const names = current.products.map(
            (product) =>
              `${product.name}, ${money(product.pricePence)}, ${STATUS_WORDS[product.status]}`,
          );
          say(
            `You have ${live} live, ${waiting} waiting to be checked${notAccepted ? ` and ${notAccepted} not accepted` : ''}. ` +
              (names.length ? `${listWords(names)}.` : 'Say "add a product" to add your first.'),
          );
          return true;
        }
        case 'remove': {
          const product = find(command.name);
          if (!product) {
            say(`I couldn't find ${command.name} in your products.`);
            return true;
          }
          ask(
            `Take ${product.name} off, so Shoppers no longer see it? Say yes to confirm.`,
            (answer) => {
              if (!YES.test(answer)) return say('All right, it stays.');
              void removePartnerProduct(product.id).then((result) => {
                say(result.message);
                void load();
              });
            },
          );
          return true;
        }
        case 'price': {
          const product = find(command.name);
          if (!product || command.pricePence === null) {
            say(
              product
                ? "I didn't catch the price."
                : `I couldn't find ${command.name} in your products.`,
            );
            return true;
          }
          const pence = command.pricePence;
          ask(`Change ${product.name} to ${money(pence)}? Say yes to confirm.`, (answer) => {
            if (!YES.test(answer)) return say('All right, the price stays.');
            void setPartnerPrice(product.id, pence).then((result) => {
              say(result.message);
              void load();
            });
          });
          return true;
        }
        case 'add': {
          if (current?.shop.kind === 'service') {
            // A service: a name, a price from, and how long it takes (ruling 65).
            ask(
              'What is the service? Say its name as Shoppers should see it, such as haircut.',
              (name) => {
                ask(`And the price of ${name}, from?`, (priceWords) => {
                  const pence = spokenMoney(priceWords);
                  if (pence === null) return say("I didn't catch a price, so nothing was added.");
                  ask('How long does it take? Say the minutes, such as thirty.', (minutesWords) => {
                    const minutes = Number(
                      /\d+/.exec(minutesWords)?.[0] ?? (spokenMoney(minutesWords) ?? 0) / 100,
                    );
                    if (!Number.isFinite(minutes) || minutes < 5) {
                      return say("I didn't catch how long it takes, so nothing was added.");
                    }
                    ask(
                      `Send ${name}, from ${money(pence)}, about ${minutes} minutes, to be checked? Say yes to confirm.`,
                      (answer) => {
                        if (!YES.test(answer)) return say('All right, nothing was added.');
                        void addPartnerProduct({
                          name: name.trim(),
                          pricePence: pence,
                          tags: '',
                          durationMinutes: minutes,
                        })
                          .then((result) => {
                            click();
                            say(result.message);
                            void load();
                          })
                          .catch((failure: unknown) =>
                            say(failure instanceof Error ? failure.message : 'That did not work.'),
                          );
                      },
                    );
                  });
                });
              },
            );
            return true;
          }
          ask(
            'What is the product? Say its name as Shoppers should see it, such as sourdough loaf, 800 grams.',
            (name) => {
              ask(`And the price of ${name}?`, (priceWords) => {
                const pence = spokenMoney(priceWords);
                if (pence === null) return say("I didn't catch a price, so nothing was added.");
                ask(
                  'Does it have a best before or use by date? Say the date, or say no.',
                  (dateWords) => {
                    const expiresOn = /\b(no|none|nope)\b/i.test(dateWords)
                      ? undefined
                      : (spokenDate(dateWords) ?? undefined);
                    ask(
                      `Send ${name}, ${money(pence)}${expiresOn ? `, best before ${longDate(expiresOn)}` : ''}, to be checked? You can add a photo on the screen afterwards by adding it again with a photo. Say yes to confirm.`,
                      (answer) => {
                        if (!YES.test(answer)) return say('All right, nothing was added.');
                        void addPartnerProduct({
                          name: name.trim(),
                          pricePence: pence,
                          tags: '',
                          ...(expiresOn ? { expiresOn } : {}),
                        })
                          .then((result) => {
                            click();
                            say(result.message);
                            void load();
                          })
                          .catch((failure: unknown) =>
                            say(failure instanceof Error ? failure.message : 'That did not work.'),
                          );
                      },
                    );
                  },
                );
              });
            },
          );
          return true;
        }
      }
    };

    latest.current.ozi.setPageCommands(handle);
    void load().then((result) => {
      if (!result) return;
      const { live, waiting } = result.counts;
      const things = result.shop.kind === 'service' ? 'service' : 'product';
      say(
        `Welcome to your ${storeConfig.productName} Shop Partner area for ${result.shop.name}. ` +
          `You have ${live} ${things}${live === 1 ? '' : 's'} live and ${waiting} waiting to be checked. ` +
          (result.shop.status === 'pending'
            ? 'Your page goes public once we have checked your listing. '
            : '') +
          (result.shop.kind === 'shop' && result.plan.tier === 'plus' && !result.plan.paid
            ? 'Partner Plus is not paid at the moment. '
            : '') +
          `Say "add a ${things}", or "help".`,
      );
    });
    return () => latest.current.ozi.setPageCommands(null);
  }, [load, share]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const value = (name: string): string => String(values.get(name) ?? '').trim();
    const pounds = Number(value('product-price').replace(/[£\s]/g, ''));
    if (value('product-name') === '' || !Number.isFinite(pounds) || pounds <= 0) {
      setProblem('Please give the product’s name and its price in pounds, like 3.50.');
      return;
    }
    const minutes = Number(value('product-minutes'));
    if (data?.shop.kind === 'service' && (!Number.isFinite(minutes) || minutes < 5)) {
      setProblem('Please say how long the service takes, in minutes.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const file = values.get('product-photo');
      const photo = file instanceof File && file.size > 0 ? await preparePhoto(file) : null;
      const result = await addPartnerProduct({
        name: value('product-name'),
        pricePence: Math.round(pounds * 100),
        tags: value('product-tags'),
        ...(value('product-expires') ? { expiresOn: value('product-expires') } : {}),
        ...(photo ? { photo: photo.base64, photoType: photo.contentType } : {}),
        ...(data?.shop.kind === 'service' ? { durationMinutes: minutes } : {}),
      });
      click();
      setNews(result.message);
      void ozi.say(result.message);
      form.reset();
      void load();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That could not be added.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }

  const service = data.shop.kind === 'service';
  // Spotlight is bought here by a shop on paid Partner Plus, through the plan's own Checkout.
  const spotlightOpen = data.shop.kind === 'shop' && data.plan.tier === 'plus' && data.plan.paid;
  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">{data.shop.name}</h1>
      <details className="max-w-xl">
        <summary className="control px-0 text-paper underline">The screen</summary>
        <ShowWordsSwitch />
      </details>
      <p className="m-0">
        Your Shop Partner area. {data.shop.kindWords}
        {data.shop.postcode ? `, ${data.shop.postcode}` : ''}.
      </p>
      {data.shop.status === 'pending' && (
        <p role="status" className="m-0 border-2 border-paper rounded-2xl p-4">
          Your page is not public yet: we check every new listing, usually within one working day.
          You can add your {service ? 'services' : 'products'} now, and they go live with it.
        </p>
      )}
      {!data.shop.active && data.shop.status !== 'pending' && (
        <p role="status" className="m-0 border-2 border-paper rounded-2xl p-4">
          Your listing is paused. Please ring us.
        </p>
      )}
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}

      <section
        aria-labelledby="plan-heading"
        className="space-y-2 border-2 border-highlight rounded-2xl p-4"
      >
        <h2 id="plan-heading" className="text-lead font-bold m-0">
          Your plan
        </h2>
        <p className="m-0">{data.plan.words}</p>
        <p className="m-0">
          {data.counts.live} live, {data.counts.waiting} waiting to be checked
          {data.counts.notAccepted ? `, ${data.counts.notAccepted} not accepted` : ''}
          {data.plan.productLimit !== null
            ? `; ${data.plan.productsListed} of ${data.plan.productLimit} places used`
            : ''}
          .
        </p>
        {data.shop.kind === 'shop' && (
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pay('plan')}
              className="control bg-highlight text-on-accent disabled:opacity-70"
            >
              {data.plan.tier === 'plus' && data.plan.paid
                ? `Renew Partner Plus, ${money(data.plan.plusMonthlyPence)} for a month`
                : data.plan.firstMonthFree
                  ? 'Start Partner Plus, first month free'
                  : `Pay for Partner Plus, ${money(data.plan.plusMonthlyPence)} a month`}
            </button>
            <span>
              Or ring us on {storeConfig.contact.telephonePlaceholder} and a person will take it.
            </span>
          </div>
        )}
      </section>

      {data.commission && (
        <section
          aria-labelledby="commission-heading"
          className="space-y-2 border-2 border-paper rounded-2xl p-4"
        >
          <h2 id="commission-heading" className="text-lead font-bold m-0">
            Commission this month
          </h2>
          <p className="m-0">
            {data.commission.ordersThisMonth} order
            {data.commission.ordersThisMonth === 1 ? '' : 's'} through {storeConfig.productName},{' '}
            {money(data.commission.goodsThisMonthPence)} of food and drink. {data.commission.words}{' '}
            owed: <strong>{money(data.commission.owedThisMonthPence)}</strong>. It is on your
            statement too.
          </p>
        </section>
      )}

      {service && (
        <section aria-labelledby="enquiries-heading" className="space-y-3">
          <h2 id="enquiries-heading" className="text-lead font-bold m-0">
            Enquiries
          </h2>
          <p className="m-0">
            Shoppers asking you for a quote or a call back. Get back to them yourself; nothing is
            paid through {storeConfig.productName} for services yet.
          </p>
          {data.enquiries.length === 0 && <p className="m-0">None yet.</p>}
          <ul className="list-none m-0 p-0 space-y-3">
            {data.enquiries.map((row) => (
              <li key={row.id} className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
                <h3 className="m-0 font-bold">
                  {row.shopperName} asked for {row.what}
                </h3>
                <p className="m-0">
                  {longDate(row.createdAt)}. {row.message || 'No message.'} Reach them on:{' '}
                  {row.contact}.{row.status === 'answered' ? ' Answered.' : ''}
                </p>
                {row.status === 'open' && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const note = String(
                        new FormData(event.currentTarget).get('reply') ?? '',
                      ).trim();
                      void answerPartnerEnquiry(row.id, note).then((result) => {
                        setNews(result.message);
                        void load();
                      });
                    }}
                    className="flex flex-wrap gap-2 items-end"
                  >
                    <label className="block">
                      A note for them (optional)
                      <input name="reply" className={field} />
                    </label>
                    <button type="submit" className="control border-paper bg-paper/10 text-paper">
                      Mark as answered
                      <span className="visually-hidden"> for {row.shopperName}</span>
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="numbers-heading" className="space-y-2">
        <h2 id="numbers-heading" className="text-lead font-bold m-0">
          How your shop is doing
        </h2>
        <p className="m-0">
          This week, {data.numbers.purchasesThisWeek} purchase
          {data.numbers.purchasesThisWeek === 1 ? '' : 's'} from your shop. This month,{' '}
          {data.numbers.purchasesThisMonth}, with {data.numbers.itemsThisMonth} items.
        </p>
      </section>

      <section
        aria-labelledby="spotlight-heading"
        className="space-y-2 border-2 border-paper rounded-2xl p-4"
      >
        <h2 id="spotlight-heading" className="text-lead font-bold m-0">
          Spotlight: {storeConfig.assistantName} mentions your shop
        </h2>
        {data.spotlight.level === 'none' ? (
          <p className="m-0">
            Not on Spotlight. Spotlight, {money(data.spotlight.prices.spotlightPence)} a month:{' '}
            {storeConfig.assistantName} mentions your shop to Shoppers looking for what you sell, up
            to{' '}
            {data.spotlight.prices.spotlightPerWeek === 1
              ? 'once'
              : `${data.spotlight.prices.spotlightPerWeek} times`}{' '}
            a week each. Spotlight Plus, {money(data.spotlight.prices.plusPence)} a month: up to{' '}
            {data.spotlight.prices.plusPerWeek} times a week. On top of your plan
            {spotlightOpen
              ? '; pay for it here, or speak to us.'
              : ', for shops on paid Partner Plus.'}
          </p>
        ) : (
          <p className="m-0">
            On {data.spotlight.level === 'plus' ? 'Spotlight Plus' : 'Spotlight'}
            {data.spotlight.until ? ` until ${longDate(data.spotlight.until)}` : ''}. Mentioned{' '}
            {data.spotlight.mentionsThisMonth} time
            {data.spotlight.mentionsThisMonth === 1 ? '' : 's'} this month. Each mention is called
            an advert, after {storeConfig.assistantName}'s own answer.
          </p>
        )}
        {spotlightOpen && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void pay('spotlight')}
              className="control border-paper bg-paper/10 text-paper disabled:opacity-70"
            >
              {data.spotlight.level === 'spotlight' ? 'Renew Spotlight' : 'Buy Spotlight'},{' '}
              {money(data.spotlight.prices.spotlightPence)} for a month
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pay('plus')}
              className="control border-paper bg-paper/10 text-paper disabled:opacity-70"
            >
              {data.spotlight.level === 'plus' ? 'Renew Spotlight Plus' : 'Buy Spotlight Plus'},{' '}
              {money(data.spotlight.prices.plusPence)} for a month
            </button>
          </div>
        )}
      </section>

      <section aria-labelledby="payments-heading" className="space-y-2">
        <h2 id="payments-heading" className="text-lead font-bold m-0">
          What you have paid
        </h2>
        {data.payments.length === 0 ? (
          <p className="m-0">No payments recorded yet.</p>
        ) : (
          <ul className="m-0 ps-6 space-y-1">
            {data.payments.map((row) => (
              <li key={row.id}>
                {longDate(row.paidAt)}: {row.what}, {row.months} month{row.months === 1 ? '' : 's'},{' '}
                {money(row.amountPence)}. Covers until {longDate(row.coversUntil)}.
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() =>
            void downloadBusinessStatement('partner', data.shop.name)
              .then(() => setNews('Your statement is downloading, as a PDF.'))
              .catch((failure: unknown) =>
                setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
              )
          }
          className="control border-paper bg-paper/10 text-paper"
        >
          Download my statement (PDF)
        </button>
      </section>

      <section aria-labelledby="share-heading" className="space-y-2">
        <h2 id="share-heading" className="text-lead font-bold m-0">
          Share your shop
        </h2>
        <p className="m-0">
          Send your page to your customers, other shops and friends. They order from you, and a
          Runner brings it to their door.
        </p>
        <p className="m-0 break-all">{shareUrl}</p>
        <label htmlFor="referral-meter" className="block font-bold">
          {data.referrals} of 100 people have joined through your link
        </label>
        <meter
          id="referral-meter"
          min={0}
          max={100}
          value={Math.min(100, data.referrals)}
          className="w-full h-6"
        />
        <button
          type="button"
          onClick={() => void share().then((words) => setNews(words))}
          className="control bg-highlight text-on-accent"
        >
          Share my shop’s link
        </button>{' '}
        <Link to={data.sharePath} className="control bg-paper/10 text-paper underline">
          See my page as Shoppers do
        </Link>
      </section>

      {!service && (
        <ProductScanner
          plus={data.plan.productLimit === null}
          placesLeft={
            data.plan.productLimit === null
              ? null
              : Math.max(0, data.plan.productLimit - data.plan.productsListed)
          }
          products={data.products}
          say={sayIt}
          confirm={confirmIt}
          onAdded={() => void load()}
          registerVoice={registerScanVoice}
        />
      )}

      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-3"
        aria-labelledby="add-heading"
      >
        <h2 id="add-heading" className="text-lead font-bold m-0">
          {service ? 'Add a service' : 'Add a product'}
        </h2>
        <p className="m-0">
          We check each new {service ? 'service' : 'product'}, usually within one working day, then
          Shoppers see it.
        </p>
        <label htmlFor="product-name" className="block font-bold">
          What it is
        </label>
        <input id="product-name" name="product-name" className={field} />
        <label htmlFor="product-price" className="block font-bold">
          {service ? 'Price from, in pounds' : 'Price in pounds'}
        </label>
        <input id="product-price" name="product-price" inputMode="decimal" className={field} />
        {service && (
          <>
            <label htmlFor="product-minutes" className="block font-bold">
              How long it takes, in minutes
            </label>
            <input
              id="product-minutes"
              name="product-minutes"
              inputMode="numeric"
              className={field}
            />
          </>
        )}
        <label htmlFor="product-tags" className="block font-bold">
          Labels, to help people find it (optional)
        </label>
        <input id="product-tags" name="product-tags" className={field} />
        <label htmlFor="product-expires" className="block font-bold">
          Best before or use by (optional)
        </label>
        <input id="product-expires" name="product-expires" type="date" className={field} />
        {data.plan.productLimit === null ? (
          <>
            <label htmlFor="product-photo" className="block font-bold">
              A photo (optional)
            </label>
            <input
              id="product-photo"
              name="product-photo"
              type="file"
              accept="image/*"
              capture="environment"
              className={field}
            />
          </>
        ) : (
          <p className="m-0 text-paper/80">Photos come with Partner Plus.</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="control w-full bg-highlight text-on-accent disabled:opacity-70"
        >
          Send it to be checked
        </button>
      </form>

      <section aria-labelledby="products-heading" className="space-y-3">
        <h2 id="products-heading" className="text-lead font-bold m-0">
          Your products
        </h2>
        {data.products.length === 0 && <p className="m-0">None yet.</p>}
        <ul className="list-none m-0 p-0 space-y-3">
          {data.products.map((product) => (
            <li key={product.id} className="border-2 border-paper/40 rounded-2xl p-4 space-y-2">
              <h3 className="m-0 font-bold">
                {product.name}, {money(product.pricePence)}
              </h3>
              <p className="m-0">
                {STATUS_WORDS[product.status][0]?.toUpperCase()}
                {STATUS_WORDS[product.status].slice(1)}.
                {product.expiresOn ? ` Best before ${longDate(product.expiresOn)}.` : ''}
                {product.note ? ` ${product.note}` : ''}
              </p>
              {product.priceEstimated && (
                <p className="m-0 font-bold">
                  <span aria-hidden="true">⚠️</span> The price is an estimate: please check it, and
                  change it below if it is not right.
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const pounds = Number(
                    String(new FormData(event.currentTarget).get('price') ?? '').replace(
                      /[£\s]/g,
                      '',
                    ),
                  );
                  if (!Number.isFinite(pounds) || pounds <= 0) return;
                  void setPartnerPrice(product.id, Math.round(pounds * 100)).then((result) => {
                    setNews(result.message);
                    void load();
                  });
                }}
                className="flex flex-wrap gap-2 items-end"
              >
                <label className="block">
                  New price
                  <input name="price" inputMode="decimal" className={field} />
                </label>
                <button type="submit" className="control border-paper bg-paper/10 text-paper">
                  Change the price<span className="visually-hidden"> of {product.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void removePartnerProduct(product.id).then((result) => {
                      setNews(result.message);
                      void load();
                    })
                  }
                  className="control bg-paper/10 text-paper underline"
                >
                  Take it off<span className="visually-hidden">: {product.name}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        onClick={() => {
          rememberBusinessToken(null);
          navigate('/business');
        }}
        className="control bg-paper/10 text-paper underline"
      >
        Sign out
      </button>
    </div>
  );
}
