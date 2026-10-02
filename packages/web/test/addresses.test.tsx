/**
 * Addresses and the PIN on the screen (docs/BUILD_PROMPT.md, Section D): the page with its
 * plus marked ADD AN ADDRESS, the PIN chosen the first time and asked for after, typed or
 * said aloud, the home address changed only with it, and checkout offering home first, then
 * a different address, saved with the PIN or used once without.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import { parsePin } from '../src/voice/pin';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_CARD, FAKE_SHOPPER } from './setup';

interface Server {
  pin: string | null;
  home: string;
  saved: Array<{ id: string; label: string; address: string }>;
  sent: Array<{ method: string; path: string; body: Record<string, unknown> | undefined }>;
}

let server: Server;
let engine: FakeEngine;

const MILK = {
  id: 'item-milk',
  name: 'Semi skimmed milk, 2 pints',
  category: 'Dairy',
  estimatedPricePence: 125,
  ageRestricted: false,
};

beforeEach(() => {
  server = { pin: null, home: FAKE_SHOPPER.deliveryAddress, saved: [], sent: [] };
  engine = fakeEngine();
  setVoiceEngine(engine);
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
  // The introduction has been heard, so Ozi only speaks about this page.
  window.localStorage.setItem(
    'ozidelivery.voice.settings',
    JSON.stringify({
      muted: false,
      language: 'en-GB',
      voiceIds: {},
      introHeard: true,
      bubble: null,
    }),
  );
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
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      server.sent.push({ method, path, body });
      const wrongPin = (): Response | null => {
        if (server.pin === null) {
          return reply(
            { error: { message: 'Choose a PIN first.', details: { pin: 'needed' } } },
            409,
          );
        }
        return body?.['pin'] === server.pin
          ? null
          : reply({ error: { message: 'That PIN is not right. You can try 2 more times.' } }, 403);
      };

      if (path === '/me') {
        return reply({
          role: 'shopper',
          shopper: { ...FAKE_SHOPPER, deliveryAddress: server.home, hasPin: server.pin !== null },
        });
      }
      if (path === '/me/addresses' && method === 'GET') {
        return reply({
          home: server.home,
          saved: server.saved.map((a) => ({ ...a })),
          hasPin: server.pin !== null,
        });
      }
      if (path === '/me/pin') {
        if (body?.['pin'] === '1234') {
          return reply(
            {
              error: {
                message:
                  'That PIN is a run of numbers, which is easy to guess. Please choose another.',
              },
            },
            400,
          );
        }
        server.pin = String(body?.['pin']);
        return reply({ message: 'Your PIN is set.' }, 201);
      }
      if (path === '/me/addresses' && method === 'POST') {
        const refused = wrongPin();
        if (refused) return refused;
        const saved = {
          id: `addr-${server.saved.length + 1}`,
          label: String(body?.['label'] ?? ''),
          address: String(body?.['address']),
        };
        server.saved.push(saved);
        return reply({ address: { ...saved }, message: 'Saved.' }, 201);
      }
      if (path.startsWith('/me/addresses/') && method === 'DELETE') {
        server.saved = server.saved.filter((a) => !path.endsWith(a.id));
        return reply({ removed: true, message: 'That address has been removed.' });
      }
      if (path === '/me/home-address') {
        const refused = wrongPin();
        if (refused) return refused;
        server.home = String(body?.['address']);
        return reply({
          home: server.home,
          message: 'Your home address is changed. We have let you know on your phone as well.',
        });
      }
      if (path.startsWith('/catalogue/search')) {
        return reply({ items: [MILK], source: { mode: 'community', attribution: 'x' } });
      }
      if (path === '/payment-methods') return reply({ paymentMethods: [FAKE_CARD] });
      if (path === '/orders' && method === 'POST') {
        return reply(
          {
            order: { id: 'order-9', status: 'paid' },
            payment: { requiresAction: false },
            message: 'Thank you.',
          },
          201,
        );
      }
      if (path === '/config') {
        return reply({
          push: { publicKey: null },
          payments: { mode: 'rehearsal', publishableKey: null, supportedCardRegions: ['GB'] },
          signIn: { byText: true },
        });
      }
      if (path === '/orders/current') return reply({ order: null });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('a PIN said aloud', () => {
  it('hears four numbers however they are said, and nothing less', () => {
    expect(parsePin('two seven five nine')).toBe('2759');
    expect(parsePin('2 7 5 9')).toBe('2759');
    expect(parsePin('my PIN is 2759')).toBe('2759');
    expect(parsePin('oh eight one four')).toBe('0814');
    expect(parsePin('double seven one three')).toBe('7713');
    expect(parsePin('two seven five')).toBeNull();
    expect(parsePin('two seven five nine one')).toBeNull();
    expect(parsePin('I do not know')).toBeNull();
  });
});

describe('your addresses', () => {
  it('has a plus marked ADD AN ADDRESS, and Ozi says it is there', async () => {
    const view = renderAt('/addresses');
    const add = await screen.findByRole('button', { name: 'Add an address' });
    expect(add).toHaveTextContent('+');
    expect(within(add).getByText('Add an address')).toHaveClass('uppercase');
    await waitFor(() => {
      expect(engine.spoken.map((s) => s.text).join(' ')).toMatch(
        /To add one, press the plus button marked Add an address/,
      );
    });
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);
  });

  it('asks for a PIN to be chosen the first time, twice, then saves with it', async () => {
    const user = userEvent.setup();
    renderAt('/addresses');
    await user.click(await screen.findByRole('button', { name: 'Add an address' }));
    await user.type(screen.getByLabelText(/A name for it/), 'Mum');
    await user.type(screen.getByLabelText('The address'), '4 Other Road, Rochester, ME1 1AA');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      screen.getByRole('heading', { name: 'Choose a PIN to save this address' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('The same PIN again'), '1234');
    await user.click(screen.getByRole('button', { name: 'Choose this PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/run of numbers/);

    await user.type(screen.getByLabelText('PIN'), '2759');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('The same PIN again'), '2795');
    await user.click(screen.getByRole('button', { name: 'Choose this PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not the same/);

    await user.type(screen.getByLabelText('PIN'), '2759');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('The same PIN again'), '2759');
    await user.click(screen.getByRole('button', { name: 'Choose this PIN' }));

    expect(
      await screen.findByText('4 Other Road, Rochester, ME1 1AA', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(server.pin).toBe('2759');
    expect(server.saved).toEqual([
      { id: 'addr-1', label: 'Mum', address: '4 Other Road, Rochester, ME1 1AA' },
    ]);
  });

  it('opens with the form when Ozi is asked to add an address, and takes the PIN said aloud', async () => {
    server.pin = '2759';
    renderAt('/shop');
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('Ozi, add an address');
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('The address'), '9 Halls, Canterbury, CT1 1AA');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Say my PIN' }));
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(/^Say the four numbers of your PIN/);
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear('two seven five nine');
    });
    expect(
      await screen.findByText('9 Halls, Canterbury, CT1 1AA', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(server.saved).toHaveLength(1);
    // The PIN is never said back, and never shown.
    expect(engine.spoken.some((s) => /2759|two seven five nine/i.test(s.text))).toBe(false);
    expect(document.body.textContent).not.toMatch(/2759/);
  });

  it('changes the home address only with the PIN', async () => {
    server.pin = '2759';
    const user = userEvent.setup();
    renderAt('/addresses');
    await user.click(await screen.findByRole('button', { name: 'Change your home address' }));
    await user.type(screen.getByLabelText('Your new home address'), '1 New Road, Chatham, ME4 1AA');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('PIN'), '1111');
    await user.click(screen.getByRole('button', { name: 'Use this PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That PIN is not right.');
    expect(server.home).toBe(FAKE_SHOPPER.deliveryAddress);

    await user.type(screen.getByLabelText('PIN'), '2759');
    await user.click(screen.getByRole('button', { name: 'Use this PIN' }));
    expect(
      await screen.findByText('1 New Road, Chatham, ME4 1AA', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(server.home).toBe('1 New Road, Chatham, ME4 1AA');
  });

  it('removes one without a PIN', async () => {
    server.saved = [{ id: 'addr-1', label: 'Mum', address: '4 Other Road' }];
    const user = userEvent.setup();
    renderAt('/addresses');
    await user.click(await screen.findByRole('button', { name: 'Remove Mum' }));
    await waitFor(() => {
      expect(screen.queryByText('4 Other Road')).toBeNull();
    });
    expect(server.saved).toEqual([]);
  });
});

describe('where an order goes, at checkout', () => {
  async function toCheckout(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    renderAt('/shop');
    await user.click(await screen.findByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));
  }

  it('offers home first and saved addresses beside it', async () => {
    server.saved = [{ id: 'addr-1', label: "Tom's halls", address: '1 Halls, Canterbury' }];
    const user = userEvent.setup();
    await toCheckout(user);
    const home = await screen.findByRole('radio', { name: /Your home address/ });
    expect(home).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Tom's halls/ }));
    await user.click(screen.getByRole('button', { name: 'Yes, this is the right address' }));
    await user.click(screen.getByRole('button', { name: 'Send my order' }));
    await waitFor(() => {
      expect(server.sent.find((r) => r.path === '/orders')?.body?.['deliveryAddress']).toBe(
        '1 Halls, Canterbury',
      );
    });
  });

  it('uses a different address once, with no PIN', async () => {
    const user = userEvent.setup();
    await toCheckout(user);
    await user.click(await screen.findByRole('button', { name: 'Send to a different address' }));
    await user.type(screen.getByLabelText('The address to send it to'), '5 Friend Street, Strood');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Save it for next time, or use it this once?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use it once, for this order only' }));

    expect(screen.getByRole('radio', { name: /This order only/ })).toBeChecked();
    expect(server.sent.some((r) => r.method !== 'GET' && r.path.startsWith('/me'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, this is the right address' }));
    await user.click(screen.getByRole('button', { name: 'Send my order' }));
    await waitFor(() => {
      expect(server.sent.find((r) => r.path === '/orders')?.body?.['deliveryAddress']).toBe(
        '5 Friend Street, Strood',
      );
    });
  });

  it('saving a different address asks for the PIN, then chooses it', async () => {
    server.pin = '2759';
    const user = userEvent.setup();
    await toCheckout(user);
    await user.click(await screen.findByRole('button', { name: 'Send to a different address' }));
    await user.type(screen.getByLabelText('The address to send it to'), '5 Friend Street, Strood');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Save it for next time' }));
    await user.type(screen.getByLabelText('PIN'), '2759');
    await user.click(screen.getByRole('button', { name: 'Use this PIN' }));
    expect(await screen.findByRole('radio', { name: /5 Friend Street/ })).toBeChecked();
    expect(server.saved).toHaveLength(1);
  });
});
