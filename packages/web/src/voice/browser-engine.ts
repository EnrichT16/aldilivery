/**
 * The stand-in voice engine: the phone's own speech recognition and voice, behind the Oluoma
 * Voice interface (docs/BUILD_PROMPT.md, Section E). Used when Oluoma Voice is not set up, and
 * whenever it fails (ruling 53).
 *
 * It uses the browser's Web Speech API. Recognition is in Chrome, Edge and Safari, usually by
 * sending audio to the browser maker's own service; Firefox has none, and says so through
 * `readiness`. Speaking is everywhere. Nothing here records, keeps or sends audio anywhere of
 * ours.
 *
 * Nothing in Ozi is tuned to this engine's mistakes. When it mishears, it mishears.
 *
 * Chrome, checked on 3 November 2026 (ruling 95: the app must work well in Chrome, Safari and
 * most browsers):
 *
 * - On a desktop, `speechSynthesis.getVoices()` is empty until `voiceschanged` fires, often
 *   after the first call. `loadVoices` waits for that event, briefly; a sentence is never lost,
 *   only said in the browser's own voice if the list is still empty.
 * - Recognition stops by itself after a few seconds of silence (`no-speech`), and after about a
 *   minute whatever happens. Both come through `onError` as `no-speech` and `onEnd`, never as a
 *   fault: Ozi (`state/ozi.tsx`) starts listening again a quarter of a second later, without a
 *   word. Stopping on purpose (`aborted`) is not reported at all.
 * - Nothing is said aloud before the person has touched the page once: the utterance fails with
 *   `not-allowed`, which is kept out of `speechFailed` so the next sentence, after a tap, works.
 *   The microphone, likewise, is first asked for inside a tap (ruling 62).
 */

import {
  SPEAKING_RATE,
  microphoneAlreadyAllowed,
  type LanguageTag,
  type ListenOptions,
  type OutputVoice,
  type SpeakOptions,
  type SpeakOutcome,
  type VoiceEngine,
  type VoiceErrorKind,
  type VoiceReadiness,
} from './engine';

/* The parts of the Web Speech API used here. Not in every TypeScript DOM library. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function synthesis(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : undefined;
}

const ERROR_KINDS: Record<string, VoiceErrorKind> = {
  'not-allowed': 'not-allowed',
  'service-not-allowed': 'service-not-allowed',
  'no-speech': 'no-speech',
  network: 'network',
  'audio-capture': 'unavailable',
  'language-not-supported': 'unavailable',
};

const ERROR_WORDS: Record<VoiceErrorKind, string> = {
  // Plain words only: Ozi itself chooses the instruction for the phone in hand (ruling 62).
  'not-allowed': 'The microphone is not allowed for this site.',
  'service-not-allowed': 'Voice is switched off in this browser.',
  'no-speech': 'I did not hear anything.',
  network: 'I could not reach the speech service. Please check your connection.',
  unavailable: 'This phone or browser cannot listen.',
  other: 'Something went wrong while listening.',
};

/** Voices take a moment to load in some browsers; wait for them, briefly. */
function loadVoices(speech: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = speech.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const settle = (): void => {
      speech.removeEventListener('voiceschanged', changed);
      window.clearTimeout(timer);
      resolve(speech.getVoices());
    };
    // Chrome can fire this once with the list still empty, then again with the voices.
    const changed = (): void => {
      if (speech.getVoices().length > 0) settle();
    };
    speech.addEventListener('voiceschanged', changed);
    const timer = window.setTimeout(settle, 1500);
  });
}

/**
 * How natural a voice is likely to sound, from its name (ruling 99, 10 November 2026: Ozi "sounds
 * like an eighteenth-century robot"). A phone's default voice is often its oldest and most
 * mechanical, while a far better one is already installed beside it: the makers mark those
 * "Natural", "Neural", "Premium" or "Enhanced", and the browser's own online voices are better
 * than the compact ones. The old novelty voices are never chosen. Higher is better.
 */
export function voiceQuality(voice: {
  name: string;
  voiceURI: string;
  localService?: boolean;
}): number {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  if (
    /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|kathy|junior|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/.test(
      name,
    )
  ) {
    return -5;
  }
  let score = 0;
  if (/natural|neural/.test(name)) score += 6;
  if (/premium/.test(name)) score += 5;
  if (/enhanced/.test(name)) score += 4;
  if (/siri/.test(name)) score += 4;
  if (/\bgoogle\b/.test(name)) score += 3;
  if (/online/.test(name)) score += 2;
  if (/compact|espeak|festival|pico/.test(name)) score -= 3;
  return score;
}

/** The best voice for a language: an exact match of the accent first, then the most natural. */
export function bestVoice<
  V extends { name: string; voiceURI: string; lang: string; default?: boolean },
>(voices: readonly V[], wanted: LanguageTag): V | undefined {
  const exact = (voice: V): boolean =>
    voice.lang.toLowerCase().replace('_', '-') === wanted.toLowerCase();
  return voices
    .filter((voice) => sameLanguage(voice.lang, wanted))
    .map((voice, index) => ({
      voice,
      index,
      score: voiceQuality(voice) + (exact(voice) ? 10 : 0) + (voice.default ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.voice;
}

function sameLanguage(voiceLang: string, wanted: LanguageTag): boolean {
  const a = voiceLang.toLowerCase().replace('_', '-');
  const b = wanted.toLowerCase();
  return a === b || a.split('-')[0] === b.split('-')[0];
}

/**
 * Wakes the phone's speech from inside a tap (13 November 2026, Anthony: after tapping and
 * allowing the microphone, Ozi's words were on the screen but not spoken until he turned "talks
 * out loud" off and on again). A phone only lets a page speak when the first words are started
 * in the very moment of a touch; Ozi's first words came a little later, after the microphone
 * question, so the phone dropped them in silence. A silent word said at the touch itself opens
 * the way, and everything after it is heard. Safe to call at every touch.
 */
export function primeSpeech(): void {
  try {
    const speech = synthesis();
    if (!speech) return;
    speech.resume();
    if (speech.speaking || speech.pending) return;
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0;
    speech.speak(silent);
  } catch {
    // A browser that will not: the next real sentence says so in its own way.
  }
}

/** One sentence handed to the synthesiser and not yet finished. */
interface Saying {
  text: string;
  resolve: (outcome: SpeakOutcome) => void;
  safety: number;
}

export function browserVoiceEngine(): VoiceEngine {
  let recognition: Recognition | null = null;
  // Set once speaking has failed on this device, so readiness stops claiming it can.
  let speechFailed = false;
  // The sentences being said or waiting their turn, oldest first (ruling 92): one reply's
  // sentences queue up behind each other; a new reply, or an interruption, clears them all.
  const sayings: Saying[] = [];

  function finish(saying: Saying, outcome: SpeakOutcome): void {
    const at = sayings.indexOf(saying);
    if (at === -1) return;
    sayings.splice(at, 1);
    window.clearTimeout(saying.safety);
    saying.resolve(outcome);
  }

  function finishAll(outcome: SpeakOutcome): void {
    for (const saying of [...sayings]) finish(saying, outcome);
  }

  return {
    name: 'The phone’s own speech',
    wakeWordOnDevice: false,

    async readiness(): Promise<VoiceReadiness> {
      const canListen = recognitionConstructor() !== undefined;
      const canSpeak = synthesis() !== undefined && !speechFailed;
      return {
        canListen,
        canSpeak,
        ...(canListen ? {} : { reason: 'This browser cannot listen. Chrome, Edge or Safari can.' }),
      };
    },

    // The first listening of a visit waits for a tap, so the browser shows its own "Allow
    // microphone?" question (ruling 62), unless the microphone is already allowed.
    async firstListenNeedsTap(): Promise<boolean> {
      return !(await microphoneAlreadyAllowed());
    },

    /**
     * Starts straight away, in the same moment it is called, with nothing awaited first: called
     * from a tap, the browser counts it as the person's own doing and asks for the microphone.
     */
    startListening(options: ListenOptions): void {
      const Constructor = recognitionConstructor();
      if (!Constructor) {
        options.onError?.({ kind: 'unavailable', message: ERROR_WORDS.unavailable });
        options.onEnd?.();
        return;
      }
      recognition?.abort();
      const current = new Constructor();
      recognition = current;
      current.lang = options.language;
      current.interimResults = true;
      current.continuous = false;
      current.maxAlternatives = 1;

      let ended = false;
      current.onresult = (event) => {
        let text = '';
        let isFinal = false;
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i] as RecognitionResult;
          text += result[0].transcript;
          isFinal = result.isFinal;
        }
        options.onText(text.trim(), isFinal);
      };
      current.onerror = (event) => {
        const kind = ERROR_KINDS[event.error] ?? 'other';
        // Stopping on purpose is not an error worth reporting.
        if (event.error === 'aborted') return;
        options.onError?.({ kind, message: ERROR_WORDS[kind] });
      };
      current.onend = () => {
        if (ended) return;
        ended = true;
        if (recognition === current) recognition = null;
        options.onEnd?.();
      };
      try {
        current.start();
      } catch {
        // Some browsers throw rather than report, when they will not start without a tap.
        options.onError?.({ kind: 'not-allowed', message: ERROR_WORDS['not-allowed'] });
        current.onend?.();
      }
    },

    stopListening(): void {
      recognition?.stop();
    },

    async speak(text: string, options: SpeakOptions): Promise<SpeakOutcome> {
      const speech = synthesis();
      if (text.trim() === '') return 'finished';
      if (!speech || speechFailed) return 'not-spoken';
      // A new sentence replaces whatever was being said, unless it is the next sentence of the
      // same reply (ruling 92), which waits its turn on the synthesiser: no cancel, no click.
      if (!options.queue) {
        finishAll('interrupted');
        speech.cancel();
      }
      // How long the sentences ahead of this one may take, so its safety timer waits for them.
      const ahead = sayings.reduce((sum, saying) => sum + saying.text.length, 0);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.language;
      // Even pacing (Section E): the platform's normal rate, not hurried.
      utterance.rate = SPEAKING_RATE;
      const voices = await loadVoices(speech);
      const chosen =
        voices.find((voice) => voice.voiceURI === options.voiceId) ??
        // The most natural voice the phone has for the language, not merely its default.
        bestVoice(voices, options.language);
      if (chosen) utterance.voice = chosen;

      return new Promise((resolve) => {
        // Some devices never report the end of speech: one with no voice installed, or a
        // browser that drops the sentence. A conversation must never hang on that, so a timer
        // sized to the sentence (and any ahead of it) ends the wait regardless. Found in a real
        // browser, 1 Oct 2026.
        const saying: Saying = {
          text,
          resolve,
          safety: window.setTimeout(
            () => {
              if (!sayings.includes(saying)) return;
              finish(saying, 'not-spoken');
              speech.cancel();
            },
            3000 + (text.length + ahead) * 90,
          ),
        };
        sayings.push(saying);
        utterance.onend = () => finish(saying, 'finished');
        utterance.onerror = (event) => {
          if (!sayings.includes(saying)) return;
          // Cut short on purpose, or a real failure. A device with no voice installed fails
          // every sentence at once with `synthesis-failed`. Found in a real browser, 1 Oct 2026.
          const error = (event as { error?: string }).error;
          if (error === 'interrupted' || error === 'canceled') {
            finish(saying, 'interrupted');
          } else if (error === 'not-allowed') {
            // The browser will not speak until the person has touched the page once. Not a
            // broken device: the next sentence, after a touch, will work.
            finish(saying, 'not-spoken');
          } else {
            speechFailed = true;
            finish(saying, 'not-spoken');
          }
        };
        speech.speak(utterance);
      });
    },

    // Somebody speaking over Ozi (barge-in), or a tap: everything stops at once, queued or not.
    interrupt(): void {
      finishAll('interrupted');
      synthesis()?.cancel();
    },

    async voices(language: LanguageTag): Promise<OutputVoice[]> {
      const speech = synthesis();
      if (!speech) return [];
      const all = await loadVoices(speech);
      return (
        all
          .filter((voice) => sameLanguage(voice.lang, language) && voiceQuality(voice) >= 0)
          // The most natural first, so the first in Settings is the one Ozi uses.
          .sort((a, b) => voiceQuality(b) - voiceQuality(a))
          .map((voice) => ({ id: voice.voiceURI, name: voice.name, language: voice.lang }))
      );
    },
  };
}
