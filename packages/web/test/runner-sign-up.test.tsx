/**
 * Signing up to run.
 *
 * Until 27 Sep 2026 the Runner page's button led to the Shopper sign-up, so a would-be Runner
 * made a shopping account instead. These check the Runner form itself: what it asks, what it
 * sends, and that it says plainly — before and after — that no job comes until a person has
 * done the checks.
 */

import { render, screen, waitFor } from '@testing-library/react';
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

  it('says before anything is filled in how documents are checked', () => {
    renderAt('/runner/sign-up');
    expect(
      screen.getByText(/we check your\s+right to work in the UK and a DBS check/),
    ).toBeInTheDocument();
    // The automatic check approves only what is clearly in order (30 October 2026).
    expect(
      screen.getByText(/Our automatic check approves documents that are clearly in order/),
    ).toBeInTheDocument();
    expect(screen.getByText(/for a car, motorbike or van your licence/)).toBeInTheDocument();
  });

  it('asks for a name and mobile with real labels, and every way they might deliver', () => {
    renderAt('/runner/sign-up');
    expect(screen.getByLabelText('Your name')).toHaveAccessibleDescription(/documents/);
    expect(screen.getByLabelText('Your mobile number')).toHaveAttribute('type', 'tel');
    expect(screen.getByLabelText('Your home postcode')).toHaveAccessibleDescription(/own area/);
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
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
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
      // The 18 or over tick, and where they live, kept by the server (30 October 2026).
      adult: true,
      homePostcode: 'ME7 1AA',
    });
    expect(screen.getByRole('heading', { name: 'Now, your documents' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'A photo of your face' }),
    ).toBeInTheDocument();
  });

  it('records the Shopper whose referral link for a driver they followed (30 October 2026)', async () => {
    window.sessionStorage.clear();
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up?via=shopper-margaret');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));
    await screen.findByRole('heading', { level: 1, name: 'Thank you, Tomasz' });
    expect(recorded.find((r) => r.path === '/runners')?.body).toMatchObject({
      referredBy: 'shopper-margaret',
    });
  });

  it('sends a photo from the camera, or a share code, and moves on to what is left', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
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

  it('also lets them choose a photo already on the phone, or a PDF for a document (27 October 2026)', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    // The face: a photo only, from the camera or the library.
    const chooseFace = await screen.findByLabelText('Choose a photo');
    expect(chooseFace).not.toHaveAttribute('capture');
    expect(chooseFace).toHaveAttribute('accept', 'image/*');

    // A document: a photo or a PDF, chosen rather than taken.
    const chooseDbs = screen.getAllByLabelText('Choose a photo or PDF').at(-1)!;
    expect(chooseDbs).not.toHaveAttribute('capture');
    expect(chooseDbs).toHaveAttribute('accept', 'image/*,application/pdf');
    await user.upload(
      chooseDbs,
      new File(['%PDF-1.7 certificate'], 'dbs.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(
        recorded.find((r) => r.path === '/runners/me/documents' && r.method === 'POST')?.body,
      ).toMatchObject({ contentType: 'application/pdf' }),
    );
  });

  it('asks, unticked, for consent to compare the face photo with the ID (ruling 74)', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByLabelText('I am 18 or over, and I agree to the Runner agreement'));
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    const consent = await screen.findByRole('checkbox', {
      name: /may compare my face photo with the photo on my ID to confirm it is me\./,
    });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveAccessibleDescription(/a person compares them instead/);
    await user.click(consent);
    expect(await screen.findByText(/Your face photo may be compared/)).toBeInTheDocument();
    expect(consent).toBeChecked();
    expect(recorded.find((r) => r.path === '/runners/me/face-match-consent')?.body).toEqual({
      agree: true,
    });
  });

  it('keeps the Runner signed in on this device, without touching a Shopper signed in here', async () => {
    const user = userEvent.setup({ delay: null });
    renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
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
    expect(problems).toHaveTextContent('There are 4 problems to fix');
    expect(problems).toHaveTextContent('Please give your home postcode.');
    expect(problems).toHaveTextContent('agree to the Runner agreement');
    expect(problems).toHaveFocus();
  });

  it('will not sign anybody up who has not agreed to the Runner agreement (ruling 55)', async () => {
    const user = userEvent.setup({ delay: null });
    const recorded = renderAt('/runner/sign-up');
    await user.type(screen.getByLabelText('Your name'), 'Tomasz');
    await user.type(screen.getByLabelText('Your mobile number'), '07700 900101');
    await user.type(screen.getByLabelText('Your home postcode'), 'ME7 1AA');
    await user.click(screen.getByRole('button', { name: 'Sign me up to run' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please tick to say you are 18 or over and agree to the Runner agreement.',
    );
    expect(recorded.some((r) => r.path === '/runners')).toBe(false);
    // Opens in a new tab (16 October 2026), so what has been typed here is not lost.
    const agreement = screen.getByRole('link', { name: /Read the Runner agreement/ });
    expect(agreement).toHaveAttribute('href', '/runner/agreement');
    expect(agreement).toHaveAttribute('target', '_blank');
    expect(agreement).toHaveAccessibleName('Read the Runner agreement (opens in a new tab)');
    expect(screen.getByLabelText('Your name')).toHaveValue('Tomasz');
  });
});
