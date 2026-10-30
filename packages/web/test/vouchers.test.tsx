/**
 * Sending a referral reward voucher, on the screen (Anthony, 30 October 2026): staff paste the
 * code and press "Send voucher"; a sent one shows Sent, Opened or Used with times, the code's
 * last four only, the reminders, and "Show the code"; the person sees the code clearly, read one
 * character at a time by a screen reader, with "Copy code", how long it lasts and "I've used
 * it"; and Ozi's reminder ring in the app, answered. Every screen passes axe.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import { Inbox, InboxLink } from '../src/components/Inbox';
import { VoucherForLevel } from '../src/components/StaffVoucher';
import { storeConfig } from '../src/config';
import type { StaffReferrerRow } from '../src/lib/api';
import { BasketProvider } from '../src/state/basket';
import { OziProvider } from '../src/state/ozi';
import { SessionProvider } from '../src/state/session';
import { VoiceProvider } from '../src/state/voice';
import { setVoiceEngine } from '../src/voice';
import { fakeEngine } from './fake-voice';

/** As the app has it: Ozi, with the voice, the session and the basket. */
function withOzi(children: ReactNode): JSX.Element {
  return (
    <MemoryRouter>
      <SessionProvider>
        <VoiceProvider>
          <BasketProvider>
            <OziProvider>{children}</OziProvider>
          </BasketProvider>
        </VoiceProvider>
      </SessionProvider>
    </MemoryRouter>
  );
}

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

function stubPaths(
  answer: (method: string, path: string, body: unknown) => Response | null,
): Array<{ method: string; path: string; body: unknown }> {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      return answer(method, path, body) ?? reply({ error: { message: 'Not stubbed' } }, 404);
    }),
  );
  return sent;
}

async function noViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  } as axe.RunOptions);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const LEVEL: StaffReferrerRow['levels'][number] = {
  id: 'l1',
  label: '£10 voucher',
  activeReferrals: 20,
  rewardPence: 1000,
  reachedAt: '2026-11-01T10:00:00.000Z',
  givenAt: null,
  givenBy: null,
};

const SENT = {
  id: 'v1',
  levelId: 'l1',
  label: '£10 voucher',
  status: 'opened' as const,
  sentAt: '2026-11-02T10:00:00.000Z',
  sentByName: 'Kemi',
  openedAt: '2026-11-03T09:00:00.000Z',
  usedAt: null,
  codeMasked: '••••••••••9876',
  codeLastFour: '9876',
  hasLink: false,
  erased: false,
  nextReminderAt: null,
  reminders: [{ number: 1, at: '2026-11-02T10:00:00.000Z', via: 'text', words: 'texted' }],
};

describe('sending a voucher on the staff Referrals page', () => {
  it('sends the pasted code, and the link if there is one', async () => {
    const sent = stubPaths((method, path) =>
      method === 'POST' && path === '/staff/referrals/levels/l1/voucher'
        ? reply({ voucher: SENT, message: 'The £10 voucher is sent.' }, 201)
        : null,
    );
    const onSent = vi.fn();
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <VoucherForLevel staffKey="k" level={LEVEL} personName="Ada Obi" by="Kemi" onSent={onSent} />,
    );
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: /Send voucher/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please paste the voucher code.');
    await user.type(screen.getByLabelText('Voucher code'), 'GIFT-ABCD-9876');
    await user.type(
      screen.getByLabelText('Link to the voucher, if you have one'),
      'https://www.amazon.co.uk/gc/redeem',
    );
    await user.click(
      screen.getByRole('button', { name: /^Send voucher.*the £10 voucher for Ada Obi$/ }),
    );
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('The £10 voucher is sent.'));
    expect(sent.find((row) => row.method === 'POST')?.body).toEqual({
      code: 'GIFT-ABCD-9876',
      link: 'https://www.amazon.co.uk/gc/redeem',
      by: 'Kemi',
    });
  });

  it('shows how a sent one stands, the last four only, and the code when opened', async () => {
    stubPaths((_method, path) =>
      path === '/staff/referrals/vouchers/v1'
        ? reply({ voucher: { ...SENT, code: 'GIFT-ABCD-9876', link: null } })
        : null,
    );
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <VoucherForLevel
        staffKey="k"
        level={{ ...LEVEL, voucher: SENT }}
        personName="Ada Obi"
        by="Kemi"
        onSent={vi.fn()}
      />,
    );
    expect(screen.getByText('The £10 voucher: Opened')).toBeInTheDocument();
    expect(screen.getByText(/Sent by Kemi/)).toBeInTheDocument();
    expect(screen.getByText(/^Opened /)).toBeInTheDocument();
    expect(screen.getByText('ending 9876')).toBeInTheDocument();
    expect(screen.getByText(/Reminder 1, .*: texted\./)).toBeInTheDocument();
    expect(container.textContent).not.toContain('GIFT-ABCD');
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Show the code for Ada Obi' }));
    expect(await screen.findByText('GIFT-ABCD-9876')).toBeInTheDocument();
  });
});

describe('the voucher in the person’s inbox', () => {
  const MESSAGE = {
    id: 'm1',
    from: 'company',
    fromName: `Kemi, ${storeConfig.productName}`,
    text: `Your £10 Amazon shopping voucher from ${storeConfig.productName}. Thank you.`,
    sentAt: '2026-11-02T10:00:00.000Z',
    readAt: null,
    voucher: {
      id: 'v1',
      title: `Your £10 Amazon shopping voucher from ${storeConfig.productName}`,
      code: 'GIFT-ABCD-9876',
      link: null,
      lastsWords: 'Amazon gift cards last 10 years.',
      openedAt: null,
      usedAt: null,
    },
  };

  it('shows the code clearly, spells it for a screen reader, copies it, and takes "I’ve used it"', async () => {
    const sent = stubPaths((method, path) => {
      if (path === '/inbox') {
        return reply({ productName: storeConfig.productName, messages: [MESSAGE], unread: 1 });
      }
      if (path === '/inbox/read') return reply({ unread: 0 });
      if (method === 'POST' && path === '/inbox/vouchers/v1/used') {
        return reply({
          voucher: { ...MESSAGE.voucher, usedAt: '2026-11-04T10:00:00.000Z' },
          words: 'Thank you. We have noted that you have used your voucher.',
        });
      }
      return null;
    });
    const user = userEvent.setup({ delay: null });
    setVoiceEngine(fakeEngine());
    const { container } = render(withOzi(<Inbox as="shopper" />));
    const card = (
      await screen.findByRole('heading', {
        name: `Your £10 Amazon shopping voucher from ${storeConfig.productName}`,
      })
    ).closest('section')!;
    expect(within(card).getByText('GIFT-ABCD-9876')).toBeInTheDocument();
    expect(within(card).getByText('G I F T dash A B C D dash 9 8 7 6')).toBeInTheDocument();
    expect(within(card).getByText('Amazon gift cards last 10 years.')).toBeInTheDocument();
    await noViolations(container);

    await user.click(within(card).getByRole('button', { name: 'Copy code' }));
    expect(await navigator.clipboard.readText()).toBe('GIFT-ABCD-9876');
    expect(within(card).getByText('The code is copied.')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'I’ve used it' }));
    expect(await within(card).findByText(/You told us you used it/)).toBeInTheDocument();
    expect(sent.some((row) => row.path === '/inbox/vouchers/v1/used')).toBe(true);
  });
});

describe('Ozi’s reminder ring in the app', () => {
  it('rings, is answered, and says the words aloud and on the screen', async () => {
    const words = `Hello, this is ${storeConfig.assistantName} from ${storeConfig.productName}. You've been sent a £10 shopping voucher as a thank you. Open your ${storeConfig.assistantName} inbox to see it.`;
    const sent = stubPaths((method, path) => {
      if (path === '/inbox/unread') {
        return reply({
          unread: 1,
          call: null,
          ozi: { id: 'v1', from: storeConfig.assistantName, words },
        });
      }
      if (method === 'POST' && path === '/inbox/vouchers/v1/ring/answer') return reply({ words });
      return null;
    });
    const user = userEvent.setup({ delay: null });
    setVoiceEngine(fakeEngine());
    const { container } = render(withOzi(<InboxLink as="shopper" to="/messages" />));
    expect(
      await screen.findByRole('heading', { name: `${storeConfig.assistantName} is calling` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /is calling/ })).toBeInTheDocument();
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(sent.some((row) => row.path === '/inbox/vouchers/v1/ring/answer')).toBe(true);
  });
});
