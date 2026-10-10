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
    const done = (): void => {
      speech.removeEventListener('voiceschanged', done);
      resolve(speech.getVoices());
    };
    speech.addEventListener('voiceschanged', done);
    window.setTimeout(done, 1500);
  });
}

function sameLanguage(voiceLang: string, wanted: LanguageTag): boolean {
  const a = voiceLang.toLowerCase().replace('_', '-');
  const b = wanted.toLowerCase();
  return a === b || a.split('-')[0] === b.split('-')[0];
}

export function browserVoiceEngine(): VoiceEngine {
  let recognition: Recognition | null = null;
  // Set once speaking has failed on this device, so readiness stops claiming it can.
  let speechFailed = false;
  let speakingResolve: ((outcome: SpeakOutcome) => void) | null = null;

  function finishSpeaking(outcome: SpeakOutcome): void {
    const resolve = speakingResolve;
    speakingResolve = null;
    resolve?.(outcome);
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
      // A new sentence replaces whatever was being said.
      finishSpeaking('interrupted');
      speech.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.language;
      // Even pacing (Section E): the platform's normal rate, not hurried.
      utterance.rate = SPEAKING_RATE;
      const voices = await loadVoices(speech);
      const chosen =
        voices.find((voice) => voice.voiceURI === options.voiceId) ??
        voices.find((voice) => sameLanguage(voice.lang, options.language) && voice.default) ??
        voices.find((voice) => sameLanguage(voice.lang, options.language));
      if (chosen) utterance.voice = chosen;

      return new Promise((resolve) => {
        speakingResolve = resolve;
        // Some devices never report the end of speech: one with no voice installed, or a
        // browser that drops the sentence. A conversation must never hang on that, so a timer
        // sized to the sentence ends the wait regardless. Found in a real browser, 1 Oct 2026.
        const safety = window.setTimeout(
          () => {
            if (speakingResolve === resolve) {
              finishSpeaking('not-spoken');
              speech.cancel();
            }
          },
          3000 + text.length * 90,
        );
        utterance.onend = () => {
          window.clearTimeout(safety);
          if (speakingResolve === resolve) finishSpeaking('finished');
        };
        utterance.onerror = (event) => {
          window.clearTimeout(safety);
          if (speakingResolve !== resolve) return;
          // Cut short on purpose, or a real failure. A device with no voice installed fails
          // every sentence at once with `synthesis-failed`. Found in a real browser, 1 Oct 2026.
          const error = (event as { error?: string }).error;
          if (error === 'interrupted' || error === 'canceled') {
            finishSpeaking('interrupted');
          } else if (error === 'not-allowed') {
            // The browser will not speak until the person has touched the page once. Not a
            // broken device: the next sentence, after a touch, will work.
            finishSpeaking('not-spoken');
          } else {
            speechFailed = true;
            finishSpeaking('not-spoken');
          }
        };
        speech.speak(utterance);
      });
    },

    interrupt(): void {
      finishSpeaking('interrupted');
      synthesis()?.cancel();
    },

    async voices(language: LanguageTag): Promise<OutputVoice[]> {
      const speech = synthesis();
      if (!speech) return [];
      const all = await loadVoices(speech);
      return all
        .filter((voice) => sameLanguage(voice.lang, language))
        .map((voice) => ({ id: voice.voiceURI, name: voice.name, language: voice.lang }));
    },
  };
}
