/**
 * Areas and where Runners are, on the screen (Anthony, 30 October 2026): every area is open (6
 * November 2026), and a Shopper where there is no Runner yet is warned gently only as they order,
 * and may still pay; a Runner's location is shared while on
 * shift and on a job, never off shift, with a note said once, and a kind word when it is refused;
 * and the staff Areas page, with its pause button, and where Runners on a job were last seen.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { HomePostcode, RunnerLocation } from '../src/components/RunnerLocation';
import { storeConfig } from '../src/config';
import { Areas, RunnersNow } from '../src/pages/StaffAdmin';
import { FAKE_CARD, FAKE_SHOPPER, stubApi, type RecordedRequest } from './setup';

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

/** A fetch that answers these paths, and records what was sent. */
function stubPaths(
  answer: (method: string, path: string, body: unknown) => Response | null,
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      recorded.push({ method, path, body } as RecordedRequest);
      return answer(method, path, body) ?? reply({ error: { message: 'Not stubbed' } }, 404);
    }),
  );
  return recorded;
}

describe('a Shopper where there is no Runner yet (30 October 2026)', () => {
  const RUNNER_LINK = 'https://example.test/runner/sign-up?via=shopper-margaret';

  /** The usual stub, with the area of the address answering as asked. */
  function stubArea(warn: boolean): RecordedRequest[] {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        const method = init?.method ?? 'GET';
        if (path.startsWith('/areas/check')) {
          recorded.push({ method, path: '/areas/check', body: undefined } as RecordedRequest);
          return reply({
            area: 'LS',
            name: 'Leeds',
            hasRunner: !warn,
            paused: false,
            warn,
            words: storeConfig.areas.openWords.replace('{area}', 'Leeds'),
            ...(warn ? { warning: storeConfig.areas.noRunnerWords } : {}),
          });
        }
        if (path === '/me/area/warned') {
          recorded.push({
            method,
            path,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          } as RecordedRequest);
          return reply({ noted: true });
        }
        if (path === '/share') {
          recorded.push({ method, path, body: undefined } as RecordedRequest);
          return reply({
            link: 'https://example.test/join?via=shopper-margaret',
            joined: 2,
            runnerLink: RUNNER_LINK,
          });
        }
        return base(url, init);
      }),
    );
    return recorded;
  }

  async function toConfirm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    render(
      <MemoryRouter initialEntries={['/shop']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /Add Semi skimmed milk/ }));
    // Browsing and the basket never warn.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));
  }

  async function confirmAddress(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByRole('button', { name: 'Yes, this is the right address' }));
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
  });

  it('warns as an alert dialog only when ordering; "OK, I understand" lets them pay', async () => {
    const recorded = stubArea(true);
    const user = userEvent.setup({ delay: null });
    await toConfirm(user);
    await waitFor(() => expect(recorded.some((r) => r.path === '/areas/check')).toBe(true));
    // Not before the address is confirmed: the order is not being placed yet.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // No "not running" words anywhere.
    expect(document.body).not.toHaveTextContent(/isn't running|not running/i);

    await confirmAddress(user);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Before you send your order');
    expect(dialog).toHaveAccessibleDescription(storeConfig.areas.noRunnerWords);
    // Focus moves into it.
    expect(within(dialog).getByRole('button', { name: 'OK, I understand' })).toHaveFocus();
    // The button to pay is never greyed out by it.
    expect(screen.getByRole('button', { name: 'Send my order and pay' })).toBeEnabled();
    // Noted, so they are texted once when a Runner joins.
    await waitFor(() =>
      expect(recorded.filter((r) => r.path === '/me/area/warned')).toHaveLength(1),
    );

    await user.click(within(dialog).getByRole('button', { name: 'OK, I understand' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send my order and pay' })).toHaveFocus(),
    );

    await user.click(screen.getByRole('button', { name: 'Send my order and pay' }));
    await waitFor(() =>
      expect(recorded.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(true),
    );
    // Once for this order: it did not come back.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(recorded.filter((r) => r.path === '/me/area/warned')).toHaveLength(1);
  });

  it('is shown once for the order, not on every change on the screen', async () => {
    stubArea(true);
    const user = userEvent.setup({ delay: null });
    await toConfirm(user);
    await confirmAddress(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Something else on the screen changes: no second warning.
    const asap = screen.queryAllByRole('radio')[0];
    if (asap) await user.click(asap);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is not shown where the area has a Runner, and nothing blocks the order', async () => {
    const recorded = stubArea(false);
    const user = userEvent.setup({ delay: null });
    await toConfirm(user);
    await waitFor(() => expect(recorded.some((r) => r.path === '/areas/check')).toBe(true));
    await confirmAddress(user);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send my order and pay' }));
    await waitFor(() =>
      expect(recorded.some((r) => r.method === 'POST' && r.path === '/orders')).toBe(true),
    );
  });

  it('sends the referral link for a driver with the share sheet, then goes back to the order', async () => {
    const share = vi.fn(async () => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    stubArea(true);
    const user = userEvent.setup({ delay: null });
    await toConfirm(user);
    await confirmAddress(user);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send my referral link' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: storeConfig.productName,
      text: storeConfig.areas.inviteDriverWords.replace('{link}', RUNNER_LINK),
      url: RUNNER_LINK,
    });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Send my order and pay' })).toBeEnabled();
  });

  it('copies the link where there is no share sheet', async () => {
    stubArea(true);
    const user = userEvent.setup({ delay: null });
    // After user-event's own clipboard is put in place.
    const writeText = vi.fn(async () => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await toConfirm(user);
    await confirmAddress(user);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send my referral link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        storeConfig.areas.inviteDriverWords.replace('{link}', RUNNER_LINK),
      ),
    );
    expect(await screen.findByText(/Your referral link is copied/)).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('has no accessibility problems', async () => {
    stubArea(true);
    const user = userEvent.setup({ delay: null });
    await toConfirm(user);
    await confirmAddress(user);
    const dialog = await screen.findByRole('alertdialog');
    const results = await axe.run(dialog);
    expect(results.violations).toEqual([]);
  });
});

describe('a Runner with no home postcode yet', () => {
  it('is asked plainly and prominently, and told only jobs wait for it', () => {
    render(<HomePostcode onSaved={() => undefined} />);
    const region = screen.getByRole('region', { name: 'Please add your home postcode' });
    expect(region).toHaveAccessibleDescription(
      /You will not be offered any jobs until your home postcode is saved\..*Everything else in the app works as normal without it\./,
    );
    expect(within(region).getByLabelText('Home postcode')).toBeInTheDocument();
  });
});

describe('sharing where a Runner is', () => {
  let watch: ReturnType<typeof vi.fn>;
  let once: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  let refuse = false;

  beforeEach(() => {
    refuse = false;
    const position = {
      coords: { latitude: 51.389, longitude: 0.547, accuracy: 10 },
    } as GeolocationPosition;
    const denied = { code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError;
    once = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) =>
      refuse ? fail(denied) : ok(position),
    );
    watch = vi.fn((ok: PositionCallback, fail: PositionErrorCallback) => {
      if (refuse) fail(denied);
      else ok(position);
      return 3;
    });
    clearWatch = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: once, watchPosition: watch, clearWatch },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares nothing off shift', () => {
    const sent = stubPaths(() => reply({ kept: true }));
    render(<RunnerLocation onShift={false} onJob={false} />);
    expect(once).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shares about every two minutes on shift, with a note said once', async () => {
    vi.useFakeTimers();
    const sent = stubPaths(() => reply({ kept: true }));
    render(<RunnerLocation onShift onJob={false} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your location is being shared while you are on shift.',
    );
    expect(once).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(storeConfig.areas.shareOnShiftSeconds * 1000);
    });
    expect(once).toHaveBeenCalledTimes(2);
    expect(sent.filter((r) => r.path === '/runners/me/location')[0]?.body).toEqual({
      latitude: 51.389,
      longitude: 0.547,
    });
    // The same words, so a screen reader is not told again with every place sent.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('follows them on a job, asks them to keep the page open, and stops after it', async () => {
    stubPaths(() => reply({ kept: true }));
    const { rerender } = render(<RunnerLocation onShift onJob />);
    expect(watch).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your location is being shared while you are on this job.',
    );
    expect(
      screen.getByText(/A website can only share where you are while it is open on your screen/),
    ).toHaveTextContent(`please keep ${storeConfig.productName} open`);
    rerender(<RunnerLocation onShift={false} onJob={false} />);
    expect(clearWatch).toHaveBeenCalledWith(3);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('explains kindly how to allow it when it is refused, and says jobs come from home', () => {
    refuse = true;
    stubPaths(() => reply({ kept: true }));
    render(<RunnerLocation onShift onJob={false} />);
    expect(screen.getByText('Your phone is not sharing where you are')).toBeInTheDocument();
    expect(screen.getByText(/only be offered jobs in your home postcode/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});

const AREA = {
  hasRunner: true,
  warn: false,
  shoppers: 12,
  runnersApproved: 2,
  runnersWaiting: 1,
  shopsApproved: 4,
  shopsWaiting: 1,
  organisations: 1,
  waitingList: 0,
  ordersToday: 3,
  ordersThisWeek: 9,
  pausedBy: null,
};

describe('the Areas page', () => {
  it('shows each area with its counts and status, and pauses one', async () => {
    let paused = false;
    const sent = stubPaths((method, path) => {
      if (path === '/staff/areas') {
        return reply({
          areas: [
            {
              ...AREA,
              area: 'ME',
              name: 'Medway',
              paused,
              warn: paused,
              statusWords: paused ? 'Paused' : 'Has a Runner (driver)',
            },
            {
              ...AREA,
              area: 'M',
              name: 'Manchester',
              hasRunner: false,
              paused: false,
              warn: true,
              statusWords: 'No Runner (driver) yet',
              ordersThisWeek: 0,
              waitingList: 5,
            },
          ],
        });
      }
      if (method === 'POST' && path === '/staff/areas/ME/pause') {
        paused = true;
        return reply({ message: 'Medway is paused.' });
      }
      return null;
    });
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Areas staffKey="k" by="Kemi" onNews={news} />);

    const medway = (await screen.findByRole('heading', { level: 3, name: 'Medway (ME)' }))
      .parentElement!;
    expect(within(medway).getByText('Has a Runner (driver)')).toBeInTheDocument();
    expect(within(medway).getByText('12 Shoppers')).toBeInTheDocument();
    expect(
      within(medway).getByText('2 approved Runners, 1 waiting for approval'),
    ).toBeInTheDocument();
    expect(within(medway).getByText('4 approved shops, 1 waiting')).toBeInTheDocument();
    expect(within(medway).getByText('3 orders today, 9 this week')).toBeInTheDocument();
    const manchester = screen.getByRole('heading', {
      level: 3,
      name: 'Manchester (M)',
    }).parentElement!;
    expect(within(manchester).getByText('No Runner (driver) yet')).toBeInTheDocument();
    expect(
      within(manchester).getByText('5 warned there was no Runner, to be texted when one joins'),
    ).toBeInTheDocument();
    // Every area is open: no readiness, and no word of not running.
    expect(container).not.toHaveTextContent(/Not ready|isn't running|not running|takes no orders/);

    await user.click(within(medway).getByRole('button', { name: 'Pause Medway' }));
    await waitFor(() => expect(news).toHaveBeenCalledWith('Medway is paused.'));
    expect(sent.find((r) => r.path === '/staff/areas/ME/pause')?.body).toEqual({
      paused: true,
      by: 'Kemi',
    });
    expect(await screen.findByRole('button', { name: 'Unpause Medway' })).toBeInTheDocument();

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe('Runners on a job, for staff', () => {
  it('shows when each was last seen, with a link to open it in maps', async () => {
    stubPaths((_method, path) =>
      path === '/staff/runners/now'
        ? reply({
            activeNow: 1,
            onShift: 1,
            onAJob: 1,
            runners: [
              {
                id: 'r1',
                name: 'Tomasz',
                onShift: true,
                activeNow: true,
                travel: 'on_foot',
                job: { id: 'o1', reference: 'ABC123', status: 'shopping' },
                jobsCompleted: 3,
                jobsToday: 1,
                earnedTodayPence: 500,
                earnedWeekPence: 500,
                earnedAllTimePence: 1500,
                lastSeenAt: '2026-10-30T13:05:00.000Z',
                mapsLink: 'https://www.google.com/maps/search/?api=1&query=51.390000,0.550000',
              },
            ],
          })
        : null,
    );
    render(<RunnersNow staffKey="k" />);
    expect(await screen.findByText(/Last seen at 13:05/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open in maps for Tomasz/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=51.390000,0.550000',
    );
  });
});
