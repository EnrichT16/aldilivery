import { useEffect, useRef, useState } from 'react';
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
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { BasketProvider } from './state/basket';
import { SessionProvider } from './state/session';

/**
 * Moving between pages in a single page application is silent for a screen reader unless
 * somebody makes a noise. On every move this says the new page's heading out loud and puts
 * focus on the main region, which is what a full page load would have done.
 *
 * Not on the first load, though. A real page load leaves focus at the top of the document,
 * and that is where the skip link and the Shop and Basket buttons are. Moving focus into
 * main straight away put the first Tab on the microphone, past all three, so a keyboard user
 * arriving at any address could never reach them going forwards. Found in a real browser,
 * 25 Sep 2026.
 */
function RouteAnnouncer(): JSX.Element {
  const location = useLocation();
  const firstLoad = useRef(true);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const main = document.getElementById('main');
    const heading = main?.querySelector('h1')?.textContent?.trim();
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    main?.focus();
    setAnnouncement(heading ?? storeConfig.productName);
  }, [location.pathname]);

  return (
    <p role="status" aria-live="polite" className="visually-hidden">
      {announcement}
    </p>
  );
}

/**
 * Every page gets its own title, taken from its heading, so a browser tab, the history list
 * and a screen reader's list of windows all say which page this is rather than all saying
 * "Aldilivery". Some pages change their heading once they know who is signed in, so this
 * watches for that rather than reading it once.
 */
function PageTitle(): null {
  const location = useLocation();

  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return undefined;
    const update = (): void => {
      const heading = main.querySelector('h1')?.textContent?.trim();
      document.title =
        heading && heading !== storeConfig.productName
          ? `${heading} – ${storeConfig.productName}`
          : storeConfig.productName;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
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
          <PageTitle />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/sign-in" element={<SignIn />} />
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
