/**
 * The admin panel: signing in with the staff key, reviewing Runner documents, deciding problems
 * with the evidence, writing off what a leaving Runner owes, and reading feedback. Every request
 * carries the staff key, and every decision carries the name of whoever made it.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

interface Sent {
  method: string;
  path: string;
  body: unknown;
  key: string | undefined;
}

let sent: Sent[];
let documentsDecided: boolean;

beforeEach(() => {
  sent = [];
  documentsDecided = false;
  window.sessionStorage.setItem('ozidelivery.doors.read', 'yes');
  // jsdom has no object URLs; the panel only needs an address to hand to <img> and <audio>.
  URL.createObjectURL = () => 'blob:evidence';
  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => Promise.resolve(body),
      blob: async () => Promise.resolve(new Blob(['x'])),
    }) as unknown as Response;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const key = (init?.headers as Record<string, string> | undefined)?.['x-staff-key'];
      sent.push({ method, path, body, key });

      if (path.startsWith('/staff') && key !== 'right-key') {
        return reply({ error: { message: 'Staff only.' } }, 403);
      }
      if (path === '/staff/check') return reply({ ok: true });
      if (path === '/staff/me') {
        return reply({
          name: 'Founder',
          role: 'founder',
          title: 'Founder',
          areas: ['documents', 'problems', 'feedback', 'owed', 'finds', 'enquiries', 'team'],
          account: false,
          mustChangePassword: false,
        });
      }
      if (path === '/staff/documents') {
        return reply({
          documents: documentsDecided
            ? []
            : [
                {
                  id: 'd1',
                  kind: 'insurance',
                  name: 'Motor insurance',
                  status: 'submitted',
                  sentAs: 'photo',
                  shareCode: null,
                  createdAt: '2026-10-03T10:00:00Z',
                  runner: { id: 'r1', name: 'Tomasz', runnerId: 'RAB12CD3' },
                },
              ],
        });
      }
      if (path === '/staff/documents/d1/review') {
        documentsDecided = true;
        return reply({ document: {} });
      }
      if (path === '/staff/problems') {
        return reply({
          reports: [
            {
              id: 'p1',
              orderId: 'o1',
              reportedBy: 'shopper',
              summary: 'Half the shopping was missing.',
              refundRequestedPence: 800,
              decideBy: '2026-10-06T10:00:00Z',
              overdue: false,
              evidence: [
                {
                  id: 'e1',
                  kind: 'voice_note',
                  addedBy: 'shopper',
                  text: null,
                  contentType: 'audio/webm',
                },
                {
                  id: 'e2',
                  kind: 'note',
                  addedBy: 'runner',
                  text: 'One bag only.',
                  contentType: null,
                },
              ],
            },
          ],
        });
      }
      if (path === '/staff/evidence/e1' || path === '/staff/documents/d1/image') return reply({});
      if (path === '/staff/problems/p1/decide') return reply({ report: {} });
      if (path === '/staff/recoveries') {
        return reply({
          writeOffUpToPence: 2000,
          recoveries: [
            {
              runner: { id: 'r1', name: 'Tomasz', runnerId: 'RAB12CD3' },
              remainingPence: 150,
              canWriteOff: true,
            },
            {
              runner: { id: 'r2', name: 'Ola', runnerId: 'RZZ99XY1' },
              remainingPence: 2500,
              canWriteOff: false,
            },
          ],
        });
      }
      if (path === '/staff/runners/r1/write-off') return reply({ message: '£1.50 written off.' });
      if (path === '/staff/feedback') {
        return reply({
          feedback: [
            {
              id: 'f1',
              message: 'A shop map would help.',
              createdAt: '2026-10-03T10:00:00Z',
              runner: { name: 'Tomasz', runnerId: 'RAB12CD3' },
            },
            {
              id: 'f2',
              message: 'Pay day sooner.',
              createdAt: '2026-10-03T11:00:00Z',
              runner: null,
            },
          ],
        });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderStaff() {
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <App />
    </MemoryRouter>,
  );
}

async function signIn(user: ReturnType<typeof userEvent.setup>, key = 'right-key') {
  await user.click(screen.getByRole('button', { name: 'Founder: sign in with the staff key' }));
  await user.type(screen.getByLabelText('Your name, recorded with each decision'), 'Anthony');
  await user.type(screen.getByLabelText('Staff key'), key);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function expectAccessible(): Promise<void> {
  const results = await axe.run(document.body);
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe('signing in', () => {
  it('refuses a wrong staff key', async () => {
    const user = userEvent.setup();
    renderStaff();
    await expectAccessible();
    await signIn(user, 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('That staff key was not accepted.');
  });

  it('remembers the key for this tab only, and signs out', async () => {
    const user = userEvent.setup();
    renderStaff();
    await signIn(user);
    expect(await screen.findByText(/Signed in as Anthony/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ozidelivery.staff.key')).toBe('right-key');
    expect(window.localStorage.getItem('ozidelivery.staff.key')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ozidelivery.staff.key')).toBeNull();
  });
});

describe('the panel', () => {
  it('accepts a document with its insurance date, recording who decided', async () => {
    const user = userEvent.setup();
    renderStaff();
    await signIn(user);
    const card = await screen.findByRole('article', { name: /Motor insurance, from Tomasz/ });
    await expectAccessible();
    await user.click(within(card).getByRole('button', { name: 'Show the photo' }));
    expect(
      await within(card).findByRole('img', { name: /Motor insurance, sent by Tomasz/ }),
    ).toBeInTheDocument();
    await user.type(within(card).getByLabelText('The date the insurance runs out'), '2027-03-31');
    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Nothing is waiting.')).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/staff/documents/d1/review')).toMatchObject({
      key: 'right-key',
      body: { decision: 'accept', by: 'Anthony', expiresOn: '2027-03-31' },
    });
  });

  it('decides a problem after playing the evidence', async () => {
    const user = userEvent.setup();
    renderStaff();
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Problems' }));
    const card = await screen.findByRole('article', { name: /Half the shopping was missing/ });
    expect(within(card).getByText(/They asked for £8.00 back/)).toBeInTheDocument();
    expect(within(card).getByText(/One bag only/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /Play voice note 1/ }));
    expect(await within(card).findByRole('button', { name: /Stop voice note 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectAccessible();

    await user.click(within(card).getByRole('button', { name: 'Save the decision' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Please choose who was responsible.');
    await user.click(within(card).getByRole('radio', { name: 'The Runner was responsible' }));
    await user.type(within(card).getByLabelText(/The decision, in words/), 'Bag left in the car.');
    await user.click(within(card).getByRole('button', { name: 'Save the decision' }));
    expect(await screen.findByText('Decided. £8.00 refunded.')).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/staff/problems/p1/decide')?.body).toEqual({
      decision: 'runner_at_fault',
      refundPence: 800,
      note: 'Bag left in the car.',
      by: 'Anthony',
    });
  });

  it('writes off a small amount owed, and only offers it at £20 or less', async () => {
    const user = userEvent.setup();
    renderStaff();
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Money owed' }));
    expect(await screen.findByText(/Ola \(RZZ99XY1\) owes £25.00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write off £25.00/ })).not.toBeInTheDocument();
    await expectAccessible();
    await user.click(screen.getByRole('button', { name: 'They have left: write off £1.50' }));
    expect(await screen.findByText('Tomasz: £1.50 written off.')).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/staff/runners/r1/write-off')?.body).toEqual({
      by: 'Anthony',
    });
  });

  it('shows Runner feedback, named or not', async () => {
    const user = userEvent.setup();
    renderStaff();
    await signIn(user);
    await user.click(await screen.findByRole('button', { name: 'Feedback' }));
    expect(await screen.findByText('A shop map would help.')).toBeInTheDocument();
    expect(screen.getByText(/From Tomasz \(RAB12CD3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Sent without a name/)).toBeInTheDocument();
    await expectAccessible();
  });
});
