import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';
import { useSession } from '../state/session';
import { AdSquare } from './AdSquare';
import { companyFacts } from './CompanyDetails';
import { DemoBanner } from './DemoBanner';
import { MicrophoneHelp } from './MicrophoneHelp';
import { OziBubble } from './OziBubble';
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
 */
export function Layout({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const onLanding = location.pathname === '/' || location.pathname === '/join';
  const { shopper } = useSession();

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper pb-20">
      <a className="skip-link" href="#main">
        Skip to the main part of this page
      </a>

      {/* The first screen has the name once, in big letters, and no bar above it (ruling 47). */}
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

      <main id="main" tabIndex={-1} className="flex-1 px-5 py-8">
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
          <MicrophoneHelp />
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
      <OziSwitch />
      <OziBubble />
    </div>
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
