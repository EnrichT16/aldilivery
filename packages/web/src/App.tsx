import { useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import { Layout } from './components/Layout';
import { WeeklyReminder } from './components/WeeklyReminder';
import { applyBrandToDocument, storeConfig } from './config';
import { Addresses } from './pages/Addresses';
import { Basket } from './pages/Basket';
import { Card } from './pages/Card';
import { Catalogue } from './pages/Catalogue';
import { Confirm } from './pages/Confirm';
import { BusinessSignIn } from './pages/BusinessSignIn';
import { FindIt } from './pages/FindIt';
import { GiftCards } from './pages/GiftCards';
import { Gifts } from './pages/Gifts';
import { JoinOrganisation } from './pages/JoinOrganisation';
import { JustLooking } from './pages/JustLooking';
import { More } from './pages/More';
import { Offers } from './pages/Offers';
import { Landing } from './pages/Landing';
import { LookingAfter } from './pages/LookingAfter';
import { MyOrder } from './pages/MyOrder';
import { Orders } from './pages/Orders';
import { OrganisationDashboard } from './pages/OrganisationDashboard';
import { Organisations } from './pages/Organisations';
import { PartnerDashboard } from './pages/PartnerDashboard';
import { ReportProblem } from './pages/ReportProblem';
import { Plus } from './pages/Plus';
import { Privacy } from './pages/Privacy';
import { Recipes } from './pages/Recipes';
import { RunnerDoor } from './pages/Runner';
import { RunnerHome } from './pages/RunnerHome';
import { RunnerSignUp } from './pages/RunnerSignUp';
import { Settings } from './pages/Settings';
import { ShopPage, Shops } from './pages/Shops';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Terms } from './pages/Terms';
import { WeeklyShop } from './pages/WeeklyShop';
import { CallJoin } from './pages/CallJoin';
import { Staff } from './pages/Staff';
import { BasketProvider } from './state/basket';
import { SessionProvider } from './state/session';
import { OziProvider } from './state/ozi';
import { VoiceProvider } from './state/voice';

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
 * the product name. Some pages change their heading once they know who is signed in, so this
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
      <VoiceProvider>
        <BasketProvider>
          <OziProvider>
            <Layout>
              <RouteAnnouncer />
              <WeeklyReminder />
              <PageTitle />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/join" element={<Landing />} />
                <Route path="/organisations" element={<Organisations />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/call/join" element={<CallJoin />} />
                <Route path="/staff" element={<Staff />} />
                <Route path="/looking-after" element={<LookingAfter />} />
                <Route path="/sign-up" element={<SignUp />} />
                <Route path="/sign-in" element={<SignIn />} />
                <Route path="/card" element={<Card />} />
                <Route path="/shop" element={<Catalogue />} />
                <Route path="/basket" element={<Basket />} />
                <Route path="/recipes" element={<Recipes />} />
                <Route path="/gifts" element={<Gifts />} />
                <Route path="/more" element={<More />} />
                <Route path="/find-it" element={<FindIt />} />
                <Route path="/gift-cards" element={<GiftCards />} />
                <Route path="/plus" element={<Plus />} />
                <Route path="/offers" element={<Offers />} />
                <Route path="/weekly-shop" element={<WeeklyShop />} />
                <Route path="/business" element={<BusinessSignIn />} />
                <Route path="/partner" element={<PartnerDashboard />} />
                <Route path="/organisation" element={<OrganisationDashboard />} />
                <Route path="/shops" element={<Shops />} />
                <Route path="/shops/:id" element={<ShopPage />} />
                <Route path="/join/organisation/:code" element={<JoinOrganisation />} />
                <Route path="/confirm" element={<Confirm />} />
                <Route path="/my-order" element={<MyOrder />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:orderId/problem" element={<ReportProblem as="shopper" />} />
                <Route path="/runner" element={<RunnerDoor />} />
                <Route path="/runner/sign-up" element={<RunnerSignUp />} />
                <Route path="/runner/home" element={<RunnerHome />} />
                <Route path="/runner/jobs/:orderId/problem" element={<ReportProblem />} />
                <Route path="/just-looking" element={<JustLooking />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/addresses" element={<Addresses />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </OziProvider>
        </BasketProvider>
      </VoiceProvider>
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
