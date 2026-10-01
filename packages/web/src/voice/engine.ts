/**
 * The voice interface Ozi calls.
 *
 * Speech recognition and speech synthesis are not built inside this product. They belong to
 * Oluoma Voice, a separate product in its own repository (docs/BUILD_PROMPT.md, Section E).
 * Ozi only ever talks to the engine through this interface, so one engine can be swapped for
 * another without touching anything else. docs/OLUOMA_VOICE.md is the same contract written
 * out for the people building Oluoma Voice.
 *
 * Until Oluoma Voice exists, `browser-engine.ts` stands in, using the phone's own speech. Its
 * recognition mistakes are its own: nothing in Ozi is tuned around them (Anthony, 30 Sep
 * 2026), because the real engine will not make them.
 *
 * Every call takes a language, as a BCP 47 tag such as `en-GB` or `cy-GB`, because the
 * language module (Section E) covers spoken output as well as the screen.
 */

/** A BCP 47 language tag: `en-GB`, `cy-GB`, `ig-NG`, `ha-NG`, `yo-NG`, `sw-KE`. */
export type LanguageTag = string;

/** Whether the engine can listen and speak in a language, right now, on this device. */
export interface VoiceReadiness {
  canListen: boolean;
  canSpeak: boolean;
  /** When it cannot, why, in words that can be shown to a Shopper. */
  reason?: string;
}

/** One of the voices a Shopper can choose for a language (Section E: two or three each). */
export interface OutputVoice {
  /** Stable, so a choice can be remembered. */
  id: string;
  /** What the Shopper is shown when choosing. */
  name: string;
  language: LanguageTag;
}

export type VoiceErrorKind =
  /** The Shopper, or their device settings, refused the microphone. */
  | 'not-allowed'
  /** Listening started and nothing was said. */
  | 'no-speech'
  /** The engine needed the network and could not reach it. */
  | 'network'
  /** This device or browser cannot do it at all. */
  | 'unavailable'
  | 'other';

export interface VoiceError {
  kind: VoiceErrorKind;
  message: string;
}

export interface ListenOptions {
  language: LanguageTag;
  /**
   * Recognised text. Called with `isFinal` false as words arrive, if the engine can, and once
   * with `isFinal` true when the Shopper has finished speaking.
   */
  onText: (text: string, isFinal: boolean) => void;
  /** Listening has stopped, for whatever reason. Always called, exactly once. */
  onEnd?: () => void;
  onError?: (error: VoiceError) => void;
}

export interface SpeakOptions {
  language: LanguageTag;
  /** One of `voices(language)`. The engine's own default when absent or not found. */
  voiceId?: string;
}

/**
 * How a `speak` ended. `not-spoken` means the words were never heard: the device cannot
 * speak, the engine failed, or it cannot tell whether it spoke. Ozi then announces the words on
 * the screen instead, so nobody is left in silence.
 */
export type SpeakOutcome = 'finished' | 'interrupted' | 'not-spoken';

export interface VoiceEngine {
  /** Which engine this is, for the log and for Settings. */
  readonly name: string;

  /** Report readiness: whether listening and speaking work in this language here. */
  readiness(language: LanguageTag): Promise<VoiceReadiness>;

  /** Start listening. Recognised text comes back through `options.onText`. */
  startListening(options: ListenOptions): void;

  /** Stop listening now. Any final text already heard is still delivered. */
  stopListening(): void;

  /**
   * Speak the given text. Resolves `finished` when it has been said, `interrupted` if
   * `interrupt` cut it short or another `speak` replaced it, and `not-spoken` if it could not
   * be said. Never rejects.
   */
  speak(text: string, options: SpeakOptions): Promise<SpeakOutcome>;

  /** Stop speaking now, mid-word if need be. */
  interrupt(): void;

  /** The voices available for a language, for the choice in Settings. */
  voices(language: LanguageTag): Promise<OutputVoice[]>;
}

/** Listen once, and resolve with what was said; empty if nothing was. */
export function listenOnce(engine: VoiceEngine, language: LanguageTag): Promise<string> {
  return new Promise((resolve, reject) => {
    let heard = '';
    engine.startListening({
      language,
      onText: (text, isFinal) => {
        if (isFinal) heard = text;
      },
      onError: (error) => {
        if (error.kind === 'no-speech') resolve('');
        else reject(error);
      },
      onEnd: () => {
        resolve(heard);
      },
    });
  });
}
