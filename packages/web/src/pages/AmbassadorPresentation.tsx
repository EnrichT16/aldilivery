import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { openPrint } from '../components/ambassador/PrintSheet';
import { QrCode } from '../components/QrCode';
import { storeConfig } from '../config';
import { fetchAmbassadorToolkit, type AmbassadorToolkit } from '../lib/api';
import { ambassadorAs } from '../lib/ambassador';
import { money } from '../lib/money';

/**
 * The six-slide presentation for business owners (Anthony, 30 October 2026), shown on the
 * Ambassador's phone or tablet: what the service is, the new customers, being paid in full at the
 * counter with no commission, how the price works, Partner Plus and Preferred Partner perks, and
 * how to join, with the Ambassador's own QR code.
 *
 * One slide at a time, each a labelled group ("Slide 2 of 6: New customers"), moved by the Next
 * and Previous buttons, the arrow keys, or a swipe, and the slide reached is said aloud. On paper
 * every slide prints, one to a page.
 */

export interface Slide {
  title: string;
  body: JSX.Element;
}

export function presentationSlides(toolkit: AmbassadorToolkit): Slide[] {
  const product = storeConfig.productName;
  const restaurants = storeConfig.restaurants;
  const partners = storeConfig.extras.partners;
  const assistant = storeConfig.assistantName;
  return [
    {
      title: product,
      body: (
        <>
          <p className="m-0 text-lead">{storeConfig.tagline}</p>
          <p className="m-0">{storeConfig.motto}</p>
          <p className="m-0">Presented by {toolkit.name}, an independent Ozi Ambassador.</p>
        </>
      ),
    },
    {
      title: 'New customers',
      body: (
        <ul className="m-0 ps-6 space-y-2">
          <li>Older people, disabled people and people who are blind.</li>
          <li>The families and carers who order for them.</li>
          <li>
            They order by speaking to {assistant}, or by ringing{' '}
            {storeConfig.contact.telephonePlaceholder} from any phone. No app skills needed.
          </li>
        </ul>
      ),
    },
    {
      title: 'Paid in full at the counter',
      body: (
        <ul className="m-0 ps-6 space-y-2">
          <li>Our Runner (driver) comes to your counter and pays for the order there and then.</li>
          <li>Paid instantly, in full.</li>
          <li>No commission. Nothing taken off later.</li>
          <li>Other delivery apps pay you later and take a commission.</li>
        </ul>
      ),
    },
    {
      title: 'How the price works',
      body: (
        <ul className="m-0 ps-6 space-y-2">
          <li>Your price is safe: you are always paid your own price.</li>
          <li>
            {product} adds a small mark-up on top, agreed with you. Customers are told prices on{' '}
            {product} may be higher than in your shop.
          </li>
          <li>
            You can choose to give us a discount. At {restaurants.preferredDiscountPercent}% or more
            you become a Preferred Partner, with perks.
          </li>
        </ul>
      ),
    },
    {
      title: 'Partner Plus and Preferred Partner perks',
      body: (
        <ul className="m-0 ps-6 space-y-2">
          <li>
            Partner Plus for shops: {money(partners.plusMonthlyPence)} a month
            {partners.plusFirstMonthFree ? ', first month free' : ''}. Your full catalogue with
            photos, higher in the listings, and a chance to be Shop of the Month.
          </li>
          <li>
            Preferred Partners are shown first to customers looking for food like yours, and marked
            as Preferred Partners.
          </li>
          <li>A restaurant, café or takeaway listing is free.</li>
        </ul>
      ),
    },
    {
      title: 'How to join',
      body: (
        <div className="flex flex-wrap gap-6 items-start">
          <div className="w-40 bg-paper p-2 rounded-2xl">
            <QrCode
              value={toolkit.businessLink}
              label={`QR code: ${toolkit.firstName}'s link for a business to join`}
            />
          </div>
          <ul className="m-0 ps-6 space-y-2">
            <li>Scan the code with your phone and join, free.</li>
            <li>Or I can sign you up now, here, with you.</li>
            <li>A person at {product} checks every business before it goes live.</li>
          </ul>
        </div>
      ),
    },
  ];
}

export function AmbassadorPresentation(): JSX.Element {
  const [params] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [toolkit, setToolkit] = useState<AmbassadorToolkit | null>(null);
  const [problem, setProblem] = useState('');
  const [current, setCurrent] = useState(0);
  const [said, setSaid] = useState('');
  const touch = useRef<number | null>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const keys = useRef<{
    key: (event: KeyboardEvent) => void;
    start: (event: TouchEvent) => void;
    end: (event: TouchEvent) => void;
  } | null>(null);
  const printed = useRef(false);
  const action = params.get('action');

  useEffect(() => {
    if (!as) {
      setProblem('Please sign in to use your Ambassador Toolkit.');
      return;
    }
    fetchAmbassadorToolkit(as)
      .then(setToolkit)
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be opened.'),
      );
  }, [as]);

  useEffect(() => {
    if (!toolkit || printed.current || (action !== 'print' && action !== 'pdf')) return;
    printed.current = true;
    const timer = window.setTimeout(openPrint, 400);
    return () => window.clearTimeout(timer);
  }, [toolkit, action]);

  // The carousel's keys and swipes are listened for here rather than as JSX props: the region is
  // focusable and moved by the keyboard (the WAI-ARIA carousel pattern), which the lint rules
  // for non-interactive elements would otherwise refuse. The handlers live in a ref so the
  // listeners always see the current slide.
  useEffect(() => {
    const element = carousel.current;
    if (!element) return;
    element.tabIndex = 0;
    const key = (event: KeyboardEvent): void => keys.current?.key(event);
    const start = (event: TouchEvent): void => keys.current?.start(event);
    const end = (event: TouchEvent): void => keys.current?.end(event);
    element.addEventListener('keydown', key);
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchend', end);
    return () => {
      element.removeEventListener('keydown', key);
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchend', end);
    };
  }, [toolkit]);

  if (!toolkit) {
    return (
      <div className="space-y-4">
        <h1 className="text-display font-bold m-0">Presentation</h1>
        {problem !== '' ? (
          <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
            {problem}
          </p>
        ) : (
          <p className="m-0">Opening the presentation.</p>
        )}
      </div>
    );
  }

  const slides = presentationSlides(toolkit);
  const go = (to: number): void => {
    const next = Math.max(0, Math.min(slides.length - 1, to));
    setCurrent(next);
    setSaid(`Slide ${next + 1} of ${slides.length}: ${slides[next]?.title ?? ''}`);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      go(current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      go(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      go(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      go(slides.length - 1);
    }
  };
  const onTouchStart = (event: TouchEvent): void => {
    touch.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent): void => {
    const from = touch.current;
    const to = event.changedTouches[0]?.clientX;
    touch.current = null;
    if (from === null || to === undefined) return;
    if (to - from < -50) go(current + 1);
    else if (to - from > 50) go(current - 1);
  };
  keys.current = { key: onKey, start: onTouchStart, end: onTouchEnd };

  return (
    <div className="space-y-4">
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          body * { visibility: hidden !important; }
          .slides, .slides * { visibility: visible !important; }
          .slides { position: absolute; left: 0; top: 0; width: 100%; }
          .slides .slide[hidden] { display: block !important; }
          .slides .slide { break-after: page; min-height: 150mm; }
          .slides .slide-controls { display: none !important; }
        }
      `}</style>
      <h1 className="text-display font-bold m-0">Presentation for business owners</h1>
      <p role="status" aria-live="polite" className="visually-hidden">
        {said}
      </p>
      {/* The carousel itself: focusable, so the arrow keys move it, and swiped on a phone. */}
      <div
        ref={carousel}
        role="region"
        aria-roledescription="carousel"
        aria-label="Presentation. Use the arrow keys or swipe to move between slides."
        className="slides space-y-4 focus:outline focus:outline-4"
      >
        {slides.map((slide, index) => (
          <section
            key={slide.title}
            role="group"
            aria-roledescription="slide"
            aria-label={`Slide ${index + 1} of ${slides.length}: ${slide.title}`}
            hidden={index !== current}
            className="slide border-4 border-highlight rounded-2xl p-6 space-y-4 min-h-[60vh]"
          >
            <p className="m-0 extra">
              {index + 1} of {slides.length}
            </p>
            <h2 className="text-display font-bold m-0">{slide.title}</h2>
            {slide.body}
          </section>
        ))}
        <div className="slide-controls flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={current === 0}
            className="control border-paper bg-paper/10 text-paper disabled:opacity-50"
          >
            Previous slide
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            disabled={current === slides.length - 1}
            className="control bg-highlight text-on-accent disabled:opacity-50"
          >
            Next slide
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openPrint}
          className="control border-paper bg-paper/10 text-paper"
        >
          Print
        </button>
        <button
          type="button"
          onClick={openPrint}
          className="control border-paper bg-paper/10 text-paper"
        >
          Download PDF
        </button>
        {current === slides.length - 1 && (
          <Link to="/ambassador/sign-up-business" className="control bg-highlight text-on-accent">
            Sign up this business now
          </Link>
        )}
        <Link
          to="/ambassador/home?tab=toolkit"
          className="control border-paper bg-paper/10 text-paper"
        >
          Back to the Toolkit
        </Link>
      </div>
    </div>
  );
}
