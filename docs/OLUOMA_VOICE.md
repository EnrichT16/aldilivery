# Oluoma Voice — the interface Ozi Delivery calls

For the team building Oluoma Voice, the separate voice product (docs/BUILD_PROMPT.md, Section E).
Ozi Delivery does not recognise or synthesise speech itself. It calls an engine through the
interface below, and nothing else in Ozi knows which engine is behind it. When Oluoma Voice is
ready, it replaces the stand-in by changing one file: `packages/web/src/voice/index.ts`.

The interface is defined in TypeScript in `packages/web/src/voice/engine.ts`. That file is the
source of truth; this document explains it.

## What the engine must do

| Method | What it does |
| --- | --- |
| `readiness(language)` | Report whether listening and speaking work in that language, now, on this device. When one does not, give a reason in plain words that can be shown to a Shopper. |
| `startListening({ language, onText, onEnd, onError })` | Start listening in that language. Send recognised text through `onText(text, isFinal)`: as words arrive if possible, and once with `isFinal` true when the Shopper has finished. Call `onEnd` exactly once when listening stops, for any reason. |
| `stopListening()` | Stop listening now. Text already heard is still delivered. |
| `speak(text, { language, voiceId })` | Say the text in that language, in the chosen voice, or the engine's own default for the language. Resolve `finished` when it has been said, `interrupted` if it was cut short, and `not-spoken` if it could not be said or the engine cannot tell that it was. Never reject. On `not-spoken`, Ozi announces the words on the screen instead, so be honest: a sentence reported `finished` that nobody heard leaves a blind Shopper in silence. |
| `interrupt()` | Stop speaking now, mid-word if need be. Ozi uses this whenever the Shopper presses the microphone while Ozi is talking. |
| `wakeWordOnDevice` | A property, not a method: whether the engine can listen for "Hey Ozi" on the phone itself, hearing nothing else and sending nothing anywhere. Only then may Ozi listen while muted, so that "Hey Ozi" can bring it back. A muted Ozi must never be listening to a conversation. The browser stand-in cannot, so it reports `false`; Oluoma Voice is asked to provide this. |
| `voices(language)` | List the output voices for that language: two or three each. Each has a stable `id` that Ozi stores, a `name` the Shopper is shown, and its `language`. |

Errors reported through `onError` have a `kind`: `not-allowed` (the microphone was refused),
`no-speech`, `network`, `unavailable` or `other`, plus a `message` in plain words.

## Languages

Every call takes a BCP 47 language tag. At launch: `en-GB` and `cy-GB` (Welsh). Then `ig-NG`
(Igbo), `ha-NG` (Hausa), `yo-NG` (Yoruba) and `sw-KE` (Swahili). The engine reports through
`readiness` which ones it can do. Adding a language must be a content task, not a code change in
Ozi.

## Accent

There is no accent setting for recognition, and there must never be one. Accent is handled by the
quality of the model, not by a switch that burdens the people it claims to help. Recognition is
expected to be good on Nigerian, Welsh and Kentish English; Anthony's note is that Faster Whisper
is far better on these than a phone's built-in recognition.

Output is different. Offer two or three voices per language, so that, for example, a Nigerian
Shopper can choose Nigerian English over received pronunciation. Ozi shows them in Settings,
beside the language, and plays a sentence in the one chosen.

## The voice itself

- Mid to high pitch: not deep, and not thin.
- Clear newsreader delivery, with even pacing. Never hurried.
- Do not clone any existing commercial assistant's voice.

## How Ozi uses it

- **Ozi speaks aloud by default**, from the first launch. A sighted Shopper can mute it in
  Settings; nothing ever asks whether to.
- **Everything Ozi says is also written on the screen.** While Ozi is speaking aloud, those words
  are shown but not announced, so a screen reader does not talk over Ozi. When Ozi is muted or
  cannot speak, they are announced instead.
- **Ozi's round button** shows whether Ozi is listening: bright green and glowing while it is,
  white with a crossed-out microphone and the word "Muted" when it is not. Muted means the
  engine is not listening at all, unless it reports `wakeWordOnDevice`, in which case it may
  listen for the wake word alone.
- **After the wake word, Ozi stays in listening mode**, so ordering is a back and forth
  conversation rather than separate commands. "Hey Ozi" as a wake word, with the phone locked,
  needs the native apps (Section F) and Oluoma Voice; in the browser today, the conversation
  starts with the microphone button.

## Privacy

Ozi never stores audio. Anything recognised that Ozi keeps is stripped of personal data at the
point of collection, before storage (Section R). That stripping is Ozi's job, not the engine's,
but an engine that sends audio off the device must say so, in `name` or in its documentation, so
Ozi can tell the Shopper.

## The stand-in, until Oluoma Voice exists

`packages/web/src/voice/browser-engine.ts` uses the phone's own speech, through the browser's Web
Speech API:

- Recognition works in Chrome, Edge and Safari, usually by sending audio to the browser maker's
  service. Firefox has none, and says so through `readiness`.
- Speaking works everywhere.
- Its recognition mistakes are its own. Nothing in Ozi is tuned around them, because Oluoma Voice
  will not make them.
