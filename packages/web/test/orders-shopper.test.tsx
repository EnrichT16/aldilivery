/**
 * The Shopper's side of an order (STILL_TO_DO items 1, 6, 7 and 10, and closing an account):
 * the arrival time said as "about", the door words with a button to hear them, feedback after
 * delivery that earns credit whatever it says, closing an account in two presses, and the
 * owner's till screen. Each is checked with axe as well.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { TillCases } from '../src/components/TillCases';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';
import { FAKE_SHOPPER } from './setup';

const DOOR_SENTENCE =
  'Your Runner is Tomasz. At your door they will say "blue kettle". If they do not, you do not need to open the door.';

/** Ozi has introduced itself already, so what it says next is what the test is about. */
function quietStart(): FakeEngine {
  window.localStorage.setItem('ozidelivery.voice.settings', JSON.stringify({ introHeard: true }));
  const engine = fakeEngine();
  setVoiceEngine(engine);
  return engine;
}

/** The Shopper says something once Ozi is listening. */
async function hear(engine: FakeEngine, text: string): Promise<void> {
  await waitFor(() => {
    expect(engine.listening).not.toBeNull();
  });
  engine.hear(text);
}

const alert = vi.hoisted(() => ({ chime: vi.fn(), buzz: vi.fn() }));
vi.mock('../src/lib/alert', () => alert);

interface State {
  status: string;
  feedbackGiven: boolean;
  closing: string | null;
  tillWaiting: boolean;
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

beforeEach(() => {
  state = {
    status: 'delivering',
    feedbackGiven: false,
    closing: null,
    tillWaiting: true,
    sent: [],
  };
  vi.clearAllMocks();
  URL.createObjectURL = () => 'blob:receipt';
});

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
    blob: async () => Promise.resolve(new Blob(['x'])),
  } as unknown as Response;
}

function stubApi(): void {
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      state.sent.push({ method, path, body });

      if (path === '/me') {
        return reply({
          role: 'shopper',
          shopper: { ...FAKE_SHOPPER, deletionScheduledFor: state.closing },
        });
      }
      if (path === '/config') return reply({ push: { publicKey: null } });
      if (path === '/orders/current') {
        return reply({
          order: {
            id: 'order-1',
            status: state.status,
            runnerName: 'Tomasz',
            items: [{ id: 'i1', name: 'Semi skimmed milk, 2 pints', quantity: 2 }],
            totalEstimatePence: 1600,
            deliveredAt: null,
            doorWord: 'blue kettle',
            doorWordSentence: DOOR_SENTENCE,
            eta: ['delivered', 'completed'].includes(state.status)
              ? null
              : { words: 'about 10 to 15 minutes', byAt: '2026-10-09T13:35:00.000Z' },
            feedbackGiven: state.feedbackGiven,
            feedbackCreditPence: 100,
          },
          questions: [],
        });
      }
      if (path === '/orders/order-1/feedback' && method === 'POST') {
        state.feedbackGiven = true;
        return reply(
          {
            creditPence: 100,
            message:
              'Thank you for telling us. £1.00 of delivery credit is on your account, and comes off your next order.',
          },
          201,
        );
      }
      if (path === '/account/delete' && method === 'POST') {
        state.closing = '2026-10-16T10:00:00.000Z';
        return reply({
          deletionScheduledFor: state.closing,
          recycleBinDays: 7,
          message:
            'Your account will be deleted in 7 days. Until then you can change your mind and we will put everything back.',
        });
      }
      if (path === '/account/restore' && method === 'POST') {
        state.closing = null;
        return reply({ restored: true, message: 'Your account is staying. Nothing was lost.' });
      }
      if (path === '/staff/till-cases') {
        return reply({
          waiting: state.tillWaiting
            ? [
                {
                  orderId: 'order-9',
                  reference: 'OZ-ABC123',
                  shopperName: 'Ada',
                  paidBy: 'card',
                  bankReference: null,
                  estimatePence: 1600,
                  tillTotalPence: 2350,
                  receiptTotalPence: 1000,
                  differencePence: 750,
                  reason: 'over the limit',
                  status: 'needs_person',
                  settledBy: null,
                  settledAt: null,
                  hasReceiptPhoto: true,
                },
              ]
            : [],
          settled: [],
        });
      }
      if (path === '/staff/till-cases/order-9/charge' && method === 'POST') {
        state.tillWaiting = false;
        return reply({ message: 'Taken: £7.50 from the card ending 4242.' });
      }
      if (path === '/staff/orders/order-9/receipt-photo') return reply({});
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function noViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

describe('the order page', () => {
  it('says about when it will arrive, never to the minute', async () => {
    stubApi();
    const { container } = renderAt('/my-order');
    expect(
      await screen.findByText(/Expected in about 10 to 15 minutes, by around/),
    ).toBeInTheDocument();
    await noViolations(container);
  });

  it('shows the door words, and has them said aloud on request', async () => {
    const user = userEvent.setup({ delay: null });
    const engine = quietStart();
    stubApi();
    renderAt('/my-order');
    expect(await screen.findByRole('heading', { name: 'Who is at the door' })).toBeInTheDocument();
    expect(screen.getByText('blue kettle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Say the door words aloud' }));
    await waitFor(() => {
      expect(engine.spoken.map((one) => one.text)).toContain(DOOR_SENTENCE);
    });
  });

  it('tells the Shopper the door words when asked by voice', async () => {
    const engine = quietStart();
    stubApi();
    renderAt('/shop');
    await hear(engine, 'what are the door words');
    await waitFor(() => {
      expect(engine.spoken.map((one) => one.text)).toContain(DOOR_SENTENCE);
    });
  });

  it('asks how it went once delivered, and any answer earns the credit', async () => {
    const user = userEvent.setup({ delay: null });
    state.status = 'delivered';
    stubApi();
    const { container } = renderAt('/my-order');
    expect(await screen.findByRole('heading', { name: 'How did it go?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who is at the door' })).not.toBeInTheDocument();
    await noViolations(container);

    // Nothing chosen: asked for something, nothing sent.
    await user.click(screen.getByRole('button', { name: 'Send my feedback' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please choose a score');

    await user.click(screen.getByRole('checkbox', { name: 'It came late' }));
    await user.click(screen.getByRole('button', { name: 'Send my feedback' }));
    expect(
      await screen.findByText(/£1.00 of delivery credit is on your account/),
    ).toBeInTheDocument();
    const posted = state.sent.find((one) => one.path === '/orders/order-1/feedback');
    expect(posted?.body).toEqual({ themes: ['late'], message: '' });
  });
});

describe('closing an account', () => {
  it('takes two presses, then offers to keep it', async () => {
    const user = userEvent.setup({ delay: null });
    stubApi();
    const { container } = renderAt('/settings');
    await user.click(await screen.findByRole('button', { name: 'Close my account' }));
    expect(state.sent.some((one) => one.path === '/account/delete')).toBe(false);
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Yes, close my account' }));
    expect(await screen.findByText(/Your account closes on/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(
      await screen.findByText('Your account is staying. Nothing was lost.'),
    ).toBeInTheDocument();
  });
});

describe('closing an account by voice', () => {
  it('asks once more, and closes it only on a yes', async () => {
    const engine = quietStart();
    stubApi();
    renderAt('/shop');
    await hear(engine, 'close my account');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(/^Do you want to close your account\?/);
    });
    await hear(engine, 'yes');
    await waitFor(() => {
      expect(state.sent.some((one) => one.path === '/account/delete')).toBe(true);
    });
  });

  it('keeps it on a no', async () => {
    const engine = quietStart();
    stubApi();
    renderAt('/shop');
    await hear(engine, 'close my account');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(/^Do you want to close your account\?/);
    });
    await hear(engine, 'no');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe('All right. Your account stays as it is.');
    });
    expect(state.sent.some((one) => one.path === '/account/delete')).toBe(false);
  });
});

describe('the owner’s till screen', () => {
  it('shows the difference and the receipt photo, and takes the extra in one press', async () => {
    const user = userEvent.setup({ delay: null });
    stubApi();
    const news = vi.fn();
    const { container } = render(<TillCases staffKey="st1.token" onNews={news} />);
    expect(await screen.findByText(/£7.50 more to take, Ada, order OZ-ABC123/)).toBeInTheDocument();
    await noViolations(container);

    await user.click(screen.getByRole('button', { name: /Show the receipt photo/ }));
    expect(
      await screen.findByRole('img', { name: 'The till receipt for order OZ-ABC123' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Take £7.50 from the saved card/ }));
    expect(news).toHaveBeenCalledWith('Taken: £7.50 from the card ending 4242.');
    expect(await screen.findByText('None waiting.')).toBeInTheDocument();
  });
});
