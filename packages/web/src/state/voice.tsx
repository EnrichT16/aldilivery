import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  listenOnce,
  voiceEngine,
  type LanguageTag,
  type SpeakOutcome,
  type VoiceEngine,
} from '../voice';

/**
 * Ozi's voice, for the whole app.
 *
 * Ozi speaks aloud by default, from the first launch (docs/BUILD_PROMPT.md, Section E): the
 * product is for people who cannot see the screen, so silence is the wrong default. Muting is a
 * setting for sighted Shoppers. It is in Settings, found rather than offered: nothing ever asks
 * whether to mute.
 *
 * Settings are kept on this device for now. They will move to the account with the language
 * module, so they follow the Shopper to a new phone.
 */

export interface VoiceSettings {
  /** False unless the Shopper has turned Ozi's speech off in Settings. */
  muted: boolean;
  /** The language Ozi speaks and listens in. English until the language module. */
  language: LanguageTag;
  /** The chosen output voice for each language, if the Shopper has chosen one. */
  voiceIds: Record<LanguageTag, string>;
}

const DEFAULTS: VoiceSettings = { muted: false, language: 'en-GB', voiceIds: {} };
const STORAGE_KEY = 'ozidelivery.voice.settings';

function readSettings(): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      muted: parsed.muted === true,
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULTS.language,
      voiceIds: typeof parsed.voiceIds === 'object' && parsed.voiceIds ? parsed.voiceIds : {},
    };
  } catch {
    return DEFAULTS;
  }
}

function writeSettings(settings: VoiceSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A browser that will not store anything keeps the setting for this visit only.
  }
}

interface VoiceValue {
  engine: VoiceEngine;
  settings: VoiceSettings;
  /**
   * Whether Ozi's words are spoken aloud: not muted, and the engine can speak here. When they
   * are, the screen shows them without also announcing them, so a screen reader and Ozi do not
   * talk over each other. When they are not, the screen announces them instead.
   */
  speaking: boolean;
  /** Say something, unless muted. `not-spoken` when muted or it could not be said. */
  say: (text: string) => Promise<SpeakOutcome>;
  /** Stop speaking now. */
  interrupt: () => void;
  /** Listen once and resolve with what was said. */
  listen: () => Promise<string>;
  update: (patch: Partial<VoiceSettings>) => void;
}

const VoiceContext = createContext<VoiceValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<VoiceSettings>(readSettings);
  const engine = voiceEngine();
  // Until the engine says otherwise, assume it cannot speak, so nothing goes unannounced.
  const [canSpeak, setCanSpeak] = useState(false);

  useEffect(() => {
    let cancelled = false;
    engine
      .readiness(settings.language)
      .then((ready) => {
        if (!cancelled) setCanSpeak(ready.canSpeak);
      })
      .catch(() => {
        if (!cancelled) setCanSpeak(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, settings.language]);

  const update = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writeSettings(next);
      return next;
    });
  }, []);

  const say = useCallback(
    async (text: string): Promise<SpeakOutcome> => {
      if (settings.muted) return 'not-spoken';
      const voiceId = settings.voiceIds[settings.language];
      const outcome = await engine.speak(text, {
        language: settings.language,
        ...(voiceId ? { voiceId } : {}),
      });
      // Speech that failed once is not trusted again: the screen announces from now on.
      if (outcome === 'not-spoken') setCanSpeak(false);
      return outcome;
    },
    [engine, settings],
  );

  const interrupt = useCallback(() => {
    engine.interrupt();
  }, [engine]);

  const listen = useCallback(
    () => listenOnce(engine, settings.language),
    [engine, settings.language],
  );

  const value = useMemo<VoiceValue>(
    () => ({
      engine,
      settings,
      speaking: !settings.muted && canSpeak,
      say,
      interrupt,
      listen,
      update,
    }),
    [engine, settings, canSpeak, say, interrupt, listen, update],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceValue {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('useVoice must be used inside VoiceProvider.');
  return value;
}
