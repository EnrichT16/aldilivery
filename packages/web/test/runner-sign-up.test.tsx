/**
 * Signing up to run.
 *
 * Until 27 Sep 2026 the Runner page's button led to the Shopper sign-up, so a would-be Runner
 * made a shopping account instead. These check the Runner form itself: what it asks, what it
 * sends, and that it says plainly — before and after — that no job comes until a person has
 * done the checks.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { stubApi } from './setup';

function renderAt(path: string) {
  const recorded = stubApi();
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return recorded;
}

describe('signing up to run', () => {
  it('is where the Runner page sends people, not the Shopper sign-up', async () => {
    renderAt('/runner');
    expect(screen.getByRole('link', { name: 'Start signing up as a Runner' })).toHaveAttribute(
      'href',
      '/runner/sign-up',
    );
  });

  it('says before anything is filled in that a person checks documents first', () => {
    renderAt('/runner/sign-up');
    expect(screen.getByText(/right to work in the United Kingdom and a/)).toBeInTheDocument();
  });

  it('asks for a name and mobile with real labels, and how they get around as a group', () => {
    renderAt('/runner/sign-up');
    expect(screen.getByLabelText('Your name')).toHaveAccessibleDescription(/documents/);
    expect(screen.getByLabelText('Your mobile number')).toHaveAttribute('type', 'tel');
    const group = screen.getByRole('group', { name: 'How will you get around?' });
    expect(group).toBeInTheDocument();
    expect(screen.getByLabelText('On foot')).toBeChecked();
  });

  it('sends what was typed, and says what happens next', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');

    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByLabelText('Bicycle'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' }),
    ).toBeInTheDocument();
    expect(recorded.find((r) => r.path === '/runners')?.body).toEqual({
      name: 'Tomasz',
      phone: '07700 900101',
      vehicleType: 'bicycle',
    });
    expect(screen.getByText(/We will contact you on 07700 900101/)).toBeInTheDocument();
    expect(screen.getByText(/not ready yet/)).toBeInTheDocument();
  });

  it('does not keep the Runner token, so a Shopper in the same browser stays signed in', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));
    await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' });

    expect(window.localStorage.getItem('aldilivery.session.token')).toBeNull();
  });

  it('lists what is missing in words, and puts focus on the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/runner/sign-up');
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    const problems = await screen.findByRole('alert');
    expect(problems).toHaveTextContent('There are 2 problems to fix');
    expect(problems).toHaveFocus();
  });
});
