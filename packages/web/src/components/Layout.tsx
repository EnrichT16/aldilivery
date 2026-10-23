import { useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';
import { useDockHeights, useMeasuredBar } from '../lib/dock';
import { useBasket } from '../state/basket';
import { useOzi } from '../state/ozi';
import { useSession } from '../state/session';
import { AdSquare } from './AdSquare';
import { companyFacts } from './CompanyDetails';
import { DemoBanner } from './DemoBanner';
import { InboxLink } from './Inbox';
import { MicrophoneHelp } from './MicrophoneHelp';
import { BUBBLE_ROOM, OziBubble, presenceWord } from './OziBubble';
import { OziSwitch } from './OziSwitch';
import { SocialLinks } from './SocialLinks';

/**
 * The page frame.
 *
 * Landmarks are real HTML elements, not divs with roles: a `header`, a `nav`, a `main` and
 * a `footer`. A screen reader user can jump between them without us doing anything clever.
 *
 * The skip link is first in the source order, so the very first thing a keyboard user meets
 * on any page is a way past the navigation.
 *
 * A signed-in Shopper (19 October 2026, after the big delivery apps) has a slim bar at the top
 * with where the shopping is going, and a floating bar at the foot of the screen: Home, Shops,
 * a wide "Talk to Ozi" in the middle (our search is talking), Basket with how many things are
 * in it, and More. Runners, staff, Shop Partners and visitors keep the bar they had.
 *
 * Everything fixed to the foot of the screen sits in one stack, measured, so the page leaves
 * that much room at its foot and a focused control is always scrolled clear of it.
 */

/** Pages that belong to Runners, staff and businesses: never the Shopper's bars. */
const NOT_SHOPPER = /^\/(runner|staff|partner|business|organisation|join\/organisation)(\/|$)/;

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const onLanding = location.pathname === '/' || location.pathname === '/join';
  const { shopper, restoring } = useSession();
  // While a signed-in session is being restored, the Shopper's bars are shown already, so the
  // screen does not swap its navigation over under somebody's finger a moment later.
  const signedIn = Boolean(shopper) || restoring;
  const shopperBars = signedIn && !onLanding && !NOT_SHOPPER.test(location.pathname);
  const dockRef = useRef<HTMLDivElement>(null);
  useMeasuredBar('dock', dockRef);
  const bars = useDockHeights();
  // The round button needs room too when it is not in the bottom bar.
  const room = bars.dock + bars.caption + (shopperBars ? 0 : BUBBLE_ROOM);

  return (
    <div
      className="min-h-screen flex flex-col bg-ink text-paper"
      // Saved to the home screen, the page runs under the phone's clock and its home bar: the
      // safe areas keep everything clear of them (20 October 2026).
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: `calc(${room}px + 1rem)`,
      }}
    >
      <a className="skip-link" href="#main">
        Skip to the main part of this page
      </a>

      {shopperBars ? (
        <ShopperTopBar address={shopper?.deliveryAddress ?? ''} restoring={restoring} />
      ) : (
        /* The first screen has the name once, in big letters, and no bar above it (ruling 47). */
        <header className={onLanding ? 'visually-hidden' : 'px-5 py-4 border-b-2 border-paper/25'}>
          <div className="mx-auto w-full max-w-3xl flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="control px-0 text-lead font-bold text-paper">
              {storeConfig.productName}
            </Link>

            {!onLanding && (
              <nav aria-label="Main">
                <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
                  <li>
                    <Link to="/shop" className="control bg-paper/10 text-paper">
                      Shop
                    </Link>
                  </li>
                  <li>
                    <Link to="/basket" className="control bg-paper/10 text-paper">
                      Basket
                    </Link>
                  </li>
                  <li>
                    <Link to="/more" className="control bg-paper/10 text-paper">
                      More
                    </Link>
                  </li>
                  {shopper && (
                    <li>
                      <Link to="/my-order" className="control bg-paper/10 text-paper">
                        Your order
                      </Link>
                    </li>
                  )}
                  {shopper && (
                    <li>
                      <Link to="/orders" className="control bg-paper/10 text-paper">
                        Past orders
                      </Link>
                    </li>
                  )}
                  <li>
                    <Link to="/settings" className="control bg-paper/10 text-paper">
                      Settings
                    </Link>
                  </li>
                </ul>
              </nav>
            )}
          </div>
        </header>
      )}

      <main
        id="main"
        tabIndex={-1}
        className={shopperBars ? 'flex-1 px-4 pt-4 pb-8' : 'flex-1 px-5 py-8'}
      >
        <AdSquare />
        <div className="mx-auto w-full max-w-3xl">
          {/* The app store reviewers' demo account (ruling 60), named on every page. */}
          {shopper?.isDemo && (
            <div className="mb-6">
              <DemoBanner />
            </div>
          )}
          {/* Ozi's "Tap to talk" and microphone notes, in the flow of the page, so they push
              it down and never cover a form field (ruling 62). */}
          <MicrophoneHelp talkInBar={shopperBars} />
          {children}
        </div>
      </main>

      <footer className="px-5 py-6 border-t-2 border-paper/25">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <p className="m-0 extra">
            {storeConfig.productName} shops at {storeConfig.store.displayName}. Your Runner pays the
            shelf price and you are charged what the till says.
          </p>
          <p className="m-0 text-paper/80 extra">{storeConfig.store.catalogueSource.attribution}</p>
          <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
            <li>
              <Link to="/about" className="control px-0 text-paper underline">
                About us
              </Link>
            </li>
            <li>
              <Link to="/help" className="control px-0 text-paper underline">
                Help and contact
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="control px-0 text-paper underline">
                Privacy
              </Link>
            </li>
            <li>
              <Link to="/terms" className="control px-0 text-paper underline">
                Our terms
              </Link>
            </li>
            <li>
              <Link to="/cookies" className="control px-0 text-paper underline">
                Cookies
              </Link>
            </li>
          </ul>
          <SocialLinks />
          <CompanyLine />
        </div>
      </footer>
      <div
        ref={dockRef}
        className="fixed bottom-0 inset-x-0 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {shopperBars && <ShopperBottomBar />}
        <OziSwitch />
      </div>
      <OziBubble docked={shopperBars} />
    </div>
  );
}

/** The Shopper's bar at the top: where the shopping is going, their order, and Settings. */
function ShopperTopBar({
  address,
  restoring,
}: {
  address: string;
  restoring: boolean;
}): JSX.Element {
  const street = address.split(',')[0]?.trim() ?? '';
  return (
    <header className="px-4 pt-3 pb-1">
      <div className="mx-auto w-full max-w-3xl flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          to="/addresses"
          className="control flex-1 min-w-0 !justify-start !px-2 bg-transparent text-paper text-left"
        >
          <PinIcon />
          <span className="min-w-0">
            <span className="block leading-tight text-[0.85rem] text-paper/90 whitespace-nowrap">
              Delivering to
            </span>
            <span className="block leading-tight font-bold truncate">
              {street || (restoring ? 'One moment' : 'Add your address')}
            </span>
          </span>
          <ChevronIcon />
        </Link>
        <Link to="/settings" className="control !px-3 bg-paper/10 text-paper">
          Settings
        </Link>
        {/* Only once the account is known, as before: these links mean signed in. */}
        {!restoring && (
          <nav aria-label="Your orders" className="w-full">
            <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
              <li>
                <Link to="/my-order" className="control !px-3 bg-paper/10 text-paper">
                  Your order
                </Link>
              </li>
              <li>
                <Link to="/orders" className="control !px-3 bg-paper/10 text-paper">
                  Past orders
                </Link>
              </li>
              <li>
                {/* The company inbox (ruling 77), with how many are new. */}
                <InboxLink
                  as="shopper"
                  to="/messages"
                  className="control !px-3 bg-paper/10 text-paper"
                />
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}

/**
 * The Shopper's floating bar at the foot of the screen. Each button has its word under its
 * picture; the picture is decoration. The page you are on is marked to a screen reader
 * (aria-current) and on the screen by a bar under its word, not by colour alone.
 */
function ShopperBottomBar(): JSX.Element {
  const ozi = useOzi();
  const { itemCount } = useBasket();
  const assistant = storeConfig.assistantName;
  const item = (isActive: boolean): string =>
    `control w-full h-full flex-col gap-0 !px-0 !py-1 !rounded-full text-ink leading-tight ${
      isActive ? 'bg-ink/10 underline decoration-4 underline-offset-4' : 'bg-transparent'
    }`;
  return (
    <nav aria-label="Main" className="px-3 pb-2">
      <ul className="mx-auto w-full max-w-3xl flex items-stretch gap-1 text-[0.9rem] list-none m-0 p-1.5 rounded-[2rem] bg-paper text-ink shadow-lg border-2 border-ink/20">
        <li className="flex-1 min-w-0">
          <NavLink to="/shop" end className={({ isActive }) => item(isActive)}>
            <HomeIcon />
            Home
          </NavLink>
        </li>
        <li className="flex-1 min-w-0">
          <NavLink to="/shops" end className={({ isActive }) => item(isActive)}>
            <ShopIcon />
            Shops
          </NavLink>
        </li>
        <li className="flex-[1.25] min-w-0">
          {/* Ozi's own button (19 October 2026): green while it listens or talks, its state in
              words, and the same press as the round button it replaces on these screens. */}
          <button
            type="button"
            aria-describedby="bar-ozi-hint"
            onClick={() => (ozi.presence === 'needs-tap' ? ozi.tapToTalk() : ozi.press())}
            className={`control w-full h-full flex-col gap-0 !px-1 !py-1 !rounded-full font-bold leading-tight border-2 border-ink text-on-accent ${
              ozi.presence === 'listening' || ozi.talking
                ? 'bg-listening ozi-beaming'
                : 'bg-highlight'
            }`}
          >
            <MicIcon />
            {ozi.presence === 'needs-tap' ? `Talk to ${assistant}` : presenceWord(ozi)}
          </button>
          <span id="bar-ozi-hint" className="visually-hidden">
            {ozi.talking
              ? `${assistant} is talking. Press to stop.`
              : ozi.presence === 'listening'
                ? `${assistant} is listening. Press to pause.`
                : `Press to talk to ${assistant}.`}
          </span>
        </li>
        <li className="flex-1 min-w-0">
          <NavLink
            to="/basket"
            aria-describedby={itemCount > 0 ? 'basket-count' : undefined}
            className={({ isActive }) => `relative ${item(isActive)}`}
          >
            <BasketIcon />
            Basket
            {itemCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute top-0 right-1 min-w-[1.6rem] h-[1.6rem] px-1 rounded-full bg-ink text-paper text-[0.8rem] font-bold flex items-center justify-center no-underline"
              >
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </NavLink>
          {itemCount > 0 && (
            <span id="basket-count" className="visually-hidden">
              {itemCount} {itemCount === 1 ? 'thing' : 'things'} in it
            </span>
          )}
        </li>
        <li className="flex-1 min-w-0">
          <NavLink to="/more" end className={({ isActive }) => item(isActive)}>
            <PersonIcon />
            More
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}

/** The bars' pictures: each one decoration, with its word beside it. */
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}
function PinIcon(): JSX.Element {
  return (
    <Icon size={28}>
      <path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.6" />
    </Icon>
  );
}
function ChevronIcon(): JSX.Element {
  return (
    <Icon size={22}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
function HomeIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </Icon>
  );
}
function ShopIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M3 9h18l-1.5-5h-15L3 9Z" />
      <path d="M5 9v12h14V9" />
      <path d="M10 21v-6h4v6" />
    </Icon>
  );
}
function MicIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </Icon>
  );
}
function BasketIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M3 9h18l-2 11H5L3 9Z" />
      <path d="m8 9 4-6 4 6" />
    </Icon>
  );
}
function PersonIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  );
}

/**
 * The company's name, number, registered office and email, on every page (Companies Act 2006
 * and the trading disclosure regulations of 2015; the E-Commerce Regulations 2002). Always shown,
 * not tucked behind "Show words on the screen". Placeholders read "to follow" (ruling 54).
 */
function CompanyLine(): JSX.Element {
  const facts = companyFacts();
  return (
    <p className="m-0 text-paper/80">
      {facts.name}, registered in {facts.registeredIn}, company number {facts.number}. Registered
      office: {facts.office}. Email: {facts.email ?? 'to follow'}.
    </p>
  );
}
