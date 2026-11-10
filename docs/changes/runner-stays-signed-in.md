# A Runner stays signed in and can always send their documents (10 November 2026, ruling 100)

## What Runners said

"The app logs me out within 5 minutes on Chrome." One Runner gave up because he could not send
his documents.

## What was really happening

Nobody was being signed out. The sign-in was still saved on the phone each time. Eight separate
faults made it look and feel like being signed out, and made documents hard to send.

1. **The first screen ignored a signed-in Runner.** The home-screen app opens at `/`, which only
   knew about a signed-in Shopper, so a Runner was shown the doors as if he were a stranger. The
   Runner door (`/runner`) then offered "sign in" without looking for his saved sign-in.
2. **A job notification opened the wrong page.** A job sent by the office opened `/runner`, the
   page for people who have not signed up, instead of `/runner/home`.
3. **The page reloaded itself at the worst moments.** A first ever visit queued a reload (the
   first service worker claiming the page looked like a new version), and a queued reload was
   carried out when the page was hidden. The camera, the file picker, going to Messages for the
   code and the agreement in a new tab all hide the page.
4. **After a reload the sign-up showed an empty form.** The "Now, your documents" step lived only
   in the page's memory. Sending the form again was refused with "There is already a Runner on
   that phone number", with no way forward.
5. **After a reload the sign-in forgot the code step.** People asked for code after code and ran
   into the limit of three in fifteen minutes. The "no account" link on the Runner sign-in also
   led to the Shopper sign-up.
6. **Photos could fail without a useful word.** A photo the phone was slow to open went unshrunk
   and could be larger than the server takes; the server answered that with "Something went wrong
   at our end"; an insurance photo chosen before its date was thrown away; and a send on a poor
   signal showed "Sending…" for ever.
7. **Two refusals five seconds apart could end a sign-in.** The Runner page asks every five
   seconds, so a server restarting for a release could say "your sign-in has ended" twice inside
   one restart.
8. **On an iPhone the browser and the home-screen app keep separate sign-ins.** That is how the
   phone works and no code can join them, but nothing said so.

## What changed

1. `Landing.tsx`: with no Shopper signed in and a Runner's sign-in on the phone, `/` goes
   straight to `/runner/home`. A signed-in Shopper still has `/` (shared phones). `Runner.tsx`:
   the Runner door does the same.
2. `services/allocate.ts`: the notification for a job from the office opens `/runner/home`. No
   other notification sent a Runner to `/runner`.
3. `lib/updates.ts`:
   - a service worker taking over is ignored when the page had none when it opened;
   - a page is never reloaded for being hidden;
   - every automatic reload (new version, safety net, heal) waits while the page is busy: while a
     screen holds reloads (`holdReloads()`, used by uploads and by the code step of signing in),
     for two minutes after a camera or file button is used, and while anything typed has not been
     sent. A waiting reload happens when the page next comes back to the front with nothing in
     hand, or the next time the app is opened. The once-for-each-build rules are unchanged.
4. `RunnerSignUp.tsx`: a Runner already signed in on the phone sees the documents step, and the
   screen and the assistant say "You are signed up. Now your documents." A number that is already
   a Runner's is told so, with a "Sign in instead" button that carries the number to the Runner
   sign-in. The half-filled form (name, number, postcode, introducer's code, ways of delivering)
   is kept for the tab and forgotten once signed up. The tick that agrees is never kept.
5. `SignIn.tsx`: the code step is kept for the tab (number, time sent, Shopper or Runner, text or
   call, the server's sentence) and brought back while under ten minutes old. The code itself is
   never kept. It is forgotten on signing in and on choosing a different number. A Runner with no
   account is sent to `/runner/sign-up`.
6. Uploads:
   - `lib/photo.ts`: when opening the photo times out or fails, the browser is asked once to
     decode the file itself (`createImageBitmap`) before the photo goes as it is;
   - `api/src/app.ts`: a body over its route's limit answers 413, "That photo is too large.
     Please take it again, a little further away.";
   - `DocumentsChecklist.tsx`: an insurance photo chosen before its date is kept, the date is
     asked for, and "Send my insurance" sends both;
   - `lib/api.ts`: a new `upload()` beside `request()` stops a send with no answer after ninety
     seconds, "That took too long to send. Please check your signal and try again.", and holds
     reloads while the file is on its way. Used by a Runner's documents, the receipt photo and
     the evidence for a problem. Nothing that streams or waits long on purpose uses it.
7. `lib/session-guard.ts` is the one place for the sign-out rule: `session_invalid`, said again at
   least twenty seconds later, and then said once more to one direct "me" question. The Runner
   page uses it through `SignOutGuard`; the Shopper, staff, Shop Partner and organisation screens
   through `confirmedSignedOut`, whose wait is now twenty seconds too.
8. `HomeScreenSignInNote.tsx`: on an iPhone or iPad, in a browser tab only, one sentence on the
   Runner sign-in and after sign-up: "the app on your Home Screen keeps its own sign-in, so sign
   in once there too."

## Not done, and why

- **A Shop Partner or organisation is not redirected from `/`.** That sign-in is kept for the tab
  only (session storage), so it is never there when the home-screen app is opened afresh, and the
  page does not know which of the two dashboards to open without asking the server first.
- **The timeout is not on every upload.** Shop Partner product photos, label scans and Ambassador
  documents go through their own helpers in `lib/api.ts`, which was being edited elsewhere; they
  are still protected from reloads by the two-minute rule for camera and file buttons.

## Tests

- `web/test/updates.test.ts`: a first-visit claim does not reload; hidden does not reload; held
  reloads wait and happen on a later return; the file-button and typed-words rules; a heal waits.
- `web/test/sessions.test.tsx`: refusals five seconds apart never sign out; twenty seconds and a
  direct question do; a restart that recovers signs nobody out.
- `web/test/runner-stays-signed-in.test.tsx`: the first screen and the Runner door; sign-up after
  a reload, the 409 and the kept form; the code step after a reload; the insurance photo; the
  upload timeout; the second way to read a photo; the iPhone sentence.
- `api/test/runner-account.test.ts`: the 413 in plain words.
- `api/test/allocate-jobs.test.ts`: the notification opens `/runner/home`.
