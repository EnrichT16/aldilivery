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
import { RUNNER_AGREEMENT_VERSION } from '@aldilivery/core';

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
    expect(
      screen.getByText(/checks your right to work in the UK and a DBS check/),
    ).toBeInTheDocument();
  });

  it('asks for a name and mobile with real labels, and every way they might deliver', () => {
    renderAt('/runner/sign-up');
    expect(screen.getByLabelText('Your name')).toHaveAccessibleDescription(/documents/);
    expect(screen.getByLabelText('Your mobile number')).toHaveAttribute('type', 'tel');
    const group = screen.getByRole('group', { name: 'How will you deliver?' });
    expect(group).toHaveAccessibleDescription(/switch any day/);
    expect(screen.getByLabelText('Walking')).toBeChecked();
    expect(screen.getByLabelText('Car')).not.toBeChecked();
  });

  it('sends every way they ticked and who invited them, then asks for the documents', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up?ref=RABCD234');

    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByLabelText('Bicycle or electric bike'));
    await user.click(screen.getByLabelText('Car'));
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' }),
    ).toBeInTheDocument();
    expect(recorded.find((r) => r.path === '/runners')?.body).toEqual({
      name: 'Tomasz',
      phone: '07700 900101',
      travelModes: ['on_foot', 'bicycle', 'car'],
      referredBy: 'RABCD234',
      agreement: { accepted: true, version: RUNNER_AGREEMENT_VERSION, channel: 'button' },
    });
    expect(screen.getByRole('heading', { name: 'Now, your documents' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'A photo of your face' }),
    ).toBeInTheDocument();
  });

  it('sends a photo from the camera, or a share code, and moves on to what is left', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    const face = await screen.findByLabelText('Take a photo of my face');
    expect(face).toHaveAttribute('capture', 'user');
    await user.upload(face, new File(['face'], 'face.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(/A photo of your face: Thank you/)).toBeInTheDocument();
    const sentPhoto = recorded.find(
      (r) => r.path === '/runners/me/documents' && r.method === 'POST',
    );
    expect(sentPhoto?.body).toMatchObject({ kind: 'face_photo', contentType: 'image/jpeg' });

    await user.type(screen.getAllByLabelText('Or type the share code')[0]!, 'W4X 7YZ 9AB');
    await user.click(screen.getAllByRole('button', { name: 'Send the share code' })[0]!);
    await screen.findByText(/Your right to work in the UK: Thank you/);
    expect(screen.queryByRole('heading', { name: 'Your right to work in the UK' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your DBS certificate' })).toBeInTheDocument();
  });

  it('keeps the Runner signed in on this device, without touching a Shopper signed in here', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));
    await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' });

    expect(window.localStorage.getItem('ozidelivery.runner.token')).toBe('runner-token');
    expect(window.localStorage.getItem('ozidelivery.session.token')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to your Runner page' })).toHaveAttribute(
      'href',
      '/runner/home',
    );
  });

  it('lists what is missing in words, and puts focus on the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/runner/sign-up');
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    const problems = await screen.findByRole('alert');
    expect(problems).toHaveTextContent('There are 3 problems to fix');
    expect(problems).toHaveTextContent('agree to the Runner agreement');
    expect(problems).toHaveFocus();
  });

  it('will not sign anybody up who has not agreed to the Runner agreement (ruling 55)', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please tick to say you are 18 or over and agree to the Runner agreement.',
    );
    expect(recorded.some((r) => r.path === '/runners')).toBe(false);
    expect(screen.getByRole('link', { name: 'Read the Runner agreement' })).toHaveAttribute(
      'href',
      '/runner/agreement',
    );
  });
});
