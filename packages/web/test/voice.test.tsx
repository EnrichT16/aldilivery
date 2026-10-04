/**
 * Ozi's voice, through the Oluoma Voice interface (docs/BUILD_PROMPT.md, Section E), and Ozi's
 * presence on every screen as Anthony described it on 1 Oct 2026: speaking on the first launch,
 * the glowing round button, muting by press or by voice, gentle reminders, and a button that
 * can be moved.
 *
 * The screens are tested against a stand-in engine that records what Ozi was asked to say and
 * lets the test decide what the Shopper said. The browser stand-in itself is tested against a
 * fake of the browser's speech API, because jsdom has none.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { FIRST_REMINDER_MS, LATER_REMINDER_MS } from '../src/state/ozi';
import { browserVoiceEngine } from '../src/voice/browser-engine';
import {
  setVoiceEngine,
  type ListenOptions,
  type SpeakOptions,
  type SpeakOutcome,
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

function fakeEngine(
  options: { canListen?: boolean; holdSpeech?: boolean; outcome?: SpeakOutcome } = {},
): FakeEngine {
  let release: (() => void) | null = null;
  const engine: FakeEngine = {
    name: 'A test engine',
    wakeWordOnDevice: false,
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
      if (!options.holdSpeech) return Promise.resolve(options.outcome ?? 'finished');
      return new Promise((resolve) => {
        release = () => {
          release = null;
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

function firstLaunch(): void {
  window.localStorage.removeItem('ozidelivery.voice.settings');
}

function storedSettings(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem('ozidelivery.voice.settings') ?? '{}') as Record<
    string,
    unknown
  >;
}

function bubble(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the first launch', () => {
  it('introduces itself aloud, with no notification, then listens', async () => {
    firstLaunch();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/');

    await waitFor(() => {
      expect(engine.spoken).toHaveLength(2);
    });
    const intro = engine.spoken[0]!.text;
    // Somebody new is asked straight away whether to open an account, by talking.
    expect(engine.spoken[1]!.text).toMatch(
      /Would you like to open one now, just by talking with me\?/,
    );
    // Anthony's words, 4 October 2026: who Ozi is, the motto, then how to turn it off.
    expect(intro).toMatch(
      new RegExp(`^Hello, I'm ${assistant}, your shopping assistant\\. Send me, I will help\\.`),
    );
    expect(intro).toMatch(
      /turn off the switch at the bottom of the screen, or just say "turn off talking"/,
    );
    expect(intro).toMatch(/use the same switch, or Settings, or say "Hey Ozi, turn on"/);
    expect(intro).toMatch(/just say "repeat"/);
    // The stand-in cannot hear a wake word while its button has paused it, so Ozi does not
    // promise that. "Hey Ozi, turn on" works because turning talking off keeps Ozi listening.
    expect(intro).not.toMatch(/again, or say "Hey Ozi"/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    expect(storedSettings()).toMatchObject({ introHeard: true });
  });

  it('does not introduce itself again', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    expect(engine.spoken.some((s) => /^Hello, I'm/.test(s.text))).toBe(false);
  });

  it('reads the choices on the first screen once a visit, after the introduction', async () => {
    window.sessionStorage.removeItem('ozidelivery.doors.read');
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const view = renderAt('/');
    await waitFor(() => {
      expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(
        /^Hello, I'm Ozi, your shopping assistant\. Send me, I will help\. Who are you\? Shopper: I want my shopping brought to me\. Runner: .* Organisation: .* I look after someone: /,
      );
    });
    view.unmount();
    const again = fakeEngine();
    setVoiceEngine(again);
    renderAt('/');
    await waitFor(() => {
      expect(again.listening).not.toBeNull();
    });
    expect(again.spoken).toEqual([]);
  });

  it('shows and announces the introduction when it could not be spoken', async () => {
    firstLaunch();
    setVoiceEngine(fakeEngine({ outcome: 'not-spoken' }));
    stubApi();
    renderAt('/');
    const shown = await screen.findAllByText(/^Hello, I'm Ozi/);
    const status = shown.find((element) => element.getAttribute('role') === 'status');
    await waitFor(() => {
      expect(status).toHaveAttribute('aria-live', 'polite');
    });
  });
});

describe('the round button', () => {
  it('glows green while listening; pressing mutes it, and it changes in more than colour', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');

    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    expect(bubble('Listening')).toHaveClass('ozi-beaming');
    expect(bubble('Listening')).toHaveAccessibleDescription(/Ozi is listening\. Press to mute\./);

    await user.click(bubble('Listening'));
    await waitFor(() => {
      expect(bubble('Muted')).toBeInTheDocument();
    });
    expect(bubble('Muted')).not.toHaveClass('ozi-beaming');
    expect(bubble('Muted')).toHaveClass('border-dashed');
    expect(engine.listening).toBeNull();
    expect(engine.spoken.at(-1)?.text).toMatch(/^I'm muted now, and not listening/);

    await user.click(bubble('Muted'));
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe("I'm listening. What would you like?");
    });
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
  });

  it('mutes when told to', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('Ozi, mute yourself');
    });
    await waitFor(() => {
      expect(bubble('Muted')).toBeInTheDocument();
    });
  });

  it('does not answer words that were not meant for it, like the television', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('and the weather tomorrow will be lovely');
    });
    expect(
      await screen.findByText('You said: and the weather tomorrow will be lovely'),
    ).toBeInTheDocument();
    expect(engine.spoken).toEqual([]);
  });

  it('stops talking at once when pressed while Ozi is talking', async () => {
    firstLaunch();
    const engine = fakeEngine({ holdSpeech: true });
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await user.click(await screen.findByRole('button', { name: 'Talking' }));
    expect(engine.interrupted).toBe(1);
  });

  it('reminds gently while muted: after two minutes, then every three', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    fireEvent.click(bubble('Listening'));
    await waitFor(() => {
      expect(bubble('Muted')).toBeInTheDocument();
    });
    const before = engine.spoken.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_REMINDER_MS - 1000);
    });
    expect(engine.spoken).toHaveLength(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(engine.spoken.at(-1)?.text).toMatch(
      /^Just a gentle reminder: I'm still here, but I'm muted, and I'm not listening\./,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATER_REMINDER_MS);
    });
    expect(engine.spoken.at(-1)?.text).toMatch(/^I'm still here, resting and not listening\./);
    expect(engine.spoken).toHaveLength(before + 2);
    // Still muted: reminding is not listening.
    expect(engine.listening).toBeNull();
  });

  it('moves with the arrow keys and stays put; Settings puts it back', async () => {
    setVoiceEngine(fakeEngine());
    stubApi();
    const user = userEvent.setup();
    renderAt('/settings');
    await screen.findByRole('button', { name: 'Listening' });

    bubble('Listening').focus();
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    const moved = storedSettings().bubble as { x: number; y: number };
    expect(moved.x).toBeCloseTo(0.87);
    expect(moved.y).toBeCloseTo(0.5);

    await user.click(
      screen.getByRole('button', { name: `Put ${assistant}’s button back in its usual place` }),
    );
    expect(storedSettings().bubble).toBeNull();
  });

  it('moves by dragging, and a drag is never taken for a press', async () => {
    // jsdom has no PointerEvent; a mouse event with a pointer id stands in for it.
    if (typeof window.PointerEvent === 'undefined') {
      vi.stubGlobal(
        'PointerEvent',
        class extends MouseEvent {
          pointerId: number;
          constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
          }
        },
      );
    }
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    const button = bubble('Listening');
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 400 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 600, clientY: 300 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 600, clientY: 300 });
    fireEvent.click(button);

    const placed = storedSettings().bubble as { x: number; y: number };
    expect(placed.x).toBeCloseTo(600 / window.innerWidth);
    expect(bubble('Listening')).toBeInTheDocument();
  });
});

describe('speaking by default, and Settings', () => {
  it('speaks from the first launch, without asking', async () => {
    setVoiceEngine(fakeEngine());
    stubApi();
    renderAt('/settings');
    expect(await screen.findByLabelText(`${assistant} speaks aloud`)).toBeChecked();
  });

  it('stays quiet once its voice is off, and announces its words on the screen instead', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/settings');

    await user.click(await screen.findByLabelText(`${assistant} speaks aloud`));
    expect(storedSettings()).toMatchObject({ muted: true });

    await user.click(await screen.findByRole('button', { name: 'Listening' }));
    const words = await screen.findAllByText(/^I'm muted now, and not listening/);
    expect(engine.spoken).toEqual([]);
    expect(words.find((element) => element.getAttribute('role') === 'status')).toHaveAttribute(
      'aria-live',
      'polite',
    );
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
    expect(storedSettings().voiceIds).toEqual({ 'en-GB': 'voice-ng' });
  });

  it('has no axe violations on Settings or the landing page, with the button showing', async () => {
    const options = {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions;
    setVoiceEngine(fakeEngine());
    stubApi();
    const { unmount } = renderAt('/settings');
    await screen.findByLabelText('Nigerian English');
    await screen.findByRole('button', { name: 'Listening' });
    expect((await axe.run(document.body, options)).violations.map((v) => v.id)).toEqual([]);
    unmount();

    renderAt('/');
    await screen.findByRole('button', { name: 'Listening' });
    expect((await axe.run(document.body, options)).violations.map((v) => v.id)).toEqual([]);
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

  it('cannot hear a wake word while muted, and says so', () => {
    expect(browserVoiceEngine().wakeWordOnDevice).toBe(false);
  });

  it('treats a browser that wants a touch first as not having spoken, without giving up on it', async () => {
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
        utterance.onerror?.({ error: 'not-allowed' });
      },
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    const engine = browserVoiceEngine();
    await expect(engine.speak('Hello', { language: 'en-GB' })).resolves.toBe('not-spoken');
    expect((await engine.readiness('en-GB')).canSpeak).toBe(true);
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
