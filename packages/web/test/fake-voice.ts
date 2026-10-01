/**
 * A stand-in voice engine for tests: it records what Ozi was asked to say, and lets the test
 * say what the Shopper said.
 */

import type { ListenOptions, SpeakOptions, VoiceEngine } from '../src/voice';

export interface FakeEngine extends VoiceEngine {
  spoken: Array<{ text: string; options: SpeakOptions }>;
  listening: ListenOptions | null;
  /** The Shopper says something. */
  hear: (text: string) => void;
}

export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    name: 'A test engine',
    wakeWordOnDevice: false,
    spoken: [],
    listening: null,
    readiness: async () => ({ canListen: true, canSpeak: true }),
    startListening(listen) {
      engine.listening = listen;
    },
    stopListening() {
      const current = engine.listening;
      engine.listening = null;
      current?.onEnd?.();
    },
    speak(text, options) {
      engine.spoken.push({ text, options });
      return Promise.resolve('finished');
    },
    interrupt() {},
    voices: async () => [],
    hear(text) {
      const current = engine.listening;
      engine.listening = null;
      current?.onText(text, true);
      current?.onEnd?.();
    },
  };
  return engine;
}
