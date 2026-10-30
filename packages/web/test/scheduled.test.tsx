/**
 * Ordering now for a later day (ruling 78), on the screen: choosing the day, the time of day and
 * when the money is taken, the words agreed to before the one button, and the booked orders on
 * Past orders, changed or cancelled.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { bookableDays, dayWords } from '@aldilivery/core';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { FAKE_CARD, FAKE_SHOPPER, stubApi, type RecordedRequest } from './setup';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

/** The usual stub, with the booked order routes answered too. */
function stubWithBooked(extra: (method: string, path: string, body: unknown) => Response | null) {
  const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
  const base = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const answered = extra(method, path, body);
      if (answered) {
        recorded.push({ method, path, body } as RecordedRequest);
        return answered;
      }
      return base(url, init);
    }),
  );
  return recorded;
}

describe('choosing a later day at checkout', () => {
  it('sends the day, the window and the payday, with the words agreed to', async () => {
    const recorded = stubWithBooked((method, path) =>
      // A day in next month is priced again for that month (its own allowance), so the test
      // passes whatever today's date is.
      method === 'POST' && path === '/basket/price'
        ? reply({ totalPence: 1739, allowanceExtraPence: 0 })
        : method === 'POST' && path === '/orders'
          ? reply(
              {
                order: { id: 'order-1', status: 'confirmed', totalEstimatePence: 0, feePence: 0 },
                scheduled: true,
                message: 'Thank you. Your order is booked.',
              },
              201,
            )
          : null,
    );
    const user = userEvent.setup({ delay: null });
    renderAt('/shop');
    await user.click(await screen.findByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));
    await waitFor(() => {
      expect(recorded.some((r) => r.path === '/payment-methods')).toBe(true);
    });
    const yes = screen.queryByRole('button', { name: 'Yes, this is the right address' });
    if (yes) await user.click(yes);

    // As soon as possible is the only thing chosen for the Shopper.
    expect(screen.getByLabelText('As soon as possible, today')).toBeChecked();
    await user.click(screen.getByLabelText('On another day'));
    const day = bookableDays(new Date(), storeConfig.scheduled)[2]!;
    await user.selectOptions(screen.getByLabelText('The day'), day);
    await user.click(screen.getByLabelText(/^Evening, 17:00 to 21:00/));
    await user.click(screen.getByLabelText('From my card, on a day and time I choose'));
    const chargeDay = within(screen.getByLabelText('The day the money is taken'))
      .getAllByRole('option')
      .at(-1)!
      .getAttribute('value')!;
    await user.selectOptions(screen.getByLabelText('The day the money is taken'), chargeDay);
    expect(screen.getByLabelText('The time it is taken')).toHaveValue('00:05');

    // The agreement, said plainly before the one button.
    const words = `Delivered on ${dayWords(day)}, in the evening, 17:00 to 21:00. The money is taken from your card on ${dayWords(chargeDay)} at 00:05.`;
    expect(
      screen.getAllByText(new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /if prices have gone up, the difference is taken from your card on the day/,
      ).length,
    ).toBeGreaterThan(0);
    // Still exactly one control that pays (Rule One).
    expect(screen.getAllByRole('button', { name: 'Send my order and pay' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Send my order and pay' }));
    expect(
      await screen.findByRole('heading', { name: 'Your order is booked' }),
    ).toBeInTheDocument();
    const order = recorded.find((r) => r.method === 'POST' && r.path === '/orders');
    expect(order?.body).toMatchObject({
      paymentMethodId: FAKE_CARD.id,
      schedule: {
        deliveryDay: day,
        window: 'evening',
        pay: 'scheduled',
        chargeDay,
        chargeTime: '00:05',
      },
      confirmation: { statement: expect.stringContaining(words) },
    });
  });
});

describe('booked orders on Past orders', () => {
  const booked = {
    id: 'order-b',
    reference: 'OZ-ORDERB',
    status: 'confirmed',
    deliveryDay: bookableDays(new Date(), storeConfig.scheduled)[3]!,
    deliveryWindow: 'morning',
    deliveryWords: 'Saturday 31 October, in the morning, 8:00 to 12:00',
    chargePlan: 'scheduled',
    chargeAt: new Date(Date.now() + 86_400_000).toISOString(),
    chargeWords: 'on Sunday 1 November at 00:05',
    chargeStatus: 'waiting',
    paid: false,
    held: false,
    bankReference: null,
    totalPence: 1449,
    items: [{ name: 'Semi skimmed milk, 2 pints', quantity: 2 }],
    canChange: true,
    canChangePayment: true,
    canCancel: true,
  };

  it('lists one, changes its day, and cancels it after asking once more', async () => {
    let cancelled = false;
    const recorded = stubWithBooked((method, path, body) => {
      if (path === '/orders/booked') {
        return reply({ orders: cancelled ? [] : [booked] });
      }
      if (method === 'POST' && path === '/orders/order-b/booking') {
        return reply({ order: { ...booked, ...(body as object) }, message: 'Changed.' });
      }
      if (method === 'POST' && path === '/orders/order-b/booking/cancel') {
        cancelled = true;
        return reply({
          order: booked,
          refundedPence: 0,
          message: 'Your booked order is cancelled. Nothing was taken.',
        });
      }
      return null;
    });
    const user = userEvent.setup({ delay: null });
    renderAt('/orders');
    expect(await screen.findByRole('heading', { name: 'Booked for later' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: booked.deliveryWords })).toBeInTheDocument();
    expect(
      screen.getByText(/The money is taken on Sunday 1 November at 00:05\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Change/ }));
    const newDay = bookableDays(new Date(), storeConfig.scheduled)[5]!;
    await user.selectOptions(screen.getByLabelText('The day'), newDay);
    await user.click(screen.getByLabelText('Afternoon'));
    await user.click(screen.getByRole('button', { name: 'Save the change' }));
    await waitFor(() => {
      expect(recorded.find((r) => r.path === '/orders/order-b/booking')?.body).toMatchObject({
        deliveryDay: newDay,
        window: 'afternoon',
      });
    });

    await user.click(await screen.findByRole('button', { name: /^Cancel/ }));
    expect(screen.getByText('Cancel this order? Nothing has been taken.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    expect(
      await screen.findByText('Your booked order is cancelled. Nothing was taken.'),
    ).toBeInTheDocument();
    expect(recorded.some((r) => r.path === '/orders/order-b/booking/cancel')).toBe(true);
  });
});
