/**
 * The shell itself: what is on each screen, and the accessibility promises that axe cannot
 * check on its own.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { storeConfig } from '../src/config';
import { FAKE_CARD, FAKE_SHOPPER, stubApi, stubCatalogueFetch } from './setup';

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

  it('has one microphone, Ozi’s own round button, and it says what it is in words', async () => {
    renderAt('/');
    const ozi = await screen.findByRole('button', { name: 'Can’t listen' });
    expect(ozi.closest('[data-ozi]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Say what you need' })).toBeNull();
  });

  it('says plainly when this browser cannot listen, rather than doing nothing', async () => {
    // jsdom has neither speech recognition nor speech synthesis, like a browser without them.
    const user = userEvent.setup();
    renderAt('/');

    await user.click(await screen.findByRole('button', { name: 'Can’t listen' }));

    // Shown and announced beside Ozi's round button.
    const shown = await screen.findAllByText(/I can't listen on this phone or browser yet/);
    const message = shown.find((element) => element.getAttribute('role') === 'status');
    expect(message).toBeDefined();
    // Nothing can be spoken here, so the words are announced instead.
    expect(message).toHaveAttribute('aria-live', 'polite');
  });

  it('asks who you are, with words under each choice, and no door for staff', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Shopper/ })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /^Runner.*taking it to their door/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /^Shop Partner.*show your products and prices/ }),
    ).toHaveAttribute('href', '/business');
    expect(screen.getByRole('link', { name: /^Organisation/ })).toHaveAttribute(
      'href',
      '/organisations',
    );
    expect(screen.getByRole('link', { name: /^I look after someone/ })).toHaveAttribute(
      'href',
      '/looking-after',
    );
    expect(screen.getByRole('link', { name: /^Just looking/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /admin|staff/i })).toBeNull();
  });

  it('links to the privacy page, the terms and the cookies page from every page', () => {
    renderAt('/shop');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Our terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/cookies');
  });

  /**
   * Ruling 54 (9 October 2026): the privacy page and the terms were reviewed against UK law and
   * are no longer marked as drafts. While a company detail is still a placeholder in
   * config/store.json, they say "to follow" rather than show a made-up number.
   */
  it('shows the privacy page without a draft mark, with what the law asks it to say', () => {
    renderAt('/privacy');
    expect(screen.queryByText(/This is a draft/)).toBeNull();
    expect(screen.getByText(/Calls are not recorded/)).toBeInTheDocument();
    expect(
      screen.getAllByText(new RegExp(storeConfig.store.legalEntityName)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'How long we keep it' })).toBeInTheDocument();
    expect(screen.getByText(/ico\.org\.uk or on 0303 123 1113/)).toBeInTheDocument();
    expect(screen.getByText(/your explicit\s+consent/)).toBeInTheDocument();
    if (storeConfig.store.companyNumberIsPlaceholder) {
      expect(screen.getByText('Company number: to follow.')).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(storeConfig.store.companyNumber))).toBeNull();
    }
  });

  it('puts the company name, number and registered office in the footer of every page', () => {
    renderAt('/shop');
    const footer = document.querySelector('footer');
    expect(footer?.textContent).toContain(storeConfig.store.legalEntityName);
    expect(footer?.textContent).toContain(`registered in ${storeConfig.store.registeredIn}`);
    expect(footer?.textContent).toMatch(/Registered office:/);
  });

  it('says how to cancel, and keeps consumer rights, in the terms', () => {
    renderAt('/terms');
    expect(screen.queryByText(/This is a draft/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Changing your mind' })).toBeInTheDocument();
    expect(
      screen.getByText(/We never limit our responsibility for death or injury/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Help and adjustments' })).toBeInTheDocument();
  });

  it('lists what is kept on the device, with no tracking cookies', () => {
    renderAt('/cookies');
    expect(
      screen.getByRole('heading', { level: 1, name: 'What we keep on your device' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no advertising cookies and no tracking cookies/)).toBeInTheDocument();
  });

  it('has a Runner agreement that matches how the Runner app works', () => {
    renderAt('/runner');
    expect(screen.getByRole('link', { name: 'Read the Runner agreement' })).toHaveAttribute(
      'href',
      '/runner/agreement',
    );
    renderAt('/runner/agreement');
    expect(screen.getByRole('heading', { level: 1, name: 'Runner agreement' })).toBeInTheDocument();
    expect(screen.getByText(/You can say no to any job, without a reason/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${storeConfig.problems.recoveryPercentOfPay}% of each later`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing is ever taken from your pay automatically/),
    ).toBeInTheDocument();
    // Paying at the till is decided (ruling 55): the Runner is paid back straight away.
    expect(
      screen.getByText(/we pay it back to you, straight to your own Stripe/),
    ).toBeInTheDocument();
    expect(screen.getByText(/never comes out of it/)).toBeInTheDocument();
    // Still a draft on purpose: employment status and a right of substitution need decisions.
    expect(screen.getByText(/This is a draft/)).toBeInTheDocument();
    // Ruling 61: a new version, so every Runner agrees again, with the new terms on the page.
    expect(screen.getByText(/Version of 10 October 2026/)).toBeInTheDocument();
    expect(screen.getByText(/by motorbike up to £70\.00/)).toBeInTheDocument();
    expect(screen.getByText(/parts of up to £75\.00 for motorbike riders first/)).toBeInTheDocument();
    expect(screen.getByText(/pays\s+£5\.00 for your part/)).toBeInTheDocument();
  });

  it('keeps the invitation code from a shared link for the sign-up form', () => {
    renderAt('/join?ref=rabcd234');
    expect(window.sessionStorage.getItem('ozidelivery.referral')).toBe('RABCD234');
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('shows the telephone number, and says it is a placeholder', () => {
    renderAt('/');
    expect(
      // In twos, the way Ozi reads it out.
      screen.getByRole('link', { name: '08 00 00 00 00 0' }),
    ).toHaveAttribute('href', `tel:${storeConfig.contact.telephonePlaceholder.replace(/\s/g, '')}`);
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

/**
 * Found in a real browser on 25 Sep 2026: focus was moved into main on the very first load,
 * so the first Tab landed past the skip link and the Shop and Basket buttons, and every page
 * was titled plain with the product name. Nothing here had checked either.
 */
describe('arriving at a page, and moving between pages', () => {
  it('leaves focus at the top on arrival, so the first Tab reaches the skip link', async () => {
    const user = userEvent.setup();
    renderAt('/shop');

    await user.tab();

    expect(screen.getByRole('link', { name: 'Skip to the main part of this page' })).toHaveFocus();
  });

  it('says the new page heading out loud and moves focus to main when the page changes', async () => {
    const user = userEvent.setup();
    renderAt('/shop');

    await user.click(screen.getByRole('link', { name: 'Basket' }));

    const announcement = await screen.findByText('Your basket', { selector: '[role=status]' });
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives every page its own title, taken from its heading', async () => {
    renderAt('/basket');
    await waitFor(() => {
      expect(document.title).toBe(`Your basket – ${storeConfig.productName}`);
    });
  });

  it('titles the landing page with the product name alone', async () => {
    renderAt('/');
    await waitFor(() => {
      expect(document.title).toBe(storeConfig.productName);
    });
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
    const feeRow = within(table).getByRole('rowheader', { name: 'Delivery' });
    expect(feeRow).toBeInTheDocument();

    // 125 + 89 = 214p of shopping: pay as you go, £15 or less, so the smaller delivery fee;
    // two item charges of 50p; and every price shown with its item charge in (ruling 58).
    const expectedFee = storeConfig.fees.delivery.payAsYouGoSmallOrderPence;
    expect(within(table).getByText(`£${(expectedFee / 100).toFixed(2)}`)).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Item charges' })).toBeInTheDocument();
    expect(within(table).getByText('£1.00')).toBeInTheDocument();
    expect(
      within(table).getByText(`£${((214 + 100 + expectedFee) / 100).toFixed(2)}`),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 × about £1\.75 = £1\.75/)).toBeInTheDocument();
  });

  it('says plainly when the basket is more than one Runner carries, and offers both choices (ruling 61)', async () => {
    await addTwoThings();
    const milk = screen.getByLabelText(/How many Semi skimmed milk/);
    // 121 pints at £1.25, plus the bread, is £152.14: over the £150 one order carries.
    fireEvent.change(milk, { target: { value: '121' } });

    expect(
      await screen.findByText(
        'Your shopping is over £150, which is more than one Runner can carry. You can take something out or swap it to stay with one Runner, or keep everything and a second Runner will bring the rest for an extra £13.50 delivery.',
      ),
    ).toBeInTheDocument();
    // Nothing hidden: each Runner and their delivery.
    expect(screen.getByText(/Runner 2: .*delivery £13\.50, taken only when this Runner collects it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Keep everything and check my order' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Check and send my order' })).not.toBeInTheDocument();
  });

  it('offers no way to send a basket over the most one basket holds (£450)', async () => {
    await addTwoThings();
    fireEvent.change(screen.getByLabelText(/How many Semi skimmed milk/), { target: { value: '361' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/one basket holds up to £450\.00/);
    expect(screen.queryByRole('link', { name: /Check and send my order|Keep everything/ })).not.toBeInTheDocument();
  });

  it('says the fee is the only one, and that there is no smallest order', async () => {
    await addTwoThings();
    expect(screen.getByText(/already includes its item charge/)).toBeInTheDocument();
    expect(screen.getByText(/no smallest order/)).toBeInTheDocument();
  });

  it('does not confirm anything by itself: the only way on is a link', async () => {
    await addTwoThings();
    expect(screen.getByRole('link', { name: 'Check and send my order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send my order/i })).not.toBeInTheDocument();
  });
});

describe('the confirmation screen', () => {
  /** The button only exists for somebody who has an account and a card, so: both. */
  function signedInWithACard() {
    return stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
  }

  async function confirmWithMilk(pints: number) {
    signedInWithACard();
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    fireEvent.change(screen.getByLabelText(/How many Semi skimmed milk/), {
      target: { value: String(pints) },
    });
    await user.click(await screen.findByRole('link', { name: 'Check and send my order' }));
  }

  it('says who carries a large order, and that it may come in parts (rulings 59 and 60)', async () => {
    // 49 pints at £1.25 is £61.25 at the shop's prices: over the £60 line.
    await confirmWithMilk(49);
    expect(
      screen.getByText(
        'Large orders go to a Runner with a motorbike, car or van. If none is free, it may come in parts, for the same price.',
      ),
    ).toBeInTheDocument();
  });

  it('over £150, sends only once the Shopper has chosen to keep everything (ruling 61)', async () => {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    const user = userEvent.setup();
    renderAt('/shop');
    await user.click(await screen.findByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    fireEvent.change(screen.getByLabelText(/How many Semi skimmed milk/), { target: { value: '121' } });
    await user.click(await screen.findByRole('link', { name: 'Keep everything and check my order' }));
    const yes = screen.queryByRole('button', { name: 'Yes, this is the right address' });
    if (yes) await user.click(yes);
    const send = screen.getByRole('button', { name: 'Send my order and pay' });
    expect(send).toBeDisabled();
    const keep = screen.getByLabelText('Keep everything, as 2 orders each with its own Runner');
    expect(keep).not.toBeChecked();
    await user.click(keep);
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await waitFor(() => expect(recorded.some((call) => call.method === 'POST' && call.path === '/orders')).toBe(true));
    const body = recorded.find((call) => call.method === 'POST' && call.path === '/orders')!.body as {
      keepEverything: boolean;
      confirmation: { statement: string };
    };
    expect(body.keepEverything).toBe(true);
    expect(body.confirmation.statement).toMatch(/as 2 orders each with its own Runner.*taken only when each collects/);
  });

  it('says nothing about cars for an order of £60 or less', async () => {
    await confirmWithMilk(48);
    expect(screen.getByRole('heading', { name: 'What it will cost' })).toBeInTheDocument();
    expect(screen.queryByText(/Large orders go to a Runner/)).not.toBeInTheDocument();
  });

  it('has exactly one button that could ever take a payment', async () => {
    signedInWithACard();
    const user = userEvent.setup();
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    const buttons = screen.getAllByRole('button');
    const confirming = buttons.filter((button) => /send my order/i.test(button.textContent ?? ''));

    expect(confirming).toHaveLength(1);
    expect(confirming[0]).toHaveTextContent('Send my order and pay');
  });

  it('says what will happen before the button, not after it', async () => {
    signedInWithACard();
    const user = userEvent.setup();
    renderAt('/shop');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    expect(screen.getByText(/the only thing that will ever take a payment/i)).toBeInTheDocument();
    // The shopping with its item charges in, then the parts, then delivery (ruling 58).
    expect(
      screen.getByText(
        /Your shopping, about £1\.75, with the item charges included: £1\.25 at the shop/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Delivery, £7\.99\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Altogether, about £9\.74\./)).toBeInTheDocument();
  });
});

describe('the accessibility promises axe cannot see', () => {
  const PATHS = [
    '/',
    '/sign-up',
    '/sign-in',
    '/card',
    '/shop',
    '/basket',
    '/confirm',
    '/my-order',
    '/runner',
    '/runner/sign-up',
    '/runner/home',
    '/just-looking',
    '/settings',
    '/addresses',
    '/organisations',
    '/looking-after',
    '/privacy',
    '/terms',
    '/cookies',
    '/runner/agreement',
  ];

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
    expect(screen.getByLabelText('What should your Runner do at the door?')).toBeInTheDocument();
  });

  it('lists form problems in words at the top, not by colour', async () => {
    const user = userEvent.setup();
    renderAt('/sign-up');

    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('There are 3 problems to fix');
    expect(
      within(alert).getByRole('link', { name: 'Please tell us your name.' }),
    ).toBeInTheDocument();
  });
});

describe('Rule Nine, on the screen', () => {
  /**
   * The product's own name contains the store's name, so a plain search for the store name
   * would match the product name and prove nothing. This looks for the store name followed by
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
    return Array.from(document.querySelectorAll('p, li, td')).map((node) => node.textContent ?? '');
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
    await user.click(await screen.findByRole('button', { name: 'Can’t listen' }));
    expect(readableText().some((line) => line.includes(storeConfig.assistantName))).toBe(true);
  });

  it('shows the Runner five pounds, taken from the rule constant and not typed in', () => {
    renderAt('/runner');
    const runnerPay =
      storeConfig.store.currencySymbol + (storeConfig.fees.runnerPaymentPence / 100).toFixed(2);
    expect(readableText().some((line) => line.includes(runnerPay))).toBe(true);
  });
});
