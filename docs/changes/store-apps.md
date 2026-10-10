# Phone apps for the stores, 9 October 2026

What was built on the branch `feat/store-apps`, in plain English, for the lead to fold into
docs/MASTER_BLUEPRINT.md (Part 4 "Phone apps", Part 7 step 14) and docs/STILL_TO_DO.md. No
database migration. The step-by-step guide for Anthony and Yvette is docs/APP_STORES.md.

## 1. Putting the website on the home screen

- The web app manifest moved into `packages/web/pwa.ts`, where a test can check it, and
  vite.config.ts uses it. The name, short name, description and colours still come from
  config/store.json.
- Added: a fixed `id`, both 192 and 512 pixel icons marked "any" and "maskable" (a new 192
  pixel maskable icon), `dir`, and two shortcuts for a long press on Android (Shop, Your order).
- The installed app is no longer locked upright: `orientation` is now `any`. Locking it broke
  WCAG 2.2 success criterion 1.3.4 (Orientation), which matters for someone whose phone is fixed
  to a wheelchair or who reads large text sideways.
- iPhone: a proper 180 pixel `apple-touch-icon.png` (it was pointing at the 192 pixel Android
  icon), and the tags that make it open full screen with the right name under the icon
  (`apple-mobile-web-app-capable`, `apple-mobile-web-app-title` filled from store.json,
  `apple-mobile-web-app-status-bar-style`, `mobile-web-app-capable`, `application-name`).
- Working without a signal was already right (any page is answered by the app, which then says
  it cannot reach us; the API is never answered from the cache); it is now tested.

## 2. "Get the app" explains both phones

- The button still installs in one press where Chrome allows it. Under it, both sets of steps
  are now written out: on an iPhone or iPad (Safari, the Share button, which VoiceOver reads as
  "Share", Add to Home Screen, Add) and on Android (Chrome's menu, "More options" to TalkBack,
  Install app or Add to Home screen, Install). The reader's own phone comes first, so a relative
  on a different phone can still follow the other.
- On the landing page and the basket, where space is short, the steps sit behind "How to do it
  on an iPhone or Android".
- It is hidden once the app is installed (now including Safari's own way of saying so), and
  inside the store apps.

## 3. A Help and contact page

- New page at /help, linked in every page's footer: the telephone and email (or "to follow"
  while they are placeholders), how to report a problem, Get the app, and how to close an
  account (#close-account). The store listings name it as the support page, and Google Play's
  "delete account" link points at it. Added to the accessibility test, with the About page, which
  was missing from it.

## 4. The phone apps (packages/mobile)

- A new workspace package using Capacitor 8.5.2 (the current stable major; versions pinned to
  releases from September). Plugins: push notifications, haptics, status bar, splash screen,
  camera and geolocation. The old unused `packages/web/capacitor.config.ts` and Capacitor 6 in
  the web package were removed.
- The iOS and Android projects are generated into packages/mobile/build by
  `pnpm --filter mobile build` and never committed, so the product name is only ever written
  into them at build time from config/store.json (Rule Nine). build/ is already ignored by git
  and skipped by the Rule Nine scan, so no exception had to be added to that test.
- The app identifier is `mobileApp.appId` in config/store.json: uk.co.ozidelivery.app. The site
  the app talks to is `mobileApp.site`. Both can be overridden for a test build.
- The app carries its own copy of the web app, pointed at https://ozidelivery.co.uk/api.
  Setting APP_LIVE_URL makes it open the live website instead.
- Permission wording, in plain English, for the microphone ("Ozi listens when you press the
  microphone button..."), speech recognition, camera, photos and location ("For Runners
  only... Shoppers are never tracked"), checked against the privacy policy. Android asks for the
  microphone, camera, location and notifications, with each piece of hardware optional.
- iPhone only (iPads run the iPhone app), so Apple asks for no iPad screenshots. Pinch to zoom
  stays on (ruling 43). Version numbers are set at build time; the build number always rises.
- Icons and splash screens are drawn from the same gold microphone as the website, in
  packages/mobile/assets, and every size is made by `@capacitor/assets` during the store build.
- Tested by packages/mobile/test (18 tests), now part of `pnpm run test` and
  `pnpm run typecheck`.

## 5. The build workflow

- `.github/workflows/store-apps.yml`, "Phone apps for the stores". Runs only when someone presses
  Run workflow on GitHub, never on a push (a test checks this). Builds a signed Android .aab and
  .apk on Linux, and an iPhone .ipa on GitHub's Mac with Apple's cloud signing, optionally sent
  straight to TestFlight. Each part stops with a plain message naming any secret not yet added.
  No secret is in the file.

## 6. The store listing kit (docs/store-listing)

- Name, subtitle, short and full descriptions, keywords and categories; Apple's App Privacy
  answers; Google's Data safety answers; both age rating questionnaires; the screenshots to
  capture; the review notes with placeholders for the reviewers' sign-in; and Google Play's
  512 pixel icon and feature graphic. The supermarket is not named anywhere in the listing.

## 7. Found, and still to do before submitting

- ~~Reviewers need a sign-in that does not need a text message~~: built (ruling 60), the demo
  sign-in, `DEMO_SIGNIN_PHONE` and `DEMO_SIGNIN_CODE`.
- ~~Runners cannot close their account in the app (Apple guideline 5.1.1(v))~~: built (ruling
  60), on the Runner page and by voice.
- The Recipe Pass and Ozi Plus are digital, so the stores would insist on their own payment
  systems. Recommendation: do not sell them inside the store apps for the first version.
- ALLOWED_ORIGIN in DigitalOcean must add capacitor://localhost and https://localhost for the
  apps to reach the API.
- Notifications in the apps need Apple's and Google's push services on the server (the
  website's Web Push does not reach an iPhone app). Not needed for the first version.
- The share links on the Shop Partner and organisation dashboards use the page's own address,
  which inside an app is the phone; they should use the website's address.
- A card payment inside the iPhone app must be tried on TestFlight.
- One existing API test (`addresses.test.ts`, "keeps only a salted hash, never the PIN") failed
  once and passed on the next run: it checks a random hash does not contain the PIN's four
  digits, which by chance it sometimes does. Unrelated to this work; worth making
  deterministic.
