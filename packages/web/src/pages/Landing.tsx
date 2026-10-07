import { useEffect, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { DoorButton } from '../components/DoorButton';
import { GetTheApp } from '../components/GetTheApp';
import { storeConfig } from '../config';
import { rememberJoinedVia } from '../lib/api';
import { inPairs } from '../lib/phone-aloud';
import { rememberReferral } from '../lib/referral';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';
import { useVoice } from '../state/voice';

/** The choices on the first screen, each with the words under it (ruling, 2 October 2026). */
const DOORS = [
  {
    to: '/sign-up',
    title: 'Shopper',
    description:
      'You want shopping brought to you. You order, and a Runner buys it and brings it to your door.',
  },
  {
    to: '/runner',
    title: 'Runner',
    description:
      'You want to earn money by buying shopping for people and taking it to their door.',
  },
  {
    to: '/business',
    title: 'Shop Partner',
    description:
      'You have a shop, and want to show your products and prices here. Sign in, or join.',
  },
  {
    to: '/organisations',
    title: 'Organisation',
    description:
      'A council, charity, care home, hospital or business, getting shopping for the people it looks after.',
  },
  {
    to: '/looking-after',
    title: 'I look after someone',
    description: 'You are family or a carer, and want to help someone with their shopping.',
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
 * An invitation link, `/join?ref=…` or `/join?via=…`, lands here too, and is kept for sign-up.
 */
export function Landing(): JSX.Element {
  const [params] = useSearchParams();
  const ozi = useOzi();
  const { settings } = useVoice();
  const { shopper, restoring } = useSession();

  useEffect(() => {
    rememberReferral(params.get('ref'));
    // A share link from staff or a Shopper (ruling 44): /join?via=staff-… or shopper-….
    const via = /^(staff|shopper)-([A-Za-z0-9_-]{1,40})$/.exec(params.get('via') ?? '');
    if (via) rememberJoinedVia(`${via[1]}:${via[2]}`);
  }, [params]);

  // As they are on arrival: Ozi speaks once a visit, after its first introduction.
  const onArrival = useRef({ offerAccount: ozi.offerAccount, introHeard: settings.introHeard });

  useEffect(() => {
    // Signed in: the app opens straight into the shop (ruling 47); Ozi welcomes them there.
    if (restoring || shopper) return;
    const { offerAccount, introHeard } = onArrival.current;
    // The first launch has Ozi's own introduction, which asks this itself.
    if (!introHeard) return;
    try {
      if (window.sessionStorage.getItem('ozidelivery.doors.read') === 'yes') return;
      window.sessionStorage.setItem('ozidelivery.doors.read', 'yes');
    } catch {
      return;
    }
    offerAccount(
      `Hello, I'm ${storeConfig.assistantName}, your shopping assistant. ${storeConfig.motto} ` +
        `If you're a Runner, a shop, or an organisation, just say which. `,
    );
  }, [restoring, shopper]);

  if (shopper) return <Navigate to="/shop" replace />;

  return (
    // Ruling 47: tidy. The choices sit at the top like tabs, the middle stays clear, and the
    // telephone is at the bottom. The words under each choice are for screen readers, and on
    // the screen only when "Show words on the screen" is on.
    <div className="flex flex-col items-center gap-8 py-2 min-h-[70vh]">
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
      <p className="text-lead text-center m-0 max-w-xl extra">{storeConfig.tagline}</p>

      <nav aria-labelledby="doors-heading" className="w-full max-w-xl">
        <h2 id="doors-heading" className="visually-hidden">
          Who are you?
        </h2>
        <ul className="list-none m-0 p-0 grid grid-cols-2 gap-3">
          {DOORS.map((door) => (
            <li key={door.to}>
              <DoorButton to={door.to} title={door.title} description={door.description} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1" aria-hidden="true" />

      <GetTheApp compact />

      <section aria-labelledby="telephone-heading" className="w-full max-w-xl text-center">
        <h2 id="telephone-heading" className="visually-hidden">
          Would you rather telephone us?
        </h2>
        <p className="m-0 extra">Ring us and your order is taken on the phone.</p>
        <p className="m-0 mt-3">
          <a
            href={`tel:${storeConfig.contact.telephonePlaceholder.replace(/\s/g, '')}`}
            className="control bg-paper/10 text-paper text-lead"
          >
            {/* Spaced in twos, the way Ozi reads it out (Anthony, 4 October 2026). */}
            {inPairs(storeConfig.contact.telephonePlaceholder)}
          </a>
        </p>
        {storeConfig.contact.telephoneIsPlaceholder && (
          <p className="m-0 text-paper/80 extra">
            This number is a placeholder while we get the line set up. It will not connect yet.
          </p>
        )}
      </section>
    </div>
  );
}
