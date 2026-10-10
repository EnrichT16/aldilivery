/**
 * What Anthony asked for on 4 October 2026:
 * - a switch at the bottom of every screen, and "turn off talking" / "Hey Ozi, turn on" by voice;
 * - "say that again", "come again", "pardon": the last thing said, a different way each time,
 *   then "Did you hear that?";
 * - the telephone number in twos, said twice, and a third time if asked;
 * - opening an account by talking: Ozi asks, fills in the form, reads back, and only creates it
 *   after a yes;
 * - when the browser would not let Ozi speak first, a big "tap anywhere" and speech at the touch.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { pairsAloud, inPairs } from '../src/lib/phone-aloud';
import { spokenDigits, spokenName, yesOrNo } from '../src/state/voice-sign-up';
import { setVoiceEngine, type SpeakOutcome } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_CARD, FAKE_SHOPPER, stubApi } from './setup';

const SETTINGS = 'ozidelivery.voice.settings';

function introHeard(extra: Record<string, unknown> = {}): void {
  window.localStorage.setItem(SETTINGS, JSON.stringify({ introHeard: true, ...extra }));
}

function stored(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(SETTINGS) ?? '{}') as Record<string, unknown>;
}

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

async function listening(engine: FakeEngine): Promise<void> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
}

/** The Shopper says something once Ozi is listening, then Ozi has its say. */
async function say(engine: FakeEngine, text: string): Promise<void> {
  await listening(engine);
  const before = engine.spoken.length;
  engine.hear(text);
  await waitFor(() => {
    expect(engine.spoken.length).toBeGreaterThan(before);
  });
}

describe('the switch, and turning talking off and on by voice', () => {
  it('is at the bottom of every screen, and off keeps Ozi listening but silent', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    const toggle = screen.getByRole('switch', { name: 'Ozi talks and listens' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await listening(engine);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(stored()).toMatchObject({ muted: true });
    await listening(engine);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(said(engine)).toContain("I'm talking out loud again. Send me, I will deliver.");
    });
  });

  it('turns off when told, says how to turn it back on, and turns on to "Hey Ozi, turn on"', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');

    await say(engine, 'turn off talking');
    const goodbye = said(engine).at(-1)!;
    expect(goodbye).toMatch(/^Okay, I'm turning off talking now\./);
    expect(goodbye).toMatch(
      /use the switch at the bottom of the screen, or in Settings, or just say: "Hey Ozi, turn on"/,
    );
    await waitFor(() => {
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });

    // Still listening while silent, so it can be turned back on by voice.
    await say(engine, 'Hey Ozi, turn on');
    expect(said(engine).at(-1)).toBe("I'm talking out loud again. Send me, I will deliver.");
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('saying it again', () => {
  it('repeats the last thing, a different way each time, and asks whether it was heard', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER });
    renderAt('/shop');

    await say(engine, 'Ozi');
    const original = said(engine).at(-1)!;

    await say(engine, 'Sorry, can you say that again?');
    await waitFor(() => {
      expect(said(engine).at(-1)).toBe('Did you hear that? Say yes or no.');
    });
    expect(said(engine).at(-2)).toBe(`Of course. I said: ${original}`);

    await say(engine, 'no');
    await waitFor(() => {
      expect(said(engine).at(-1)).toBe('Did you hear that? Say yes or no.');
    });
    expect(said(engine).at(-2)).toBe(`Sure, here it is again. ${original}`);

    await say(engine, 'yes thank you');
    expect(said(engine).at(-1)).toBe('Good.');

    await say(engine, 'I beg your pardon');
    await waitFor(() => {
      expect(said(engine).at(-2)).toBe(`No problem, I'll say that again. ${original}`);
    });
  });
});

describe('saying a question again', () => {
  it('asks the same question again, and still takes the answer', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await say(engine, 'Ozi, I would like some milk');
    const question = said(engine).at(-1)!;
    expect(question).toMatch(/Would you like to create an account, or sign in\?/);

    await say(engine, 'come again?');
    expect(said(engine).at(-1)).toBe(`Of course. I said: ${question}`);

    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/what's your name\?/);
    });
  });
});

describe('the telephone number', () => {
  it('is read in twos, twice, and a third time when asked', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');

    await say(engine, "What's your phone number?");
    const aloud = 'zero eight, zero zero, zero zero, zero zero, zero zero, zero';
    const reply = said(engine).at(-1)!;
    expect(reply.split(aloud)).toHaveLength(3);
    expect(reply).toMatch(/It's on the screen too, as 08 00 00 00 00 0\./);
    expect(reply).toMatch(/just say yes please, or repeat\.$/);

    await say(engine, 'yes please');
    expect(said(engine).at(-1)).toMatch(new RegExp(`^Of course\\. The number is: ${aloud}\\.`));
  });

  it('is put in twos for the screen and for speaking', () => {
    expect(inPairs('0163 485 7125 2')).toBe('01 63 48 57 12 52');
    expect(pairsAloud('01 63')).toBe('zero one, six three');
  });
});

describe('opening an account by talking', () => {
  it('is offered after the introduction, and done entirely by voice', async () => {
    window.localStorage.removeItem(SETTINGS);
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubApi();
    renderAt('/');

    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/^Do you need any extra help\?/);
    });
    await say(engine, 'no');
    expect(said(engine).at(-1)).toMatch(/Would you like to create an account, or sign in\?/);
    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/First, what's your name\?/);
    });
    expect(screen.getByRole('heading', { name: 'Set up your account' })).toBeInTheDocument();

    await say(engine, 'My name is margaret');
    expect(said(engine).at(-1)).toBe(
      "Thank you, Margaret. What's your phone number? A mobile or a landline.",
    );
    expect(screen.getByLabelText('Your name')).toHaveValue('Margaret');

    await say(engine, 'oh seven seven double oh nine double oh one two three');
    expect(said(engine).at(-1)).toBe(
      'I heard zero seven, seven zero, zero nine, zero zero, one two, three. Is that right?',
    );
    await say(engine, "yes that's right");
    expect(screen.getByLabelText('Your phone number')).toHaveValue('07700900123');
    expect(said(engine).at(-1)).toMatch(/^Where should we bring your shopping\?/);

    await say(engine, '12 Example Street Gillingham ME7 1AA');
    expect(said(engine).at(-1)).toBe(
      'I heard: 12 Example Street Gillingham ME7 1AA. Is that right?',
    );
    await say(engine, 'yes');
    expect(said(engine).at(-1)).toMatch(/^What should your Runner do at the door\?/);

    await say(engine, 'nothing thanks');
    expect(said(engine).at(-1)).toMatch(/^That's everything\. You are Margaret/);
    expect(sent.some((r) => r.path === '/shoppers')).toBe(false);

    await say(engine, 'yes please');
    await waitFor(() => {
      expect(sent.find((r) => r.path === '/shoppers')?.body).toEqual({
        displayName: 'Margaret',
        phone: '07700900123',
        deliveryAddress: '12 Example Street Gillingham ME7 1AA',
        doorstepProtocol: '',
      });
    });
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/^Your account is ready/);
    });
  });

  it('stops when told, and creates nothing', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubApi();
    renderAt('/');
    await say(engine, 'open an account');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/what's your name\?/);
    });
    await say(engine, 'stop');
    expect(said(engine).at(-1)).toMatch(/^All right, I've stopped\. Nothing has been created\./);
    expect(sent.some((r) => r.path === '/shoppers')).toBe(false);
  });

  it('understands names, numbers and answers as people say them', () => {
    expect(spokenName("it's john smith.")).toBe('John Smith');
    expect(spokenDigits('07700 900123')).toBe('07700900123');
    expect(spokenDigits('triple seven')).toBe('777');
    expect(yesOrNo("no that's not right")).toBe('no');
    expect(yesOrNo('yeah')).toBe('yes');
    expect(yesOrNo('maybe')).toBeNull();
  });
});

describe('when the browser will not let Ozi speak first', () => {
  it('says so in big letters, and speaks at the first touch anywhere', async () => {
    window.localStorage.removeItem(SETTINGS);
    const engine = fakeEngine();
    let allowed = false;
    const speak = engine.speak.bind(engine);
    engine.speak = (text, options): Promise<SpeakOutcome> => {
      if (!allowed) return Promise.resolve('not-spoken');
      return speak(text, options);
    };
    setVoiceEngine(engine);
    stubApi();
    const user = userEvent.setup();
    renderAt('/');

    const notice = await screen.findByRole('button', {
      name: 'Tap anywhere, and Ozi will talk to you',
    });
    allowed = true;
    await user.click(notice);
    await waitFor(() => {
      expect(said(engine)[0]).toMatch(/^Hello, I'm Ozi, your shopping assistant\./);
    });
    expect(
      screen.queryByRole('button', { name: 'Tap anywhere, and Ozi will talk to you' }),
    ).not.toBeInTheDocument();
  });
});

describe('a shared phone', () => {
  it('signs out, and changes account, by voice', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER });
    renderAt('/shop');
    await screen.findByRole('link', { name: 'Your order' });

    await say(engine, 'Ozi, change account');
    expect(said(engine).at(-1)).toBe(
      "I've signed out Ada. Would you like to sign in to another account, or open a new one? Say sign in, or new account.",
    );
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Your order' })).not.toBeInTheDocument();
    });
    await say(engine, 'new account');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/what's your name\?/);
    });
  });

  it('says so when nobody is signed in', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await say(engine, 'sign me out');
    expect(said(engine).at(-1)).toMatch(/^Nobody is signed in on this phone\./);
  });
});

describe('signing out in Settings', () => {
  it('has a Sign out button for a shared phone', async () => {
    introHeard();
    setVoiceEngine(fakeEngine());
    stubApi({ shopper: FAKE_SHOPPER });
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Your order' })).not.toBeInTheDocument();
  });
});

describe('hearing its name, however the phone spells it', () => {
  it('answers "Hey Ozzy" on its own, a different way each time', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER });
    renderAt('/shop');
    await say(engine, 'Hey Ozzy');
    expect(said(engine).at(-1)).toBe("I'm here. How can I help?");
    await say(engine, 'Aussie?');
    expect(said(engine).at(-1)).toBe("Yes, I'm listening. What would you like?");
  });

  it('asks again what it had asked, and keeps the question open', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi();
    renderAt('/shop');
    await say(engine, 'Ozzie, I would like some milk');
    const question = said(engine).at(-1)!;
    expect(question).toMatch(/Would you like to create an account, or sign in\?/);
    await say(engine, 'hey ozzy');
    expect(said(engine).at(-1)).toBe(`I'm here. ${question}`);
    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/what's your name\?/);
    });
  });

  it('knows the name inside a sentence', async () => {
    const { nameHeardIn, onlyName } = await import('../src/voice/name');
    expect(nameHeardIn('hey Aussie can you get bread')).toBe(true);
    expect(nameHeardIn('the oz is hot')).toBe(false);
    expect(onlyName('Hey Ozzy!')).toBe(true);
    expect(onlyName('Ozzy get milk')).toBe(false);
  });
});

describe('the card page', () => {
  it('has Ozi say what it is and what to do', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER });
    renderAt('/card');
    await waitFor(() => {
      expect(said(engine).join(' ')).toMatch(/Card payments are not switched on yet/);
    });
  });
});

describe('everyday phrases, answered by the server (ruling 44)', () => {
  it('asks the server, says its reply, and never orders "Ozi, thank you"', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const recorded = stubApi();
    renderAt('/shop');

    await say(engine, 'Ozi, thank you');
    await waitFor(() => {
      expect(said(engine).at(-1)).toBe("You're welcome. Send me, I will deliver.");
    });
    const asked = recorded.find((r) => r.path === '/ozi/reply');
    expect(asked?.body).toEqual({ text: 'Ozi, thank you', mode: 'exact', turn: 0 });
    expect(recorded.some((r) => r.path.startsWith('/basket'))).toBe(false);
  });
});

describe('create an account, or sign in (ruling 47)', () => {
  it('signs in by voice with the phone number and a code, then says what is left to set up', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubApi({ paymentMethods: [] });
    renderAt('/shop');

    await say(engine, 'sign in');
    expect(said(engine).at(-1)).toBe("Let's sign you in. What's the phone number on your account?");
    await say(engine, 'oh seven seven double oh nine double oh one two three');
    expect(said(engine).at(-1)).toBe(
      'I heard zero seven, seven zero, zero nine, zero zero, one two, three. Is that right?',
    );
    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/^I've sent a code by text to that number/);
    });
    expect(sent.find((r) => r.path === '/auth/request-code')?.body).toMatchObject({
      phone: '07700900123',
      channel: 'text',
    });

    await say(engine, 'four seven two nine one three');
    expect(sent.find((r) => r.path === '/auth/verify-code')?.body).toMatchObject({
      phone: '07700900123',
      code: '472913',
    });
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(
        /^Welcome back, Ada\. Your account isn't fully set up yet: your card details .*missing\. Would you like to finish it now\?/,
      );
    });
    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).some((text) => /^Here's where your card goes/.test(text))).toBe(true);
    });
  });

  it('offers to create an account when the number has none', async () => {
    introHeard();
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ verifyResult: 'no-account' });
    renderAt('/shop');
    await say(engine, 'I want to log in');
    await say(engine, 'zero seven seven zero zero nine zero zero one two three');
    await say(engine, 'yes');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/say the six numbers/);
    });
    await say(engine, 'one two three four five six');
    await waitFor(() => {
      expect(said(engine).at(-1)).toMatch(/^There's no account on that number yet/);
    });
  });

  it('opens straight into the shop for somebody signed in, and welcomes them once', async () => {
    introHeard();
    window.sessionStorage.removeItem('ozidelivery.welcomed');
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    renderAt('/');
    await waitFor(() => {
      expect(said(engine).at(-1)).toBe('Welcome back, Ada. What shopping would you like today?');
    });
    expect(screen.queryByRole('heading', { name: 'Who are you?' })).not.toBeInTheDocument();
  });
});
