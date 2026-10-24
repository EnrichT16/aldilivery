/**
 * "Allocate jobs" in the admin panel's Orders tab (ruling 80): choose orders with their
 * checkboxes, choose a Runner, press "Send to Runner", and the results are announced in the
 * status line; or send one order on its own with its picker. Usable by keyboard and screen
 * reader (axe), and by voice: "send order 1 2 3 4 to Tomasz", "send all waiting orders to
 * Ayesha".
 */

import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllocateJobs } from '../src/components/AllocateJobs';
import { Orders } from '../src/pages/StaffAdmin';
import { allocateCommand, orderNumbersMeant, understand } from '../src/voice/staff-voice';

let sent: Array<{ method: string; path: string; body: unknown }>;

function order(number: number, reference: string, extra: Record<string, unknown> = {}) {
  return {
    number,
    id: `order-${number}`,
    reference,
    status: 'paid',
    statusWords: 'Paid, finding a Runner',
    itemCount: 2,
    goodsEstimatePence: 1000,
    area: 'ME7',
    waitingSince: '2026-10-24T09:00:00.000Z',
    booked: null,
    bookedLater: false,
    offerAt: null,
    largeWords: null,
    split: null,
    sentTo: null,
    ...extra,
  };
}

const BOARD = {
  holdMinutes: 10,
  orders: [
    order(1, '7KQ2PX'),
    order(2, 'B4TT3R'),
    order(3, 'C0FFEE', { status: 'offered', statusWords: 'Offered to Bola' }),
  ],
  runners: [
    {
      id: 'runner-tomasz',
      name: 'Tomasz Nowak',
      firstName: 'Tomasz',
      onShift: true,
      travel: 'car',
      travelWords: 'by car',
      jobsInHand: 1,
      offersOpen: 0,
      queued: 0,
      holds: 1,
    },
    {
      id: 'runner-ayesha',
      name: 'Ayesha Khan',
      firstName: 'Ayesha',
      onShift: false,
      travel: 'bicycle',
      travelWords: 'by bicycle',
      jobsInHand: 0,
      offersOpen: 0,
      queued: 0,
      holds: 0,
    },
  ],
  recent: [],
};

beforeEach(() => {
  sent = [];
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
      if (path === '/staff/allocate') return reply(BOARD);
      if (path === '/staff/orders/allocate') {
        const assignments = (body as { assignments: Array<{ orderId: string; runnerId: string }> })
          .assignments;
        const results = assignments.map((row, index) =>
          index === assignments.length - 1 && assignments.length > 1
            ? {
                ...row,
                reference: 'C0FFEE',
                runnerName: 'Tomasz',
                result: 'refused',
                reason: 'it has been bought already',
              }
            : {
                ...row,
                reference: 'X',
                runnerName: 'Tomasz',
                result: 'allocated',
                state: 'offered',
              },
        );
        const refused = results.filter((row) => row.result === 'refused').length;
        return reply({
          allocated: results.length - refused,
          refused,
          results,
          message:
            refused > 0
              ? `${results.length - refused} orders sent to Tomasz; 1 could not be: order C0FFEE, it has been bought already.`
              : `${results.length} ${results.length === 1 ? 'order' : 'orders'} sent to ${row0Name(assignments)}.`,
        });
      }
      if (path.startsWith('/staff/orders'))
        return reply({ view: 'live', orders: [], statuses: [] });
      return reply({});
    }),
  );
});

function row0Name(assignments: Array<{ runnerId: string }>): string {
  return assignments[0]?.runnerId === 'runner-ayesha' ? 'Ayesha' : 'Tomasz';
}

async function noViolations(): Promise<void> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
  });
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

describe('the Allocate jobs view', () => {
  it('sends the chosen orders to the chosen Runner and announces the results', async () => {
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<AllocateJobs staffKey="st1.owner.sig" onNews={news} />);

    const first = await screen.findByRole('checkbox', { name: /^1\. Order 7KQ2PX/ });
    expect(screen.getByRole('radio', { name: /Tomasz Nowak, on shift, by car, holds 1 job/ }));
    expect(
      screen.getByRole('radio', { name: /Ayesha Khan, off shift, by bicycle, holds no jobs/ }),
    );
    await noViolations();

    await user.click(first);
    await user.click(screen.getByRole('checkbox', { name: /^3\. Order C0FFEE/ }));
    expect(screen.getByText('2 chosen.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Tomasz Nowak/ }));
    await user.click(screen.getByRole('button', { name: /^Send to Runner/ }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '1 orders sent to Tomasz; 1 could not be: order C0FFEE, it has been bought already.',
      ),
    );
    expect(news).toHaveBeenCalledWith(expect.stringMatching(/could not be/));
    const request = sent.find((row) => row.path === '/staff/orders/allocate');
    expect(request?.body).toEqual({
      assignments: [
        { orderId: 'order-1', runnerId: 'runner-tomasz' },
        { orderId: 'order-3', runnerId: 'runner-tomasz' },
      ],
    });
    const refused = screen.getByRole('list', { name: 'Orders that could not be sent' });
    expect(within(refused).getByText(/C0FFEE: it has been bought already/)).toBeInTheDocument();
  });

  it('selects every order at once, with a backup and sending booked orders early', async () => {
    const user = userEvent.setup({ delay: null });
    render(<AllocateJobs staffKey="st1.owner.sig" />);
    await user.click(await screen.findByRole('button', { name: 'Select all 3' }));
    expect(screen.getByRole('button', { name: 'Clear the selection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: /Ayesha Khan/ }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Backup Runner/ }),
      'runner-tomasz',
    );
    await user.click(screen.getByRole('checkbox', { name: /Send booked orders now/ }));
    await user.click(screen.getByRole('button', { name: /^Send to Runner/ }));
    await waitFor(() =>
      expect(sent.some((row) => row.path === '/staff/orders/allocate')).toBe(true),
    );
    const body = sent.find((row) => row.path === '/staff/orders/allocate')?.body as {
      assignments: unknown[];
    };
    expect(body.assignments).toHaveLength(3);
    expect(body.assignments[0]).toEqual({
      orderId: 'order-1',
      runnerId: 'runner-ayesha',
      backupRunnerId: 'runner-tomasz',
      allowEarly: true,
    });
  });

  it('sends one order on its own from its picker, by keyboard', async () => {
    const user = userEvent.setup({ delay: null });
    render(<AllocateJobs staffKey="st1.owner.sig" />);
    const picker = await screen.findByRole('combobox', { name: 'Send order B4TT3R to' });
    await user.selectOptions(picker, 'runner-ayesha');
    await user.click(screen.getByRole('button', { name: 'Send order B4TT3R' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 order sent to Ayesha.'),
    );
    expect(sent.find((row) => row.path === '/staff/orders/allocate')?.body).toEqual({
      assignments: [{ orderId: 'order-2', runnerId: 'runner-ayesha' }],
    });
  });

  it('is a view of the Orders tab only for those who may allocate', async () => {
    const user = userEvent.setup({ delay: null });
    const { unmount } = render(<Orders staffKey="st1.chidi.sig" />);
    expect(screen.queryByRole('button', { name: 'Allocate jobs' })).not.toBeInTheDocument();
    unmount();
    render(<Orders staffKey="st1.owner.sig" canAllocate />);
    await user.click(screen.getByRole('button', { name: 'Allocate jobs' }));
    expect(await screen.findByRole('heading', { name: 'Allocate jobs' })).toBeInTheDocument();
  });
});

describe('allocating by voice', () => {
  it('hears the order numbers and the Runner', () => {
    expect(understand('send order 1 2 3 4 to Tomasz')).toEqual({
      kind: 'allocate',
      orders: [1, 2, 3, 4],
      runner: 'tomasz',
    });
    expect(understand('Send orders one, two and three to Ayesha please.')).toEqual({
      kind: 'allocate',
      orders: [1, 2, 3],
      runner: 'ayesha',
    });
    expect(understand('send all waiting orders to Ayesha')).toEqual({
      kind: 'allocate',
      orders: 'all',
      runner: 'ayesha',
    });
    expect(allocateCommand('send it to me')).toBeNull();
    expect(understand('next')).toEqual({ kind: 'next' });
  });

  it('takes "1234" heard as one number digit by digit when the list is shorter', () => {
    expect(orderNumbersMeant([1234], 6)).toEqual([1, 2, 3, 4]);
    expect(orderNumbersMeant([12], 20)).toEqual([12]);
    expect(orderNumbersMeant([2, 2, 3], 5)).toEqual([2, 3]);
  });
});
