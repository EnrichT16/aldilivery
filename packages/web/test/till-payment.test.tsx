/**
 * "How you pay at the till" (Anthony, 9 October 2026): the spending card first and recommended,
 * the Runner's own card, paid back, second; the card coming soon while it is switched off; the
 * cardholder terms before a card is made; and the card shown only by Stripe, in its own frames,
 * after Stripe's nonce flow, never through our server.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TillPayment } from '../src/components/TillPayment';

const stripe = vi.hoisted(() => {
  const created: Array<{ type: string; options: Record<string, unknown> }> = [];
  const fake = {
    createEphemeralKeyNonce: vi.fn(async () => Promise.resolve({ nonce: 'nonce_from_stripe' })),
    elements: vi.fn(() => ({
      create: (type: string, options: Record<string, unknown>) => {
        created.push({ type, options });
        return { mount: vi.fn(), destroy: vi.fn() };
      },
    })),
  };
  return { created, fake };
});
vi.mock('../src/lib/stripe', () => ({
  prepareCardEntry: async () =>
    Promise.resolve({ ready: true, stripe: stripe.fake, supportedRegions: [] }),
}));

interface State {
  enabled: boolean;
  card: null | { id: string; last4: string; status: 'active' | 'inactive' };
  payMethod: 'card' | 'own';
  sent: Array<{ method: string; path: string; body: unknown }>;
}

let state: State;

function view() {
  return {
    enabled: state.enabled,
    cardName: 'Ozi card',
    payMethod: state.payMethod,
    chosen: state.payMethod,
    termsAccepted: state.card !== null,
    card: state.card,
  };
}

function stub(): void {
  window.localStorage.setItem('ozidelivery.runner.token', 'runner-token');
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
      state.sent.push({ method, path, body });
      if (path === '/runners/me/card' && method === 'GET') return reply(view());
      if (path === '/runners/me/card') {
        state.card = { id: 'ic_123', last4: '4242', status: 'inactive' };
        state.payMethod = 'card';
        return reply({ ...view(), message: 'Your Ozi card is ready, ending 4242.' });
      }
      if (path === '/runners/me/pay-method') {
        state.payMethod = (body as { method: 'card' | 'own' }).method;
        return reply({ ...view(), message: 'Done.' });
      }
      if (path === '/runners/me/card/key') {
        return reply({ cardId: 'ic_123', secret: 'ek_secret_abc' });
      }
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
}

const AXE = { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false } } };

beforeEach(() => {
  state = { enabled: true, card: null, payMethod: 'own', sent: [] };
  stripe.created.length = 0;
});

describe('how a Runner pays at the till', () => {
  it('offers only their own card while the spending card is switched off, and says it is coming', async () => {
    state.enabled = false;
    stub();
    render(<TillPayment onNews={() => undefined} />);
    expect(await screen.findByText('The Ozi card is coming soon.')).toBeInTheDocument();
    expect(screen.getByText('My own card, paid back straight away.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const results = await axe.run(document.body, AXE as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('puts the card first and recommended, and sets it up only after the terms are accepted', async () => {
    const user = userEvent.setup({ delay: null });
    const news: string[] = [];
    stub();
    render(<TillPayment onNews={(text) => news.push(text)} />);

    const radios = await screen.findAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('id'))).toEqual([
      'till-pay-card',
      'till-pay-own',
    ]);
    expect(screen.getByLabelText('Ozi card (recommended)')).toHaveAccessibleDescription(
      /None of your own money is needed/,
    );
    expect(screen.getByLabelText('My own card, paid back straight away')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Set up my Ozi card' }));
    await user.type(screen.getByLabelText('Your address, first line'), '3 Runner Row');
    await user.type(screen.getByLabelText('Town or city'), 'Gillingham');
    await user.type(screen.getByLabelText('Postcode'), 'ME7 2BB');
    await user.click(screen.getByRole('button', { name: 'Accept and make my card' }));
    expect(await screen.findByText(/Please tick to say/)).toHaveAttribute('role', 'alert');
    expect(state.sent.some((r) => r.method === 'POST' && r.path === '/runners/me/card')).toBe(
      false,
    );

    const results = await axe.run(document.body, AXE as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);

    await user.click(screen.getByLabelText(/I accept the cardholder terms/));
    await user.click(screen.getByRole('button', { name: 'Accept and make my card' }));
    expect(await screen.findByText(/Your Ozi card ends 4242/)).toBeInTheDocument();
    expect(
      state.sent.find((r) => r.method === 'POST' && r.path === '/runners/me/card')?.body,
    ).toEqual({
      acceptTerms: true,
      address: { line1: '3 Runner Row', city: 'Gillingham', postcode: 'ME7 2BB' },
    });
    expect(news).toContain('Your Ozi card is ready, ending 4242.');
    expect(screen.getByLabelText('Ozi card (recommended)')).toBeChecked();
    expect(screen.getByText('Add it to Apple Pay or Google Pay')).toBeInTheDocument();
  });

  it('shows the card only through Stripe, with a key made from Stripe’s nonce', async () => {
    const user = userEvent.setup({ delay: null });
    state.card = { id: 'ic_123', last4: '4242', status: 'inactive' };
    state.payMethod = 'card';
    stub();
    render(<TillPayment onNews={() => undefined} />);

    await user.click(await screen.findByRole('button', { name: 'Show my card details' }));
    expect(await screen.findByRole('button', { name: 'Hide my card details' })).toBeInTheDocument();
    expect(stripe.fake.createEphemeralKeyNonce).toHaveBeenCalledWith({ issuingCard: 'ic_123' });
    expect(state.sent.find((r) => r.path === '/runners/me/card/key')?.body).toEqual({
      nonce: 'nonce_from_stripe',
    });
    expect(stripe.created.map((element) => element.type)).toEqual([
      'issuingCardNumberDisplay',
      'issuingCardExpiryDisplay',
      'issuingCardCvcDisplay',
    ]);
    expect(stripe.created[0]!.options).toMatchObject({
      issuingCard: 'ic_123',
      nonce: 'nonce_from_stripe',
      ephemeralKeySecret: 'ek_secret_abc',
    });
    // Rule Ten: nothing sent to our server could be a card number.
    expect(JSON.stringify(state.sent)).not.toMatch(/\d{12,}/);
    expect(screen.getByText(/It is frozen until you take a job/)).toBeInTheDocument();
  });

  it('switches back to their own card in one tap', async () => {
    const user = userEvent.setup({ delay: null });
    state.card = { id: 'ic_123', last4: '4242', status: 'inactive' };
    state.payMethod = 'card';
    stub();
    render(<TillPayment onNews={() => undefined} />);
    await user.click(await screen.findByLabelText('My own card, paid back straight away'));
    expect(state.sent.find((r) => r.path === '/runners/me/pay-method')?.body).toEqual({
      method: 'own',
    });
  });
});
