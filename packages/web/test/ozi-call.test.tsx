/**
 * Ozi rings the owner in the app first, then his mobile (ruling 79, Anthony, 23 October 2026):
 * the incoming call fills the screen and is announced, he answers with the big buttons, the keys
 * 1, 2 and 3, or by voice, and each choice is the keypad's own. My settings has "Let Ozi ring me
 * in the app" and "Test Ozi's call".
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { heardChoice, keyChoice } from '../src/lib/owner-call';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { openPage } from './staff-tabs';

const AREAS = ['overview', 'problems', 'team', 'audit', 'money'];

let sent: Array<{ method: string; path: string; body: unknown }>;
let ring: { id: string; test: boolean; until: string; words: string } | null;
let publicKey: string | null;

const RING = {
  id: 'call-1',
  test: false,
  until: '2026-10-23T10:00:30.000Z',
  words: 'Ozi is calling, Mr. Anthony.',
};

const ANSWERED = {
  opening: 'Hello, Mr. Anthony. This is Ozi. Two things need you.',
  matters: [
    {
      id: 'm1',
      summary: 'A new shop, Corner Bakery, is waiting for approval.',
      options: 'decide',
      prompt: 'Say approve, decline or later, or press 1, 2 or 3.',
      spoken:
        'The first. A new shop, Corner Bakery, is waiting for approval. Say approve, decline or later, or press 1, 2 or 3.',
    },
    {
      id: 'm2',
      summary: 'A Shopper wrote: lovely Runner.',
      options: 'acknowledge',
      prompt: 'Say heard it, or later, or press 1 or 3.',
      spoken:
        'The second, and last. A Shopper wrote: lovely Runner. Say heard it, or later, or press 1 or 3.',
    },
  ],
  farewell: "That's everything. Goodbye, Mr. Anthony.",
  test: false,
};

const WORDS: Record<string, string> = {
  approve: 'Approved.',
  decline: 'Declined.',
  acknowledge: 'Thank you.',
  later: 'Left for later. I will ask you again in an hour.',
};

beforeEach(() => {
  sent = [];
  ring = RING;
  publicKey = null;
  window.sessionStorage.clear();
  // Signed in already, as the owner.
  window.sessionStorage.setItem('ozidelivery.staff.key', 'st1.owner.sig');
  window.sessionStorage.setItem('ozidelivery.staff.name', 'Anthony');
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      if (path === '/staff/me') {
        return reply({
          name: 'Anthony',
          role: 'founder',
          title: 'Founder',
          areas: AREAS,
          account: true,
          isOwner: true,
          viewOnly: false,
          mustChangePassword: false,
          twoStep: { on: true, dueAt: null, setupNeeded: false, recoveryCodesLeft: 8 },
        });
      }
      if (path === '/staff/desk/ring') return reply({ ring });
      if (path === '/staff/desk/ring/call-1/answer') {
        ring = null;
        return reply(ANSWERED);
      }
      if (path === '/staff/desk/ring/call-1/not-now') {
        ring = null;
        return reply({ message: 'All right, Mr. Anthony. Ozi will try again later.' });
      }
      if (path === '/staff/desk/ring/call-1/end') return reply({ ended: true });
      if (/^\/staff\/desk\/m\d\/read$/.test(path)) return reply({ read: true });
      if (/^\/staff\/desk\/m\d$/.test(path)) {
        const choice = (body as { choice: string }).choice;
        return reply({ matter: {}, message: WORDS[choice] });
      }
      if (path === '/staff/desk/reach') {
        return reply({ notificationsOn: true, devices: 0, phone: true, appRingSeconds: 30 });
      }
      if (path === '/staff/desk/test-call') {
        return reply({
          message:
            'Ozi is ringing you in the app now. If you do not answer within 30 seconds, Ozi rings your phone.',
          inApp: true,
          phone: true,
        });
      }
      if (path === '/staff/push-subscriptions') {
        return reply({ saved: true, message: 'Ozi can ring you in the app on this device.' }, 201);
      }
      if (path === '/staff/viewers') return reply({ viewers: [], areas: [] });
      if (path.startsWith('/config')) return reply({ push: { publicKey } });
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function panel(): void {
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
}

function spoken(engine: FakeEngine): string {
  return engine.spoken.map((s) => s.text).join(' | ');
}

async function say(engine: FakeEngine, text: string): Promise<void> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  engine.hear(text);
}

function decision(id: string) {
  return sent.find((r) => r.method === 'POST' && r.path === `/staff/desk/${id}`)?.body;
}

describe('the incoming call from Ozi', () => {
  it('is announced, with the focus on Answer; buttons and the keys 1, 2 and 3 decide', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const user = userEvent.setup({ delay: null });
    panel();

    const dialog = await screen.findByRole('alertdialog', { name: 'Ozi is calling' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Ozi is calling, Mr\. Anthony\./);
    const answer = within(dialog).getByRole('button', { name: 'Answer' });
    await waitFor(() => expect(answer).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    await waitFor(() => expect(spoken(engine)).toContain('Say answer, or not now.'));
    expect((await axe.run(dialog)).violations).toEqual([]);

    await user.click(answer);
    await waitFor(() =>
      expect(spoken(engine)).toContain(
        'Hello, Mr. Anthony. This is Ozi. Two things need you. The first. A new shop, Corner Bakery',
      ),
    );
    const call = screen.getByRole('alertdialog', { name: 'On a call with Ozi' });
    const approve = within(call).getByRole('button', { name: 'Approve' });
    expect(within(call).getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(within(call).getByRole('button', { name: 'Later' })).toBeInTheDocument();
    await waitFor(() => expect(approve).toHaveFocus());
    expect((await axe.run(call)).violations).toEqual([]);
    expect(sent.some((r) => r.path === '/staff/desk/m1/read')).toBe(true);

    // 1 on the keyboard, as on the keypad.
    await user.keyboard('1');
    await waitFor(() => expect(decision('m1')).toEqual({ choice: 'approve', via: 'app' }));
    await waitFor(() =>
      expect(spoken(engine)).toContain('Approved. The second, and last. A Shopper wrote'),
    );
    const heard = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Heard it' });
    await user.click(heard);
    await waitFor(() => expect(decision('m2')).toEqual({ choice: 'acknowledge', via: 'app' }));
    await waitFor(() =>
      expect(spoken(engine)).toContain("Thank you. That's everything. Goodbye, Mr. Anthony."),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(sent.some((r) => r.path === '/staff/desk/ring/call-1/end')).toBe(true);
  });

  it('can be answered and decided entirely by voice: "answer", "no", "later"', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    panel();
    await screen.findByRole('alertdialog', { name: 'Ozi is calling' });
    await waitFor(() => expect(spoken(engine)).toContain('Say answer, or not now.'));
    await say(engine, 'answer');
    await waitFor(() => expect(spoken(engine)).toContain('Two things need you.'));
    await say(engine, 'no');
    await waitFor(() => expect(decision('m1')).toEqual({ choice: 'decline', via: 'app' }));
    await waitFor(() => expect(spoken(engine)).toContain('Declined. The second, and last.'));
    // Something that is not an answer is asked again, and nothing is decided.
    await say(engine, 'what was that about');
    await waitFor(() =>
      expect(spoken(engine)).toContain(
        'Sorry, I did not catch that. Say heard it, or later, or press 1 or 3.',
      ),
    );
    expect(decision('m2')).toBeUndefined();
    await say(engine, 'later');
    await waitFor(() => expect(decision('m2')).toEqual({ choice: 'later', via: 'app' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('"Not now" closes it without answering', async () => {
    setVoiceEngine(fakeEngine());
    const user = userEvent.setup({ delay: null });
    panel();
    const dialog = await screen.findByRole('alertdialog', { name: 'Ozi is calling' });
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(sent.some((r) => r.path === '/staff/desk/ring/call-1/not-now')).toBe(true);
    expect(sent.some((r) => r.path === '/staff/desk/ring/call-1/answer')).toBe(false);
  });

  it('understands the words and keys the telephone does', () => {
    expect(heardChoice('yes', 'decide')).toBe('approve');
    expect(heardChoice('Approve it', 'decide')).toBe('approve');
    expect(heardChoice('no', 'decide')).toBe('decline');
    expect(heardChoice('decline', 'decide')).toBe('decline');
    expect(heardChoice('later please', 'decide')).toBe('later');
    expect(heardChoice('heard it', 'decide')).toBeNull();
    expect(heardChoice('heard it', 'acknowledge')).toBe('acknowledge');
    expect(heardChoice('yes', 'acknowledge')).toBe('acknowledge');
    expect(heardChoice('no', 'acknowledge')).toBeNull();
    expect(keyChoice('1', 'decide')).toBe('approve');
    expect(keyChoice('2', 'decide')).toBe('decline');
    expect(keyChoice('3', 'decide')).toBe('later');
    expect(keyChoice('1', 'acknowledge')).toBe('acknowledge');
    expect(keyChoice('2', 'acknowledge')).toBeNull();
  });
});

describe("My settings: Ozi's calls", () => {
  it('"Test Ozi\'s call" rings, and "Let Ozi ring me in the app" asks for notifications', async () => {
    ring = null;
    publicKey = 'BPublicKeyForTests';
    setVoiceEngine(fakeEngine());
    const user = userEvent.setup({ delay: null });
    // A browser that can show notifications, and says yes.
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/owner',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    };
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal(
      'Notification',
      Object.assign(function Notification() {}, { requestPermission }),
    );
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => subscription },
        }),
      },
    });

    panel();
    await openPage(user, 'My settings');
    const section = await screen.findByRole('region', { name: "Ozi's calls" });
    await within(section).findByText(/No device is set to ring yet\. Your phone is set up\./);

    await user.click(within(section).getByRole('button', { name: "Test Ozi's call" }));
    await waitFor(() => expect(sent.some((r) => r.path === '/staff/desk/test-call')).toBe(true));
    await screen.findByText(/Ozi is ringing you in the app now/);

    await user.click(within(section).getByRole('button', { name: 'Let Ozi ring me in the app' }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
    await waitFor(() =>
      expect(sent.find((r) => r.path === '/staff/push-subscriptions')?.body).toEqual({
        endpoint: 'https://fcm.googleapis.com/fcm/send/owner',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    );
    await screen.findByText('Ozi can ring you in the app on this device.');
    Reflect.deleteProperty(window.navigator, 'serviceWorker');
  });
});
