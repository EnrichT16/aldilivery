/**
 * Codes by automatic phone call for landlines, and a new account's number confirmed with a
 * code first, on the form and by voice (rulings 27 and 33, 4 October 2026).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { stubApi } from './setup';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function introHeard(): void {
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
}

async function say(engine: FakeEngine, text: string): Promise<void> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  const before = engine.spoken.length;
  engine.hear(text);
  await waitFor(() => {
    expect(engine.spoken.length).toBeGreaterThan(before);
  });
}

const lastSaid = (engine: FakeEngine): string => engine.spoken.at(-1)?.text ?? '';

describe('signing in from a landline', () => {
  it('offers a phone call that reads the code', async () => {
    introHeard();
    setVoiceEngine(fakeEngine());
    const sent = stubApi({ signInByCall: true });
    const user = userEvent.setup();
    renderAt('/sign-in');
    await user.type(await screen.findByLabelText('Your phone number'), '01634 123456');
    await user.click(await screen.findByRole('button', { name: 'Call me with the code' }));
    expect(await screen.findByLabelText('The code from the phone call')).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/auth/request-code')?.body).toMatchObject({
      phone: '01634 123456',
      channel: 'call',
    });
  });

  it('does not offer a call while calls are not set up', async () => {
    introHeard();
    setVoiceEngine(fakeEngine());
    stubApi();
    renderAt('/sign-in');
    await screen.findByRole('button', { name: 'Text me a code' });
    expect(screen.queryByRole('button', { name: 'Call me with the code' })).not.toBeInTheDocument();
  });
});

describe('confirming a new account’s number', () => {
  it('on the form: sends a code, then creates the account with the proof', async () => {
    introHeard();
    setVoiceEngine(fakeEngine());
    window.sessionStorage.setItem('ozidelivery.signup.offered', 'yes');
    const sent = stubApi({ confirmAtSignUp: true, verifyResult: 'no-account' });
    const user = userEvent.setup();
    renderAt('/sign-up');
    await user.type(await screen.findByLabelText('Your name'), 'Margaret');
    await user.type(screen.getByLabelText('Your phone number'), '07700 900123');
    await user.type(
      screen.getByLabelText('Where should we bring your shopping?'),
      '12 Example Street, Gillingham, ME7 1AA',
    );
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    expect(
      await screen.findByRole('heading', { name: 'Check it is your number' }),
    ).toBeInTheDocument();
    expect(sent.some((r) => r.path === '/shoppers')).toBe(false);
    expect(sent.find((r) => r.path === '/auth/request-code')?.body).toMatchObject({
      channel: 'text',
      purpose: 'sign-up',
    });

    await user.type(screen.getByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and create my account' }));
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/shoppers')?.body).toMatchObject({
        displayName: 'Margaret',
        phone: '07700 900123',
        phoneProof: 'proof-token',
      });
    });
  });

  it('by voice: Ozi sends the code, hears it, and only then asks for the address', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubApi({ confirmAtSignUp: true, verifyResult: 'no-account' });
    renderAt('/sign-up?talk=1');
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(/what's your name\?/);
    });
    await say(engine, 'Margaret');
    await say(engine, '07700 900123');
    await say(engine, 'yes');
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(/I've sent a code to it by text/);
    });
    await say(engine, 'one two three four five six');
    await waitFor(() => {
      expect(lastSaid(engine)).toMatch(
        /^Thank you, your number is confirmed\. Where should we bring/,
      );
    });
    expect(sent.find((r) => r.path === '/auth/verify-code')?.body).toMatchObject({
      code: '123456',
    });
  });
});
