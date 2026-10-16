# Sign-in texts: why "We cannot reach Ozi Delivery" was shown, and the fix (16 October 2026)

## What was happening

For two weeks, pressing "Text me a code" on the live site said "We cannot reach Ozi Delivery
at the moment", while the server answered `/api/health` and `/api/config` perfectly. A request
made from outside (the "Live check" workflow) showed why:

- the server did answer, with a 503 "We could not send a text just now" because Twilio refused
  the send instantly;
- DigitalOcean's edge treats a 503 from the app as the app being down and replaced the reply
  with its own HTML error page (a 504 with `x-do-orig-status: 503`);
- the browser saw HTML where it expected JSON, and the app said "we cannot reach".

So the sentence the server wrote was never shown, and nothing pointed at Twilio.

## What changed

1. `UnavailableError` answers **424 Failed Dependency** instead of 503, so DigitalOcean passes
   the reply through and the person reads the real sentence.
2. When Twilio refuses, Twilio's error **number** (and only the number) comes back in
   `error.details` as `{ provider: "twilio", code: 21212 }`. It names which setting is wrong:
   21212 the sender number, 20003 the account token, 21608 an unverified number on a trial
   account, 21606 a sender that cannot text.
3. `TWILIO_FROM` and `TWILIO_VOICE_FROM` are tidied when read: `07700 900123`, `+44 7700 900123`
   or `0044…` all become `+447700900123`, the only form Twilio accepts. A Messaging Service
   `MG…` or a sender name is left alone.
4. The sign-in page shows the plain sentence and folds the technical reason away under a small
   "Details" disclosure, so the screen stays tidy and a screenshot can still say what failed.
5. With the fix live, the same request from outside answered 424 with
   `{ provider: "twilio", code: 21659 }`: **the number in `TWILIO_FROM` is not one the Twilio
   account owns** (most likely a personal mobile typed in by mistake). So when Twilio refuses the
   sender itself (21659, 21212, 21606), the server now tries once more under the sender name
   `OziDelivery`, which British networks deliver with no number behind it. The setting should
   still be put right: Twilio Console, Phone Numbers, Manage, Active numbers, and that number
   goes in `TWILIO_FROM`.
6. `.github/workflows/live-check.yml`, run by hand from GitHub's Actions tab, makes the same
   requests as the sign-in page from outside and prints status, headers, timing and body. With a
   phone number it asks for a real code (one of that number's three per quarter hour).
