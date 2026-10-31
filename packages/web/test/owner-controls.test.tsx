/**
 * The owner's controls in the admin panel (ruling 85, 31 October 2026): every staff account with
 * its sign-in and rough place, a switch for each, "Switch off all staff except me" (asked twice),
 * and how Ozi reaches him, each kind a group of radio buttons. Usable by keyboard and screen
 * reader (axe). Never an email address or a phone number on screen.
 */

import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnerAlertSettings } from '../src/components/OwnerAlertSettings';
import { OwnerStaffControls } from '../src/components/OwnerStaffControls';

let sent: Array<{ method: string; path: string; body: unknown }>;

const STAFF = [
  {
    id: 'owner',
    name: 'Anthony',
    role: 'founder',
    title: 'Founder and owner',
    isOwner: true,
    active: true,
    signedInNow: true,
    lastSeenAt: '2026-10-31T10:00:00.000Z',
    place: 'Chatham, United Kingdom',
    device: 'phone',
  },
  {
    id: 'yvette',
    name: 'Yvette Okoro',
    role: 'customer_care',
    title: 'Customer care officer',
    isOwner: false,
    active: true,
    signedInNow: false,
    lastSeenAt: '2026-10-30T15:00:00.000Z',
    place: 'place not known',
    device: 'computer',
  },
];

const ALERTS = {
  ways: {
    urgentSafety: 'call',
    importantEmail: 'call',
    otherEmail: 'none',
    approvals: 'call',
    money: 'call',
  },
  quietFrom: '22:50',
  quietUntil: '06:00',
  kinds: [
    { kind: 'urgentSafety', label: 'urgent safety', way: 'call', fixed: true },
    { kind: 'importantEmail', label: 'important emails', way: 'call', fixed: false },
    { kind: 'otherEmail', label: 'other emails', way: 'none', fixed: false },
    { kind: 'approvals', label: 'Runner and partner approvals', way: 'call', fixed: false },
    { kind: 'money', label: 'money', way: 'call', fixed: false },
  ],
  choices: [
    { way: 'call', label: 'a call' },
    { way: 'text', label: 'a text' },
    { way: 'notification', label: 'a notification on your devices' },
    { way: 'none', label: 'nothing' },
  ],
};

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body });
      if (path === '/staff/owner/staff') return reply({ staff: STAFF });
      if (path === '/staff/owner/staff/yvette/switch') {
        return reply({
          message:
            "Yvette Okoro's account is switched off, and signed out everywhere, phones included.",
          staff: [STAFF[0], { ...STAFF[1], active: false }],
        });
      }
      if (path === '/staff/owner/staff/switch-all-off') {
        return reply({
          message: 'Done. One account is switched off and signed out everywhere.',
          count: 1,
          staff: [STAFF[0], { ...STAFF[1], active: false }],
        });
      }
      if (path === '/staff/owner/alerts' && method === 'GET') return reply(ALERTS);
      if (path === '/staff/owner/alerts') {
        return reply({ message: 'Done. From now on: for Runner and partner approvals, a text.' });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

async function noViolations(): Promise<void> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
  });
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

describe('all staff, and their sign-ins', () => {
  it('shows each account, signed in or last seen, and roughly where; switches one off', async () => {
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <main>
        <OwnerStaffControls staffKey="st1.owner" onNews={news} />
      </main>,
    );
    expect(await screen.findByText(/Switched on\. Signed in now\. Place: Chatham/)).toBeTruthy();
    expect(screen.getByText(/Last seen .*Place: place not known\./)).toBeTruthy();
    // The owner's own account has no switch.
    expect(screen.queryByRole('button', { name: /Anthony’s account/ })).toBeNull();
    await noViolations();
    await user.click(screen.getByRole('button', { name: 'Switch off Yvette Okoro’s account' }));
    await waitFor(() => expect(news).toHaveBeenCalledWith(expect.stringMatching(/switched off/)));
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/staff/owner/staff/yvette/switch',
      body: { on: false },
    });
    expect(
      await screen.findByRole('button', { name: 'Switch back on Yvette Okoro’s account' }),
    ).toBeTruthy();
  });

  it('asks once more before switching off all staff except him', async () => {
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <main>
        <OwnerStaffControls staffKey="st1.owner" onNews={news} />
      </main>,
    );
    await user.click(await screen.findByRole('button', { name: 'Switch off all staff except me' }));
    expect(sent.some((one) => one.path.endsWith('switch-all-off'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, switch off all staff except me' }));
    await waitFor(() => expect(news).toHaveBeenCalledWith(expect.stringMatching(/^Done\./)));
    expect(sent.some((one) => one.path === '/staff/owner/staff/switch-all-off')).toBe(true);
  });

  it('shows nothing to anyone the server does not let see it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: { message: 'Only the owner can do that.' } }, 403)),
    );
    const { container } = render(<OwnerStaffControls staffKey="st1.staff" onNews={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe('');
  });
});

describe('how Ozi reaches me', () => {
  it('shows each kind as radio buttons, urgent safety fixed, and saves only what changed', async () => {
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <main>
        <OwnerAlertSettings staffKey="st1.owner" onNews={news} />
      </main>,
    );
    expect(await screen.findByText(/always a call, even in quiet hours/)).toBeTruthy();
    const approvals = screen.getByRole('group', { name: 'Runner and partner approvals' });
    expect(approvals).toBeTruthy();
    await noViolations();
    const textMe = screen.getAllByRole('radio', { name: 'Text me' });
    // Important emails, other emails, approvals, money: four groups.
    expect(textMe).toHaveLength(4);
    await user.click(textMe[2]!);
    await user.click(screen.getByRole('button', { name: 'Save how Ozi reaches me' }));
    await waitFor(() => expect(news).toHaveBeenCalledWith(expect.stringMatching(/a text/)));
    expect(sent.at(-2)).toEqual({
      method: 'POST',
      path: '/staff/owner/alerts',
      body: { approvals: 'text' },
    });
  });
});
