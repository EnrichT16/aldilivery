/**
 * Ruling 62: the microphone in one tap, for a stranger handed a flyer in the street.
 *
 * Seen on a real iPhone, 10 October 2026: Ozi started listening by itself after it spoke,
 * with nobody touching the screen. Safari refuses the microphone to a page that asks that way,
 * without showing its own "Allow microphone?" question, and Ozi then said to go to Settings,
 * in a box over the "Your name" field. Now:
 * - the first listening of a visit starts only from a tap, inside the tap itself;
 * - a refusal says exactly what to tap on the phone in hand, in a note that pushes the page
 *   down and closes with one tap;
 * - a page opened inside Instagram, Facebook and the like says to open it in Safari or Chrome;
 * - typing always works, and the sign-up form never needs the microphone.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { GetTheApp } from '../src/components/GetTheApp';
import { storeConfig } from '../src/config';
import { setVoiceEngine, type ListenOptions, type VoiceErrorKind } from '../src/voice';
import { browserVoiceEngine } from '../src/voice/browser-engine';
import {
  ALLOW_LINE,
  allowStep,
  browserFacts,
  deniedMessage,
  inAppBrowser,
  openElsewhereBanner,
  openInChromeLink,
  serviceOffMessage,
  tapToTalkLabel,
  typeOrCall,
  unsupportedMessage,
} from '../src/voice/microphone-help';
import { oluomaVoiceEngine, type AudioPorts } from '../src/voice/oluoma-engine';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { stubApi } from './setup';

const assistant = storeConfig.assistantName;
const TAP = tapToTalkLabel(assistant);

const UA = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iPhoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; en_GB)',
  iPhoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.0;FBSS/3;FBLC/en_GB]',
  iPhoneMessenger:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0]',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0;]',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android',
  linkedIn:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30',
  googleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/330.0.0 Mobile/15E148 Safari/604.1',
  tikTok:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 trill_360 BytedanceWebview/d8a21c6',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
  iPhoneWebView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};

function pretendToBe(ua: string): void {
  vi.spyOn(Navigator.prototype, 'userAgent', 'get').mockReturnValue(ua);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { permissions?: unknown }).permissions;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function said(engine: FakeEngine): string[] {
  return engine.spoken.map((s) => s.text);
}

/**
 * A browser engine that needs a tap for the first listening. `answer` decides what each
 * listening does: nothing yet (it is listening), or refuse.
 */
function tapEngine(
  options: {
    needsTap?: boolean;
    answer?: (listen: ListenOptions, count: number) => VoiceErrorKind | null;
  } = {},
): FakeEngine & { starts: number } {
  const base = fakeEngine();
  const engine = Object.assign(base, {
    starts: 0,
    firstListenNeedsTap: async () => options.needsTap ?? true,
  });
  engine.startListening = (listen: ListenOptions) => {
    engine.starts += 1;
    const refusal = options.answer?.(listen, engine.starts) ?? null;
    if (refusal) {
      listen.onError?.({ kind: refusal, message: 'refused' });
      listen.onEnd?.();
      return;
    }
    engine.listening = listen;
  };
  return engine;
}

describe('the browser in hand', () => {
  it('knows the apps whose own browsers have no voice', () => {
    expect(inAppBrowser(UA.iPhoneInstagram)).toBe('Instagram');
    expect(inAppBrowser(UA.androidInstagram)).toBe('Instagram');
    expect(inAppBrowser(UA.iPhoneFacebook)).toBe('Facebook');
    expect(inAppBrowser(UA.androidFacebook)).toBe('Facebook');
    expect(inAppBrowser(UA.iPhoneMessenger)).toBe('Messenger');
    expect(inAppBrowser(UA.linkedIn)).toBe('LinkedIn');
    expect(inAppBrowser(UA.googleApp)).toBe('the Google app');
    expect(inAppBrowser(UA.tikTok)).toBe('TikTok');
    expect(inAppBrowser(UA.androidWebView)).toBe('another app');
    expect(inAppBrowser(UA.iPhoneWebView)).toBe('another app');
  });

  it('never mistakes a real browser for an app', () => {
    expect(inAppBrowser(UA.iPhoneSafari)).toBeNull();
    expect(inAppBrowser(UA.iPhoneChrome)).toBeNull();
    expect(inAppBrowser(UA.androidChrome)).toBeNull();
    expect(inAppBrowser(UA.desktopChrome)).toBeNull();
  });

  it('tells an iPhone from Android, including an iPad that says it is a Mac', () => {
    expect(browserFacts(UA.iPhoneSafari)).toEqual({ iPhone: true, android: false, inApp: null });
    expect(browserFacts(UA.androidChrome)).toEqual({ iPhone: false, android: true, inApp: null });
    const iPad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(browserFacts(iPad, 5).iPhone).toBe(true);
    expect(browserFacts(iPad, 0).iPhone).toBe(false);
  });
});

describe('the words', () => {
  const iPhone = browserFacts(UA.iPhoneSafari);
  const android = browserFacts(UA.androidChrome);

  it('says exactly what to tap when the microphone was refused, for the phone in hand', () => {
    expect(deniedMessage(iPhone, '0113 000 0000')).toBe(
      'Tap the aA button by the web address, then Website Settings, then Microphone, Allow. Or just type, or call us on 0113 000 0000.',
    );
    expect(deniedMessage(android, '0113 000 0000')).toBe(
      'Tap the lock by the web address, then Permissions, then Microphone, Allow. Or just type, or call us on 0113 000 0000.',
    );
    // No real number yet: never a made-up one.
    expect(typeOrCall(null)).toBe('Or just type, or call us.');
  });

  it('says Dictation must be on when an iPhone has switched the speech service off', () => {
    expect(serviceOffMessage(iPhone, null)).toBe(
      'Voice needs Dictation switched on: Settings, General, Keyboard, Enable Dictation.',
    );
    expect(serviceOffMessage(browserFacts(UA.iPhoneInstagram), null)).toMatch(
      /^Voice doesn't work inside Instagram\. You can type, or open this page in Safari\.$/,
    );
  });

  it('says plainly when a browser has no voice at all, and which one to use', () => {
    expect(unsupportedMessage(iPhone)).toBe(
      "Voice doesn't work in this browser. You can type, or open this page in Safari.",
    );
    expect(unsupportedMessage(android)).toBe(
      "Voice doesn't work in this browser. You can type, or open this page in Chrome.",
    );
  });

  it('builds a link that opens the same page in Chrome on Android', () => {
    expect(openInChromeLink('https://example.test/join?via=flyer')).toBe(
      'intent://example.test/join?via=flyer#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fexample.test%2Fjoin%3Fvia%3Dflyer;end',
    );
    expect(openInChromeLink('not a web address')).toBeNull();
  });
});

describe('the phone’s own speech, and the tap', () => {
  it('starts the browser’s recognition in the same moment it is asked, with nothing awaited', () => {
    const started: string[] = [];
    vi.stubGlobal(
      'webkitSpeechRecognition',
      class {
        lang = '';
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onresult = null;
        onerror = null;
        onend = null;
        start() {
          started.push(this.lang);
        }
        stop() {}
        abort() {}
      },
    );
    browserVoiceEngine().startListening({ language: 'en-GB', onText: () => {} });
    expect(started).toEqual(['en-GB']);
  });

  it('reports a switched-off speech service apart from a refused microphone', () => {
    const errors: string[] = [];
    let current: { onerror: ((event: { error: string }) => void) | null } | null = null;
    vi.stubGlobal(
      'webkitSpeechRecognition',
      class {
        onerror: ((event: { error: string }) => void) | null = null;
        onend = null;
        onresult = null;
        start() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          current = this;
        }
        stop() {}
        abort() {}
      },
    );
    const engine = browserVoiceEngine();
    engine.startListening({
      language: 'en-GB',
      onText: () => {},
      onError: (error) => errors.push(error.kind),
    });
    current!.onerror?.({ error: 'service-not-allowed' });
    engine.startListening({
      language: 'en-GB',
      onText: () => {},
      onError: (error) => errors.push(error.kind),
    });
    current!.onerror?.({ error: 'not-allowed' });
    expect(errors).toEqual(['service-not-allowed', 'not-allowed']);
  });

  it('wants a tap first, unless the browser says the microphone is already allowed', async () => {
    expect(await browserVoiceEngine().firstListenNeedsTap!()).toBe(true);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted' }) },
    });
    expect(await browserVoiceEngine().firstListenNeedsTap!()).toBe(false);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'prompt' }) },
    });
    expect(await browserVoiceEngine().firstListenNeedsTap!()).toBe(true);
  });

  it('asks for the microphone in the same moment with Oluoma Voice too, once it has chosen', async () => {
    let recordings = 0;
    const audio: AudioPorts = {
      player: () => ({ play() {}, finished: async () => true, stop() {} }),
      canRecord: () => true,
      record: () => {
        recordings += 1;
        return { audio: new Promise(() => {}), stop() {} };
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ languages: [{ language: 'en-GB', canListen: true, canSpeak: true }] }),
      })),
    );
    const engine = oluomaVoiceEngine({
      fallback: fakeEngine(),
      session: async () => ({
        url: 'https://voice.example.test',
        token: 't',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
      audio,
    });
    await engine.readiness('en-GB');
    engine.startListening({ language: 'en-GB', onText: () => {} });
    expect(recordings).toBe(1);
  });

  it('hands over to the phone’s own listening in the same moment when Oluoma Voice is not there', async () => {
    const fallback = fakeEngine();
    const engine = oluomaVoiceEngine({
      fallback,
      session: async () => null,
      audio: {
        player: () => ({ play() {}, finished: async () => true, stop() {} }),
        canRecord: () => true,
        record: () => ({ audio: new Promise(() => {}), stop() {} }),
      },
    });
    await engine.readiness('en-GB');
    engine.startListening({ language: 'en-GB', onText: () => {} });
    expect(fallback.listening).not.toBeNull();
  });
});

describe('Ozi waits for a tap before it first listens', () => {
  it('shows one big button, and starts listening inside that tap', async () => {
    const engine = tapEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');

    const button = await screen.findByRole('button', { name: TAP });
    expect(screen.getByText(ALLOW_LINE)).toBeInTheDocument();
    // Ozi's round button says the same.
    expect(screen.getByRole('button', { name: 'Tap to talk' })).toBeInTheDocument();
    // Nothing has asked for the microphone by itself.
    expect(engine.starts).toBe(0);

    // Synchronous: the microphone is asked for before the click has finished.
    fireEvent.click(button);
    expect(engine.starts).toBe(1);
    expect(engine.listening).not.toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: TAP })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Listening' })).toBeInTheDocument();
  });

  it('after the introduction, says the short line about tapping Allow, just before', async () => {
    window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({}));
    const engine = tapEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');

    await waitFor(() => {
      expect(said(engine)).toContain(`${TAP}. ${ALLOW_LINE}`);
    });
    expect(said(engine)[0]).toMatch(/^Hello, I'm /);
    expect(engine.starts).toBe(0);
    // The line is on the page by the button, not in a box beside Ozi's round button.
    const aside = screen.getByRole('complementary', { name: assistant });
    expect(within(aside).queryByText(ALLOW_LINE, { exact: false })).toBeNull();
  });

  it('the round button is the tap too', async () => {
    const engine = tapEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    fireEvent.click(await screen.findByRole('button', { name: 'Tap to talk' }));
    expect(engine.starts).toBe(1);
  });

  it('listens by itself again once allowed, and asks for a tap, quietly, if a start is refused', async () => {
    const engine = tapEngine({
      needsTap: false,
      answer: (_listen, count) => (count === 1 ? 'not-allowed' : null),
    });
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');

    // Allowed before, so it tried by itself; the browser said no: no error, just the button.
    const button = await screen.findByRole('button', { name: TAP });
    expect(screen.queryByText(/Website Settings|lock by the web address/)).toBeNull();
    expect(said(engine).join(' ')).not.toMatch(/not allowed/i);

    fireEvent.click(button);
    expect(engine.starts).toBe(2);
    expect(engine.listening).not.toBeNull();
  });
});

describe('when the microphone cannot be had', () => {
  it('says what to tap on an iPhone, in a note that pushes the page down and closes in one tap', async () => {
    pretendToBe(UA.iPhoneSafari);
    const engine = tapEngine({ answer: () => 'not-allowed' });
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');

    fireEvent.click(await screen.findByRole('button', { name: TAP }));
    const text = await screen.findByText(
      /^Tap the aA button by the web address, then Website Settings, then Microphone, Allow\. Or just type, or call us/,
    );
    const note = text.closest('[role="status"]')!;
    expect(note).not.toBeNull();
    // In the page, not laid over it beside Ozi's button.
    expect(note.closest('main')).not.toBeNull();
    expect(note.closest('[data-ozi]')).toBeNull();
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/^Tap the aA button/);
    });
    const aside = screen.getByRole('complementary', { name: assistant });
    expect(within(aside).queryByText(/Tap the aA button/)).toBeNull();

    await user.click(within(note as HTMLElement).getByRole('button', { name: 'Close this note' }));
    expect(screen.queryByText(/Tap the aA button/)).toBeNull();
  });

  it('says what to tap on Android', async () => {
    pretendToBe(UA.androidChrome);
    const engine = tapEngine({ answer: () => 'not-allowed' });
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    fireEvent.click(await screen.findByRole('button', { name: TAP }));
    expect(
      await screen.findByText(
        /^Tap the lock by the web address, then Permissions, then Microphone, Allow\./,
      ),
    ).toBeInTheDocument();
  });

  it('says to switch on Dictation when an iPhone has the speech service off', async () => {
    pretendToBe(UA.iPhoneSafari);
    const engine = tapEngine({ answer: () => 'service-not-allowed' });
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    fireEvent.click(await screen.findByRole('button', { name: TAP }));
    expect(
      await screen.findByText(
        'Voice needs Dictation switched on: Settings, General, Keyboard, Enable Dictation.',
      ),
    ).toBeInTheDocument();
  });

  it('never stands between anybody and the sign-up form: typing always works', async () => {
    pretendToBe(UA.iPhoneSafari);
    const engine = tapEngine({ answer: () => 'not-allowed' });
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/sign-up');

    fireEvent.click(await screen.findByRole('button', { name: TAP }));
    await screen.findByText(/Tap the aA button/);
    const name = screen.getByLabelText(/Your name/);
    expect(name).toBeEnabled();
    await user.type(name, 'Grace');
    expect(name).toHaveValue('Grace');
  });
});

describe('inside another app', () => {
  it('says to open the page in Safari on an iPhone, with a button to copy the link', async () => {
    pretendToBe(UA.iPhoneInstagram);
    setVoiceEngine(tapEngine());
    stubApi();
    const user = userEvent.setup();
    // After userEvent, which puts a clipboard of its own in place.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderAt('/shop');

    expect(
      await screen.findByText(openElsewhereBanner(browserFacts(UA.iPhoneInstagram), assistant)),
    ).toHaveTextContent(`For ${assistant}'s voice, open this page in Safari.`);
    expect(screen.queryByRole('link', { name: 'Open in Chrome' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy the link' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText(/^Copied\. Open Safari/)).toBeInTheDocument();
  });

  it('offers to open the page in Chrome on Android', async () => {
    pretendToBe(UA.androidFacebook);
    setVoiceEngine(tapEngine());
    stubApi();
    renderAt('/shop');
    expect(
      await screen.findByText(`For ${assistant}'s voice, open this page in Chrome.`),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Chrome' }).getAttribute('href')).toMatch(
      /^intent:\/\/.*package=com\.android\.chrome/,
    );
  });

  it('is not shown in an ordinary browser', async () => {
    pretendToBe(UA.iPhoneSafari);
    setVoiceEngine(tapEngine());
    stubApi();
    renderAt('/shop');
    await screen.findByRole('button', { name: TAP });
    expect(screen.queryByText(/open this page in Safari/)).toBeNull();
  });
});

describe('the help and install steps', () => {
  it('include tapping Allow, on the Help page and in Get the app', async () => {
    stubApi();
    renderAt('/help');
    expect(
      (await screen.findAllByText(allowStep(assistant), { exact: false })).length,
    ).toBeGreaterThan(0);
    expect(allowStep(assistant)).toBe(`When asked, tap Allow so ${assistant} can hear you.`);
  });

  it('Get the app ends both sets of steps with it', () => {
    render(<GetTheApp />);
    expect(screen.getAllByText(allowStep(assistant))).toHaveLength(2);
  });
});
