/**
 * The Runner's safety and money screens (Section M; rulings 14, 16 and 55): the SOS button,
 * directions to the shop and the door, the one-tap call from "Cannot find it", when money reaches
 * the bank, closing the Runner account, the insurance notice, and agreeing to the Runner
 * agreement by talking to Ozi. And the small admin panel parts that go with them.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

import { App } from '../src/App';
import { agreementSummary } from '../src/components/AgreeByVoice';
import { ActiveSos, ReferralRewards, RemoveRunner } from '../src/components/StaffRunnerSafety';
import { storeConfig } from '../src/config';
import { directionsLink, isApplePhone } from '../src/lib/runner-api';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine, type FakeEngine } from './fake-voice';

const livekit = vi.hoisted(() => {
  const connection = {
    setMuted: vi.fn(async () => Promise.resolve()),
    leave: vi.fn(async () => Promise.resolve()),
  };
  return { connection, connectToCall: vi.fn(async () => Promise.resolve(connection)) };
});
vi.mock('../src/lib/call-connection', () => ({ connectToCall: livekit.connectToCall }));

const CALL_999 =
  'If you are in danger, call 999 now. Get somewhere safe and public if you can. We have been told where you are.';

interface State {
  status: null | 'accepted' | 'shopping' | 'delivering';
  sosOn: boolean;
  schedule: 'weekly' | 'daily';
  instantAvailable: number;
  agreed: boolean;
  insurance: null | { until: string; daysLeft: number; paused: boolean; words: string };
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

function sos(on: boolean) {
  return {
    id: 'sos-1',
    on,
    startedAt: '2026-10-18T10:00:00.000Z',
    endedAt: on ? null : '2026-10-18T10:05:00.000Z',
    located: true,
    locationAt: '2026-10-18T10:00:00.000Z',
    alerted: true,
  };
}

function stubRunner(): void {
  window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      state.sent.push({ method, path, body });

      if (path === '/config') {
        return reply({ push: { publicKey: null }, calls: { enabled: true, pencePerMinute: 5 } });
      }
      if (path === '/me') {
        return reply({
          role: 'runner',
          runner: {
            id: 'r1',
            name: 'Tomasz',
            rightToWorkVerified: true,
            criminalRecordCheckVerified: true,
            available: false,
            agreementCurrent: state.agreed,
          },
        });
      }
      if (path === '/runners/me/agreement') {
        state.agreed = true;
        return reply({
          runner: {},
          message: 'Thank you. You have agreed to the Runner agreement.',
        });
      }
      if (path === '/runners/me/dashboard') {
        return reply({
          runnerId: 'RABCD234',
          shareLink: 'https://example.test/join?ref=RABCD234',
          travelling: 'bicycle',
          travelModes: ['on_foot', 'bicycle'],
          canDrive: false,
          earnings: { todayPence: 0, weekPence: 0, allTimePence: 0, jobsToday: 0 },
          jobs: [],
          payouts: [],
          totalTransferredPence: 0,
          insurance: state.insurance,
          leftAt: null,
        });
      }
      if (path === '/runners/me/payouts') {
        return reply({
          setup: 'ready',
          totalEarnedPence: 0,
          owedPence: 0,
          completedDeliveryCount: 0,
        });
      }
      if (path === '/jobs/current') {
        return reply({
          job: state.status
            ? {
                orderId: 'order-1',
                status: state.status,
                shopperName: 'Margaret',
                deliveryAddress: '12 Example Street, Leeds LS1 4AB',
                doorstepProtocol: '',
                substitutionDefault: 'ask_me',
                goodsEstimatePence: 339,
                receiptTotalPence: null,
                runnerPaymentPence: 500,
                items: [
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
      if (path === '/jobs/mine') return reply({ offers: [] });
      if (path === '/orders/order-1/questions') {
        return method === 'POST'
          ? reply(
              {
                question: {
                  id: 'q1',
                  orderItemId: 'i2',
                  itemName: 'White sliced bread, 800g',
                  answer: null,
                  answeredBy: null,
                  secondsLeft: 290,
                  ifNoAnswer: 'leave_out',
                },
              },
              201,
            )
          : reply({ questions: [] });
      }
      if (path === '/orders/order-1/calls/current') return reply({ call: null });
      if (path === '/orders/order-1/calls') {
        return reply(
          {
            call: { id: 'call-1', orderId: 'order-1', status: 'ringing', startedBy: 'runner' },
            join: { url: 'wss://calls.example', token: 'pass', roomName: 'order-1' },
          },
          201,
        );
      }
      if (path === '/runners/me/sos') {
        if (method === 'POST') {
          state.sosOn = true;
          return reply(
            {
              sos: sos(true),
              call999: CALL_999,
              message: `We have been told, with where you are. ${CALL_999}`,
            },
            201,
          );
        }
        return reply({ sos: state.sosOn ? sos(true) : null, call999: CALL_999 });
      }
      if (path === '/runners/me/sos/location') return reply({ sos: sos(true) });
      if (path === '/runners/me/sos/end') {
        state.sosOn = false;
        return reply({
          sos: sos(false),
          message: 'The SOS is off. We are glad you are safe. Tell us what happened when you can.',
        });
      }
      if (path === '/runners/me/payout-schedule') {
        if (method === 'POST') {
          state.schedule = (body as { schedule: State['schedule'] }).schedule;
          return reply({
            schedule: state.schedule,
            message: 'Done. Stripe sends what is in your Stripe account to your bank every day.',
          });
        }
        const possible = state.instantAvailable > 50;
        return reply({
          schedule: state.schedule,
          words:
            state.schedule === 'weekly'
              ? 'Stripe sends what is in your Stripe account to your bank once a week, on a Friday.'
              : 'Stripe sends what is in your Stripe account to your bank every day.',
          controls:
            'Your pay for each delivery, and the money for the shopping you paid for, reach your own Stripe account straight away, as before. This choice is only how often Stripe then sends it on to your bank.',
          instant: {
            availablePence: state.instantAvailable,
            feePence: 50,
            youGetPence: possible ? state.instantAvailable - 50 : 0,
            possible,
            words: possible
              ? "£42.50 can go to your debit card now. Stripe's fee for that is £0.50, paid by you, so you would get £42.00."
              : 'Nothing can be sent instantly just now.',
          },
        });
      }
      if (path === '/runners/me/payouts/instant') {
        state.instantAvailable = 0;
        return reply({
          message: "£42.00 is on its way to your debit card. Stripe's fee was £0.50.",
        });
      }
      if (path === '/runners/me/leave') {
        return reply({ left: true, message: 'Your Runner account is closed.' });
      }
      if (path === '/runners/me/documents') return reply({ documents: [], stillNeeded: [] });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
}

const geolocation = {
  getCurrentPosition: vi.fn((ok: PositionCallback) =>
    ok({
      coords: { latitude: 51.38912, longitude: 0.54691, accuracy: 12.4 },
    } as GeolocationPosition),
  ),
  watchPosition: vi.fn(() => 7),
  clearWatch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  state = {
    status: 'shopping',
    sosOn: false,
    schedule: 'weekly',
    instantAvailable: 0,
    agreed: true,
    insurance: null,
    sent: [],
  };
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
});

function renderRunner() {
  render(
    <MemoryRouter initialEntries={['/runner/home']}>
      <App />
    </MemoryRouter>,
  );
}

describe('the SOS button', () => {
  it('asks first, then shares where the Runner is and shows how to call 999', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunner();
    renderRunner();

    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    expect(state.sent.some((r) => r.method === 'POST' && r.path === '/runners/me/sos')).toBe(false);
    expect(screen.getByRole('link', { name: 'Call 999' })).toHaveAttribute('href', 'tel:999');

    await user.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    expect(await screen.findByRole('heading', { name: 'SOS is on' })).toBeInTheDocument();
    expect(
      state.sent.find((r) => r.method === 'POST' && r.path === '/runners/me/sos')?.body,
    ).toEqual({
      location: { latitude: 51.38912, longitude: 0.54691, accuracyMetres: 12 },
    });
    expect(
      screen.getByText(
        /We have been told, with where you are\. If you are in danger, call 999 now/,
      ),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('link', { name: 'Call 999' })).toHaveAttribute('href', 'tel:999');
    // Kept up to date while it is on.
    expect(geolocation.watchPosition).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'I am safe now' }));
    expect(await screen.findByText(/We are glad you are safe/)).toBeInTheDocument();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('heading', { name: 'SOS is on' })).toBeNull();
  });

  it('sends nothing when the Runner says they are fine', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunner();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    await user.click(screen.getByRole('button', { name: 'No, I am fine' }));
    expect(state.sent.some((r) => r.method === 'POST' && r.path === '/runners/me/sos')).toBe(false);
    expect(screen.getByRole('button', { name: 'SOS' })).toBeInTheDocument();
  });

  it('carries on with an SOS already on when the page opens again', async () => {
    state.sosOn = true;
    stubRunner();
    renderRunner();
    expect(await screen.findByRole('heading', { name: 'SOS is on' })).toBeInTheDocument();
  });
});

describe('directions to the shop and the door', () => {
  it('opens the phone’s maps app, the shop first while shopping, the door once on the way', async () => {
    stubRunner();
    renderRunner();
    const links = await screen.findAllByRole('link', { name: /^Directions to the/ });
    expect(links[0]).toHaveAccessibleName('Directions to the shop (opens your maps app)');
    expect(links[0]).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(storeConfig.store.displayName)}&travelmode=bicycling`,
    );
    expect(links[1]).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('12 Example Street, Leeds LS1 4AB')}&travelmode=bicycling`,
    );
  });

  it('puts the door first once on the way', async () => {
    state.status = 'delivering';
    stubRunner();
    renderRunner();
    const links = await screen.findAllByRole('link', { name: /^Directions to the/ });
    expect(links[0]).toHaveAccessibleName('Directions to the door (opens your maps app)');
  });

  it('uses Apple Maps on an iPhone, and the way they travel', () => {
    expect(isApplePhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isApplePhone('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe(false);
    expect(directionsLink('1 High St, ME7 1AA', 'on_foot', true)).toBe(
      'https://maps.apple.com/?daddr=1%20High%20St%2C%20ME7%201AA&dirflg=w',
    );
    expect(directionsLink('1 High St', 'car', false)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20High%20St&travelmode=driving',
    );
  });

  it('is not there when there is no job in hand', async () => {
    state.status = null;
    stubRunner();
    renderRunner();
    await screen.findByRole('button', { name: 'Go on shift' });
    expect(screen.queryByRole('link', { name: /^Directions to the/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'SOS' })).toBeNull();
  });
});

describe('Cannot find it', () => {
  it('asks the Shopper and starts the call in the same tap', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunner();
    renderRunner();
    await user.click(
      await screen.findByRole('button', { name: 'Cannot find it: White sliced bread, 800g' }),
    );
    await waitFor(() => {
      expect(livekit.connectToCall).toHaveBeenCalledTimes(1);
    });
    const order = state.sent.map((r) => `${r.method} ${r.path}`);
    expect(order.indexOf('POST /orders/order-1/questions')).toBeLessThan(
      order.indexOf('POST /orders/order-1/calls'),
    );
    expect(
      await screen.findByRole('heading', { name: /^(Calling Margaret|On the call with Margaret)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End call' })).toBeInTheDocument();
  });
});

describe('when money reaches the bank', () => {
  it('is weekly unless they choose daily, and says what that controls', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunner();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Money' }));
    expect(
      await screen.findByRole('heading', { name: 'When your money reaches your bank' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Once a week, on a Friday')).toBeChecked();
    expect(screen.getByText(/reach your own Stripe account straight away/)).toBeInTheDocument();
    await user.click(screen.getByLabelText('Every day'));
    expect(
      state.sent.find((r) => r.method === 'POST' && r.path === '/runners/me/payout-schedule')?.body,
    ).toEqual({
      schedule: 'daily',
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Every day')).toBeChecked();
    });
  });

  it("shows Stripe's fee before an instant payout, and sends only after a yes", async () => {
    const user = userEvent.setup({ delay: null });
    state.instantAvailable = 4250;
    stubRunner();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Money' }));
    await user.click(
      await screen.findByRole('button', { name: 'Get £42.00 now, for a £0.50 fee' }),
    );
    expect(state.sent.some((r) => r.path === '/runners/me/payouts/instant')).toBe(false);
    expect(
      screen.getByText(/Stripe’s fee of £0\.50 is taken from the £42\.50/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, send £42.00 now' }));
    expect(state.sent.find((r) => r.path === '/runners/me/payouts/instant')?.body).toEqual({
      youGetPence: 4200,
    });
    expect(await screen.findByText(/£42\.00 is on its way to your debit card/)).toBeInTheDocument();
  });
});

describe('the rest of the Runner page', () => {
  it('closes the Runner account only after asking twice', async () => {
    const user = userEvent.setup({ delay: null });
    stubRunner();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: 'Close my Runner account' }));
    expect(state.sent.some((r) => r.path === '/runners/me/leave')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, close my Runner account' }));
    expect(state.sent.find((r) => r.path === '/runners/me/leave')?.body).toEqual({ confirm: true });
    expect(await screen.findByText('Your Runner account is closed.')).toBeInTheDocument();
  });

  it('says plainly when motor insurance is about to run out', async () => {
    state.status = null;
    state.insurance = {
      until: '2026-10-25T00:00:00.000Z',
      daysLeft: 7,
      paused: false,
      words:
        'Your motor insurance runs out in 7 days. Please send a photo of the new certificate under More, Your documents.',
    };
    stubRunner();
    renderRunner();
    expect(
      await screen.findByRole('heading', { name: 'Your motor insurance' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/runs out in 7 days/)).toBeInTheDocument();
  });

  it('passes axe with a job in hand, with the SOS on, and on the Money tab', async () => {
    const user = userEvent.setup({ delay: null });
    state.instantAvailable = 4250;
    state.sosOn = true;
    stubRunner();
    renderRunner();
    await screen.findByRole('heading', { name: 'SOS is on' });
    const options = {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    };
    expect((await axe.run(document.body, options as axe.RunOptions)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Money' }));
    await screen.findByRole('heading', { name: 'When your money reaches your bank' });
    expect((await axe.run(document.body, options as axe.RunOptions)).violations).toEqual([]);
  });
});

describe('agreeing to the Runner agreement by talking to Ozi (ruling 55)', () => {
  async function heard(engine: FakeEngine, text: string): Promise<void> {
    await waitFor(() => {
      expect(engine.listening).not.toBeNull();
    });
    act(() => {
      engine.hear(text);
    });
  }

  it('says what matters in it, and only a clear yes agrees, kept as a spoken yes', async () => {
    const user = userEvent.setup({ delay: null });
    const engine = fakeEngine();
    setVoiceEngine(engine);
    state.agreed = false;
    state.status = null;
    stubRunner();
    renderRunner();

    await user.click(await screen.findByRole('button', { name: 'Agree by talking to Ozi' }));
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe(
        `${agreementSummary()} Do you agree to the Runner agreement? Please say yes or no.`,
      );
    });
    expect(agreementSummary()).toContain('£5.00 for every delivery');

    await heard(engine, 'hmm, maybe');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toBe(
        'Sorry, I need a yes or a no. Do you agree to the Runner agreement? Please say yes or no.',
      );
    });
    expect(state.sent.some((r) => r.path === '/runners/me/agreement')).toBe(false);

    await heard(engine, 'yes I agree');
    await waitFor(() => {
      expect(state.sent.find((r) => r.path === '/runners/me/agreement')?.body).toEqual({
        accepted: true,
        version: RUNNER_AGREEMENT_VERSION,
        channel: 'voice',
      });
    });
  });

  it('agrees to nothing on a no', async () => {
    const user = userEvent.setup({ delay: null });
    const engine = fakeEngine();
    setVoiceEngine(engine);
    state.agreed = false;
    state.status = null;
    stubRunner();
    renderRunner();
    await user.click(await screen.findByRole('button', { name: 'Agree by talking to Ozi' }));
    await heard(engine, 'no');
    await waitFor(() => {
      expect(engine.spoken.at(-1)?.text).toMatch(/^All right\. Nothing has been agreed/);
    });
    expect(state.sent.some((r) => r.path === '/runners/me/agreement')).toBe(false);
  });
});

describe('the admin panel parts', () => {
  function stubStaff(): Array<{ method: string; path: string; body: unknown }> {
    const sent: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        const method = init?.method ?? 'GET';
        sent.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (path === '/staff/sos') {
          return reply({
            sos: [
              {
                ...sos(true),
                runner: { name: 'Tomasz', runnerId: 'RABCD234', phone: '+447700900101' },
                reference: 'OZ-ABC123',
                latitude: 51.4,
                longitude: 0.55,
                accuracyMetres: 12,
                mapsLink: 'https://www.google.com/maps/search/?api=1&query=51.400000,0.550000',
                endedBy: null,
                alertProblem: null,
              },
            ],
          });
        }
        if (path === '/staff/sos/sos-1/end') return reply({ message: 'Marked as over.' });
        if (path === '/staff/referrals') {
          return reply({
            rewardPence: 15000,
            needed: 100,
            referrers: [
              {
                referrer: 'shopper:ngozi',
                kind: 'shopper',
                name: 'Ngozi',
                joined: 104,
                counted: 100,
                notYet: 2,
                excluded: { self: 0, sameCard: 1, sameAddress: 1 },
                cardsChecked: true,
                rewardsEarned: 1,
                rewardsGiven: 0,
                due: true,
              },
            ],
          });
        }
        if (path === '/staff/referrals/reward') {
          return reply({ message: '£150.00 for Ngozi, added to their account as credit.' });
        }
        if (path === '/staff/runners/RABCD234/remove') {
          return reply({ message: 'Tomasz has been removed.' });
        }
        return reply({ error: { message: 'Nothing stubbed' } }, 404);
      }),
    );
    return sent;
  }

  it('shows an SOS that is on, with the Runner’s own number and where they are, and marks it over', async () => {
    const user = userEvent.setup({ delay: null });
    const sent = stubStaff();
    const news = vi.fn();
    render(<ActiveSos staffKey="key" by="Kemi" onNews={news} />);
    expect(await screen.findByRole('heading', { name: 'Runner SOS (1 on)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+447700900101' })).toHaveAttribute(
      'href',
      'tel:+447700900101',
    );
    expect(screen.getByRole('link', { name: 'open it in maps' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=51.400000,0.550000',
    );
    await user.click(screen.getByRole('button', { name: /^Mark as over/ }));
    expect(sent.find((r) => r.path === '/staff/sos/sos-1/end')?.body).toEqual({ by: 'Kemi' });
    await waitFor(() => {
      expect(news).toHaveBeenCalledWith('Marked as over.');
    });
  });

  it('tracks the private referral reward, and gives it once due', async () => {
    const user = userEvent.setup({ delay: null });
    const sent = stubStaff();
    const news = vi.fn();
    render(<ReferralRewards staffKey="key" by="Anthony" onNews={news} />);
    expect(await screen.findByRole('rowheader', { name: 'Ngozi (Shopper)' })).toBeInTheDocument();
    expect(screen.getByText('0 themselves, 1 same card, 1 same address')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Give the reward to Ngozi' }));
    expect(sent.find((r) => r.path === '/staff/referrals/reward')?.body).toEqual({
      referrer: 'shopper:ngozi',
      by: 'Anthony',
    });
    await waitFor(() => {
      expect(news).toHaveBeenCalledWith('£150.00 for Ngozi, added to their account as credit.');
    });
  });

  it('removes a Runner only with a reason', async () => {
    const user = userEvent.setup({ delay: null });
    const sent = stubStaff();
    render(<RemoveRunner staffKey="key" by="Kemi" onNews={vi.fn()} />);
    await user.type(screen.getByLabelText('Runner ID'), 'RABCD234');
    await user.click(screen.getByRole('button', { name: 'Remove this Runner' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please give the Runner ID and the reason.',
    );
    await user.type(screen.getByLabelText('Why'), 'A failed DBS check.');
    await user.click(screen.getByRole('button', { name: 'Remove this Runner' }));
    expect(sent.find((r) => r.path === '/staff/runners/RABCD234/remove')?.body).toEqual({
      by: 'Kemi',
      reason: 'A failed DBS check.',
    });
  });
});

describe('a Runner’s share link', () => {
  it('counts a Shopper who opens an account by it for the Runner who shared it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: { message: 'Nothing stubbed' } }, 404)),
    );
    render(
      <MemoryRouter initialEntries={['/join?ref=rabcd234']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('runner:RABCD234');
    });
  });
});
