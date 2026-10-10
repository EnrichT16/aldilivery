/**
 * Anthony's new pricing on the screen (ruling 58, 9 October 2026): every price shown with its
 * item charge in, the delivery price that follows the Shopper's plan, and no single product
 * over £60.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { deliveryWords, sellable, shownPrice } from '../src/lib/money';
import { FAKE_CATALOGUE, FAKE_SHOPPER, stubApi } from './setup';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const originalItems = [...FAKE_CATALOGUE.items];
afterEach(() => {
  FAKE_CATALOGUE.items.splice(0, FAKE_CATALOGUE.items.length, ...originalItems);
});

describe('the price helpers', () => {
  it('show every price with its item charge in', () => {
    expect(shownPrice(140)).toBe(190);
    expect(shownPrice(599)).toBe(649);
    expect(shownPrice(600)).toBe(700);
    expect(shownPrice(1850)).toBe(2050);
  });

  it('sell nothing over £60', () => {
    expect(sellable(6000)).toBe(true);
    expect(sellable(6001)).toBe(false);
  });

  it('say how delivery is priced on each plan', () => {
    expect(deliveryWords('payg')).toBe(
      'Paying as you go, delivery is £7.99 for shopping of £15.00 or less, and £13.50 above that.',
    );
    expect(deliveryWords('membership')).toMatch(/£7\.99 with membership/);
    expect(deliveryWords('plus')).toMatch(/£5\.99 on your plan/);
  });
});

describe('the shop and the basket', () => {
  it('shows catalogue prices with the item charge in, and refuses a product over £60 plainly', async () => {
    FAKE_CATALOGUE.items.push({
      id: 'item-telly',
      name: 'A large television',
      category: 'Electricals',
      estimatedPricePence: 6100,
    });
    stubApi();
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByText(/Dairy · about £1\.75/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add A large television/ }));
    expect(
      screen.getByText(
        "We can't bring A large television: no single product can cost more than £60.00.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Basket' })).not.toHaveTextContent(/1/);
  });

  it('charges a Plus member £5.99 delivery, whatever the size', async () => {
    stubApi({ shopper: { ...FAKE_SHOPPER, deliveryPlan: 'plus' } });
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('£5.99')).toBeInTheDocument();
    expect(within(table).getByText(`£${((125 + 50 + 599) / 100).toFixed(2)}`)).toBeInTheDocument();
    expect(screen.getByText(/Delivery is £5\.99 on your plan/)).toBeInTheDocument();
  });
});
