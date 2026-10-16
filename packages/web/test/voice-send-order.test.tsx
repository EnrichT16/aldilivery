/**
 * "Send my order" by voice (16 October 2026): the basket as it stands, read back whole with the
 * total, a yes to the home address, a yes to paying, then sent — and when the bank wants its own
 * check on a voice order, the same bank step the confirmation screen opens, said aloud first.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_CARD, FAKE_SHOPPER } from './setup';

/**
 * The bank check itself is proved in stripe.test.ts; here the shared helper is stood in for, so
 * what is tested is that a voice order reaches it with the bank's secret and says what came back.
 */
const bank = vi.hoisted(() => ({
  completeBankCheck: vi.fn(async (_secret: string) => Promise.resolve({ ok: true as const })),
}));
vi.mock('../src/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/stripe')>()),
  completeBankCheck: bank.completeBankCheck,
}));

const BANANAS = {
  id: 'item-bananas',
  name: 'Bananas, loose',
  category: 'Fruit',
  estimatedPricePence: 20,
  ageRestricted: false,
};

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function stubShop(options: { bankCheck?: boolean } = {}): Sent[] {
  const sent: Sent[] = [];
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
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
      if (path === '/me') return reply({ role: 'shopper', shopper: FAKE_SHOPPER });
      if (path.startsWith('/catalogue/search')) {
        const q = new URLSearchParams(path.split('?')[1]).get('q')?.toLowerCase() ?? '';
        return reply({
          items: q.includes('banana') ? [BANANAS] : [],
          source: { mode: 'community', attribution: 'x' },
        });
      }
      if (path === '/payment-methods') return reply({ paymentMethods: [FAKE_CARD] });
      if (path === '/orders' && method === 'POST') {
        return reply(
          options.bankCheck
            ? {
                order: { id: 'order-9', status: 'confirmed' },
                payment: { requiresAction: true, clientSecret: 'pi_9_secret' },
                message: 'Your bank wants to check it is really you. Nothing has been taken yet.',
              }
            : {
                order: { id: 'order-9', status: 'paid' },
                payment: { requiresAction: false },
                message: 'Thank you. Your order is on its way to a Runner.',
              },
          201,
        );
      }
      if (path === '/config') {
        return reply({
          push: { publicKey: null },
          payments: options.bankCheck
            ? { mode: 'stripe', publishableKey: 'pk_test_x', supportedCardRegions: ['GB'] }
            : { mode: 'rehearsal', publishableKey: null, supportedCardRegions: ['GB'] },
          signIn: { byText: true },
        });
      }
      if (path === '/orders/current') return reply({ order: null });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
  return sent;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/shop']}>
      <App />
    </MemoryRouter>,
  );
}

async function say(engine: FakeEngine, text: string): Promise<string> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  const before = engine.spoken.length;
  act(() => {
    engine.hear(text);
  });
  await waitFor(() => {
    expect(engine.spoken.length).toBeGreaterThan(before);
  });
  return engine.spoken.at(-1)?.text ?? '';
}

/** Three bananas in the basket, put there by voice and kept after a no to paying. */
async function fillBasket(engine: FakeEngine): Promise<void> {
  await say(engine, 'I want three bananas');
  await say(engine, 'yes');
  expect(await say(engine, 'no')).toMatch(/^All right\. Nothing has been sent/);
}

describe('"send my order" by voice', () => {
  it('reads the whole basket back with the total, takes the two yeses, and sends it', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    await fillBasket(engine);

    // 3 x 20p of shopping with three 50p item charges is £2.10; £7.99 delivery: £10.09.
    expect(await say(engine, 'send my order')).toBe(
      `Here is your order: 3 Bananas, loose. Your shopping comes to about £2.10, with the item charges included, and delivery is £7.99, so about £10.09 altogether. It will be delivered to your home address: ${FAKE_SHOPPER.deliveryAddress}. Is that right?`,
    );
    expect(await say(engine, 'yes')).toMatch(
      /^Shall I send your order and pay now, charging about £10\.09/,
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
    expect(await say(engine, 'yes')).toMatch(/^Thank you\. Your order is on its way/);
    expect(sent.find((r) => r.method === 'POST' && r.path === '/orders')?.body).toMatchObject({
      lines: [{ catalogueItemId: 'item-bananas', quantity: 3 }],
      deliveryAddress: FAKE_SHOPPER.deliveryAddress,
      confirmation: { channel: 'voice', addressConfirmed: true, agreedTotalPence: 1009 },
    });
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
  });

  it('says so when the basket is empty', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    const sent = stubShop();
    renderApp();
    expect(await say(engine, 'Ozi, send my order')).toMatch(/^Your basket is empty/);
    expect(sent.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(false);
  });

  it('opens the bank’s own check when the bank asks for one, and says what is happening', async () => {
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({ bankCheck: true });
    renderApp();
    await fillBasket(engine);
    await say(engine, 'send the order');
    await say(engine, 'yes');
    await say(engine, 'yes');
    await waitFor(() => {
      expect(bank.completeBankCheck).toHaveBeenCalledWith('pi_9_secret');
    });
    const spoken = engine.spoken.map((s) => s.text);
    expect(spoken.some((text) => /Your bank's own screen is opening now/.test(text))).toBe(true);
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(/^Thank you, your bank said yes\./);
    });
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
  });

  it('keeps the shopping and says so when the bank says no', async () => {
    bank.completeBankCheck.mockResolvedValueOnce({
      ok: false,
      message: 'Your bank did not approve this payment.',
    } as never);
    const engine = fakeEngine();
    setVoiceEngine(engine);
    stubShop({ bankCheck: true });
    renderApp();
    await fillBasket(engine);
    await say(engine, 'send my order');
    await say(engine, 'yes');
    await say(engine, 'yes');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe(
        'Your bank did not approve this payment. Your shopping is still in your basket.',
      );
    });
    expect(screen.queryByRole('heading', { name: 'Your order' })).not.toBeInTheDocument();
  });
});
