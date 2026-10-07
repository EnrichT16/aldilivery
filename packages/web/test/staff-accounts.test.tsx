/**
 * Staff accounts in the admin panel (7 October 2026): each person signs in with their own
 * username and sees only their job's tabs; the founder manages the team.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

let sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }>;
let mustChange: boolean;

const ROLES = [
  {
    role: 'founder',
    title: 'Founder',
    areas: ['documents', 'problems', 'feedback', 'owed', 'finds', 'enquiries', 'team'],
  },
  { role: 'customer_care', title: 'Customer care officer', areas: ['problems', 'feedback'] },
  { role: 'finance', title: 'Finance officer', areas: ['owed'] },
];

beforeEach(() => {
  sent = [];
  mustChange = true;
  window.sessionStorage.clear();
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
      const headers = (init?.headers as Record<string, string> | undefined) ?? {};
      sent.push({ method, path, body, headers });
      const token = headers['x-staff-token'];
      const key = headers['x-staff-key'];
      if (path === '/staff/sign-in') {
        const { username, password } = body as { username: string; password: string };
        if (username !== 'chidi' || password !== 'abcd-efgh-jkmn') {
          return reply({ error: { message: 'That username and password do not match.' } }, 401);
        }
        return reply({
          token: 'st1.chidi.sig',
          name: 'Chidi',
          role: 'customer_care',
          title: 'Customer care officer',
          areas: ['problems', 'feedback'],
          mustChangePassword: mustChange,
        });
      }
      if (path === '/staff/me' && token === 'st1.chidi.sig') {
        return reply({
          name: 'Chidi',
          role: 'customer_care',
          title: 'Customer care officer',
          areas: ['problems', 'feedback'],
          account: true,
          mustChangePassword: mustChange,
        });
      }
      if (path === '/staff/me' && key === 'right-key') {
        return reply({ ...ROLES[0], name: 'Founder', account: false, mustChangePassword: false });
      }
      if (path === '/staff/check' && key === 'right-key') return reply({ ok: true });
      if (path === '/staff/password') {
        mustChange = false;
        return reply({ message: 'Your password is changed.' });
      }
      if (path === '/staff/problems') return reply({ problems: [] });
      if (path === '/staff/documents') return reply({ documents: [] });
      if (path === '/staff/roles') return reply({ roles: ROLES });
      if (path === '/staff/team' && method === 'GET') return reply({ team: [] });
      if (path === '/staff/team' && method === 'POST') {
        const input = body as { name: string; username: string; role: string };
        return reply(
          {
            member: {
              id: 'm1',
              ...input,
              title: 'Finance officer',
              active: true,
              mustChangePassword: true,
              lastSignInAt: null,
              createdAt: '2026-10-07T10:00:00.000Z',
            },
            password: 'pqrs-tuvw-xyz2',
            message: `${input.name} can now sign in as ${input.username} with the password pqrs-tuvw-xyz2. They choose their own password the first time. This password is shown only once.`,
          },
          201,
        );
      }
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/me') return reply({ error: { message: 'You are not signed in.' } }, 401);
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

describe('a staff member signing in', () => {
  it('chooses their own password first, then sees only their job', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'chidi');
    await user.type(screen.getByLabelText('Password'), 'abcd-efgh-jkmn');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Choose your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin pages' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('The password you were given'), 'abcd-efgh-jkmn');
    await user.type(screen.getByLabelText('Your new password'), 'chidis own password');
    await user.type(screen.getByLabelText('Your new password again'), 'chidis own password');
    await user.click(screen.getByRole('button', { name: 'Save my password' }));

    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Problems', 'Feedback']);
    expect(screen.getByText(/Signed in as Chidi, Customer care officer/)).toBeInTheDocument();
    const asked = sent.find((r) => r.path === '/staff/problems')?.headers ?? {};
    expect(asked['x-staff-token']).toBe('st1.chidi.sig');
    expect(asked['x-staff-key']).toBeUndefined();
  });

  it('says so when the password is wrong', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.type(await screen.findByLabelText('Username'), 'chidi');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That username and password do not match.',
    );
  });
});

describe('the founder', () => {
  it('sees every tab, and adds someone to the team with a job', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/staff');
    await user.click(
      await screen.findByRole('button', { name: 'Founder: sign in with the staff key' }),
    );
    await user.type(screen.getByLabelText('Your name, recorded with each decision'), 'Anthony');
    await user.type(screen.getByLabelText('Staff key'), 'right-key');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(within(nav).getAllByRole('button')).toHaveLength(7);
    await user.click(within(nav).getByRole('button', { name: 'Team' }));
    expect(await screen.findByText('Finance officer: Money owed.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Their name'), 'Ngozi');
    await user.type(screen.getByLabelText(/Their username/), 'ngozi');
    await user.selectOptions(screen.getByLabelText('Their job'), 'finance');
    await user.click(screen.getByRole('button', { name: 'Add to the team' }));
    expect(
      await screen.findByText(/Ngozi can now sign in as ngozi with the password pqrs-tuvw-xyz2/),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.path === '/staff/team' && r.method === 'POST')?.body).toEqual({
      name: 'Ngozi',
      username: 'ngozi',
      role: 'finance',
    });
  });
});
