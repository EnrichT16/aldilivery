# Putting Ozi Delivery on the App Store and Google Play

For Anthony and Yvette. Written 9 October 2026.

This guide says what to pay, what to sign up for, and every step in order, for both stores. It
says who does each step: Anthony, Yvette, or Claude. It is written to be read aloud by a screen
reader: headings and numbered steps, no tables. Every price is approximate and must be checked
on the day, because Apple and Google change them.

The short version. Everything on our side that can be ready is ready: the iPhone and Android
apps are built automatically from the website, with the right name, icon, permissions and
wording, and a button on GitHub turns them into the files each store needs. What is left is
signing up to each store (the D-U-N-S number has come: Part 2), then a few changes listed
under "Before submitting", then filling in the store pages from docs/store-listing.

Until then, people put the website on their phone's home screen. The "Get the app" button on the
website explains how, for an iPhone and for Android.

## Part 1. What it costs

1. **Apple Developer Program**: about 79 pounds a year in the UK (99 US dollars), paid by card
   when you enrol. It must be renewed every year or the app is taken off the App Store.
2. **Google Play developer account**: 25 US dollars once, about 20 pounds, paid by card when you
   sign up. No yearly fee.
3. **D-U-N-S number**: free, and it has come: **235209172** (Part 2).
4. **Building the iPhone app**: it needs a Mac, which we do not have. The plan is GitHub's own
   Macs, through the workflow already in the repository. GitHub's free allowance covers a few
   iPhone builds a month for a private repository (Mac minutes count ten times; a build takes
   about 15 to 25 minutes). Beyond that it costs a few pence a minute. Expect nothing to a few
   pounds a month.
5. **Optional alternatives for the Mac**: Codemagic, a build service with Macs, has a free
   allowance of about 500 minutes a month and then charges per minute; or buy a Mac mini, about
   600 pounds, if you would rather own one.
6. **Commission**: none, as long as the apps sell only groceries and delivery, which are
   physical. Apple and Google take 15 percent of digital things sold inside an app, such as the
   Recipe Pass or Ozi Plus; see "Before submitting".

Total to start: about 100 pounds, then about 79 pounds a year.

## Part 2. What the D-U-N-S number is for

A D-U-N-S number is a nine-digit number from the company Dun and Bradstreet that identifies a
business. Apple and Google both use it to check that the company is real and that Anthony may
act for it.

**The number has come (10 October 2026, ruling 59): 235209172**, for **OZIDELIVERY LTD, 107 King
Street, Gillingham ME7 1ER**. It is public, and is kept in `config/store.json` as
`store.dunsNumber`. Its Companies House number is **17497650** (`store.companyNumber`, given by
Anthony on 10 October 2026, ruling 60), shown on the site; Apple and Google may ask for it.
OZIDELIVERY LTD is the company that runs Ozi Delivery. Anthony's other
company is separate and is not named anywhere on the site or in the store listings.

Both the Apple and the Google accounts must be enrolled as **OZIDELIVERY LTD**, written exactly
as it is on the D-U-N-S record (capital letters, "LTD"), with the address 107 King Street,
Gillingham ME7 1ER. A different spelling or address stops the enrolment.

With it, the store pages say the app is published by the company, not by Anthony personally,
and Anthony's home address is not shown. Without it, the only option is a personal account. A
new personal Google account must also have 12 testers using the app for 14 days before it can be
published, which a company account does not.

Check, when the number arrives, that Dun and Bradstreet has the company's name and address
exactly as Companies House has them. Apple checks them against each other, and a difference
stops the enrolment. Dun and Bradstreet can correct it, free, which takes a few days.

## Part 3. Who does what

- **Anthony**: owns both accounts, as the company's director. Signs the agreements, pays, makes
  the decisions in "Before submitting", answers Apple's verification phone call, and tests the
  apps with VoiceOver and TalkBack before they go live.
- **Yvette**: the sighted check. Helps with the parts of Apple's and Google's websites that do
  not read well aloud, photographs Anthony's identity document if Google asks for it, takes the
  screenshots (docs/store-listing/screenshots.md), and looks at each screen of the apps before
  they are sent.
- **Claude**: everything in the repository. The changes in "Before submitting", the build
  workflow, pasting store text if Anthony shares his screen or copies it, and fixing anything a
  reviewer rejects.

Never paste a password, a key file or a secret into a chat with Claude. They go straight into
Apple's, Google's or GitHub's own pages.

## Part 4. Before submitting: the changes still needed in the app

These are the things that would get the apps rejected, or not work, if submitted today. Each one
is a job for Claude once Anthony says yes.

1. **A sign-in for the reviewers.** Built (ruling 60). One demo telephone number accepts one
   fixed code without a text being sent, only when both `DEMO_SIGNIN_PHONE` and
   `DEMO_SIGNIN_CODE` are set on the api component in DigitalOcean (the code as a secret). It
   opens a demo account with the banner "Demo account — no real orders": a demo Shopper, or a
   demo Runner if the reviewer signs in on the Runner page. Demo orders go through the whole
   flow to the confirmation and the one yes, but are never sent to Stripe, so no card is charged,
   and never reach a Runner; cards cannot be added and nothing can be bought on it. Ten wrong
   codes in a quarter of an hour rest it. **Anthony**: choose a UK mobile number nobody uses
   (one of Ofcom's drama numbers, 07700 900000 to 07700 900999, is fine) and a code of six
   digits; set both in DigitalOcean; write the number in docs/store-listing/review-notes.md and
   in App Store Connect and Play Console, and the code **only** in App Store Connect and Play
   Console, never in the repository or a chat.
2. **Runners closing their account in the app.** Built (ruling 60). On the Runner page, under
   More: Close my Runner account, then Yes, close my Runner account; or Close it by talking to
   Ozi; or say "close my Runner account" to Ozi on the Runner page. Refused while a job is in
   hand; the cool bag deposit is paid back; their details are removed after the same days as a
   Shopper's closed account, keeping pay records.
3. **The Recipe Pass and Ozi Plus.** These are digital, so inside an iPhone or Android app Apple
   and Google insist they are sold through their own payment systems, taking 15 percent. The
   simplest choice for the first version is to not sell them inside the store apps: the website
   keeps selling them, and anyone who bought one on the website still has it in the app. The
   other choice is to add Apple's and Google's in-app purchase, which is a bigger job. Anthony
   to choose; Claude recommends the first.
4. **Let the apps talk to the API.** Inside the apps, the page's address is the phone itself, so
   the API must accept it. In DigitalOcean, on the api component, add two addresses to the end of
   ALLOWED_ORIGIN, after a comma each: capacitor colon slash slash localhost, which is the iPhone
   app, and https colon slash slash localhost, which is the Android app. Keep
   https://ozidelivery.co.uk first. Anthony, or Claude talking him through it.
5. **A real email address and telephone number.** Both stores show a contact email, and Apple
   needs a support page with real contact details. config/store.json still has placeholders for
   both. Anthony to set up the mailbox and the number; Claude to switch them on.
6. **Notifications in the apps.** The website's notifications do not reach an iPhone app, so the
   apps need Apple's and Google's own notification services, which means a free Firebase project
   for Android and a small change to the server. The apps work without it; order updates are
   still shown and spoken in the app. Can follow in the second version.
7. **Paying by card inside the iPhone app.** Must be tried on TestFlight before submitting. If
   Stripe's card form misbehaves inside the app, the fix is to build the app with APP_LIVE_URL
   set to https://ozidelivery.co.uk, so it opens the live website inside the app instead of its
   own copy. Claude can switch that.

## Part 5. The keys and secrets, and where they go

The build workflow on GitHub needs these, added by Anthony in GitHub: the aldilivery repository,
Settings, Secrets and variables, Actions, New repository secret. Each is named exactly as below.

For Android:

1. **ANDROID_KEYSTORE_BASE64**: the upload key, a file that proves an update came from us. It is
   made once, on any computer with Java, with this command, typed in a terminal by Yvette or by
   Claude in a Claude Code session on Anthony's own computer, all on one line:

   `keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`

   It asks for a password: Anthony chooses it and keeps it in his password manager. The file is
   then turned into text with `base64 -i upload.keystore` on a Mac, or
   `base64 -w0 upload.keystore` on Linux, and that text is pasted as this secret. Keep the file and its password safe and backed up in
   two places. If it is lost, Google can reset it, but it takes days.
2. **ANDROID_KEYSTORE_PASSWORD**: that password.
3. **ANDROID_KEY_ALIAS**: the word upload.
4. **ANDROID_KEY_PASSWORD**: the same password again, unless a different one was chosen for the
   key.
5. **GOOGLE_SERVICES_JSON_BASE64**: optional, for notifications later (Part 4, step 6).

For the iPhone:

1. **APPLE_TEAM_ID**: ten letters and numbers, shown in the Apple Developer website under
   Membership details.
2. **APP_STORE_CONNECT_API_KEY_ID**, **APP_STORE_CONNECT_API_ISSUER_ID** and
   **APP_STORE_CONNECT_API_KEY_BASE64**: a key that lets GitHub's Mac build and sign the app
   without a person at the Mac. Made in App Store Connect: Users and Access, Integrations, App
   Store Connect API, Team Keys, the add button. Name it GitHub builds, and give it the **Admin**
   role, which Apple needs for the Mac to make its own signing certificate. Download the key
   file; Apple allows this only once. The Key ID is shown next to the key, and the Issuer ID
   above the list. Turn the file into text the same way, `base64 -i` followed by the file's
   name, and paste that as APP_STORE_CONNECT_API_KEY_BASE64.

## Part 6. The App Store, step by step

1. **Anthony**: check the company details on the D-U-N-S record (OZIDELIVERY LTD, 107 King
   Street, Gillingham ME7 1ER, number 235209172) match Companies House (Part 2).
2. **Anthony**: make sure his Apple ID has two-factor authentication on, and uses an email
   address he reads. A company email address on ozidelivery.co.uk is better, because Apple may
   ask for one that matches the website.
3. **Anthony, with Yvette**: enrol in the Apple Developer Program as an **organisation**. The
   easiest way is the Apple Developer app on the iPhone, which works with VoiceOver: Account,
   Enroll Now. Or developer.apple.com/programs/enroll in Safari. Give the company's legal name
   exactly as on the D-U-N-S record, **OZIDELIVERY LTD**, the D-U-N-S number 235209172, the website https://ozidelivery.co.uk, and say
   Anthony is the director with authority to sign. Pay the yearly fee.
4. **Anthony**: Apple may ring to confirm he works for the company and can sign for it. Approval
   usually takes from a day to two weeks.
5. **Anthony**: in App Store Connect (appstoreconnect.apple.com), accept the agreements it shows.
   For a free app nothing about tax or banking is needed.
6. **Anthony, or Claude talking him through it**: register the app's identifier. In the Apple
   Developer website, Certificates, Identifiers and Profiles, Identifiers, add an App ID with the
   Bundle ID **uk.co.ozidelivery.app**, and tick Push Notifications. Then in App Store Connect,
   Apps, the add button, New App: platform iOS, name Ozi Delivery, primary language English (UK),
   that Bundle ID, and SKU ozi-ios. User access: full access.
7. **Anthony**: make the App Store Connect API key and add the four Apple secrets to GitHub
   (Part 5).
8. **Anthony, or Claude**: on GitHub, the aldilivery repository, Actions, **Phone apps for the
   stores**, Run workflow. Choose ios, tick Send to TestFlight, and press Run workflow. It takes
   about 20 minutes. If a secret is missing, it says which.
9. **Anthony and Yvette**: in App Store Connect, the app, TestFlight, add yourselves as internal
   testers. Install the TestFlight app on the iPhone, open the invitation, and install. Test with
   VoiceOver: sign in, order, the card form (Part 4, step 7), Ozi's microphone, photos, and
   pinch to zoom.
10. **Anthony with Yvette, or Claude pasting**: fill in the store page from docs/store-listing:
    the name, subtitle, description, keywords, support and privacy addresses, App Privacy
    (apple-privacy.md), age rating (age-rating.md), screenshots (screenshots.md) and the review
    notes and sign-in (review-notes.md). Under Pricing and Availability: free, and the **United
    Kingdom** only to begin with, which also avoids the European Union's trader rules for now.
11. **Anthony**: choose the TestFlight build for the version, then Add for Review, then Submit.
    Most reviews finish within one to three days. If Apple rejects it, the message says why;
    share it with Claude.
12. **Anthony**: when approved, press Release, or set it to release by itself.

## Part 7. Google Play, step by step

1. **Anthony**: sign up at play.google.com/console as an **organisation**, with the company's
   name exactly as on the D-U-N-S record, **OZIDELIVERY LTD**, the D-U-N-S number 235209172, the website and a contact email and telephone number. Pay the one-off
   fee.
2. **Anthony, with Yvette**: Google checks identity: it may ask for a photo of Anthony's passport
   or driving licence, and confirms the email and telephone number with codes. It can take a few
   days.
3. **Anthony, with Yvette or Claude**: make the upload key and add the Android secrets to GitHub
   (Part 5).
4. **Anthony, or Claude**: on GitHub, Actions, Phone apps for the stores, Run workflow, choose
   android. When it finishes, open the run and download **android-app** from the bottom of the
   page. It holds two files: the .aab for Google Play, and an .apk that can be put straight on an
   Android phone for testing.
5. **Anthony**: in the Play Console, Create app: name Ozi Delivery, default language English
   (United Kingdom), App, Free, and tick the declarations.
6. **Anthony**: under Test and release, Testing, **Internal testing**, create a release and upload
   the .aab. Accept **Play App Signing** when asked, which means Google keeps the final signing
   key safe. Add Anthony and Yvette as testers by email, open the link on the phone, and install.
   Test with TalkBack, as for the iPhone.
7. **Anthony with Yvette, or Claude pasting**: fill in **App content** from
   docs/store-listing/google-data-safety.md and age-rating.md (privacy policy, app access with the
   review sign-in, ads, content rating, target audience 18 and over, data safety, and the delete
   account address). Then the **Store listing**: name, short and full description
   (description.md), the icon and feature graphic (docs/store-listing/images), and the phone
   screenshots.
8. **Anthony**: under Production, create a release with the same .aab (or a newer one), choose
   **United Kingdom** under Countries, and send it for review. A new app's first review can take
   up to a week.
9. **Anthony**: when approved, it goes live by itself, unless you chose managed publishing.

## Part 8. Every later update

1. Claude makes the change on the website as usual; it goes live on the website at once.
2. Because the apps carry their own copy of the website, they need a new build to pick up
   changes: run the workflow again (it numbers each build by itself). For Android, upload the new
   .aab as a new release; for the iPhone, tick Send to TestFlight, then choose the new build in
   App Store Connect and submit it.
3. Change the version people see (such as 1.0.1) in the workflow's version box, or in
   packages/mobile/package.json.

## Part 9. For a developer: how the apps are made

- The apps live in packages/mobile and use Capacitor 8. The native iOS and Android projects are
  **generated**, into packages/mobile/build, every time, by `pnpm --filter mobile build`, and are
  never committed. This keeps the product name out of the code (Rule Nine): it is written into
  the projects at build time from config/store.json. The identifier is `mobileApp.appId` in
  config/store.json (uk.co.ozidelivery.app); once published it must never change.
- `pnpm --filter mobile build` builds the shared core and the web app (pointing it at
  https://ozidelivery.co.uk/api), makes build/ios and build/android with `cap add` if they are
  missing, writes in the name, version numbers and permission wording
  (packages/mobile/scripts/native-settings.ts), and copies everything in with `cap sync`. Add
  `--ios` or `--android` for one only, `--quick` to skip the web app's lint and tests, and
  `--assets` to make every icon and splash size from packages/mobile/assets (this downloads
  @capacitor/assets). None of this needs a Mac; opening build/ios in Xcode does
  (`pnpm --filter mobile open:ios`). Android Studio opens build/android
  (`pnpm --filter mobile open:android`).
- APP_VERSION and APP_BUILD_NUMBER set the version; by default the build number counts minutes
  since 2026 began, so it always goes up. APP_LIVE_URL makes the app open the live website
  instead of its own copy. APP_ID builds a test copy under another identifier.
- Plugins included: push notifications, haptics, status bar, splash screen, camera and
  geolocation. The permission wording for the microphone, speech recognition, camera, photos and
  location is in native-settings.ts and is checked by packages/mobile/test.
- The workflow is .github/workflows/store-apps.yml. It runs only when someone presses Run
  workflow, never on a push.
- When native code is needed, for calls that ring on a locked phone (Section F, CallKit and
  ConnectionService), the generated projects will need to be committed, with the name moved into
  a generated settings file so Rule Nine still holds. That is a decision for then.
