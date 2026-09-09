import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';

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
  const onLanding = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <a className="skip-link" href="#main">
        Skip to the main part of this page
      </a>

      <header className="px-5 py-4 border-b-2 border-paper/25">
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
              </ul>
            </nav>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 px-5 py-8">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <footer className="px-5 py-6 border-t-2 border-paper/25">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <p className="m-0">
            {storeConfig.productName} shops at {storeConfig.store.displayName}. Your Runner pays
            the shelf price and you are charged what the till says.
          </p>
          <p className="m-0 text-paper/80">{storeConfig.store.catalogueSource.attribution}</p>
          <p className="m-0 text-paper/80">
            {storeConfig.store.legalEntityName}
            {storeConfig.store.legalEntityIsPlaceholder ? ' (company details to follow)' : ''}
          </p>
        </div>
      </footer>
    </div>
  );
}
