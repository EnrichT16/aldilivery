/**
 * A share link for everybody (ruling 44): a Shopper's is in Settings with its meter, and a
 * share link someone followed is remembered for their sign-up.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { FAKE_SHOPPER, stubApi } from './setup';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('share links', () => {
  it('shows a signed-in Shopper their link and how many joined with it', async () => {
    stubApi({ shopper: FAKE_SHOPPER });
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Your share link' })).toBeInTheDocument();
    expect(screen.getByText('https://example.test/join?via=shopper-margaret')).toBeInTheDocument();
    expect(screen.getByText('2 people have joined with your link.')).toBeInTheDocument();
  });

  it('remembers a staff member’s link for the sign-up form', () => {
    window.localStorage.removeItem('ozidelivery.joined.via');
    stubApi();
    renderAt('/join?via=staff-abc123');
    expect(window.localStorage.getItem('ozidelivery.joined.via')).toBe('staff:abc123');
  });

  it('ignores a link that is not one of ours', () => {
    window.localStorage.removeItem('ozidelivery.joined.via');
    stubApi();
    renderAt('/join?via=owner-everything');
    expect(window.localStorage.getItem('ozidelivery.joined.via')).toBeNull();
  });
});
