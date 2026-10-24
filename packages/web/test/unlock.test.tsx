/**
 * Unlocking anybody, and resetting a PIN or a password, in the admin panel (ruling 81): the
 * "Locked out" list on Needs you now with its Unlock buttons, finding someone to unlock or reset,
 * a PIN reset asked twice, a temporary password shown once, the owner's account never offered to
 * anyone else, the owner's switch in Team, and Ozi hearing "unlock Yvette" and "reset Yvette's
 * PIN". Usable by keyboard and screen reader (axe).
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LockedOut } from '../src/components/Unlock';
import { locksNamed, type LockedPerson } from '../src/lib/unlock-api';
import { App } from '../src/App';
import { understand, unlockCommand } from '../src/voice/staff-voice';

let sent: Array<{ method: string; path: string; body: unknown }>;
let locks: LockedPerson[];
let me: Record<string, unknown>;

const YVETTE_PIN: LockedPerson = {
  key: 'shopper_pin:s1',
  kind: 'shopper_pin',
  account: 'shopper',
  id: 's1',
  name: 'Yvette',
  until: '2026-10-24T09:15:00.000Z',
  words: 'Yvette, a Shopper: their PIN, after three wrong tries',
};

const KEMI_CODES: LockedPerson = {
  key: 'staff_codes:k1',
  kind: 'staff_codes',
  account: 'staff',
  id: 'k1',
  name: 'Kemi',
  until: '2026-10-24T09:12:00.000Z',
  words: 'Kemi, staff: message and call codes, after five wrong codes',
};

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  sent = [];
  locks = [YVETTE_PIN, KEMI_CODES];
  me = {
    name: 'Anthony',
    role: 'founder',
    title: 'Founder',
    areas: ['team'],
    account: true,
    mustChangePassword: false,
    isOwner: true,
    viewOnly: false,
    canUnlock: true,
    twoStep: { on: true, dueAt: '2026-11-01T00:00:00Z', setupNeeded: false, recoveryCodesLeft: 8 },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      sent.push({ method, path, body });
      if (path === '/staff/me') return reply(me);
      if (path === '/staff/locked-out') return reply({ lockedOut: locks });
      if (path.startsWith('/staff/unlock/find')) {
        return reply({
          people: [
            {
              account: 'shopper',
              id: 's1',
              name: 'Yvette',
              phoneEnding: 'ending 001',
              hasPin: true,
              pinLocked: true,
              signInCodesLocked: false,
            },
            {
              account: 'staff',
              id: 'owner-1',
              name: 'Anthony',
              isOwner: true,
              signInLocked: false,
              codesLocked: false,
            },
            {
              account: 'staff',
              id: 'k1',
              name: 'Kemi',
              isOwner: false,
              signInLocked: false,
              codesLocked: true,
            },
          ],
        });
      }
      if (path === '/staff/shoppers/s1/pin/unlock') {
        locks = locks.filter((lock) => lock.id !== 's1');
        return reply({ told: true, message: "Yvette's PIN is unlocked. We have texted them." });
      }
      if (path === '/staff/shoppers/s1/pin/reset') {
        return reply({ told: true, message: "Yvette's PIN is reset." });
      }
      if (path === '/staff/team/k1/unlock') {
        locks = locks.filter((lock) => lock.id !== 'k1');
        return reply({ told: false, message: 'Kemi is unlocked: message and call codes.' });
      }
      if (path === '/staff/team/k1/reset') {
        return reply({
          told: false,
          password: 'abcd-efgh-jkmn',
          message: "Kemi's new password is abcd-efgh-jkmn. This is shown only once.",
        });
      }
      if (path === '/staff/team') {
        return reply({
          team: [
            {
              id: 'k1',
              name: 'Kemi',
              username: 'kemi',
              role: 'operations_manager',
              title: 'Operations manager',
              active: true,
              mustChangePassword: false,
              lastSignInAt: null,
              createdAt: '2026-10-01T00:00:00Z',
              canUnlock: false,
              lockedOut: true,
            },
          ],
        });
      }
      if (path === '/staff/roles') return reply({ roles: [] });
      if (path === '/staff/team/k1/can-unlock') {
        return reply({ message: 'Kemi may now unlock people, and reset a PIN or a password.' });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

describe('the Locked out list', () => {
  it('lists everyone locked out, each with an Unlock button that uses the right tool', async () => {
    const user = userEvent.setup({ delay: null });
    const view = render(<LockedOut staffKey="st1.owner.sig" owner />);
    expect(await screen.findByText(/2 locks on now/)).toBeInTheDocument();
    expect(screen.getByText(/Yvette, a Shopper: their PIN/, { selector: 'p' })).toBeInTheDocument();
    const results = await axe.run(view.container);
    expect(results.violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: `Unlock ${YVETTE_PIN.words}` }));
    expect(await screen.findByText(/Yvette's PIN is unlocked/)).toBeInTheDocument();
    expect(sent.some((row) => row.path === '/staff/shoppers/s1/pin/unlock')).toBe(true);
    await user.click(screen.getByRole('button', { name: `Unlock ${KEMI_CODES.words}` }));
    expect(await screen.findByText(/Nobody is locked out/)).toBeInTheDocument();
    expect(sent.some((row) => row.path === '/staff/team/k1/unlock')).toBe(true);
  });

  it('finds someone, asks before a PIN reset, and shows a temporary password once', async () => {
    const user = userEvent.setup({ delay: null });
    render(<LockedOut staffKey="st1.kemi.sig" />);
    await user.type(
      await screen.findByLabelText('Their name, username, or the last numbers of their phone'),
      'yv',
    );
    await user.click(screen.getByRole('button', { name: 'Find' }));
    const yvette = await screen.findByRole('heading', { name: /Yvette, a Shopper/ });
    expect(yvette).toHaveTextContent('phone ending 001');
    expect(document.body.textContent).not.toMatch(/07700|900001/);

    await user.click(screen.getByRole('button', { name: 'Reset PIN for Yvette' }));
    expect(sent.some((row) => row.path === '/staff/shoppers/s1/pin/reset')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, reset Yvette’s PIN' }));
    expect(await screen.findByText("Yvette's PIN is reset.")).toBeInTheDocument();

    // The owner's own account is never offered to anyone else for a new password.
    const owner = screen.getByRole('heading', { name: /Anthony, the owner/ }).closest('li')!;
    expect(within(owner).queryByRole('button', { name: /New password/ })).toBeNull();
    expect(within(owner).getByRole('button', { name: 'Unlock Anthony' })).toBeInTheDocument();

    const kemi = screen.getByRole('heading', { name: /Kemi, staff/ }).closest('li')!;
    await user.click(within(kemi).getByRole('button', { name: 'New password for Kemi' }));
    await user.click(within(kemi).getByRole('button', { name: 'Yes, give Kemi a new password' }));
    expect(await within(kemi).findByText(/abcd-efgh-jkmn/)).toBeInTheDocument();
    expect(screen.getAllByText(/abcd-efgh-jkmn/)).toHaveLength(1);
  });
});

describe('the admin panel', () => {
  it('gives Needs you now, with the Locked out list, to a staff member who may unlock', async () => {
    me = {
      ...me,
      name: 'Kemi',
      role: 'customer_care',
      title: 'Customer care officer',
      areas: ['messages'],
      isOwner: false,
    };
    window.sessionStorage.setItem('ozidelivery.staff.key', 'st1.kemi.sig');
    window.sessionStorage.setItem('ozidelivery.staff.name', 'Kemi');
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Locked out' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Needs you now' })).toBeInTheDocument();
    // Without the overview area, the overview itself is not loaded.
    expect(sent.some((row) => row.path === '/staff/overview')).toBe(false);
  });

  it('lets the owner give the permission in Team, and unlock someone there', async () => {
    window.sessionStorage.setItem('ozidelivery.staff.key', 'st1.owner.sig');
    window.sessionStorage.setItem('ozidelivery.staff.name', 'Anthony');
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('tab', { name: 'People' }));
    await user.click(await screen.findByRole('tab', { name: 'Team' }));
    await user.click(await screen.findByRole('button', { name: 'Let them unlock people Kemi' }));
    await waitFor(() => {
      expect(sent.find((row) => row.path === '/staff/team/k1/can-unlock')?.body).toEqual({
        canUnlock: true,
      });
    });
    await user.click(screen.getByRole('button', { name: 'Unlock Kemi' }));
    await waitFor(() => {
      expect(sent.some((row) => row.path === '/staff/team/k1/unlock')).toBe(true);
    });
  });
});

describe('by voice', () => {
  it('hears "unlock Yvette" and "reset Yvette\'s PIN"', () => {
    expect(understand('unlock Yvette')).toEqual({ kind: 'unlock', name: 'yvette' });
    expect(understand('Please unlock Kemi.')).toEqual({ kind: 'unlock', name: 'kemi' });
    expect(understand("reset Yvette's PIN")).toEqual({ kind: 'reset-pin', name: 'yvette' });
    expect(understand('reset the PIN for Yvette Brown')).toEqual({
      kind: 'reset-pin',
      name: 'yvette brown',
    });
    expect(unlockCommand('unlock the screen')).toBeNull();
    expect(unlockCommand('reset my PIN')).toBeNull();
  });

  it('matches a spoken name to the locks, first names counting', () => {
    expect(locksNamed('yvette', [YVETTE_PIN, KEMI_CODES])).toEqual([YVETTE_PIN]);
    expect(locksNamed('nobody', [YVETTE_PIN, KEMI_CODES])).toEqual([]);
  });
});
