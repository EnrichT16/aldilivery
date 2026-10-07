/**
 * Tidy screens (ruling 47): the descriptive words are kept for screen readers but hidden on the
 * screen, until "Show words on the screen" is turned on; the first screen's choices sit at the
 * top like tabs.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { stubApi } from './setup';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('tidy screens', () => {
  it('hides the descriptions by default, while a screen reader still has them', async () => {
    stubApi();
    renderAt('/');
    const runner = await screen.findByRole('link', { name: /^Runner/ });
    // The description is still part of the link's name, for a screen reader.
    expect(runner).toHaveAccessibleName(/You want to earn money/);
    expect(document.documentElement.dataset['words']).toBe('hidden');
    expect(screen.getByText(/You want to earn money/)).toHaveClass('extra');
  });

  it('shows them once "Show words on the screen" is on, and remembers it', async () => {
    stubApi();
    const user = userEvent.setup();
    renderAt('/settings');
    const box = await screen.findByRole('checkbox', { name: 'Show words on the screen' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(document.documentElement.dataset['words']).toBe('shown');
    expect(
      JSON.parse(window.localStorage.getItem('ozidelivery.voice.settings') ?? '{}'),
    ).toMatchObject({ showText: true });
  });
});
