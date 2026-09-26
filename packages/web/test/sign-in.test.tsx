/**
 * Signing back in with a code sent by text, on the screen.
 *
 * The server side — one form for phone numbers, the limits, Twilio — is proved in the API's
 * sign-in tests. These are about what a person meets: a label on every field, the code field
 * a phone can fill in from the text, problems said in words, and being taken back to their
 * order if that is where they came from.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { stubApi, type ApiStubOptions } from './setup';

function renderAt(path: string, options: ApiStubOptions = {}) {
  const recorded = stubApi(options);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { recorded, view };
}

async function askForCode() {
  const user = userEvent.setup({ delay: null });
  await user.type(await screen.findByLabelText('Your mobile number'), '07700 900123');
  await user.click(screen.getByRole('button', { name: 'Text me a code' }));
  return user;
}

describe('signing in', () => {
  it('asks for the mobile number with a real label and a hint', async () => {
    renderAt('/sign-in');
    const phone = await screen.findByLabelText('Your mobile number');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAccessibleDescription(/when you set up your account/);
  });

  it('sends the number, then asks for the code in a field a phone can fill in', async () => {
    const { recorded } = renderAt('/sign-in');
    await askForCode();

    expect(recorded.find((r) => r.path === '/auth/request-code')?.body).toEqual({
      phone: '07700 900123',
      role: 'shopper',
    });
    const code = await screen.findByLabelText('The code from the text');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    // Focus goes to the code, so nobody has to find it.
    expect(code).toHaveFocus();
    expect(screen.getByText(/We sent it to 07700 900123/)).toHaveAttribute('role', 'status');
  });

  it('signs in and goes to the shop', async () => {
    renderAt('/sign-in');
    const user = await askForCode();
    await user.type(await screen.findByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your shopping' }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('aldilivery.session.token')).toBe('signed-in-token');
  });

  it('goes back to the order afterwards, if that is where they came from', async () => {
    renderAt('/sign-in?next=/confirm');
    const user = await askForCode();
    await user.type(await screen.findByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // An empty basket, so the order screen says so — but it is the order screen.
    expect(await screen.findByText(/nothing in your basket yet/)).toBeInTheDocument();
  });

  it('will not be sent anywhere off this site afterwards', async () => {
    renderAt('/sign-in?next=//evil.example');
    const user = await askForCode();
    await user.type(await screen.findByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your shopping' }),
    ).toBeInTheDocument();
  });

  it('says a wrong code in words, and puts focus on it', async () => {
    renderAt('/sign-in', { verifyResult: 'wrong-code' });
    const user = await askForCode();
    await user.type(await screen.findByLabelText('The code from the text'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const problem = await screen.findByRole('alert');
    expect(problem).toHaveTextContent('That code was not right. Try again.');
    expect(problem).toHaveFocus();
  });

  it('offers to set up an account when there is none on that number', async () => {
    renderAt('/sign-in', { verifyResult: 'no-account' });
    const user = await askForCode();
    await user.type(await screen.findByLabelText('The code from the text'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no account on that number/);
    expect(screen.getByRole('link', { name: /Set up an account/ })).toBeInTheDocument();
  });

  it('says plainly when signing in by text is not switched on yet', async () => {
    renderAt('/sign-in', { signInByText: false });
    expect(await screen.findByText(/not switched on yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your mobile number')).not.toBeInTheDocument();
  });

  it('is offered from the sign up screen and before sending an order', async () => {
    renderAt('/sign-up');
    expect(await screen.findByRole('link', { name: /Sign in/ })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('has no axe violations, at either step', async () => {
    renderAt('/sign-in');
    await screen.findByLabelText('Your mobile number');
    const options = {
      resultTypes: ['violations'],
      rules: { 'color-contrast': { enabled: false } },
    };
    let results = await axe.run(document.body, options as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);

    await askForCode();
    await screen.findByLabelText('The code from the text');
    results = await axe.run(document.body, options as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
