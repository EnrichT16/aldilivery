/**
 * Anthony's new pricing on the screen (ruling 58, 9 October 2026, re-banded by ruling 63 on
 * 16 October 2026): every price shown with its item charge in, the delivery price that follows
 * the Shopper's plan and the value of the shop, and no single product over £60.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import {
  deliveryRangeWords,
  deliveryWords,
  planDeliveryWords,
  sellable,
  shownPrice,
} from '../src/lib/money';
import { planDetails } from '../src/pages/Plus';
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

  it('say how delivery is priced on each plan, by the value of the shop (ruling 63)', () => {
    expect(planDeliveryWords('payg')).toBe(
      '£10.99 for shopping up to £30.00, £12.99 up to £60.00, and £14.99 over £60.00',
    );
    expect(planDeliveryWords('membership')).toBe(
      '£7.99 for shopping up to £60.00, and £9.99 over £60.00',
    );
    expect(planDeliveryWords('plus')).toBe(
      '£6.99 for shopping up to £60.00, and £8.99 over £60.00',
    );
    expect(deliveryWords('payg')).toBe(
      'Paying as you go, delivery is £10.99 for shopping up to £30.00, £12.99 up to £60.00, and £14.99 over £60.00.',
    );
    expect(deliveryWords('membership')).toBe(
      'Delivery is £7.99 for shopping up to £60.00, and £9.99 over £60.00 with membership.',
    );
    expect(deliveryWords('plus')).toBe(
      'Delivery is £6.99 for shopping up to £60.00, and £8.99 over £60.00 on your plan.',
    );
    expect(deliveryRangeWords()).toBe('£6.99 to £14.99');
  });

  it('list every plan with its delivery bands on the plans page', () => {
    const plans = planDetails();
    expect(plans.map((plan) => [plan.plan, plan.pence])).toEqual([
      ['membership', 1000],
      ['plus', 1500],
      ['family', 2000],
    ]);
    expect(plans[0]!.includes[0]).toBe(
      'Delivery £7.99 for shopping up to £60.00, and £9.99 over £60.00.',
    );
    expect(plans[1]!.includes[1]).toBe(
      'Delivery £6.99 for shopping up to £60.00, and £8.99 over £60.00.',
    );
    // The monthly order allowance and the extra past it (ruling 73), and the free Finds It.
    expect(plans[0]!.includes).toContain(
      '5 orders a month included. After that, the next order has an extra £5.99 delivery charge, and so does every 3rd order after it. You are always told before you say yes.',
    );
    expect(plans[1]!.includes).toContain(
      '8 orders a month included. After that, the next order has an extra £5.99 delivery charge, and so does every 3rd order after it. You are always told before you say yes.',
    );
    expect(plans[2]!.includes.join(' ')).toContain('5 orders a month for each person included.');
    expect(plans[0]!.includes.join(' ')).toContain('One free “Ozi Finds It” each month');
    expect(plans[1]!.includes.join(' ')).toContain('Two free “Ozi Finds It” searches each month');
  });
});

describe('the shop and the basket', () => {
  it('shows a Member’s 6th order this month its extra delivery charge, as its own line, before the yes (ruling 73)', async () => {
    stubApi({
      shopper: {
        ...FAKE_SHOPPER,
        deliveryPlan: 'membership',
        allowancePlan: 'membership',
        ordersThisMonth: 5,
      },
    });
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Extra delivery charge')).toBeInTheDocument();
    expect(within(table).getByText('£5.99')).toBeInTheDocument();
    expect(
      within(table).getByText(`£${((125 + 50 + 799 + 599) / 100).toFixed(2)}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This is your 6th order this month. Your plan includes 5, so this one has an extra £5.99 delivery charge.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no extra line on pay as you go', async () => {
    stubApi({ shopper: { ...FAKE_SHOPPER, ordersThisMonth: 30 } });
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    expect(within(screen.getByRole('table')).queryByText('Extra delivery charge')).toBeNull();
  });

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

  it('charges a Plus member £6.99 delivery on an everyday shop', async () => {
    stubApi({ shopper: { ...FAKE_SHOPPER, deliveryPlan: 'plus' } });
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('£6.99')).toBeInTheDocument();
    expect(within(table).getByText(`£${((125 + 50 + 699) / 100).toFixed(2)}`)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Delivery is £6\.99 for shopping up to £60\.00, and £8\.99 over £60\.00 on your plan/,
      ),
    ).toBeInTheDocument();
  });
});
