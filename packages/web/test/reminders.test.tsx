/**
 * Reminders for everyone, and the clock on every dashboard (Anthony, 3 November 2026, ruling 93):
 * the Shopper's Reminders section on their account page lists what is waiting, sets one (the day
 * and time in UK time), cancels one, and offers a phone call only with the plan that brings it,
 * saying kindly which plan; and the clock in the header shows the UK date and time in words,
 * never announced on its own, readable on focus.
 */

import axe from 'axe-core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { FAKE_SHOPPER } from './setup';

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let sent: Sent[];
let reminders: Array<Record<string, unknown>>;
let callAllowed: boolean;

const PLAN_WORDS = `Reminders by phone call come with ${storeConfig.assistantName} Membership, ${storeConfig.assistantName} Plus or ${storeConfig.assistantName} Family and Carer. I can remind you with a notification or a text instead.`;

beforeEach(() => {
  sent = [];
  callAllowed = false;
  reminders = [
    {
      id: 'rem-1',
      text: 'Call the bank',
      dueAt: '2026-11-04T10:00:00.000Z',
      whenWords: 'tomorrow at 10 in the morning',
      repeat: 'none',
      channel: 'text',
      status: 'scheduled',
      sentAt: null,
      heardAt: null,
    },
    {
      id: 'rem-0',
      text: 'Take the tablets',
      dueAt: '2026-11-03T08:00:00.000Z',
      whenWords: 'today at 8 in the morning',
      repeat: 'daily',
      channel: 'notification',
      status: 'sent',
      sentAt: '2026-11-03T08:00:00.000Z',
      heardAt: null,
    },
  ];
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
      if (path === '/reminders' && method === 'GET') {
        return reply({
          reminders,
          callAllowed,
          callPlanWords: callAllowed ? null : PLAN_WORDS,
          channels: ['notification', 'text', 'call'],
          repeats: ['none', 'daily', 'weekly', 'monthly'],
          maxTextLength: 200,
          maxPerAccount: 50,
        });
      }
      if (path === '/reminders' && method === 'POST') {
        const asked = body as { text: string; dueAt: string; repeat: string; channel: string };
        const made = {
          id: 'rem-2',
          text: asked.text,
          dueAt: asked.dueAt,
          whenWords: 'tomorrow at 10 in the morning',
          repeat: asked.repeat,
          channel: asked.channel,
          status: 'scheduled',
          sentAt: null,
          heardAt: null,
        };
        reminders = [made, ...reminders];
        return reply(
          { reminder: made, message: 'Reminder set for tomorrow at 10 in the morning.' },
          201,
        );
      }
      const cancel = /^\/reminders\/([^/]+)$/.exec(path);
      if (cancel && method === 'DELETE') {
        reminders = reminders.filter((row) => row['id'] !== cancel[1]);
        return reply({
          reminder: { id: cancel[1], status: 'cancelled' },
          message: 'Reminder cancelled.',
        });
      }
      const heard = /^\/reminders\/([^/]+)\/heard$/.exec(path);
      if (heard && method === 'POST') {
        reminders = reminders.map((row) =>
          row['id'] === heard[1] ? { ...row, status: 'heard' } : row,
        );
        return reply({ reminder: { id: heard[1], status: 'heard' } });
      }
      return reply({ error: { message: 'Not here in this test.' } }, 404);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <App />
    </MemoryRouter>,
  );
}

async function remindersSection(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Reminders' });
}

describe('the Reminders section on the Shopper’s account page', () => {
  it('lists what is waiting and what was sent, with plain words and large labelled controls', async () => {
    renderSettings();
    const section = await remindersSection();
    expect(await within(section).findByText('Call the bank')).toBeInTheDocument();
    expect(
      within(section).getByText('Tomorrow at 10 in the morning. A text to my phone.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'Cancel this reminder' }),
    ).toBeInTheDocument();
    // Sent, with "I've heard it".
    expect(within(section).getByText('Take the tablets')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'I’ve heard it' })).toBeInTheDocument();
    // The form, every control labelled.
    expect(within(section).getByLabelText('What to remind you about')).toHaveAttribute(
      'maxlength',
      '200',
    );
    expect(within(section).getByLabelText('Day')).toBeInTheDocument();
    expect(within(section).getByLabelText('Time (UK time)')).toBeInTheDocument();
    expect(within(section).getByLabelText('How often')).toBeInTheDocument();
    expect(within(section).getByLabelText('A notification on this device')).toBeChecked();

    const results = await axe.run(section, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('a phone call cannot be chosen without a plan, and the plan is named kindly, never a price', async () => {
    renderSettings();
    const section = await remindersSection();
    const call = await within(section).findByLabelText('A phone call from Ozi');
    expect(call).toBeDisabled();
    expect(call).toHaveAccessibleDescription(PLAN_WORDS);
    expect(within(section).getByText(PLAN_WORDS)).toBeInTheDocument();
    expect(section.textContent).not.toMatch(/£/);
  });

  it('with a plan, the call can be chosen', async () => {
    callAllowed = true;
    renderSettings();
    const section = await remindersSection();
    const call = await within(section).findByLabelText('A phone call from Ozi');
    expect(call).toBeEnabled();
    expect(within(section).queryByText(PLAN_WORDS)).not.toBeInTheDocument();
  });

  it('sets a reminder for a UK day and time, sends it as the moment in UTC, and says so', async () => {
    const user = userEvent.setup();
    renderSettings();
    const section = await remindersSection();
    await user.type(
      await within(section).findByLabelText('What to remind you about'),
      'Ring the dentist',
    );
    fireEvent.change(within(section).getByLabelText('Day'), { target: { value: '2026-11-04' } });
    fireEvent.change(within(section).getByLabelText('Time (UK time)'), {
      target: { value: '10:00' },
    });
    await user.selectOptions(within(section).getByLabelText('How often'), 'weekly');
    await user.click(within(section).getByLabelText('A text to my phone'));
    await user.click(within(section).getByRole('button', { name: 'Set reminder' }));

    await waitFor(() => {
      expect(sent.find((r) => r.method === 'POST' && r.path === '/reminders')?.body).toEqual({
        text: 'Ring the dentist',
        // 10:00 UK time on 4 November is 10:00 UTC: GMT.
        dueAt: '2026-11-04T10:00:00.000Z',
        repeat: 'weekly',
        channel: 'text',
      });
    });
    expect(await within(section).findByText('Ring the dentist')).toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Reminder set for tomorrow at 10 in the morning.',
    );
  });

  it('in summer, the UK time is an hour ahead of UTC', async () => {
    const user = userEvent.setup();
    renderSettings();
    const section = await remindersSection();
    await user.type(
      await within(section).findByLabelText('What to remind you about'),
      'Water the plants',
    );
    fireEvent.change(within(section).getByLabelText('Day'), { target: { value: '2027-07-01' } });
    fireEvent.change(within(section).getByLabelText('Time (UK time)'), {
      target: { value: '09:30' },
    });
    await user.click(within(section).getByRole('button', { name: 'Set reminder' }));
    await waitFor(() => {
      expect(sent.find((r) => r.method === 'POST' && r.path === '/reminders')?.body).toMatchObject({
        dueAt: '2027-07-01T08:30:00.000Z',
      });
    });
  });

  it('cancels one, and asks for the day and time before setting', async () => {
    const user = userEvent.setup();
    renderSettings();
    const section = await remindersSection();
    await user.click(await within(section).findByRole('button', { name: 'Cancel this reminder' }));
    await waitFor(() => {
      expect(sent.some((r) => r.method === 'DELETE' && r.path === '/reminders/rem-1')).toBe(true);
    });
    expect(await within(section).findByText('No reminders waiting.')).toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('Reminder cancelled.');

    await user.type(within(section).getByLabelText('What to remind you about'), 'Something');
    await user.click(within(section).getByRole('button', { name: 'Set reminder' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Please choose the day and the time.',
    );
    expect(sent.some((r) => r.method === 'POST' && r.path === '/reminders')).toBe(false);
  });
});

describe('the clock on the dashboard', () => {
  it('shows the UK day, date and time in words, readable on focus and never announced by itself', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T10:42:00.000Z'));
    renderSettings();
    const clock = await screen.findByRole('button', { name: /Tuesday 3 November, 10:42/ });
    expect(clock).toHaveAttribute('aria-live', 'off');
    expect(clock).toHaveTextContent('UK time');
    expect(clock.querySelector('time')).toHaveAttribute('datetime', '2026-11-03T10:42:00.000Z');
    expect(clock).toHaveTextContent('Press to hear the time and the date.');
  });

  it('in British Summer Time, the clock is an hour ahead of UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-07-01T13:05:00.000Z'));
    renderSettings();
    expect(
      await screen.findByRole('button', { name: /Thursday 1 July, 14:05/ }),
    ).toBeInTheDocument();
  });
});
