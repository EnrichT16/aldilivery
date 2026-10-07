import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  addPartnerProduct,
  fetchPartnerDashboard,
  rememberBusinessToken,
  removePartnerProduct,
  setPartnerPrice,
  type PartnerDashboard as Dashboard,
  type PartnerProductRow,
} from '../lib/api';
import { click } from '../lib/alert';
import { money } from '../lib/money';
import { preparePhoto } from '../lib/photo';
import { useOzi } from '../state/ozi';
import { partnerHelp, understandPartner } from '../voice/business-voice';
import { nameHeardIn } from '../voice/name';
import { listWords, spokenMoney } from '../voice/staff-voice';
import { spokenDate } from '../components/StaffVoice';

const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';
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

/**
 * A Shop Partner's own area (7 October 2026): what they pay, their products and prices, adding
 * a product with a photo (checked by us before Shoppers see it), and a link to share. Ozi helps
 * here too, with this dashboard's own commands only.
 */
export function PartnerDashboard(): JSX.Element {
  const navigate = useNavigate();
  const ozi = useOzi();
  const [data, setData] = useState<Dashboard | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef({ ozi, data, navigate });
  latest.current = { ozi, data, navigate };

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
      const command = understandPartner(text);
      const current = latest.current.data;
      if (!command) {
        if (nameHeardIn(text)) say(`Sorry, I didn't catch that. ${partnerHelp()}`);
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
              current.plan.paid && current.plan.paidUntil
                ? `Your plan is ${money(current.plan.monthlyPence)} a month, paid until ${longDate(current.plan.paidUntil)}.`
                : `Your plan of ${money(current.plan.monthlyPence)} a month is not paid at the moment, so new products cannot be added. Please speak to us to renew it.`,
            );
          }
          return true;
        case 'share':
          void share().then(say);
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
        case 'add':
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
    };

    latest.current.ozi.setPageCommands(handle);
    void load().then((result) => {
      if (!result) return;
      const { live, waiting } = result.counts;
      say(
        `Welcome to your ${storeConfig.productName} Shop Partner area for ${result.shop.name}. ` +
          `You have ${live} product${live === 1 ? '' : 's'} live and ${waiting} waiting to be checked. ` +
          (result.plan.paid ? '' : 'Your monthly plan is not paid at the moment. ') +
          'Say "add a product", or "help".',
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

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-display font-bold m-0">{data.shop.name}</h1>
      <p className="m-0">Your Shop Partner area.</p>
      <p role="status" className="m-0 min-h-control">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}

      <section
        aria-labelledby="plan-heading"
        className="space-y-2 border-2 border-highlight rounded-xl p-4"
      >
        <h2 id="plan-heading" className="text-lead font-bold m-0">
          Your plan
        </h2>
        <p className="m-0">
          {money(data.plan.monthlyPence)} a month.{' '}
          {data.plan.paid && data.plan.paidUntil
            ? `Paid until ${longDate(data.plan.paidUntil)}.`
            : 'Not paid at the moment: please speak to us to renew it. Until then, new products cannot be added.'}
        </p>
        <p className="m-0">
          {data.counts.live} live, {data.counts.waiting} waiting to be checked
          {data.counts.notAccepted ? `, ${data.counts.notAccepted} not accepted` : ''}.
        </p>
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
        <button
          type="button"
          onClick={() => void share().then((words) => setNews(words))}
          className="control bg-highlight text-ink"
        >
          Share my shop’s link
        </button>{' '}
        <Link to={data.sharePath} className="control bg-paper/10 text-paper underline">
          See my page as Shoppers do
        </Link>
      </section>

      <form
        onSubmit={(event) => void submit(event)}
        className="space-y-3"
        aria-labelledby="add-heading"
      >
        <h2 id="add-heading" className="text-lead font-bold m-0">
          Add a product
        </h2>
        <p className="m-0">
          We check each new product, usually within one working day, then Shoppers see it.
        </p>
        <label htmlFor="product-name" className="block font-bold">
          What it is
        </label>
        <input id="product-name" name="product-name" className={field} />
        <label htmlFor="product-price" className="block font-bold">
          Price in pounds
        </label>
        <input id="product-price" name="product-price" inputMode="decimal" className={field} />
        <label htmlFor="product-tags" className="block font-bold">
          Labels, to help people find it (optional)
        </label>
        <input id="product-tags" name="product-tags" className={field} />
        <label htmlFor="product-expires" className="block font-bold">
          Best before or use by (optional)
        </label>
        <input id="product-expires" name="product-expires" type="date" className={field} />
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
        <button
          type="submit"
          disabled={busy}
          className="control w-full bg-highlight text-ink disabled:opacity-70"
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
            <li key={product.id} className="border-2 border-paper/40 rounded-xl p-4 space-y-2">
              <h3 className="m-0 font-bold">
                {product.name}, {money(product.pricePence)}
              </h3>
              <p className="m-0">
                {STATUS_WORDS[product.status][0]?.toUpperCase()}
                {STATUS_WORDS[product.status].slice(1)}.
                {product.expiresOn ? ` Best before ${longDate(product.expiresOn)}.` : ''}
                {product.note ? ` ${product.note}` : ''}
              </p>
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
                <button type="submit" className="control bg-paper text-ink">
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
