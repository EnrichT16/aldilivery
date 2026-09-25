/**
 * The web shell talking to the real API.
 *
 * These tests are about what goes on the wire, because that is where the rules either hold
 * or do not. A screen that looks right and sends the wrong body is worse than one that looks
 * wrong, so the assertions here are mostly on the recorded requests rather than on the text.
 */

import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

// Stripe.js is fetched from Stripe and cannot load in jsdom, so the module that loads it is
// replaced. Every test that does not touch the card form still gets the real behaviour,
// because the mock's default is whatever `prepareCardEntry` is told to return.
vi.mock('../src/lib/stripe', async () => {
  const real = await vi.importActual<typeof import('../src/lib/stripe')>('../src/lib/stripe');
  return { ...real, prepareCardEntry: vi.fn(real.prepareCardEntry) };
});

import { FAKE_CARD, FAKE_SHOPPER, stubApi, type RecordedRequest } from './setup';

// Every `userEvent.setup` below passes `delay: null`, which turns off the simulated wait
// between keystrokes. These tests type addresses and phone numbers, and the default delay is
// realistic and slow: on a build container that slowness is the difference between a test
// that passes and one that runs out of time. Nothing here is testing how fast anybody types.

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

function sent(recorded: RecordedRequest[], method: string, path: string) {
  return recorded.find((call) => call.method === method && call.path === path);
}

describe('setting up an account', () => {
  it('sends what was typed, and nothing that was not asked for', async () => {
    const recorded = stubApi();
    const user = userEvent.setup({ delay: null });
    renderAt('/sign-up');

    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your phone number'), '07700 900000');
    await user.type(
      screen.getByLabelText('Where should we bring your shopping?'),
      '12 Made Up Street, Leeds, LS1 1AA',
    );
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    await waitFor(() => {
      expect(sent(recorded, 'POST', '/shoppers')).toBeDefined();
    });

    const body = sent(recorded, 'POST', '/shoppers')?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      displayName: 'Ada',
      phone: '07700 900000',
      deliveryAddress: '12 Made Up Street, Leeds, LS1 1AA',
      substitutionDefault: 'ask_me',
    });
    // No password, because there is no password. If one ever appears in this body,
    // something has gone badly wrong with the design.
    expect(Object.keys(body)).not.toContain('password');
  });

  it('keeps the session, so the next screen knows who you are', async () => {
    stubApi();
    const user = userEvent.setup({ delay: null });
    renderAt('/sign-up');

    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your phone number'), '07700 900000');
    await user.type(screen.getByLabelText('Where should we bring your shopping?'), '12 Made Up St');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    await waitFor(() => {
      expect(window.localStorage.getItem('aldilivery.session.token')).toBe('new-token');
    });
  });

  it('shows a refusal from the server in the same list as its own checks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 409,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () =>
            Promise.resolve({
              error: { message: 'There is already an account on that phone number.' },
            }),
        } as unknown as Response),
      ),
    );

    const user = userEvent.setup({ delay: null });
    renderAt('/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Your phone number'), '07700 900000');
    await user.type(screen.getByLabelText('Where should we bring your shopping?'), '12 Made Up St');
    await user.click(screen.getByRole('button', { name: 'Create my account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('There is already an account on that phone number.');
  });
});

describe('sending an order', () => {
  async function reachTheButton(recorded: RecordedRequest[]) {
    const user = userEvent.setup({ delay: null });
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    await waitFor(() => {
      expect(sent(recorded, 'GET', '/payment-methods')).toBeDefined();
    });
    return user;
  }

  it('sends the confirmation, in the exact words the Shopper was shown', async () => {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    const user = await reachTheButton(recorded);

    // The sentence on the screen, next to the button. The paragraph also carries a
    // visually-hidden "You are agreeing to this: " for screen readers, which is a lead-in
    // rather than part of the agreement, so it is taken off before comparing.
    const paragraph = screen.getByText(/Send my order\. About £/);
    const leadIn = paragraph.querySelector('.visually-hidden')?.textContent ?? '';
    const shown = (paragraph.textContent ?? '').slice(leadIn.length);

    await user.click(screen.getByRole('button', { name: 'Send my order' }));

    await waitFor(() => {
      expect(sent(recorded, 'POST', '/orders')).toBeDefined();
    });

    const body = sent(recorded, 'POST', '/orders')?.body as {
      confirmation: { confirmed: boolean; statement: string; agreedTotalPence: number };
      deliveryAddress: string;
      paymentMethodId: string;
    };

    expect(body.confirmation.confirmed).toBe(true);
    // Rule One: what is recorded against the charge is what was on the screen, not a
    // summary of it written somewhere else.
    expect(body.confirmation.statement).toBe(shown);
    expect(body.confirmation.agreedTotalPence).toBeGreaterThan(0);
    expect(body.deliveryAddress).toBe(FAKE_SHOPPER.deliveryAddress);
    expect(body.paymentMethodId).toBe(FAKE_CARD.id);
  });

  it('says the order is sent, and gives the order number', async () => {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    const user = await reachTheButton(recorded);
    await user.click(screen.getByRole('button', { name: 'Send my order' }));

    expect(await screen.findByText('Your order is sent')).toBeInTheDocument();
    expect(screen.getByText(/order-1/)).toBeInTheDocument();
  });

  it('shows a price that moved, and does not claim anything was sent', async () => {
    const recorded = stubApi({
      shopper: FAKE_SHOPPER,
      paymentMethods: [FAKE_CARD],
      orderError:
        'The price changed while you were deciding. It is now £10.50. Nothing has been charged. Please check it and confirm again.',
    });
    const user = await reachTheButton(recorded);
    await user.click(screen.getByRole('button', { name: 'Send my order' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The price changed while you were deciding');
    expect(alert).toHaveTextContent('Nothing has been charged');
    expect(screen.queryByText('Your order is sent')).not.toBeInTheDocument();
  });

  it('will not send without a card, and says why', async () => {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [] });
    await reachTheButton(recorded);

    expect(screen.getByRole('button', { name: 'Send my order' })).toBeDisabled();
    expect(screen.getByText(/have not saved a card yet/)).toBeInTheDocument();
    expect(sent(recorded, 'POST', '/orders')).toBeUndefined();
  });

  it('asks somebody with no account to set one up, rather than failing at the button', async () => {
    const recorded = stubApi({ paymentMethods: [] });
    const user = userEvent.setup({ delay: null });
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'We need to know who you are' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send my order' })).not.toBeInTheDocument();
    expect(sent(recorded, 'POST', '/orders')).toBeUndefined();
  });
});

describe('Rule Ten, on the wire', () => {
  it('never sends anything that could be a card number to our own server', async () => {
    const recorded = stubApi({ shopper: FAKE_SHOPPER, paymentMethods: [FAKE_CARD] });
    const user = userEvent.setup({ delay: null });
    renderAt('/shop');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Semi skimmed milk/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add Semi skimmed milk/ }));
    await user.click(screen.getByRole('link', { name: 'Basket' }));
    await user.click(screen.getByRole('link', { name: 'Check and send my order' }));
    await waitFor(() => {
      expect(sent(recorded, 'GET', '/payment-methods')).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: 'Send my order' }));

    await waitFor(() => {
      expect(sent(recorded, 'POST', '/orders')).toBeDefined();
    });

    // Not one request in the whole journey may carry a run of digits long enough to be a
    // card number. The card fields live in Stripe's iframe, so there is nothing to send —
    // this test is here to notice if that ever stops being true.
    const everything = JSON.stringify(recorded);
    expect(everything).not.toMatch(/\d{13,}/);
  });
});

describe('the card screen', () => {
  // Each test sets up its own stub, once, before anything renders. A `beforeEach` stub that a
  // test then replaced meant two different fetch mocks were live during one test, and which
  // one answered depended on how fast the machine was.
  it('says plainly when card payments are not switched on, instead of a dead form', async () => {
    stubApi({ shopper: FAKE_SHOPPER, paymentsMode: 'rehearsal' });
    renderAt('/card');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not switched on/);
    // And offers a way onwards rather than stranding them.
    expect(screen.getByRole('link', { name: 'Carry on without a card' })).toBeInTheDocument();
  });

  it('sends nobody to a card form before they have an account', async () => {
    stubApi({ paymentsMode: 'rehearsal' });
    renderAt('/card');
    expect(await screen.findByText('Set up your account first')).toBeInTheDocument();
  });
});

/**
 * The card form itself, judged.
 *
 * Until now the card screen was only ever rendered with nobody signed in, so every
 * accessibility check saw "Set up your account first" and none of them ever saw the form.
 * The one screen that handles money was the one screen nothing judged.
 *
 * It cannot be reached honestly in jsdom — Stripe.js is fetched from Stripe and draws its
 * fields in an iframe — so Stripe is replaced here with something that mounts nothing. That
 * is a real limit and worth naming: what follows tests **our** markup around the iframe, and
 * says nothing about what is inside it. The fields themselves carry Stripe's own labels and
 * can only be judged in a real browser.
 */
describe('the card form, once somebody is signed in', () => {
  /** Enough of Stripe to let the screen reach its ready state. It draws nothing. */
  function fakeStripe() {
    const element = {
      mount: () => undefined,
      unmount: () => undefined,
      clear: () => undefined,
      on: () => undefined,
    };
    return { elements: () => ({ create: () => element }) };
  }

  async function renderTheForm() {
    const { prepareCardEntry } = await import('../src/lib/stripe');
    vi.mocked(prepareCardEntry).mockResolvedValue({
      ready: true,
      stripe: fakeStripe() as never,
      supportedRegions: ['GB'],
    });
    stubApi({ shopper: FAKE_SHOPPER, paymentsMode: 'stripe', publishableKey: 'pk_test_x' });
    renderAt('/card');
    await screen.findByRole('group', { name: 'Your card details' });
  }

  it('names the card fields as a group, so entering them says what they are for', async () => {
    await renderTheForm();

    const group = screen.getByRole('group', { name: 'Your card details' });
    // The explanation is read with the name rather than being visual decoration.
    expect(group).toHaveAccessibleDescription(/never reaches/);
  });

  it('gives every control on it the minimum forty eight pixel size', async () => {
    await renderTheForm();

    const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      if (control.classList.contains('skip-link')) continue;
      expect(
        /\bcontrol\b|min-h-control|\bh-\d/.test(control.className),
        `missing its minimum size: ${control.outerHTML.slice(0, 120)}`,
      ).toBe(true);
    }
  });

  it('says that nothing here takes a payment, before asking for a card', async () => {
    await renderTheForm();

    // Being asked for a card is the moment somebody is most entitled to be suspicious, so
    // the reassurance has to be on the screen rather than implied.
    expect(screen.getByText(/Nothing on this screen takes a payment/)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    await renderTheForm();

    const results = await axe.run(document.body, {
      resultTypes: ['violations'],
      // No layout engine in jsdom, so contrast is checked by hand instead — the figures are
      // in BUILD_LOG.md and every pair on this screen passes AA at 20px.
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toBe('');
  });
});
