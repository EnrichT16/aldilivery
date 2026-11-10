/**
 * A Runner stays signed in and can always send their documents (10 November 2026, ruling 100).
 *
 * Runners said "the app logs me out within 5 minutes on Chrome", and one gave up because he could
 * not send his documents. Nobody was being signed out: the first screen ignored a signed-in
 * Runner, a reload emptied the sign-up and the sign-in half way through, and a photo could be
 * thrown away or hang for ever. Each of those is proved put right here. The reload rules
 * themselves are in updates.test.ts, and the sign-out rule in sessions.test.tsx.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { DocumentsChecklist } from '../src/components/DocumentsChecklist';
import { HomeScreenSignInNote, inAppleBrowserTab } from '../src/components/HomeScreenSignInNote';
import { sendRunnerDocument, UPLOAD_TIMEOUT } from '../src/lib/api';
import { preparePhoto } from '../src/lib/photo';
import { forgetBusy, reloadsMustWait } from '../src/lib/updates';
import { FAKE_RUNNER, FAKE_SHOPPER, stubApi, type ApiStubOptions } from './setup';

const RUNNER_TOKEN_KEY = 'ozidelivery.runner.token';
const CODE_STEP_KEY = 'ozidelivery.sign-in.code-step';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function answer(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

function pathOf(url: string): string {
  return String(url)
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/api(?=\/|$)/, '');
}

/** The usual pretend server, with some paths answered differently for one test. */
function stubApiWith(
  special: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined,
  options: ApiStubOptions = {},
) {
  const recorded = stubApi(options);
  const usual = globalThis.fetch as unknown as Fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const own = await special(pathOf(url), init);
      return own ?? usual(url, init);
    }),
  );
  return recorded;
}

/** A Runner signed in on this phone: their token kept, and "me" answered as the server would. */
function signedInRunner(options: ApiStubOptions = {}) {
  const recorded = stubApiWith((path, init) => {
    const sentBy = (init?.headers as Record<string, string> | undefined)?.authorization;
    return path === '/me' && sentBy === 'Bearer runner-token'
      ? answer({ role: 'runner', runner: FAKE_RUNNER })
      : undefined;
  }, options);
  window.localStorage.setItem(RUNNER_TOKEN_KEY, 'runner-token');
  return recorded;
}

function renderApp(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  forgetBusy();
  vi.restoreAllMocks();
});

describe('the first screen knows a signed-in Runner', () => {
  it('the app opened at its first page takes a signed-in Runner to their Runner page', async () => {
    signedInRunner();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');
  });

  it('on a shared phone the signed-in Shopper has the first page, and the Runner is left alone', async () => {
    signedInRunner({ shopper: FAKE_SHOPPER });
    renderApp('/');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Who are you?' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Hello, Tomasz' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(RUNNER_TOKEN_KEY)).toBe('runner-token');
  });

  it('nobody signed in still sees the doors', async () => {
    stubApi();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('the Runner door takes a signed-in Runner to their Runner page, not to "sign in"', async () => {
    signedInRunner();
    renderApp('/runner');
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
  });
});

describe('signing up to run survives a reload', () => {
  it('a Runner already signed in here sees the documents, said plainly, not an empty form', async () => {
    signedInRunner();
    renderApp('/runner/sign-up');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You are signed up' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You are signed up\. Now your documents\./)).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      await screen.findByRole('heading', { name: 'A photo of your face' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign me up to run' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your Runner page' })).toHaveAttribute(
      'href',
      '/runner/home',
    );
  });

  it('a number that is already a Runner’s is told so, with "Sign in instead" carrying the number', async () => {
    stubApiWith((path, init) =>
      path === '/runners' && init?.method === 'POST'
        ? answer(
            { error: { code: 'conflict', message: 'There is already a Runner on that phone number.' } },
            409,
          )
        : undefined,
    );
    const user = userEvent.setup({ delay: null });
    renderApp('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already a Runner on that phone number/);
    expect(alert).toHaveTextContent(/sign in instead/);
    const link = screen.getByRole('link', { name: 'Sign in instead' });
    expect(link).toHaveAttribute('href', '/runner/sign-in');

    await user.click(link);
    expect(await screen.findByRole('heading', { name: 'Runner sign in' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Your phone number')).toHaveValue('07700 900101');
  });

  it('keeps the half-filled form for the tab, but never the tick that agrees, and forgets it once signed up', async () => {
    stubApi();
    const user = userEvent.setup({ delay: null });
    renderApp('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByLabelText('Car'));
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));

    // The page is reloaded.
    cleanup();
    renderApp('/runner/sign-up');
    expect(screen.getByLabelText('Your name')).toHaveValue('Tomasz');
    expect(screen.getByLabelText('Your mobile number')).toHaveValue('07700 900101');
    expect(screen.getByLabelText('Your home postcode')).toHaveValue('ME7 1AA');
    expect(screen.getByLabelText('Car')).toBeChecked();
    expect(screen.getByLabelText('Walking')).toBeChecked();
    expect(
      screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'),
    ).not.toBeChecked();
    // What came back with the reload is kept already, so it does not hold a new version off.
    expect(reloadsMustWait()).toBe(false);

    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ozidelivery.runner-sign-up.draft')).toBeNull();
  });
});

describe('the "type your code" step survives a reload', () => {
  async function askForCode() {
    const user = userEvent.setup({ delay: null });
    await user.type(await screen.findByLabelText('Your phone number'), '07700 900123');
    await user.click(screen.getByRole('button', { name: 'Text me a code' }));
    await screen.findByLabelText('The code from the text');
    return user;
  }

  it('comes back to the code step with the number, asks for no second code, and never keeps the code', async () => {
    const recorded = stubApi();
    renderApp('/runner/sign-in');
    const user = await askForCode();
    // While the code is fetched from Messages, no new version may reload the page.
    expect(reloadsMustWait()).toBe(true);
    await user.type(screen.getByLabelText('The code from the text'), '1234');

    const kept = window.sessionStorage.getItem(CODE_STEP_KEY) ?? '';
    expect(JSON.parse(kept)).toMatchObject({ phone: '07700 900123', step: 'code', role: 'runner' });
    expect(kept).not.toContain('1234');

    // The phone reloads the page while they are in Messages.
    cleanup();
    renderApp('/runner/sign-in');
    expect(await screen.findByLabelText('The code from the text')).toBeInTheDocument();
    expect(screen.getByText(/07700 900123/)).toBeInTheDocument();
    expect(recorded.filter((request) => request.path === '/auth/request-code')).toHaveLength(1);

    await user.type(screen.getByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Tomasz' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CODE_STEP_KEY)).toBeNull();
    await waitFor(() => expect(reloadsMustWait()).toBe(false));
  });

  it('is forgotten on choosing a different number', async () => {
    stubApi();
    renderApp('/runner/sign-in');
    const user = await askForCode();
    await user.click(
      screen.getByRole('button', { name: 'Use a different number, or send the code again' }),
    );
    expect(window.sessionStorage.getItem(CODE_STEP_KEY)).toBeNull();
    expect(await screen.findByLabelText('Your phone number')).toBeInTheDocument();
  });

  it('is not brought back once the code is too old, or for the other kind of sign-in', async () => {
    stubApi();
    const step = { phone: '07700 900123', step: 'code', role: 'runner', channel: 'text', message: '' };
    window.sessionStorage.setItem(
      CODE_STEP_KEY,
      JSON.stringify({ ...step, sentAt: Date.now() - 11 * 60_000 }),
    );
    renderApp('/runner/sign-in');
    expect(await screen.findByLabelText('Your phone number')).toHaveValue('');
    expect(screen.queryByLabelText('The code from the text')).not.toBeInTheDocument();

    cleanup();
    window.sessionStorage.setItem(CODE_STEP_KEY, JSON.stringify({ ...step, sentAt: Date.now() }));
    renderApp('/sign-in');
    expect(await screen.findByLabelText('Your phone number')).toHaveValue('');
    expect(screen.queryByLabelText('The code from the text')).not.toBeInTheDocument();
  });

  it('a Runner with no account is sent to the Runner sign-up, not the Shopper’s', async () => {
    stubApi({ verifyResult: 'no-account' });
    renderApp('/runner/sign-in');
    const user = await askForCode();
    await user.type(screen.getByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no Runner account on that number/);
    expect(screen.getByRole('link', { name: 'Sign up as a Runner' })).toHaveAttribute(
      'href',
      '/runner/sign-up',
    );
    expect(screen.queryByRole('link', { name: 'Set up an account' })).not.toBeInTheDocument();
  });
});

describe('sending documents', () => {
  it('keeps an insurance photo chosen before its date, asks for the date, then sends both', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const insurance = { kind: 'insurance', name: 'Your motor insurance' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (pathOf(url) !== '/runners/me/documents') return answer({}, 404);
        if (init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return answer({ documents: [], stillNeeded: [], message: 'Thank you.' }, 201);
        }
        return answer({ documents: [], stillNeeded: [insurance], faceMatchConsent: false });
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<DocumentsChecklist />);
    await screen.findByRole('heading', { name: 'Your motor insurance' });

    const photo = new File(['certificate'], 'insurance.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Take a photo'), photo);

    // Not thrown away, and nothing sent without its date.
    expect(await screen.findByText(/We have kept your photo/)).toBeInTheDocument();
    expect(posted).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('The date it runs out')).toHaveFocus());

    // Pressing Send without the date says what is missing, and still keeps the photo.
    await user.click(screen.getByRole('button', { name: 'Send my insurance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Your photo is kept/);
    expect(posted).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('The date it runs out'), {
      target: { value: '2027-06-30' },
    });
    await user.click(screen.getByRole('button', { name: 'Send my insurance' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      kind: 'insurance',
      expiresOn: '2027-06-30',
      contentType: 'image/jpeg',
    });
    expect(String(posted[0]?.['image'])).not.toBe('');
    expect(
      await screen.findByText(/You have sent everything we need/),
    ).toBeInTheDocument();
  });

  it('a send with no answer after ninety seconds stops, in plain words, and holds reloads meanwhile', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
        ),
      );
      const sending = sendRunnerDocument({ kind: 'dbs', image: 'AAAA', contentType: 'image/jpeg' });
      const outcome = sending.then(
        () => 'sent',
        (failure: Error) => failure.message,
      );
      expect(reloadsMustWait()).toBe(true);
      await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT.ms - 1000);
      expect(reloadsMustWait()).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await outcome).toBe(
        'That took too long to send. Please check your signal and try again.',
      );
      expect(reloadsMustWait()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a photo the page cannot open the usual way is decoded by the browser once before going as it is', async () => {
    // A picture element that cannot read the photo.
    class Unreadable {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 0;
      height = 0;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', Unreadable);
    const close = vi.fn();
    const decode = vi.fn(async () => ({ width: 4000, height: 3000, close }));
    vi.stubGlobal('createImageBitmap', decode);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,U01BTEw=',
    );

    const file = new File(['a very large photo'], 'licence.heic', { type: 'image/heic' });
    const ready = await preparePhoto(file);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(file);
    expect(ready).toEqual({ base64: 'U01BTEw=', contentType: 'image/jpeg' });
    // Shrunk to 1600 on its long side.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalled();

    // And when that fails too, the photo goes as it is rather than not at all.
    decode.mockRejectedValueOnce(new Error('cannot decode'));
    const asItIs = await preparePhoto(file);
    expect(asItIs.contentType).toBe('image/heic');
    expect(asItIs.base64).not.toBe('');
  });
});

describe('the home-screen app keeps its own sign-in on an iPhone', () => {
  function pretend(userAgent: string, standalone: boolean): () => void {
    const before = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => userAgent });
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      get: () => standalone,
    });
    return () => {
      if (before) Object.defineProperty(window.navigator, 'userAgent', before);
      else delete (window.navigator as unknown as Record<string, unknown>)['userAgent'];
      delete (window.navigator as unknown as Record<string, unknown>)['standalone'];
    };
  }

  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';

  it('says so in one sentence in a browser tab there, and nowhere else', () => {
    let undo = pretend(IPHONE, false);
    try {
      expect(inAppleBrowserTab()).toBe(true);
      render(<HomeScreenSignInNote />);
      expect(
        screen.getByText(/the app on your Home Screen keeps its own sign-in, so sign in once/),
      ).toBeInTheDocument();
    } finally {
      undo();
      cleanup();
    }

    // Opened from the Home Screen: nothing to say.
    undo = pretend(IPHONE, true);
    try {
      expect(inAppleBrowserTab()).toBe(false);
    } finally {
      undo();
    }

    // Any other phone or computer: nothing to say.
    expect(inAppleBrowserTab()).toBe(false);
    const { container } = render(<HomeScreenSignInNote />);
    expect(container).toBeEmptyDOMElement();
  });
});
