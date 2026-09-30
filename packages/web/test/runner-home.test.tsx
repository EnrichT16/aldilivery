/**
 * A Runner's page, through a whole job.
 *
 * The server is stood in for by a small state machine that behaves the way the real routes do
 * — an offer, then accepted, shopping, the till total, on the way, delivered — so the screen is
 * judged on what a Runner meets at each step, not on a single snapshot.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { penceFrom } from '../src/pages/RunnerHome';

interface State {
  approved: boolean;
  available: boolean;
  offered: boolean;
  status: null | 'accepted' | 'shopping' | 'receipt_submitted' | 'delivering' | 'delivered';
  pay: 'not_started' | 'incomplete' | 'ready';
  question: null | { answer: null | 'similar' | 'leave_out'; answeredBy: null | 'shopper' };
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

function stubRunnerApi(): void {
  window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
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
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (auth !== 'Bearer runner-token') {
        return reply({ error: { message: 'You need to sign in again before doing that.' } }, 401);
      }

      if (path === '/me') {
        return reply({
          role: 'runner',
          runner: {
            id: 'r1',
            name: 'Tomasz',
            phone: '+447700900101',
            rightToWorkVerified: state.approved,
            criminalRecordCheckVerified: state.approved,
            available: state.available,
          },
        });
      }
      if (path === '/runners/me/payouts') {
        return reply({
          setup: state.pay,
          totalEarnedPence: 1000,
          owedPence: state.pay === 'ready' ? 0 : 500,
          owedDeliveries: state.pay === 'ready' ? 0 : 1,
          completedDeliveryCount: 2,
        });
      }
      if (path === '/runners/me/payouts/setup') {
        return reply({ url: 'https://connect.stripe.example/setup/abc' });
      }
      if (path === '/runners/me/availability') {
        state.available = (body as { available: boolean }).available;
        return reply({ runner: {} });
      }
      if (path === '/jobs/mine') {
        return reply({
          offers: state.offered
            ? [
                {
                  offer: { id: 'offer-1' },
                  secondsLeft: 42,
                  job: {
                    itemCount: 3,
                    goodsEstimatePence: 339,
                    runnerPaymentPence: 500,
                    distanceMiles: 0.4,
                  },
                },
              ]
            : [],
        });
      }
      if (path === '/jobs/offer-1/accept') {
        state.offered = false;
        state.status = 'accepted';
        return reply({});
      }
      if (path === '/jobs/offer-1/decline') {
        state.offered = false;
        return reply({});
      }
      if (path === '/jobs/current') {
        return reply({
          job:
            state.status && state.status !== 'delivered'
              ? {
                  orderId: 'order-1',
                  status: state.status,
                  shopperName: 'Margaret',
                  deliveryAddress: '12 Example Street, Leeds',
                  doorstepProtocol: 'Knock twice, I am slow to the door.',
                  substitutionDefault: 'similar_item',
                  goodsEstimatePence: 339,
                  receiptTotalPence: null,
                  runnerPaymentPence: 500,
                  items: [
                    {
                      id: 'i1',
                      name: 'Semi skimmed milk, 2 pints',
                      quantity: 2,
                      estimatedPricePence: 125,
                    },
                    {
                      id: 'i2',
                      name: 'White sliced bread, 800g',
                      quantity: 1,
                      estimatedPricePence: 89,
                    },
                  ],
                }
              : null,
        });
      }
      if (path === '/orders/order-1/questions') {
        if (method === 'POST') state.question = { answer: null, answeredBy: null };
        const question = state.question && {
          id: 'q1',
          orderItemId: 'i2',
          itemName: 'White sliced bread, 800g',
          ...state.question,
          secondsLeft: state.question.answer === null ? 290 : 0,
          ifNoAnswer: 'leave_out',
        };
        return method === 'POST'
          ? reply({ question }, 201)
          : reply({ questions: question ? [question] : [] });
      }
      if (path === '/orders/order-1/status') {
        state.status = (body as { status: State['status'] }).status;
        return reply({});
      }
      if (path === '/orders/order-1/receipt') {
        state.status = 'receipt_submitted';
        return reply({ message: 'The shopping came to £3.20.' });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/runner/home']}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state = {
    approved: true,
    available: false,
    offered: false,
    status: null,
    pay: 'ready',
    question: null,
    sent: [],
  };
});

describe('reading a till total', () => {
  it('understands the usual ways of writing an amount', () => {
    expect(penceFrom('12.34')).toBe(1234);
    expect(penceFrom('£12.34')).toBe(1234);
    expect(penceFrom('12')).toBe(1200);
    expect(penceFrom(' 3.2 ')).toBe(320);
  });

  it('refuses anything that is not an amount, rather than guessing', () => {
    expect(penceFrom('')).toBeNull();
    expect(penceFrom('twelve')).toBeNull();
    expect(penceFrom('12.345')).toBeNull();
  });
});

describe('a Runner page', () => {
  it('says plainly when nobody is signed in as a Runner here', () => {
    renderHome();
    expect(screen.getByText(/not signed in as a Runner on this device/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up to run' })).toBeInTheDocument();
  });

  it('shows which checks are still to do, and offers no way on shift until both are', async () => {
    state.approved = false;
    stubRunnerApi();
    renderHome();
    expect(
      await screen.findByRole('heading', { name: 'Waiting for your checks' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Right to work in the United Kingdom: not yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go on shift' })).not.toBeInTheDocument();
  });

  it('goes on shift, is offered a job as an alert, and sees a summary without the address', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunnerApi();
    renderHome();

    await user.click(await screen.findByRole('button', { name: 'Go on shift' }));
    expect(state.available).toBe(true);
    expect(await screen.findByRole('heading', { name: 'You are on shift' })).toBeInTheDocument();

    state.offered = true;
    await user.click(screen.getByRole('button', { name: 'Go off shift' }));
    await user.click(await screen.findByRole('button', { name: 'Go on shift' }));

    const offer = await screen.findByRole('alert');
    expect(offer).toHaveTextContent('A job for you');
    expect(offer).toHaveTextContent(
      '3 things, about £3.39 of shopping, 0.4 miles away. You get £5.00.',
    );
    expect(offer).not.toHaveTextContent('Example Street');
  });

  it('takes a job through to the door, with the till total before setting off', async () => {
    const user = userEvent.setup({ delay: null });
    state.available = true;
    state.offered = true;
    stubRunnerApi();
    renderHome();

    await user.click(await screen.findByRole('button', { name: 'Take this job' }));
    expect(
      await screen.findByRole('heading', { name: 'Your job: shopping for Margaret' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 × Semi skimmed milk, 2 pints')).toBeInTheDocument();
    expect(screen.getByText(/Never swap anything they have not agreed to/)).toBeInTheDocument();
    expect(
      screen.getByText('At the door, in their words: Knock twice, I am slow to the door.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I have started shopping' }));

    const till = await screen.findByLabelText('What did the till say?');
    expect(till).toHaveAccessibleDescription(/charged exactly this/);
    await user.click(screen.getByRole('button', { name: 'Put in the till total' }));
    expect(await screen.findByText(/Please type the total from the receipt/)).toHaveAttribute(
      'role',
      'alert',
    );

    await user.type(till, '3.20');
    await user.click(screen.getByRole('button', { name: 'Put in the till total' }));
    expect(state.sent.find((r) => r.path === '/orders/order-1/receipt')?.body).toEqual({
      receiptTotalPence: 320,
    });

    await user.click(await screen.findByRole('button', { name: 'I am on my way' }));
    await user.click(await screen.findByRole('button', { name: 'I have delivered it' }));

    expect(await screen.findByText(/Delivered. Thank you. You have earned £5.00/)).toHaveAttribute(
      'role',
      'status',
    );
    expect(state.status).toBe('delivered');
  });

  it('asks the Shopper about something it cannot find, and says their answer out loud', async () => {
    const user = userEvent.setup({ delay: null });
    state.status = 'shopping';
    stubRunnerApi();
    renderHome();

    const ask = await screen.findByRole('button', {
      name: 'Cannot find it: White sliced bread, 800g',
    });
    // One per thing on the list.
    expect(screen.getAllByRole('button', { name: /^Cannot find it/ })).toHaveLength(2);
    await user.click(ask);
    expect(
      state.sent.find((r) => r.method === 'POST' && r.path.endsWith('/questions'))?.body,
    ).toEqual({ orderItemId: 'i2' });
    expect(
      await screen.findByText(
        'Asked Margaret. Waiting for an answer, about 5 minutes left. If there is no answer: leave it out.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cannot find it: White sliced bread, 800g' }),
    ).not.toBeInTheDocument();

    // Margaret answers on her screen; the next look at the server brings it back.
    state.question = { answer: 'leave_out', answeredBy: 'shopper' };
    await user.type(screen.getByLabelText('What did the till say?'), '2.50');
    await user.click(screen.getByRole('button', { name: 'Put in the till total' }));
    expect(
      await screen.findByText('Margaret says: leave it out, for the White sliced bread, 800g.'),
    ).toHaveAttribute('role', 'status');
    expect(screen.getByText('Margaret says: leave it out.')).toBeInTheDocument();
  });

  it('does not offer to ask before shopping has started', async () => {
    state.status = 'accepted';
    stubRunnerApi();
    renderHome();
    await screen.findByRole('button', { name: 'I have started shopping' });
    expect(screen.queryByRole('button', { name: /^Cannot find it/ })).not.toBeInTheDocument();
  });

  it('has no axe violations with a job offered, or with a job in hand', async () => {
    const options = {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    };
    state.available = true;
    state.offered = true;
    stubRunnerApi();
    renderHome();
    await screen.findByRole('button', { name: 'Take this job' });
    let results = await axe.run(document.body, options as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Take this job' }));
    await user.click(await screen.findByRole('button', { name: 'I have started shopping' }));
    await screen.findByLabelText('What did the till say?');
    results = await axe.run(document.body, options as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('how a Runner gets paid', () => {
  it('shows what has been earned, and that pay goes straight to their own bank', async () => {
    stubRunnerApi();
    renderHome();
    expect(await screen.findByText(/You have earned £10.00 from 2 deliveries/)).toBeInTheDocument();
    expect(screen.getByText(/straight to your own bank account/)).toBeInTheDocument();
  });

  it('says what is owed and sends them to Stripe to set up, saying the service never sees the details', async () => {
    const user = userEvent.setup({ delay: null });
    state.pay = 'not_started';
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '' });
    stubRunnerApi();
    renderHome();

    expect(await screen.findByText(/£5.00 more is owed to you/)).toBeInTheDocument();
    expect(
      screen.getByText(`${storeConfig.productName} never sees them.`, { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up how you get paid' }));
    expect(assign).toHaveBeenCalledWith('https://connect.stripe.example/setup/abc');
  });

  it('offers to finish when they started but Stripe needs more', async () => {
    state.pay = 'incomplete';
    stubRunnerApi();
    renderHome();
    expect(
      await screen.findByRole('button', { name: 'Finish setting up how you get paid' }),
    ).toBeInTheDocument();
  });

  it('is not shown before the checks are done', async () => {
    state.approved = false;
    stubRunnerApi();
    renderHome();
    await screen.findByRole('heading', { name: 'Waiting for your checks' });
    expect(screen.queryByRole('heading', { name: 'How you get paid' })).not.toBeInTheDocument();
  });
});
