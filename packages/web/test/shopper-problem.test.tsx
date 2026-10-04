/**
 * A Shopper's past orders, and reporting a problem with one, asking for money back
 * (rulings of 2 October 2026).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  sent = [];
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
      if (path === '/orders') {
        return reply({
          orders: [
            {
              id: 'order-7',
              status: 'completed',
              totalEstimatePence: 1720,
              finalTotalPence: 1695,
              createdAt: '2026-10-03T09:00:00.000Z',
              deliveredAt: '2026-10-03T11:00:00.000Z',
              items: [{ id: 'i1', name: 'Bananas, loose', quantity: 6 }],
            },
          ],
        });
      }
      if (path === '/orders/order-7/problems' && method === 'GET') return reply({ reports: [] });
      if (path === '/orders/order-7/problems' && method === 'POST') {
        return reply(
          {
            report: {
              id: 'p1',
              orderId: 'order-7',
              reportedBy: 'shopper',
              summary: (body as { summary: string }).summary,
              refundRequestedPence: 250,
              status: 'decided',
              decideBy: '2026-10-06T10:00:00.000Z',
              decision: 'no_fault',
              decisionWords: 'Nobody was at fault.',
              refundPence: 250,
              decisionNote: 'Refunded straight away.',
              decidedAt: '2026-10-04T10:00:00.000Z',
              evidence: [],
            },
            message:
              '£2.50 is on its way back to your card. Your bank may take a few days to show it.',
          },
          201,
        );
      }
      if (path === '/config') return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
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

describe('a Shopper reporting a problem', () => {
  it('lists past orders with what was in them and what was paid, each with Report a problem', async () => {
    renderAt('/orders');
    expect(
      await screen.findByRole('heading', { name: 'Saturday 3 October: Delivered' }),
    ).toBeInTheDocument();
    expect(screen.getByText('6 × Bananas, loose.')).toBeInTheDocument();
    expect(screen.getByText('You paid £16.95.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Report a problem with the order of Saturday 3 October' }),
    ).toHaveAttribute('href', '/orders/order-7/problem');
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('asks how much they want back, checks it, and says when it is refunded straight away', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/orders/order-7/problem');
    await user.type(await screen.findByLabelText('What went wrong?'), 'The bananas were bruised.');
    await user.type(screen.getByLabelText(/How much would you like back/), 'two pounds');
    await user.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please write the amount in pounds and pence, like 2.50.',
    );

    await user.clear(screen.getByLabelText(/How much would you like back/));
    await user.type(screen.getByLabelText(/How much would you like back/), '£2.50');
    await user.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(
      await screen.findByText(
        '£2.50 is on its way back to your card. Your bank may take a few days to show it.',
      ),
    ).toBeInTheDocument();
    expect(sent.find((r) => r.method === 'POST')?.body).toEqual({
      summary: 'The bananas were bruised.',
      refundRequestedPence: 250,
    });
  });
});
