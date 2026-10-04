import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { DoorButton } from '../components/DoorButton';
import { storeConfig } from '../config';
import { inPairs } from '../lib/phone-aloud';
import { rememberReferral } from '../lib/referral';
import { useOzi } from '../state/ozi';
import { useVoice } from '../state/voice';

/** The choices on the first screen, each with the words under it (ruling, 2 October 2026). */
const DOORS = [
  { to: '/sign-up', title: 'Shopper', description: 'I want my shopping brought to me.' },
  {
    to: '/runner',
    title: 'Runner',
    description:
      'I want to pick up orders in the app, buy the shopping, and take it to the Shopper. And be paid for it.',
  },
  {
    to: '/organisations',
    title: 'Organisation',
    description: 'A council, charity, care provider or business, arranging shopping for people.',
  },
  {
    to: '/looking-after',
    title: 'I look after someone',
    description: 'I am family or a carer, and I want to help someone with their shopping.',
  },
  {
    to: '/just-looking',
    title: 'Just looking',
    description: 'Tell me how this works before I decide.',
  },
];

/**
 * The landing page: who are you?
 *
 * Deep navy, white text, and the doors, each with a short description under it. Ozi's own round
 * button is the one microphone, here as on every screen (ruling, 1 October 2026): a second one in
 * the middle of this page sat under it and said the same thing twice to a screen reader. Each door
 * has its description written and — once Ozi has introduced itself — said aloud, once a
 * visit. Staff do not have a door here; they sign in at their own address.
 *
 * An invitation link, `/join?ref=…`, lands here too, and the code is kept for the sign-up form.
 */
export function Landing(): JSX.Element {
  const [params] = useSearchParams();
  const ozi = useOzi();
  const { settings } = useVoice();

  useEffect(() => {
    rememberReferral(params.get('ref'));
  }, [params]);

  // As they are on arrival: the choices are read once a visit, not again when these change.
  const onArrival = useRef({ say: ozi.say, introHeard: settings.introHeard });

  useEffect(() => {
    const { say, introHeard } = onArrival.current;
    // The first launch has Ozi's own introduction; after that, the choices, once a visit.
    if (!introHeard) return;
    try {
      if (window.sessionStorage.getItem('ozidelivery.doors.read') === 'yes') return;
      window.sessionStorage.setItem('ozidelivery.doors.read', 'yes');
    } catch {
      return;
    }
    void say(
      `Hello, I'm ${storeConfig.assistantName}, your shopping assistant. ${storeConfig.motto} Who are you? ` +
        DOORS.map((door) => `${door.title}: ${door.description}`).join(' ') +
        ' Or just tell me what you need. To create your account by talking to me, say "create my account".',
    );
  }, []);

  return (
    <div className="flex flex-col items-center gap-10 py-4">
      {ozi.waitingForTouch && (
        // The browser will not let a website make a sound until it is touched once. A touch
        // anywhere starts Ozi; this says so, as big as anything on the page.
        <button
          type="button"
          className="control w-full max-w-xl min-h-[6rem] bg-[var(--colour-listening)] text-ink text-lead font-bold border-4 border-ink"
        >
          Tap anywhere, and {storeConfig.assistantName} will talk to you
        </button>
      )}

      <h1 className="text-display font-bold text-center m-0">{storeConfig.productName}</h1>

      <p className="text-lead font-bold text-center m-0 max-w-xl">{storeConfig.motto}</p>
      <p className="text-lead text-center m-0 max-w-xl">{storeConfig.tagline}</p>

      <section aria-labelledby="doors-heading" className="w-full max-w-xl">
        <h2 id="doors-heading" className="text-lead font-bold">
          Who are you?
        </h2>
        <ul className="list-none m-0 p-0 space-y-4">
          {DOORS.map((door) => (
            <li key={door.to}>
              <DoorButton to={door.to} title={door.title} description={door.description} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="telephone-heading" className="w-full max-w-xl text-center">
        <h2 id="telephone-heading" className="text-lead font-bold">
          Would you rather telephone us?
        </h2>
        <p className="m-0">Ring us and a person will take your order.</p>
        <p className="m-0 mt-3">
          <a
            href={`tel:${storeConfig.contact.telephonePlaceholder.replace(/\s/g, '')}`}
            className="control bg-paper text-ink text-lead"
          >
            {/* Spaced in twos, the way Ozi reads it out (Anthony, 4 October 2026). */}
            {inPairs(storeConfig.contact.telephonePlaceholder)}
          </a>
        </p>
        {storeConfig.contact.telephoneIsPlaceholder && (
          <p className="m-0 text-paper/80">
            This number is a placeholder while we get the line set up. It will not connect yet.
          </p>
        )}
      </section>
    </div>
  );
}
