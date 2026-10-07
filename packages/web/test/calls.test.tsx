/**
 * Calling about an order (Section F): the Shopper agrees the price before calling, answering or
 * adding anyone; a Runner calls and answers for free; END CALL and MUTE are big buttons; a carer
 * joins from a link with no account. No telephone number appears anywhere.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { CallControls } from '../src/components/CallControls';
import { FAKE_SHOPPER } from './setup';

const livekit = vi.hoisted(() => {
  const connection = {
    setMuted: vi.fn(async () => Promise.resolve()),
    leave: vi.fn(async () => Promise.resolve()),
  };
  return {
    connection,
    connectToCall: vi.fn(async () => Promise.resolve(connection)),
  };
});
vi.mock('../src/lib/call-connection', () => ({ connectToCall: livekit.connectToCall }));

interface State {
  callsEnabled: boolean;
  current: null | { id: string; status: string; startedBy: 'shopper' | 'runner' };
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

const JOIN = { url: 'wss://calls.example', token: 'pass', roomName: 'order-1' };

beforeEach(() => {
  state = { callsEnabled: true, current: null, sent: [] };
  vi.clearAllMocks();
  window.localStorage.setItem('ozidelivery.session.token', 'test-token');
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;
  const call = (status = 'ringing') => ({
    id: 'call-1',
    orderId: 'order-1',
    status,
    startedBy: 'shopper',
    pencePerMinute: 5,
    priceAccepted: true,
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      state.sent.push({ method, path, body });

      if (path === '/me') return reply({ role: 'shopper', shopper: FAKE_SHOPPER });
      if (path === '/config') {
        return reply({
          push: { publicKey: null },
          calls: { enabled: state.callsEnabled, pencePerMinute: 5 },
        });
      }
      if (path === '/orders/current') {
        return reply({
          order: {
            id: 'order-1',
            status: 'shopping',
            runnerName: 'Tomasz',
            items: [{ id: 'i1', name: 'Semi skimmed milk, 2 pints', quantity: 1 }],
            totalEstimatePence: 1450,
            deliveredAt: null,
          },
          questions: [],
        });
      }
      if (path === '/orders/order-1/calls/current') {
        return reply({
          call: state.current
            ? { ...call(state.current.status), ...state.current, orderId: 'order-1' }
            : null,
        });
      }
      if (path === '/orders/order-1/calls' && method === 'POST') {
        return reply({ call: call(), join: JOIN }, 201);
      }
      if (path === '/calls/call-1/join') return reply({ call: call('live'), join: JOIN });
      if (path === '/calls/call-1/end') return reply({ call: call('ended') });
      if (path === '/calls/call-1/guests') {
        return reply({
          link: 'https://ozidelivery.example/call/join#guest-code',
          message: 'Send this link to Mary. When they open it, they join the call.',
        });
      }
      if (path === '/calls/guest-join') return reply({ name: 'Mary', join: JOIN });
      if (path === '/calls/call-1/phone') {
        return reply({
          ringing: true,
          message: "Ringing Margaret's phone now. Their number is never shown to you.",
        });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function expectAccessible(): Promise<void> {
  const results = await axe.run(document.body);
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe('the Shopper calling their Runner', () => {
  it('puts the price first, and calls only after a yes', async () => {
    const user = userEvent.setup();
    renderAt('/my-order');
    await user.click(await screen.findByRole('button', { name: 'Call Tomasz' }));
    expect(screen.getByText(/Calls cost 5p a minute/)).toBeInTheDocument();
    expect(state.sent.some((s) => s.path === '/orders/order-1/calls')).toBe(false);
    await expectAccessible();

    await user.click(screen.getByRole('button', { name: 'Yes, call Tomasz' }));
    expect(await screen.findByRole('heading', { name: 'Calling Tomasz…' })).toBeInTheDocument();
    expect(state.sent.find((s) => s.path === '/orders/order-1/calls')?.body).toEqual({
      priceAccepted: true,
    });
    expect(livekit.connectToCall).toHaveBeenCalledWith(JOIN, expect.anything());
    await expectAccessible();
  });

  it('can say not now', async () => {
    const user = userEvent.setup();
    renderAt('/my-order');
    await user.click(await screen.findByRole('button', { name: 'Call Tomasz' }));
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByRole('button', { name: 'Call Tomasz' })).toBeInTheDocument();
  });

  it('mutes, and ends the call', async () => {
    const user = userEvent.setup();
    renderAt('/my-order');
    await user.click(await screen.findByRole('button', { name: 'Call Tomasz' }));
    await user.click(screen.getByRole('button', { name: 'Yes, call Tomasz' }));

    const mute = await screen.findByRole('button', { name: 'Mute' });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    await user.click(mute);
    expect(livekit.connection.setMuted).toHaveBeenCalledWith(true);
    expect(await screen.findByRole('button', { name: 'Unmute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'End call' }));
    expect(livekit.connection.leave).toHaveBeenCalled();
    await waitFor(() => expect(state.sent.some((s) => s.path === '/calls/call-1/end')).toBe(true));
  });

  it('adds a carer by a link, after agreeing to pay for them', async () => {
    const user = userEvent.setup();
    renderAt('/my-order');
    await user.click(await screen.findByRole('button', { name: 'Call Tomasz' }));
    await user.click(screen.getByRole('button', { name: 'Yes, call Tomasz' }));
    await user.click(await screen.findByRole('button', { name: 'Add someone to the call' }));
    await user.type(screen.getByLabelText('Who are you adding?'), 'Mary');
    expect(
      screen.getByText('Adding Mary costs 5p a minute for them, paid from your card.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, add them and send the link' }));
    expect(
      await screen.findByText('Their link: https://ozidelivery.example/call/join#guest-code'),
    ).toBeInTheDocument();
    expect(state.sent.find((s) => s.path === '/calls/call-1/guests')?.body).toEqual({
      name: 'Mary',
      priceAccepted: true,
    });
    await expectAccessible();
  });

  it('answers the Runner ringing in, agreeing to pay', async () => {
    state.current = { id: 'call-1', status: 'ringing', startedBy: 'runner' };
    const user = userEvent.setup();
    renderAt('/my-order');
    expect(await screen.findByText('Tomasz is calling.', { selector: 'p' })).toBeInTheDocument();
    await expectAccessible();
    await user.click(screen.getByRole('button', { name: 'Answer, and pay for the call' }));
    await screen.findByRole('button', { name: 'End call' });
    expect(state.sent.find((s) => s.path === '/calls/call-1/join')?.body).toEqual({
      priceAccepted: true,
    });
  });

  it('shows no call button while calls are not set up', async () => {
    state.callsEnabled = false;
    renderAt('/my-order');
    await screen.findByText(/Tomasz is doing your shopping now/);
    await waitFor(() => expect(state.sent.some((s) => s.path === '/config')).toBe(true));
    expect(screen.queryByRole('button', { name: /Call Tomasz/ })).not.toBeInTheDocument();
  });
});

describe('a Runner calling', () => {
  it('calls straight away, with no price, because a Runner never pays', async () => {
    const user = userEvent.setup();
    render(<CallControls orderId="order-1" as="runner" otherName="Margaret" />);
    await user.click(await screen.findByRole('button', { name: 'Call Margaret' }));
    await screen.findByRole('button', { name: 'End call' });
    expect(screen.queryByText(/Calls cost/)).not.toBeInTheDocument();
    expect(state.sent.find((s) => s.path === '/orders/order-1/calls')?.body).toEqual({});
    expect(
      screen.queryByRole('button', { name: 'Add someone to the call' }),
    ).not.toBeInTheDocument();
  });
});

describe('a Runner ringing the Shopper’s own phone (ruling 46)', () => {
  it('rings it from the call panel, and never shows the number', async () => {
    const user = userEvent.setup();
    render(<CallControls orderId="order-1" as="runner" otherName="Margaret" />);
    await user.click(await screen.findByRole('button', { name: 'Call Margaret' }));
    await user.click(await screen.findByRole('button', { name: 'Ring their phone instead' }));
    await screen.findByText("Ringing Margaret's phone now. Their number is never shown to you.");
    expect(state.sent.some((s) => s.path === '/calls/call-1/phone' && s.method === 'POST')).toBe(
      true,
    );
    expect(document.body.textContent).not.toMatch(/07\d{3}|\+44/);
  });
});

describe('a carer joining from a link', () => {
  it('joins with the code from the link, at no cost to them', async () => {
    const user = userEvent.setup();
    renderAt('/call/join#guest-code');
    expect(screen.getByText(/It costs you nothing/)).toBeInTheDocument();
    await expectAccessible();
    await user.click(screen.getByRole('button', { name: 'Join the call' }));
    expect(await screen.findByText('You joined as Mary.')).toBeInTheDocument();
    expect(state.sent.find((s) => s.path === '/calls/guest-join')?.body).toEqual({
      code: 'guest-code',
    });
    await user.click(screen.getByRole('button', { name: 'End call' }));
    expect(livekit.connection.leave).toHaveBeenCalled();
  });

  it('says so when the link is incomplete', () => {
    renderAt('/call/join');
    expect(screen.getByText(/This link is not complete/)).toBeInTheDocument();
  });
});
