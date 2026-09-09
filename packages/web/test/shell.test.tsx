/**
 * The shell itself: what is on each screen, and the accessibility promises that axe cannot
 * check on its own.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { stubCatalogueFetch } from './setup';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stubCatalogueFetch();
});

describe('the landing page', () => {
  it('says the line', () => {
    renderAt('/');
    expect(screen.getByText('Say it, Ozi shops it, a Runner brings it')).toBeInTheDocument();
  });

  it('has one microphone button, and it says what it is in words', () => {
    renderAt('/');
    const microphone = screen.getByRole('button', { name: 'Say what you need' });
    expect(microphone).toBeInTheDocument();
  });

  it('tells you plainly that talking is not ready yet, rather than doing nothing', async () => {
    const user = userEvent.setup();
    renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Say what you need' }));

    const message = await screen.findByText(
      new RegExp(`Talking to ${storeConfig.assistantName} is not ready yet`),
    );
    expect(message).toHaveAttribute('role', 'status');
    expect(message).toHaveAttribute('aria-live', 'polite');
  });

  it('has three doors: Shopper, Runner and just looking', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /^Shopper/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Runner/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Just looking/ })).toBeInTheDocument();
  });

  it('shows the telephone number, and says it is a placeholder', () => {
    renderAt('/');
    expect(
      screen.getByRole('link', { name: storeConfig.contact.telephonePlaceholder }),
    ).toBeInTheDocument();
    expect(screen.getByText(/placeholder while we get the line set up/i)).toBeInTheDocument();
  });

  it('has exactly one first level heading', () => {
    renderAt('/');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('offers a way past the navigation as the very first thing', () => {
    renderAt('/');
    const skip = screen.getByRole('link', { name: 'Skip to the main part of this page' });
    expect(skip).toHaveAttribute('href', '#main');
  });
});

describe('the basket', () => {
  async function addTwoThings() {
    const user = userEvent.setup();
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('button', { name: /Add White sliced bread/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    return user;
  }

  it('shows the fee before there is any way to confirm', async () => {
    await addTwoThings();

    const table = screen.getByRole('table');
    const feeRow = within(table).getByRole('rowheader', { name: 'Our fee' });
    expect(feeRow).toBeInTheDocument();

    // 125 + 89 = 214p of shopping, which falls in the first band.
    const expectedFee = storeConfig.fees.bands[0]!.feePence;
    expect(within(table).getByText(`£${(expectedFee / 100).toFixed(2)}`)).toBeInTheDocument();
  });

  it('says the fee is the only one, and that there is no smallest order', async () => {
    await addTwoThings();
    expect(screen.getByText(/is the only fee/)).toBeInTheDocument();
    expect(screen.getByText(/no smallest order/)).toBeInTheDocument();
  });

  it('does not confirm anything by itself: the only way on is a link', async () => {
    await addTwoThings();
    expect(
      screen.getByRole('link', { name: 'Check and send my order' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send my order/i })).not.toBeInTheDocument();
  });
});

describe('the confirmation screen', () => {
  it('has exactly one button that could ever take a payment', async () => {
    const user = userEvent.setup();
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    const buttons = screen.getAllByRole('button');
    const confirming = buttons.filter((button) =>
      /send my order/i.test(button.textContent ?? ''),
    );

    expect(confirming).toHaveLength(1);
    expect(confirming[0]).toHaveTextContent('Send my order');
  });

  it('says what will happen before the button, not after it', async () => {
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    expect(
      screen.getByText(/the only thing that will ever take a payment/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Our fee, £8\.00\. That is the only fee\./)).toBeInTheDocument();
  });
});

describe('the accessibility promises axe cannot see', () => {
  const PATHS = ['/', '/sign-up', '/shop', '/basket', '/confirm', '/runner', '/just-looking'];

  it('gives every control a name that a person could read out, on every screen', async () => {
    for (const path of PATHS) {
      const view = renderAt(path);
      await waitFor(() => {
        expect(document.querySelector('main')).not.toBeNull();
      });

      for (const control of screen.queryAllByRole('button')) {
        expect(control.textContent?.trim(), `a button on ${path} had no words in it`).toBeTruthy();
        // Where there is an aria-label it must match the visible text word for word, so a
        // voice control user says what they can see.
        const label = control.getAttribute('aria-label');
        if (label) {
          expect(label).toBe(control.textContent?.trim());
        }
      }

      for (const link of screen.queryAllByRole('link')) {
        expect(link.textContent?.trim(), `a link on ${path} had no words in it`).toBeTruthy();
        const label = link.getAttribute('aria-label');
        if (label) {
          expect(label).toBe(link.textContent?.trim());
        }
      }

      view.unmount();
    }
  });

  it('gives every control the class that sets the minimum forty eight pixel size', async () => {
    for (const path of PATHS) {
      const view = renderAt(path);
      await waitFor(() => {
        expect(document.querySelector('main')).not.toBeNull();
      });

      const controls = [
        ...screen.queryAllByRole('button'),
        ...screen.queryAllByRole('link'),
        ...screen.queryAllByRole('textbox'),
        ...screen.queryAllByRole('searchbox'),
        ...screen.queryAllByRole('spinbutton'),
      ];

      for (const control of controls) {
        if (control.classList.contains('skip-link')) continue;
        const classes = control.className;
        expect(
          /\bcontrol\b|min-h-control|\bh-\d/.test(classes),
          `a control on ${path} was missing its minimum size: ${control.outerHTML.slice(0, 120)}`,
        ).toBe(true);
      }

      view.unmount();
    }
  });

  it('names every field with a real label, on the sign up form', () => {
    renderAt('/sign-up');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Your phone number')).toBeInTheDocument();
    expect(
      screen.getByLabelText('What should your Runner do at the door?'),
    ).toBeInTheDocument();
  });

  it('lists form problems in words at the top, not by colour', async () => {
    const user = userEvent.setup();
    renderAt('/sign-up');

    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('There are 2 problems to fix');
    expect(within(alert).getByRole('link', { name: 'Please tell us your name.' })).toBeInTheDocument();
  });
});

describe('Rule Nine, on the screen', () => {
  /**
   * The product's own name contains the store's name, so a plain search for the store name
   * would match "Aldilivery" and prove nothing. This looks for the store name followed by
   * something that is not a letter, which is a word boundary without needing an escape.
   */
  function mentionsStoreName(text: string): boolean {
    const name = storeConfig.store.displayName;
    const index = text.indexOf(name);
    if (index < 0) return false;
    const nextCharacter = text.charAt(index + name.length);
    return nextCharacter === '' || !/[a-z]/i.test(nextCharacter);
  }

  function readableText(): string[] {
    return Array.from(document.querySelectorAll('p, li, td')).map(
      (node) => node.textContent ?? '',
    );
  }

  it('takes the store name and the product name from configuration', () => {
    renderAt('/just-looking');
    const text = readableText();
    expect(text.some(mentionsStoreName)).toBe(true);
    expect(text.some((line) => line.includes(storeConfig.productName))).toBe(true);
  });

  it('names the assistant from configuration, never from a string in a component', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Say what you need' }));
    expect(
      readableText().some((line) => line.includes(storeConfig.assistantName)),
    ).toBe(true);
  });

  it('shows the Runner five pounds, taken from the rule constant and not typed in', () => {
    renderAt('/runner');
    const runnerPay =
      storeConfig.store.currencySymbol +
      (storeConfig.fees.runnerPaymentPence / 100).toFixed(2);
    expect(readableText().some((line) => line.includes(runnerPay))).toBe(true);
  });
});
