import { useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';

import { WhyStopped } from './components/WhyStopped';
import { Layout } from './components/Layout';
import { ReferralNews } from './components/ReferralCard';
import { WeeklyReminder } from './components/WeeklyReminder';
import { rememberLinkFrom } from './lib/referral';
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
import { BusinessMessages, RunnerMessages, ShopperMessages } from './pages/Messages';
import { Offers } from './pages/Offers';
import { Landing } from './pages/Landing';
import { LookingAfter } from './pages/LookingAfter';
import { MyOrder } from './pages/MyOrder';
import { About } from './pages/About';
import { AmbassadorTerms } from './pages/AmbassadorTerms';
import { Orders } from './pages/Orders';
import { PayByBank } from './pages/PayByBank';
import { OrganisationDashboard } from './pages/OrganisationDashboard';
import { Organisations } from './pages/Organisations';
import { OrganisationTerms } from './pages/OrganisationTerms';
import { PartnerDashboard } from './pages/PartnerDashboard';
import { PartnerJoin } from './pages/PartnerJoin';
import { PartnerTerms } from './pages/PartnerTerms';
import { ReportProblem } from './pages/ReportProblem';
import { Plus } from './pages/Plus';
import { Cookies } from './pages/Cookies';
import { Help } from './pages/Help';
import { Privacy } from './pages/Privacy';
import { Recipes } from './pages/Recipes';
import { RunnerDoor } from './pages/Runner';
import { RunnerHome } from './pages/RunnerHome';
import { RunnerSignUp } from './pages/RunnerSignUp';
import { Settings } from './pages/Settings';
import { ShopPage, Shops } from './pages/Shops';
import { BrowsePage } from './pages/Browse';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { RunnerAgreement } from './pages/RunnerAgreement';
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
/**
 * A referral link on any page (Anthony, 30 October 2026): `?via=`, `?ref=` or `?ambassador=` is
 * kept on the device until sign-up completes, so a Shopper's link to /runner/sign-up, or an
 * Ambassador's to /business/join, is counted whichever page it lands on.
 */
function KeepReferralLink(): null {
  const location = useLocation();
  useEffect(() => {
    if (location.search !== '') rememberLinkFrom(new URLSearchParams(location.search));
  }, [location.search]);
  return null;
}

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
              <KeepReferralLink />
              <WeeklyReminder />
              <ReferralNews />
              <PageTitle />
              <WhyStopped />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/join" element={<Landing />} />
                <Route path="/organisations" element={<Organisations />} />
                <Route path="/about" element={<About />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/cookies" element={<Cookies />} />
                <Route path="/help" element={<Help />} />
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
                <Route path="/messages" element={<ShopperMessages />} />
                <Route
                  path="/pay-by-bank"
                  element={<PayByBank as="shopper" back={{ to: '/more', label: 'Back to More' }} />}
                />
                <Route
                  path="/partner/pay-by-bank"
                  element={
                    <PayByBank
                      as="business"
                      back={{ to: '/partner', label: 'Back to your shop' }}
                    />
                  }
                />
                <Route
                  path="/organisation/pay-by-bank"
                  element={
                    <PayByBank
                      as="business"
                      back={{ to: '/organisation', label: 'Back to your organisation' }}
                    />
                  }
                />
                <Route path="/runner/messages" element={<RunnerMessages />} />
                <Route path="/partner/messages" element={<BusinessMessages back="/partner" />} />
                <Route
                  path="/organisation/messages"
                  element={<BusinessMessages back="/organisation" />}
                />
                <Route path="/find-it" element={<FindIt />} />
                <Route path="/gift-cards" element={<GiftCards />} />
                <Route path="/plus" element={<Plus />} />
                <Route path="/offers" element={<Offers />} />
                <Route path="/weekly-shop" element={<WeeklyShop />} />
                <Route path="/business" element={<BusinessSignIn />} />
                <Route path="/business/join" element={<PartnerJoin />} />
                <Route path="/partner" element={<PartnerDashboard />} />
                <Route path="/organisation" element={<OrganisationDashboard />} />
                <Route path="/partner/terms" element={<PartnerTerms />} />
                <Route path="/organisation/terms" element={<OrganisationTerms />} />
                <Route path="/ambassador/terms" element={<AmbassadorTerms />} />
                <Route path="/shops" element={<Shops />} />
                <Route path="/restaurants" element={<BrowsePage section="restaurants" />} />
                <Route path="/convenience" element={<BrowsePage section="convenience" />} />
                <Route path="/services" element={<BrowsePage section="services" />} />
                <Route path="/shops/:id" element={<ShopPage />} />
                <Route path="/join/organisation/:code" element={<JoinOrganisation />} />
                <Route path="/confirm" element={<Confirm />} />
                <Route path="/my-order" element={<MyOrder />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/orders/:orderId/problem" element={<ReportProblem as="shopper" />} />
                <Route path="/runner" element={<RunnerDoor />} />
                <Route path="/runner/sign-up" element={<RunnerSignUp />} />
                <Route path="/runner/sign-in" element={<SignIn as="runner" />} />
                <Route path="/runner/agreement" element={<RunnerAgreement />} />
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
