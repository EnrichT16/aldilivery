import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import { Layout } from './components/Layout';
import { applyBrandToDocument, storeConfig } from './config';
import { Basket } from './pages/Basket';
import { Card } from './pages/Card';
import { Catalogue } from './pages/Catalogue';
import { Confirm } from './pages/Confirm';
import { JustLooking } from './pages/JustLooking';
import { Landing } from './pages/Landing';
import { RunnerDoor } from './pages/Runner';
import { SignUp } from './pages/SignUp';
import { BasketProvider } from './state/basket';
import { SessionProvider } from './state/session';

/**
 * Moving between pages in a single page application is silent for a screen reader unless
 * somebody makes a noise. This announces the new page title and puts focus on the main
 * region, which is what a full page load would have done.
 */
function RouteAnnouncer(): JSX.Element {
  const location = useLocation();

  useEffect(() => {
    const main = document.getElementById('main');
    main?.focus();
  }, [location.pathname]);

  return (
    <p role="status" aria-live="polite" className="visually-hidden">
      {location.pathname === '/' ? storeConfig.productName : 'Page changed'}
    </p>
  );
}

export function App(): JSX.Element {
  useEffect(() => {
    applyBrandToDocument();
  }, []);

  return (
    <SessionProvider>
      <BasketProvider>
        <Layout>
          <RouteAnnouncer />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/card" element={<Card />} />
            <Route path="/shop" element={<Catalogue />} />
            <Route path="/basket" element={<Basket />} />
            <Route path="/confirm" element={<Confirm />} />
            <Route path="/runner" element={<RunnerDoor />} />
            <Route path="/just-looking" element={<JustLooking />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </BasketProvider>
    </SessionProvider>
  );
}

function NotFound(): JSX.Element {
  return (
    <div className="space-y-4">
      <h1 className="text-display font-bold m-0">There is nothing on this page</h1>
      <p className="m-0">You may have followed an old link. Go back to the start and try again.</p>
    </div>
  );
}
