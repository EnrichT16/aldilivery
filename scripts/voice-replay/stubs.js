// Injected before any page script: a phone that can hear and speak, under the test's control.
// window.__ozi.say(text) is a person speaking; window.__spoken is everything Ozi said aloud.
(() => {
  const spoken = [];
  window.__spoken = spoken;
  let active = null;
  const queue = [];

  class FakeRecognition {
    constructor() {
      this.lang = 'en-GB';
      this.interimResults = true;
      this.continuous = false;
      this.maxAlternatives = 1;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this._running = false;
    }
    start() {
      if (active && active !== this) active._finish();
      active = this;
      this._running = true;
      window.__listening = true;
      if (queue.length > 0) {
        const text = queue.shift();
        setTimeout(() => this._deliver(text), 50);
      }
    }
    _deliver(text) {
      if (!this._running) return;
      const result = [{ transcript: text, confidence: 0.9 }];
      result.isFinal = true;
      const event = { results: [result], resultIndex: 0 };
      this.onresult?.(event);
      this._finish();
    }
    _finish() {
      if (!this._running) return;
      this._running = false;
      if (active === this) active = null;
      window.__listening = false;
      this.onend?.();
    }
    stop() {
      this._finish();
    }
    abort() {
      this._finish();
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  window.__ozi = {
    say(text) {
      if (active && active._running) active._deliver(text);
      else queue.push(text);
    },
    listening() {
      return !!(active && active._running);
    },
  };

  const voice = { voiceURI: 'fake-en-GB', name: 'Fake British', lang: 'en-GB', default: true, localService: true };
  const listeners = {};
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [voice],
    addEventListener: (name, fn) => ((listeners[name] = listeners[name] || []).push(fn)),
    removeEventListener: () => {},
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    speak: (utterance) => {
      spoken.push(utterance.text);
      setTimeout(() => {
        utterance.onstart?.({});
        utterance.onend?.({});
      }, 20 + Math.min(400, utterance.text.length * 2));
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      this.lang = 'en-GB';
      this.rate = 1;
      this.voice = null;
      this.onend = null;
      this.onerror = null;
      this.onstart = null;
    }
  };

  const realQuery = navigator.permissions?.query?.bind(navigator.permissions);
  Object.defineProperty(navigator, 'permissions', {
    value: {
      query: async (descriptor) => {
        if (descriptor && descriptor.name === 'microphone') return { state: 'granted', onchange: null };
        return realQuery ? realQuery(descriptor) : { state: 'prompt' };
      },
    },
    configurable: true,
  });
})();
