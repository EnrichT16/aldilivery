/**
 * Ruling 95 (3 November 2026): the app must work well in Chrome, Safari and most browsers.
 *
 * A copy that will not draw its screen heals itself once and says so plainly; "Reset the app"
 * is on the sign-in pages and in Settings and keeps every sign-in; a visible version sits on
 * every page and Ozi can say it; and Chrome ending a listen for silence never counts as a fault.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { LoadGuard } from '../src/components/LoadGuard';
import { RESET_LINE } from '../src/components/ResetApp';
import { storeConfig } from '../src/config';
import { ASKS_VERSION, appVersion, versionSpoken } from '../src/lib/version';
import { browserVoiceEngine } from '../src/voice/browser-engine';
import { setVoiceEngine, type ListenOptions, type VoiceError } from '../src/voice';
import { fakeEngine } from './fake-voice';
import { stubApi } from './setup';

const resetApp = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/lib/updates', async (original) => ({
  ...(await original<typeof import('../src/lib/updates')>()),
  resetApp,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  resetApp.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the version', () => {
  it('is made from the build: a date-stamped build as the UK day and minute, a commit shortened', () => {
    const stamped = appVersion('2026-11-03T14:05:30.000Z', '2026-11-03T14:05:30.000Z');
    expect(stamped.id).toBe('20261103.1405');
    expect(stamped.words).toBe('Version 20261103.1405, 3 November 2026');
    expect(versionSpoken(stamped)).toBe(
      'This is the version from 3 November 2026, built at 14:05.',
    );

    const commit = appVersion('9fceb02a1b2c3d4e', '2026-11-03T09:00:00.000Z');
    expect(commit.id).toBe('9fceb02');
    expect(commit.words).toBe('Version 9fceb02, 3 November 2026');
    expect(versionSpoken(commit)).toBe('This is version 9 f c e b 0 2, from 3 November 2026.');

    expect(appVersion('9fceb02', 'not a date').words).toBe('Version 9fceb02');
  });

  it('knows the question, and knows what is not it', () => {
    for (const asked of [
      'what version is this',
      'Ozi, which version am I on?',
      "what's the app version",
      'what version of the app is this',
      'version number',
      'what build is this',
    ]) {
      expect(ASKS_VERSION.test(asked), asked).toBe(true);
    }
    for (const notIt of ['what time is it', 'two pints of milk', 'what is the delivery fee']) {
      expect(ASKS_VERSION.test(notIt), notIt).toBe(false);
    }
  });

  it('is in the footer of every page, named for a screen reader', async () => {
    stubApi();
    renderAt('/about');
    const notes = await screen.findAllByRole('note', { name: 'App version' });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toHaveTextContent(/^Version \S+/);
    expect(notes[0]).toHaveTextContent(appVersion().words);
  });

  it('is on the sign-in page and in Settings, each with "Reset the app"', async () => {
    for (const path of ['/sign-in', '/business', '/staff', '/settings']) {
      stubApi();
      const view = renderAt(path);
      expect(await screen.findByRole('button', { name: 'Reset the app' })).toBeInTheDocument();
      const notes = screen.getAllByRole('note', { name: 'App version' });
      // The footer's, and the page's own.
      expect(notes.length).toBeGreaterThanOrEqual(2);
      view.unmount();
    }
  });

  it('is said by Ozi when asked "what version is this"', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('Ozi, what version is this?');
    });
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe(versionSpoken());
    });
    expect(engine.spoken.at(-1)?.text).toMatch(/^This is (the )?version/);
  });
});

describe('"Reset the app"', () => {
  it('says what is happening, then clears the saved copy, keeping sign-ins', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
    renderAt('/runner/sign-in');
    const button = await screen.findByRole('button', { name: 'Reset the app' });
    expect(button).toHaveAccessibleDescription(/You stay signed in/);

    await userEvent.click(button);

    await waitFor(() => {
      expect(resetApp).toHaveBeenCalledTimes(1);
    });
    expect(engine.spoken.map((one) => one.text)).toContain(RESET_LINE);
    // Said by Ozi (its caption shows it too), and in the button's own status line.
    expect(screen.getAllByText(RESET_LINE).length).toBeGreaterThanOrEqual(1);
    // The real resetApp keeps every sign-in (updates.test.ts); the page passes nothing else.
    expect(window.localStorage.getItem('ozidelivery.runner.token')).toBe('runner-token');
  });
});

describe('when the app cannot draw its screen', () => {
  function Broken(): JSX.Element {
    throw new Error('A half-loaded copy: a component is missing.');
  }

  it('heals once, saying so plainly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heal = vi.fn(async () => true);
    render(
      <LoadGuard heal={heal}>
        <Broken />
      </LoadGuard>,
    );
    expect(
      screen.getByRole('heading', {
        name: `Something went wrong loading ${storeConfig.productName}.`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Reloading…');
    await waitFor(() => {
      expect(heal).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'Reset the app' })).not.toBeInTheDocument();
  });

  it('after a second failure, asks the person to close the app, with "Reset the app" to hand', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const heal = vi.fn(async () => false);
    render(
      <LoadGuard heal={heal}>
        <Broken />
      </LoadGuard>,
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Please close the app and open it again.',
      );
    });
    expect(screen.getByRole('note', { name: 'App version' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset the app' }));
    await waitFor(() => {
      expect(resetApp).toHaveBeenCalledTimes(1);
    });
  });

  it('draws the app as normal when nothing is wrong', () => {
    render(
      <LoadGuard>
        <p>All well.</p>
      </LoadGuard>,
    );
    expect(screen.getByText('All well.')).toBeInTheDocument();
  });
});

describe('Chrome ending a listen', () => {
  it('for silence (no-speech): Ozi listens again, with no note and no fault', async () => {
    const engine = fakeEngine();
    const starts = vi.spyOn(engine, 'startListening');
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    const before = starts.mock.calls.length;
    const first = engine.listening as ListenOptions;
    engine.listening = null;
    act(() => {
      first.onError?.({ kind: 'no-speech', message: 'I did not hear anything.' });
      first.onEnd?.();
    });
    await waitFor(() => {
      expect(starts.mock.calls.length).toBe(before + 1);
    });
    expect(engine.listening).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(engine.spoken.map((one) => one.text).join(' ')).not.toMatch(
      /cannot listen|did not hear|went wrong/i,
    );
    expect(screen.queryByText(/cannot listen/i)).not.toBeInTheDocument();
  });

  it('the browser engine reports no-speech once and keeps "aborted" to itself', () => {
    class FakeRecognition {
      static instances: FakeRecognition[] = [];
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start(): void {
        FakeRecognition.instances.push(this);
      }
      stop(): void {}
      abort(): void {}
    }
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    const engine = browserVoiceEngine();
    const errors: VoiceError[] = [];
    let ended = 0;
    engine.startListening({
      language: 'en-GB',
      onText: () => undefined,
      onError: (error) => {
        errors.push(error);
      },
      onEnd: () => {
        ended += 1;
      },
    });
    const running = FakeRecognition.instances[0]!;
    expect(running.continuous).toBe(false);
    running.onerror?.({ error: 'no-speech' });
    running.onend?.();
    expect(errors).toEqual([{ kind: 'no-speech', message: 'I did not hear anything.' }]);
    expect(ended).toBe(1);

    engine.startListening({
      language: 'en-GB',
      onText: () => undefined,
      onError: (error) => {
        errors.push(error);
      },
      onEnd: () => {
        ended += 1;
      },
    });
    const second = FakeRecognition.instances[1]!;
    second.onerror?.({ error: 'aborted' });
    second.onend?.();
    second.onend?.();
    expect(errors).toHaveLength(1);
    // Exactly once, however many times Chrome says it has ended.
    expect(ended).toBe(2);
  });
});
