/**
 * Ozi's voice, through the Oluoma Voice interface (docs/BUILD_PROMPT.md, Section E).
 *
 * The screens are tested against a stand-in engine that records what Ozi was asked to say and
 * lets the test decide what the Shopper said. The browser stand-in itself is tested against a
 * fake of the browser's speech API, because jsdom has none.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { browserVoiceEngine } from '../src/voice/browser-engine';
import {
  setVoiceEngine,
  type ListenOptions,
  type SpeakOptions,
  type VoiceEngine,
} from '../src/voice';
import { stubApi } from './setup';

const assistant = storeConfig.assistantName;

interface FakeEngine extends VoiceEngine {
  spoken: Array<{ text: string; options: SpeakOptions }>;
  listening: ListenOptions | null;
  /** The Shopper says something; empty means they said nothing. */
  hear: (text: string) => void;
  interrupted: number;
}

function fakeEngine(options: { canListen?: boolean; holdSpeech?: boolean } = {}): FakeEngine {
  let release: (() => void) | null = null;
  const engine: FakeEngine = {
    name: 'A test engine',
    spoken: [],
    listening: null,
    interrupted: 0,
    readiness: async () => ({ canListen: options.canListen ?? true, canSpeak: true }),
    startListening(listen) {
      engine.listening = listen;
    },
    stopListening() {
      const current = engine.listening;
      engine.listening = null;
      current?.onEnd?.();
    },
    speak(text, speakOptions) {
      engine.spoken.push({ text, options: speakOptions });
      if (!options.holdSpeech) return Promise.resolve('finished');
      return new Promise((resolve) => {
        release = () => {
          resolve('interrupted');
        };
      });
    },
    interrupt() {
      engine.interrupted += 1;
      release?.();
    },
    voices: async (language) => [
      { id: 'voice-ng', name: 'Nigerian English', language },
      { id: 'voice-gb', name: 'British English', language },
    ],
    hear(text) {
      const current = engine.listening;
      engine.listening = null;
      if (text !== '') current?.onText(text, true);
      current?.onEnd?.();
    },
  };
  return engine;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  setVoiceEngine(null);
});

describe('the microphone', () => {
  it('greets the Shopper aloud, listens, and answers what it heard', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    expect(engine.spoken[0]).toEqual({
      text: `Hello, I am ${assistant}. What would you like?`,
      options: { language: 'en-GB' },
    });
    expect(screen.getByRole('button', { name: 'Listening. Press to stop' })).toBeInTheDocument();

    act(() => {
      engine.hear('bananas and grapes');
    });
    expect(await screen.findByText('You said: bananas and grapes')).toBeInTheDocument();
    await waitFor(() => {
      expect(engine.spoken[1]?.text).toMatch(/^You said: bananas and grapes\./);
    });
    // Ozi is speaking aloud, so its words are shown but not announced over its voice.
    expect(screen.getByText(/^You said: bananas and grapes\. Ordering/)).toHaveAttribute(
      'aria-live',
      'off',
    );
  });

  it('stops talking at once when pressed while it is speaking', async () => {
    const engine = fakeEngine({ holdSpeech: true });
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    await user.click(await screen.findByRole('button', { name: `Stop ${assistant} talking` }));
    expect(engine.interrupted).toBe(1);
    expect(engine.listening).toBeNull();
    expect(screen.getByRole('button', { name: 'Say what you need' })).toBeInTheDocument();
  });

  it('announces its words on the screen when the phone cannot actually speak them', async () => {
    const engine = fakeEngine();
    engine.speak = (text, options) => {
      engine.spoken.push({ text, options });
      return Promise.resolve('not-spoken');
    };
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    const greeting = await screen.findByText(`Hello, I am ${assistant}. What would you like?`);
    await waitFor(() => {
      expect(greeting).toHaveAttribute('aria-live', 'polite');
    });
    // And the conversation carries on rather than hanging.
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
  });

  it('says so when nothing was heard', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('');
    });
    await waitFor(() => {
      expect(engine.spoken[1]?.text).toMatch(/^I did not hear anything/);
    });
  });
});

describe('speaking by default, and muting in Settings', () => {
  it('speaks from the first launch, without asking', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/settings');
    expect(await screen.findByLabelText(`${assistant} speaks aloud`)).toBeChecked();
  });

  it('stays quiet once muted, and announces its words on the screen instead', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/settings');

    await user.click(await screen.findByLabelText(`${assistant} speaks aloud`));
    expect(await screen.findByText(new RegExp(`${assistant} will stay quiet`))).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      JSON.parse(window.localStorage.getItem('ozidelivery.voice.settings') ?? '{}'),
    ).toMatchObject({
      muted: true,
    });

    await user.click(screen.getByRole('link', { name: 'Shop' }));
    await user.click(screen.getByRole('link', { name: storeConfig.productName }));
    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    const greeting = await screen.findByText(`Hello, I am ${assistant}. What would you like?`);
    expect(engine.spoken).toEqual([]);
    expect(greeting).toHaveAttribute('aria-live', 'polite');
  });

  it('offers the voices for the language, and says a sentence in the one chosen', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/settings');

    await user.click(await screen.findByLabelText('Nigerian English'));
    expect(engine.spoken.at(-1)).toEqual({
      text: `This is how ${assistant} will sound.`,
      options: { language: 'en-GB', voiceId: 'voice-ng' },
    });
    expect(
      JSON.parse(window.localStorage.getItem('ozidelivery.voice.settings') ?? '{}').voiceIds,
    ).toEqual({ 'en-GB': 'voice-ng' });
  });

  it('has no axe violations', async () => {
    setVoiceEngine(fakeEngine());
    stubApi();
    renderAt('/settings');
    await screen.findByLabelText('Nigerian English');
    const results = await axe.run(document.body, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('the stand-in engine: the phone’s own speech', () => {
  it('reports a device with no voice as not having spoken, and stops claiming it can', async () => {
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        rate = 0;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ voiceURI: 'gb', name: 'British', lang: 'en-GB', default: true }],
      speak: (utterance: { onerror: ((event: { error: string }) => void) | null }) => {
        utterance.onerror?.({ error: 'synthesis-failed' });
      },
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const engine = browserVoiceEngine();
    expect((await engine.readiness('en-GB')).canSpeak).toBe(true);
    await expect(engine.speak('Hello', { language: 'en-GB' })).resolves.toBe('not-spoken');
    expect((await engine.readiness('en-GB')).canSpeak).toBe(false);
  });

  it('never hangs on a device that does not say when it has finished speaking', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'SpeechSynthesisUtterance',
        class {
          lang = '';
          rate = 0;
          voice: unknown = null;
          onend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          constructor(readonly text: string) {}
        },
      );
      const cancel = vi.fn();
      vi.stubGlobal('speechSynthesis', {
        getVoices: () => [{ voiceURI: 'gb', name: 'British', lang: 'en-GB', default: true }],
        // Accepts the sentence and never reports its end.
        speak: () => {},
        cancel,
        addEventListener: () => {},
        removeEventListener: () => {},
      });
      const said = browserVoiceEngine().speak('Hello there', { language: 'en-GB' });
      await vi.advanceTimersByTimeAsync(5000);
      // It cannot tell whether anything was heard, so the screen announces the words.
      await expect(said).resolves.toBe('not-spoken');
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says it cannot listen where the browser has no recognition', async () => {
    expect(await browserVoiceEngine().readiness('en-GB')).toMatchObject({ canListen: false });
  });

  it('listens in the language asked for, and passes on the final words', async () => {
    const instances: Array<Record<string, unknown>> = [];
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = true;
      maxAlternatives = 0;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        instances.push(this as unknown as Record<string, unknown>);
      }
      start() {}
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);

    const engine = browserVoiceEngine();
    expect(await engine.readiness('cy-GB')).toMatchObject({ canListen: true });
    const texts: Array<[string, boolean]> = [];
    let ended = 0;
    engine.startListening({
      language: 'cy-GB',
      onText: (text, isFinal) => texts.push([text, isFinal]),
      onEnd: () => {
        ended += 1;
      },
    });
    const recognition = instances[0] as unknown as FakeRecognition;
    expect(recognition.lang).toBe('cy-GB');
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: ' bara a llaeth ' } }],
    });
    engine.stopListening();
    expect(texts).toEqual([['bara a llaeth', true]]);
    expect(ended).toBe(1);
  });

  it('speaks in the chosen voice, and an interruption cuts it short', async () => {
    const utterances: Array<{ lang: string; voice: unknown; onend: (() => void) | null }> = [];
    const cancel = vi.fn();
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        rate = 0;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    const voices = [
      { voiceURI: 'gb', name: 'British', lang: 'en-GB', default: true },
      { voiceURI: 'ng', name: 'Nigerian', lang: 'en-NG', default: false },
    ];
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      speak: (utterance: (typeof utterances)[number]) => utterances.push(utterance),
      cancel,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    const engine = browserVoiceEngine();
    const said = engine.speak('Hello', { language: 'en-GB', voiceId: 'ng' });
    await waitFor(() => {
      expect(utterances).toHaveLength(1);
    });
    expect(utterances[0]?.voice).toBe(voices[1]);
    engine.interrupt();
    await expect(said).resolves.toBe('interrupted');
    expect(cancel).toHaveBeenCalled();

    expect((await engine.voices('en-GB')).map((v) => v.name)).toEqual(['British', 'Nigerian']);
  });
});
