/**
 * Ozi knows the owner on his own phone (Anthony, 31 October 2026, ruling 84). The founder, who
 * is registered blind, opened the app, tapped to talk and said "Hello Ozi", "Good morning Ozi",
 * "This is the owner and founder" and "Do you know my name?". Ozi answered as if to a visitor.
 *
 * With his session remembered on this phone, on the home page and in the admin panel, every one
 * of those reaches the server with his staff session, the Shopper introduction, the extra-help
 * question and the account offer are never spoken, and his first words from Ozi greet him by
 * name. A visitor with nothing signed in still hears the introduction.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { currentAsker } from '../src/lib/ozi-asker';
import { keepStaffSession } from '../src/lib/staff-session';
import { setVoiceEngine } from '../src/voice';
import { forgetKnownPhrases } from '../src/voice/phrases';
import { fakeEngine, type FakeEngine } from './fake-voice';

const TOKEN = 'st1.owner.sig';
const GREETING = /^Good (morning|afternoon|evening), Mr\. Anthony\. How can I help\?$/;
const NEVER = /Hello, I'm|extra help|create an account|sign in\?|open an account|place an order/i;

interface Asked {
  path: string;
  headers: Record<string, string>;
  body: { text?: string; mode?: string };
}

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

/** The server, as far as these screens need it: the owner's conversation answers personally. */
function stubServer(asked: Asked[], signIn?: (body: Record<string, unknown>) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      asked.push({ path, headers: (init?.headers ?? {}) as Record<string, string>, body });
      if (path === '/staff/sign-in' && signIn) return signIn(body);
      if (path === '/staff/me') {
        return reply({
          name: 'Anthony',
          role: 'founder',
          title: 'Founder',
          areas: ['team'],
          account: true,
          mustChangePassword: false,
          isOwner: true,
          address: 'Mr Anthony',
        });
      }
      if (path === '/staff/team') return reply({ members: [] });
      if (path === '/staff/sign-out-phone') return reply({ message: 'Signed out of this phone.' });
      if (path === '/ozi/reply') {
        const text = String(body['text'] ?? '');
        const owner = (init?.headers as Record<string, string> | undefined)?.['x-staff-token'];
        if (owner !== TOKEN) return reply({ reply: 'Hello. What shopping would you like?' });
        if (/name/i.test(text)) {
          return reply({ reply: 'Yes, Mr. Anthony. You are the owner and founder.' });
        }
        if (/owner and founder/i.test(text)) {
          return reply({ reply: 'I know, Mr. Anthony. Lovely to hear you.' });
        }
        if (/morning/i.test(text)) return reply({ reply: 'Good morning, Mr. Anthony.' });
        return reply({ reply: 'Hello, Mr. Anthony. How can I help?' });
      }
      return reply({});
    }),
  );
}

/** His session, remembered on this phone in an earlier visit. */
function rememberOwner(): void {
  window.localStorage.setItem('ozidelivery.staff.key', TOKEN);
  window.localStorage.setItem('ozidelivery.staff.name', 'Anthony');
  window.localStorage.setItem('ozidelivery.staff.owner', '1');
  window.localStorage.setItem('ozidelivery.staff.expires', String(Date.now() + 86_400_000));
}

function firstVisit(): void {
  // The introduction has never been heard on this phone: it would be said to a visitor.
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: false }));
}

async function say(engine: FakeEngine, words: string): Promise<void> {
  await waitFor(() => expect(engine.listening).not.toBeNull());
  engine.hear(words);
}

function oziReplies(asked: Asked[]): Asked[] {
  return asked.filter((one) => one.path === '/ozi/reply');
}

describe('the owner on his own phone, on the home page', () => {
  it("greets him by name, and sends the founder's own words with his session", async () => {
    forgetKnownPhrases();
    rememberOwner();
    firstVisit();
    const asked: Asked[] = [];
    stubServer(asked);
    expect(currentAsker()).toEqual({ kind: 'staff', key: TOKEN });
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(engine.spoken[0]?.text).toMatch(GREETING));

    await say(engine, 'Hello Ozi');
    await waitFor(() =>
      expect(engine.spoken.at(-1)?.text).toBe('Hello, Mr. Anthony. How can I help?'),
    );
    await say(engine, 'Good morning Ozi');
    await waitFor(() => expect(engine.spoken.at(-1)?.text).toBe('Good morning, Mr. Anthony.'));
    await say(engine, 'This is the owner and founder');
    await waitFor(() => expect(engine.spoken.at(-1)?.text).toMatch(/^I know, Mr\. Anthony/));
    await say(engine, 'Do you know my name?');
    await waitFor(() => expect(engine.spoken.at(-1)?.text).toMatch(/owner and founder/));

    const sent = oziReplies(asked);
    expect(sent.map((one) => one.body.text)).toEqual([
      'Hello Ozi',
      'Good morning Ozi',
      'This is the owner and founder',
      'Do you know my name?',
    ]);
    for (const one of sent) {
      expect(one.headers['x-staff-token']).toBe(TOKEN);
      expect(one.body.mode).toBe('within');
    }
    const everything = engine.spoken.map((s) => s.text).join(' ');
    expect(everything).not.toMatch(NEVER);
  });

  it('when the server does not answer, still greets him by name, never with an account offer', async () => {
    forgetKnownPhrases();
    rememberOwner();
    const asked: Asked[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        asked.push({ path: String(url), headers: {}, body: {} });
        if (String(url).includes('/ozi/reply')) return reply({ reply: null });
        void init;
        return reply({});
      }),
    );
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(engine.spoken[0]?.text).toMatch(GREETING));
    await say(engine, 'Good morning Ozi');
    await waitFor(() => expect(engine.spoken.length).toBeGreaterThan(1));
    await waitFor(() => expect(engine.spoken.at(-1)?.text).toMatch(GREETING));
    expect(engine.spoken.map((s) => s.text).join(' ')).not.toMatch(NEVER);
  });
});

describe('the owner on his own phone, in the admin panel', () => {
  it('is signed in after the app was closed, and "Hello Ozi" goes to his conversation', async () => {
    forgetKnownPhrases();
    rememberOwner();
    firstVisit();
    const asked: Asked[] = [];
    stubServer(asked);
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('button', { name: 'Sign out of this phone' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(/Mr Anthony/));
    await say(engine, 'Hello Ozi');
    await waitFor(() => expect(oziReplies(asked)).toHaveLength(1));
    expect(oziReplies(asked)[0]).toMatchObject({
      headers: expect.objectContaining({ 'x-staff-token': TOKEN }),
      body: { text: 'Hello Ozi', mode: 'within' },
    });
    await waitFor(() =>
      expect(engine.spoken.at(-1)?.text).toBe('Hello, Mr. Anthony. How can I help?'),
    );
    expect(engine.spoken.map((s) => s.text).join(' ')).not.toMatch(NEVER);
  });

  it('Sign out of this phone forgets him here and tells the server', async () => {
    rememberOwner();
    const asked: Asked[] = [];
    stubServer(asked);
    setVoiceEngine(fakeEngine());
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Sign out of this phone' }));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(window.localStorage.getItem('ozidelivery.staff.key')).toBeNull();
    await waitFor(() =>
      expect(asked.some((one) => one.path === '/staff/sign-out-phone')).toBe(true),
    );
    expect(currentAsker()).toEqual({ kind: 'shopper' });
  });
});

describe('Remember me on this phone', () => {
  it('is ticked for the owner when his passcode is asked, and keeps his session token on the phone', async () => {
    const asked: Asked[] = [];
    stubServer(asked, (body) =>
      body['passcode']
        ? reply({
            token: TOKEN,
            name: 'Anthony',
            role: 'founder',
            title: 'Founder',
            areas: ['team'],
            mustChangePassword: false,
            remembered: body['remember'] === true,
            expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          })
        : reply(
            {
              error: {
                code: 'more_needed',
                message: 'Now your passcode, please.',
                details: { needs: ['passcode'] },
              },
            },
            401,
          ),
    );
    setVoiceEngine(fakeEngine());
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    const box = await screen.findByRole('checkbox', { name: 'Remember me on this phone' });
    expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText('Username'), 'anthony');
    await user.type(screen.getByLabelText('Password'), 'a long password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Remember me on this phone' })).toBeChecked(),
    );
    await user.type(screen.getByLabelText(/Your passcode/), '123456#');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('button', { name: 'Sign out of this phone' }),
    ).toBeInTheDocument();
    const signIn = asked.filter((one) => one.path === '/staff/sign-in').at(-1);
    expect(signIn?.body).toMatchObject({ remember: true });
    expect(window.localStorage.getItem('ozidelivery.staff.key')).toBe(TOKEN);
    expect(window.sessionStorage.getItem('ozidelivery.staff.key')).toBeNull();
    await waitFor(() => expect(window.localStorage.getItem('ozidelivery.staff.owner')).toBe('1'));
  });

  it('is never offered for the staff key, which stays for this tab only', async () => {
    const asked: Asked[] = [];
    stubServer(asked);
    setVoiceEngine(fakeEngine());
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Founder: sign in with the staff key' }),
    );
    expect(screen.queryByRole('checkbox', { name: 'Remember me on this phone' })).toBeNull();
    expect(screen.getByText(/never remembered on a phone/)).toBeInTheDocument();
  });
});

describe('a visitor with nothing signed in', () => {
  it('still hears the Shopper introduction and the extra-help question', async () => {
    forgetKnownPhrases();
    firstVisit();
    const asked: Asked[] = [];
    stubServer(asked);
    expect(currentAsker()).toEqual({ kind: 'shopper' });
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(engine.spoken[0]?.text).toMatch(/^Hello, I'm /));
    await waitFor(() => expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(/extra help/));
  });
});

/**
 * 31 October 2026, the founder's exact experience: on a new phone he opened the admin page,
 * Ozi asked whether he was blind and whether he wanted an account, and after he signed in his
 * question "Do I have any shop partners I need to approve?" was taken as the answer to that
 * waiting question. Neither may ever happen again.
 */
describe('a new phone opening the admin page', () => {
  it('hears how to sign in, never the Shopper introduction or the extra-help question', async () => {
    forgetKnownPhrases();
    firstVisit();
    const asked: Asked[] = [];
    stubServer(asked);
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(/Admin sign in/),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(engine.spoken.map((s) => s.text).join(' ')).not.toMatch(NEVER);
  });

  it("signing in as the owner drops any waiting Shopper question, and his next words are his own", async () => {
    forgetKnownPhrases();
    firstVisit();
    const asked: Asked[] = [];
    stubServer(asked);
    const engine = fakeEngine();
    setVoiceEngine(engine);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    // A visitor's welcome, with its question left waiting for yes or no.
    await waitFor(() => expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(/extra help/));
    const before = engine.spoken.length;
    // He signs in as the owner (what the admin page does once his passcode is accepted).
    keepStaffSession({ key: TOKEN, name: 'Anthony Ibe', remember: true, owner: true });
    await waitFor(() => expect(engine.spoken.at(-1)?.text).toMatch(GREETING));
    await say(engine, 'Do I have any shop partners I need to approve?');
    await waitFor(() => expect(oziReplies(asked)).toHaveLength(1));
    expect(oziReplies(asked)[0]).toMatchObject({
      headers: expect.objectContaining({ 'x-staff-token': TOKEN }),
      body: { text: 'Do I have any shop partners I need to approve?', mode: 'within' },
    });
    await waitFor(() =>
      expect(engine.spoken.at(-1)?.text).toBe('Hello, Mr. Anthony. How can I help?'),
    );
    const since = engine.spoken.slice(before).map((s) => s.text).join(' ');
    expect(since).not.toMatch(NEVER);
  });
});
