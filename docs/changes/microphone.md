# The microphone in one tap (ruling 62, 10 October 2026)

What was built, in plain English. No database migration.

## What went wrong

On a real iPhone, Ozi's round button read "Can't listen" and Ozi said "The microphone is not
allowed for this site. You can allow it in your phone or browser settings.", in a box over the
"Your name" field on the sign-up page. Safari's own "Allow microphone?" question never appeared.

**Why**: Ozi started listening by itself the moment it finished speaking (and straight away on
a return visit), with nobody touching the screen. Safari on an iPhone only asks for the
microphone when a page asks for it straight from a tap. Asked any other way, it refuses
without asking, and reports `not-allowed`, which Ozi then called the person's refusal and sent
them to Settings. With Oluoma Voice the microphone was also asked for only after waiting on
something, so even a tap would not have counted. Separately, an iPhone with Dictation off, or a
page opened inside Instagram, Facebook, Gmail and the like, gives `service-not-allowed`, which
was given the same words.

## What happens now

1. **Ozi may speak first, but listens first only from a tap.** When Ozi first needs to listen,
   it shows one big button at the top of the page, **"Tap to talk to Ozi"**, with the line
   **"Your phone will ask to use the microphone. Tap Allow."**, and says the same. Ozi's round
   button reads "Tap to talk" and does the same thing. The tap asks for the microphone in the
   same moment, so the phone shows its own Allow question.
2. **After that, as before.** Once listening has worked, Ozi listens by itself again. If the
   browser refuses an automatic start, Ozi quietly shows the tap button again; it never calls
   that an error. Where the browser already says the microphone is allowed for the site, no
   tap is needed at all.
3. **Plain words, for the phone in hand**, spoken by Ozi and shown in a note at the top of the
   page that pushes the page down (never over a form field), with a Close button:
   - Refused after a tap, on an iPhone: "Tap the aA button by the web address, then Website
     Settings, then Microphone, Allow." On Android: "Tap the lock by the web address, then
     Permissions, then Microphone, Allow." Then "Or just type, or call us on" our number (just
     "Or just type, or call us." while the number is still a placeholder in config).
   - An iPhone with the speech service off: "Voice needs Dictation switched on: Settings,
     General, Keyboard, Enable Dictation."
   - No voice in the browser at all: "Voice doesn't work in this browser. You can type, or
     open this page in Safari." (Chrome when not on an iPhone).
4. **Inside another app** (Instagram, Facebook, Messenger, LinkedIn, Gmail, the Google app,
   TikTok, Snapchat, X, and any app's built-in browser): a banner, "For Ozi's voice, open this
   page in Safari." (Chrome on Android), with **Copy the link**, and on Android **Open in
   Chrome**. Never shown inside our own App Store or Google Play app.
5. **Typing always works.** Nothing here stands between anybody and the page, and the sign-up
   form never needs the microphone.
6. **Help and install steps** now say "When asked, tap Allow so Ozi can hear you." (the Help
   page's new "Talking to Ozi" section, and the end of both sets of steps in Get the app).

## Where it is

- `packages/web/src/voice/microphone-help.ts`: which browser this is, and every message.
- `packages/web/src/components/MicrophoneHelp.tsx`: the tap button, the note and the banner,
  at the top of every page (`Layout.tsx`).
- `packages/web/src/state/ozi.tsx`: `tapToTalk`, the `needs-tap` state, and the notes.
- `packages/web/src/voice/engine.ts`: `firstListenNeedsTap` and the new `service-not-allowed`
  kind; `browser-engine.ts` and `oluoma-engine.ts` start listening in the same moment they are
  asked.
- Tests: `packages/web/test/microphone.test.tsx`.

## Still to check by hand

Try it on real phones before the flyers go out: iPhone Safari, Android Chrome, and the page
opened from Instagram, Facebook and Gmail.
