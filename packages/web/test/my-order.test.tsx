/**
 * A Shopper following their order, and answering their Runner when something is not on the
 * shelf — on their own screen, with no phone numbers passed between them.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { FAKE_SHOPPER } from './setup';

const alert = vi.hoisted(() => ({ chime: vi.fn(), buzz: vi.fn() }));
vi.mock('../src/lib/alert', () => alert);

const notifications = vi.hoisted(() => ({
  state: 'off' as string,
  notificationState: vi.fn(async () => Promise.resolve(notifications.state)),
  turnOn: vi.fn(async () => Promise.resolve('on')),
  turnOff: vi.fn(async () => Promise.resolve('off')),
}));
vi.mock('../src/lib/notifications', () => notifications);

interface State {
  order: boolean;
  status: string;
  question: null | {
    answer: null | 'similar' | 'leave_out';
    answeredBy: null | 'shopper' | 'preference';
  };
  answerError: string | null;
  pushKey: string | null;
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

beforeEach(() => {
  state = {
    order: true,
    status: 'shopping',
    question: null,
    answerError: null,
    pushKey: null,
    sent: [],
  };
  notifications.state = 'off';
  vi.clearAllMocks();
});

function stubShopperApi(): void {
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
      state.sent.push({ method, path, body });

      if (path === '/me') return reply({ role: 'shopper', shopper: FAKE_SHOPPER });
      if (path === '/config') return reply({ push: { publicKey: state.pushKey } });
      if (path === '/orders/current') {
        if (!state.order) return reply({ order: null });
        return reply({
          order: {
            id: 'order-1',
            status: state.status,
            runnerName: 'Tomasz',
            items: [
              { id: 'i1', name: 'Semi skimmed milk, 2 pints', quantity: 2 },
              { id: 'i2', name: 'White sliced bread, 800g', quantity: 1 },
            ],
            totalEstimatePence: 1139,
            deliveredAt: null,
          },
          questions: state.question
            ? [
                {
                  id: 'q1',
                  orderItemId: 'i2',
                  itemName: 'White sliced bread, 800g',
                  ...state.question,
                  secondsLeft: state.question.answer === null ? 240 : 0,
                  ifNoAnswer: 'leave_out',
                },
              ]
            : [],
        });
      }
      if (path === '/orders/order-1/questions/q1/answer') {
        if (state.answerError) {
          return reply({ error: { message: state.answerError } }, 409);
        }
        const answer = (body as { answer: 'similar' | 'leave_out' }).answer;
        state.question = { answer, answeredBy: 'shopper' };
        return reply({
          answered: true,
          message:
            answer === 'similar'
              ? 'Thank you. Your Runner will bring something similar.'
              : 'Thank you. Your Runner will leave it out.',
        });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
}

function renderOrder() {
  render(
    <MemoryRouter initialEntries={['/my-order']}>
      <App />
    </MemoryRouter>,
  );
}

describe('following an order', () => {
  it('asks a signed-out visitor to sign in, and comes back here afterwards', () => {
    renderOrder();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=/my-order',
    );
  });

  it('says in words where the order has got to', async () => {
    stubShopperApi();
    renderOrder();
    expect(await screen.findByText('Tomasz is doing your shopping now.')).toBeInTheDocument();
    expect(screen.getByText('2 × Semi skimmed milk, 2 pints')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your order' })).toBeInTheDocument();
  });

  it('says plainly when there is nothing on its way', async () => {
    state.order = false;
    stubShopperApi();
    renderOrder();
    expect(await screen.findByText(/no order on its way/)).toBeInTheDocument();
  });
});

describe('a question from the Runner', () => {
  it('arrives as an alert with two answers, and says what happens if nobody answers', async () => {
    state.question = { answer: null, answeredBy: null };
    stubShopperApi();
    renderOrder();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tomasz cannot find White sliced bread, 800g. What would you like them to do?',
    );
    expect(screen.getByRole('button', { name: 'Bring something similar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave it out' })).toBeInTheDocument();
    expect(
      screen.getByText(/If we do not hear from you in about 4 minutes, they will leave it out/),
    ).toBeInTheDocument();
  });

  it('sends the answer, thanks them, and shows it against the item', async () => {
    const user = userEvent.setup({ delay: null });
    state.question = { answer: null, answeredBy: null };
    stubShopperApi();
    renderOrder();

    await user.click(await screen.findByRole('button', { name: 'Bring something similar' }));
    expect(state.sent.find((r) => r.path.endsWith('/answer'))?.body).toEqual({
      answer: 'similar',
    });
    expect(
      await screen.findByText('Thank you. Your Runner will bring something similar.'),
    ).toHaveAttribute('role', 'status');
    expect(
      await screen.findByText(/Not on the shelf: you asked them to bring something similar/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave it out' })).not.toBeInTheDocument();
  });

  it('says so when it is too late to answer', async () => {
    const user = userEvent.setup({ delay: null });
    state.question = { answer: null, answeredBy: null };
    state.answerError =
      'We could not wait any longer, so your Runner went with what you asked for when you signed up: leave it out.';
    stubShopperApi();
    renderOrder();

    await user.click(await screen.findByRole('button', { name: 'Leave it out' }));
    expect(await screen.findByText(/We could not wait any longer/)).toHaveAttribute(
      'role',
      'alert',
    );
  });

  it('has no axe violations with a question waiting', async () => {
    state.question = { answer: null, answeredBy: null };
    stubShopperApi();
    renderOrder();
    await screen.findByRole('button', { name: 'Leave it out' });
    const results = await axe.run(document.body, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('getting the Shopper’s attention', () => {
  it('chimes and buzzes once when a question arrives, not on every look', async () => {
    const user = userEvent.setup({ delay: null });
    state.question = { answer: null, answeredBy: null };
    stubShopperApi();
    renderOrder();
    await screen.findByRole('alert');
    expect(alert.chime).toHaveBeenCalledTimes(1);
    expect(alert.buzz).toHaveBeenCalledTimes(1);

    // Answering looks again; the same question is not news.
    await user.click(screen.getByRole('button', { name: 'Leave it out' }));
    await screen.findByText(/you asked them to leave it out/);
    expect(alert.chime).toHaveBeenCalledTimes(1);
  });

  it('is silent when there is no question', async () => {
    stubShopperApi();
    renderOrder();
    await screen.findByText('Tomasz is doing your shopping now.');
    expect(alert.chime).not.toHaveBeenCalled();
  });
});

describe('notifications on this device', () => {
  it('are not offered when the site has not switched them on', async () => {
    stubShopperApi();
    renderOrder();
    await screen.findByText('Tomasz is doing your shopping now.');
    expect(
      screen.queryByRole('heading', { name: 'If your Runner has a question' }),
    ).not.toBeInTheDocument();
  });

  it('can be turned on, and says so', async () => {
    const user = userEvent.setup({ delay: null });
    state.pushKey = 'BPublicKey';
    stubShopperApi();
    renderOrder();
    await user.click(
      await screen.findByRole('button', { name: 'Tell me when my Runner has a question' }),
    );
    expect(notifications.turnOn).toHaveBeenCalledWith('BPublicKey');
    expect(
      await screen.findByText(
        'Done. We will tell you on this device when your Runner has a question.',
      ),
    ).toHaveAttribute('role', 'status');
    expect(
      screen.getByRole('button', { name: 'Stop telling me on this device' }),
    ).toBeInTheDocument();
  });

  it('says in plain words what to do when the browser has blocked them', async () => {
    state.pushKey = 'BPublicKey';
    notifications.state = 'blocked';
    stubShopperApi();
    renderOrder();
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tell me/ })).not.toBeInTheDocument();
  });

  it('tells an iPhone user to add it to the Home Screen first', async () => {
    state.pushKey = 'BPublicKey';
    notifications.state = 'needs-home-screen';
    stubShopperApi();
    renderOrder();
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
  });

  it('has no axe violations with the offer showing', async () => {
    state.pushKey = 'BPublicKey';
    state.question = { answer: null, answeredBy: null };
    stubShopperApi();
    renderOrder();
    await screen.findByRole('button', { name: 'Tell me when my Runner has a question' });
    const results = await axe.run(document.body, {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
