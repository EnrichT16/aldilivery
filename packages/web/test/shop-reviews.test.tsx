/**
 * Rate the shop and review points (ruling 70): on Past orders, the shops from recent deliveries
 * wait to be rated with words on every star, the points balance is said in words, and a rating
 * is sent with the stars and the few words given. "Four stars" said aloud is understood too.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { heardStars } from '../src/components/ShopReviews';
import { FAKE_SHOPPER } from './setup';

let sent: Array<{ method: string; path: string; body: unknown }>;
let pending: Array<{ orderId: string; deliveredAt: string; shop: { id: string; name: string } }>;

beforeEach(() => {
  sent = [];
  pending = [
    {
      orderId: 'order-7',
      deliveredAt: '2026-10-15T11:00:00.000Z',
      shop: { id: 'shop-1', name: 'Corner Bakery' },
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
      if (path.startsWith('/config')) return reply({ push: { publicKey: null } });
      if (path === '/orders/current') return reply({ order: null });
      if (path === '/me/enquiries') return reply({ enquiries: [] });
      if (path === '/orders' && method === 'GET') {
        return reply({
          orders: [
            {
              id: 'order-7',
              status: 'completed',
              totalEstimatePence: 1720,
              finalTotalPence: 1695,
              createdAt: '2026-10-15T09:00:00.000Z',
              deliveredAt: '2026-10-15T11:00:00.000Z',
              items: [{ id: 'i1', name: 'Sourdough loaf (Corner Bakery)', quantity: 1 }],
            },
          ],
        });
      }
      if (path === '/me/reviews/pending') {
        return reply({
          pending,
          balance: {
            points: 40,
            pendingPoints: 0,
            worthPence: 40,
            pointsToSpend: 60,
            reviews: 4,
            words: 'You have 40 points, worth 40p.',
          },
          rules: { pointsPerReview: 10, pencePerPoint: 1, spendFromPoints: 100, pendingDays: 7 },
        });
      }
      if (path === '/orders/order-7/shop-review' && method === 'POST') {
        pending = [];
        return reply(
          {
            points: 10,
            pendingDays: 7,
            balance: {
              points: 40,
              pendingPoints: 10,
              worthPence: 40,
              pointsToSpend: 60,
              reviews: 5,
              words: 'You have 40 points, worth 40p. 10 more are on their way.',
            },
            message:
              'Thank you for rating Corner Bakery. 10 points are on their way to you and will be yours in 7 days. You have 40 points, worth 40p. 10 more are on their way.',
          },
          201,
        );
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderOrders(): void {
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <App />
    </MemoryRouter>,
  );
}

describe('rating a shop on Past orders', () => {
  it('shows the points in words and sends the stars pressed, with the few words given', async () => {
    const user = userEvent.setup({ delay: null });
    renderOrders();
    expect(await screen.findByRole('heading', { name: 'Rate your shops' })).toBeInTheDocument();
    expect(
      screen.getByText(/You have 40 points, worth 40p\. From 100 points, £1\.00 comes off/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Corner Bakery/ })).toBeInTheDocument();

    // Every star carries its words, and nothing can be sent before a star is chosen.
    const send = screen.getByRole('button', { name: 'Send my rating of Corner Bakery' });
    expect(send).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '4 stars' }));
    expect(screen.getByRole('button', { name: '4 stars' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('A few words, if you like'), 'Lovely bread.');
    await user.click(send);

    await waitFor(() => {
      expect(
        sent.find((r) => r.method === 'POST' && r.path === '/orders/order-7/shop-review')?.body,
      ).toEqual({ shop: 'shop-1', stars: 4, message: 'Lovely bread.' });
    });
    expect(await screen.findByText(/Thank you for rating Corner Bakery\. 10 points/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Send my rating of Corner Bakery' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/10 more are on their way/)).toHaveLength(2);
  });

  it('understands the stars said aloud', () => {
    expect(heardStars('four stars')).toBe(4);
    expect(heardStars('I would give them 5 stars')).toBe(5);
    expect(heardStars('one star')).toBe(1);
    expect(heardStars('three out of five')).toBe(3);
    expect(heardStars('order milk')).toBeNull();
    expect(heardStars('seven stars')).toBeNull();
  });
});
