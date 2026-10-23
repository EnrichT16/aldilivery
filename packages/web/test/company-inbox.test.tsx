/**
 * The company inbox (ruling 77): every account has a Messages page with how many are new and a
 * reply box; the admin panel's Messages tab asks for a message code when a staff member presses
 * Send, and lists every message and call with who, to whom, when and what authorised it.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { understandOrganisation, understandPartner } from '../src/voice/business-voice';
import { READ_MESSAGES } from '../src/lib/inbox-api';
import { openPage } from './staff-tabs';

interface Sent {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

let sent: Sent[];
let read: boolean;

function reply(body: unknown, status = 200): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  } as unknown as Response;
}

const MESSAGE = {
  id: 'm1',
  from: 'company',
  fromName: `Anthony, ${storeConfig.productName}`,
  text: 'Can you work on Saturday morning?',
  sentAt: '2026-10-23T10:00:00.000Z',
};

function stub(extra: (path: string, method: string, body: unknown) => Response | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (path === '/inbox') {
        return reply({
          productName: storeConfig.productName,
          messages: [{ ...MESSAGE, readAt: read ? '2026-10-23T10:05:00.000Z' : null }],
          unread: read ? 0 : 1,
        });
      }
      if (path === '/inbox/unread') return reply({ unread: read ? 0 : 1, call: null });
      if (path === '/inbox/read') {
        read = true;
        return reply({ unread: 0 });
      }
      if (path === '/inbox/call') return reply({ call: null });
      if (path === '/inbox/reply') {
        return reply(
          {
            message: {
              id: 'm2',
              from: 'you',
              fromName: 'Tomasz',
              text: 'Yes',
              sentAt: null,
              readAt: null,
            },
            words: `Sent to ${storeConfig.productName}. We will reply here.`,
          },
          201,
        );
      }
      return extra(path, method, body) ?? reply({ error: { message: `Nothing for ${path}` } }, 404);
    }),
  );
}

beforeEach(() => {
  sent = [];
  read = false;
});

async function expectAccessible(): Promise<void> {
  const results = await axe.run(document.body);
  expect(results.violations.map((v) => v.id)).toEqual([]);
}

describe('the Messages page, for each account', () => {
  it('a Runner sees how many are new, the message, and replies; it is marked read', async () => {
    window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
    stub(() => null);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/runner/messages']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('You have 1 new message.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Your messages, oldest first' });
    expect(within(list).getByText('Can you work on Saturday morning?')).toBeInTheDocument();
    expect(within(list).getByText(/New\./)).toBeInTheDocument();
    await waitFor(() => expect(sent.some((row) => row.path === '/inbox/read')).toBe(true));
    // The Runner's own sign-in, never another account's.
    const opened = sent.find((row) => row.path === '/inbox')!;
    expect(opened.headers['authorization']).toBe('Bearer runner-token');

    await user.type(screen.getByLabelText('Your reply'), 'Yes, from nine.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/inbox/reply')?.body).toEqual({
        text: 'Yes, from nine.',
      }),
    );
    expect(screen.getByRole('button', { name: 'Say my reply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read my messages aloud' })).toBeInTheDocument();
    await expectAccessible();
  });

  it('a Shop Partner reaches it with their business sign-in', async () => {
    window.sessionStorage.setItem('ozidelivery.business.token', 'business-token');
    stub(() => null);
    render(
      <MemoryRouter initialEntries={['/partner/messages']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('You have 1 new message.')).toBeInTheDocument();
    const opened = sent.find((row) => row.path === '/inbox')!;
    expect(opened.headers['x-business-token']).toBe('business-token');
  });

  it('Ozi understands "read my messages", on every kind of account', () => {
    expect(READ_MESSAGES.test('read my messages')).toBe(true);
    expect(READ_MESSAGES.test('have I got any messages')).toBe(true);
    expect(READ_MESSAGES.test('put my message on the card')).toBe(false);
    expect(understandPartner('read my messages')).toEqual({ kind: 'messages' });
    expect(understandOrganisation('any new messages?')).toEqual({ kind: 'messages' });
  });
});

describe('the admin panel’s Messages tab', () => {
  function stubStaff(authoriser: boolean): void {
    window.sessionStorage.setItem('ozidelivery.staff.key', 'st1.chidi');
    window.sessionStorage.setItem('ozidelivery.staff.name', 'Chidi');
    stub((path, method) => {
      if (path === '/staff/me') {
        return reply({
          name: 'Chidi',
          role: 'customer_care',
          title: 'Customer care officer',
          areas: ['messages'],
          account: true,
          mustChangePassword: false,
          isOwner: false,
          viewOnly: false,
          twoStep: {
            on: true,
            dueAt: '2026-11-01T00:00:00Z',
            setupNeeded: false,
            recoveryCodesLeft: 8,
          },
        });
      }
      if (path === '/staff/contact/me') {
        return reply({
          authoriser,
          ownAccount: true,
          callCodeActive: authoriser,
          callCodeUntil: null,
          callsOn: true,
          phoneOn: true,
          recordingOn: false,
          recordingNote: 'not recorded: recording storage not set up',
          messageCodeMinutes: 120,
        });
      }
      if (path === '/staff/messages') {
        return reply({
          unread: 1,
          threads: [
            {
              id: 't1',
              accountKind: 'runner',
              accountId: 'r1',
              accountWord: 'Runner',
              accountName: 'Tomasz',
              lastMessageAt: '2026-10-23T10:00:00.000Z',
              lastFromAccount: true,
              unread: 1,
              held: 0,
            },
          ],
        });
      }
      if (path.startsWith('/staff/contact/accounts')) {
        return reply({ accounts: [{ id: 'r1', name: 'Tomasz', kind: 'runner', word: 'Runner' }] });
      }
      if (path === '/staff/contact/log') {
        return reply({
          everyone: false,
          entries: [
            {
              kind: 'message',
              id: 'm1',
              at: '2026-10-23T10:00:00.000Z',
              staffName: 'Chidi',
              recipientWord: 'Runner',
              recipientName: 'Tomasz',
              status: 'sent',
              sentAt: '2026-10-23T10:00:00.000Z',
              readAt: null,
              authorisedBy: 'code',
              authorisedByName: 'Anthony',
            },
            {
              kind: 'call',
              id: 'c1',
              at: '2026-10-23T09:00:00.000Z',
              status: 'ended',
              staffName: 'Chidi',
              accountKind: 'runner',
              accountWord: 'Runner',
              accountName: 'Tomasz',
              recipientWord: 'Runner',
              recipientName: 'Tomasz',
              authorisedBy: 'code',
              authorisedByName: 'Anthony',
              startedAt: '2026-10-23T09:00:00.000Z',
              answeredAt: null,
              endedAt: '2026-10-23T09:02:00.000Z',
              durationSeconds: 0,
              phoneRung: false,
              answered: false,
              recording: {
                status: 'not_recorded',
                note: 'not recorded: recording storage not set up',
                playable: false,
              },
            },
          ],
        });
      }
      if (path === '/staff/messages/send' && method === 'POST') {
        return reply({ message: {}, notifiedBy: 'text', words: 'Sent to Tomasz.' }, 201);
      }
      if (path === '/staff/messages/ask' && method === 'POST') {
        return reply({ message: {}, words: 'Ozi will ask the owner.' }, 201);
      }
      return null;
    });
  }

  async function openMessages(user: ReturnType<typeof userEvent.setup>) {
    render(
      <MemoryRouter initialEntries={['/staff']}>
        <App />
      </MemoryRouter>,
    );
    await openPage(user, 'Messages');
    expect(await screen.findByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  }

  async function writeToTomasz(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Their name'), 'Tom');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await user.click(await screen.findByRole('button', { name: 'Runner Tomasz' }));
    await user.type(screen.getByLabelText('Your message'), 'Please ring the office.');
  }

  it('pressing Send asks for the message code, and only then sends with it', async () => {
    stubStaff(false);
    const user = userEvent.setup();
    await openMessages(user);
    expect(await screen.findByText('1 unread reply.')).toBeInTheDocument();
    await writeToTomasz(user);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    // Nothing went yet: the code is asked for first.
    expect(sent.some((row) => row.path === '/staff/messages/send')).toBe(false);
    const field = screen.getByLabelText('Message code, 6 numbers');
    expect(field).toHaveFocus();
    await user.type(field, '123456');
    await user.click(screen.getByRole('button', { name: 'Send with this code' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/staff/messages/send')?.body).toEqual({
        accountKind: 'runner',
        accountId: 'r1',
        text: 'Please ring the office.',
        code: '123456',
      }),
    );
    await expectAccessible();
  });

  it('"Ask for a code" puts the message on Ozi’s desk instead', async () => {
    stubStaff(false);
    const user = userEvent.setup();
    await openMessages(user);
    await writeToTomasz(user);
    await user.click(screen.getByRole('button', { name: /Ask for a code/ }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/staff/messages/ask')?.body).toEqual({
        accountKind: 'runner',
        accountId: 'r1',
        text: 'Please ring the office.',
      }),
    );
  });

  it('an authoriser sends at once, with no code asked', async () => {
    stubStaff(true);
    const user = userEvent.setup();
    await openMessages(user);
    await writeToTomasz(user);
    expect(screen.queryByRole('button', { name: /Ask for a code/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(sent.find((row) => row.path === '/staff/messages/send')?.body).toEqual({
        accountKind: 'runner',
        accountId: 'r1',
        text: 'Please ring the office.',
      }),
    );
  });

  it('lists every message and call with the time, who, to whom and what authorised it', async () => {
    stubStaff(false);
    const user = userEvent.setup();
    await openMessages(user);
    const log = await screen.findByRole('list', { name: 'Messages and calls, newest first' });
    const rows = within(log).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(
      'Message from Chidi to Runner Tomasz, sent with a code from Anthony',
    );
    expect(rows[0]).toHaveTextContent('Friday 23 October at 11:00 am');
    expect(rows[1]).toHaveTextContent('Call from Chidi to Runner Tomasz');
    expect(rows[1]).toHaveTextContent('Not answered.');
    expect(rows[1]).toHaveTextContent('Recording: not recorded: recording storage not set up.');
  });
});
