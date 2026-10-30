/**
 * Agreeing again when our terms change (Anthony, 30 October 2026): the notice a Shop Partner or
 * an Ambassador on older terms sees, with the words, a link to the terms, an "I agree" tick and a
 * button; it refuses without the tick, records the agreement with it, and passes axe.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReferralCard } from '../src/components/ReferralCard';
import { TermsChanged } from '../src/components/TermsChanged';
import { fakeReferrals } from './setup';

const WORDS = 'Our terms have changed. Please read and agree to keep going.';

const reply = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => Promise.resolve(body),
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the terms-changed notice', () => {
  it('says so plainly, links to the terms, and agrees only with the tick', async () => {
    const onAgree = vi.fn(async () => Promise.resolve());
    const user = userEvent.setup({ delay: null });
    const { container } = render(
      <MemoryRouter>
        <TermsChanged
          words={WORDS}
          termsName="Shop Partner terms"
          termsPath="/partner/terms"
          onAgree={onAgree}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Our terms have changed' })).toBeInTheDocument();
    expect(screen.getByText(WORDS)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the Shop Partner terms' })).toHaveAttribute(
      'href',
      '/partner/terms',
    );
    await user.click(screen.getByRole('button', { name: 'I agree' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please tick to agree to the Shop Partner terms first.',
    );
    expect(onAgree).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('I have read and agree to the new Shop Partner terms'));
    await user.click(screen.getByRole('button', { name: 'I agree' }));
    expect(onAgree).toHaveBeenCalledTimes(1);
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('shows an Ambassador on older terms the notice, and agrees with the new version', async () => {
    const sent: Array<{ path: string; body: unknown }> = [];
    let changed = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url)
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/api(?=\/|$)/, '');
        const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
        sent.push({ path, body });
        if (path === '/referrals/me') {
          return reply(
            fakeReferrals('https://example.test/join?via=shopper-margaret', {
              ambassador: {
                joined: true,
                link: 'https://example.test/business/join?ambassador=shopper-margaret',
                termsChanged: changed,
                termsChangedWords: changed ? WORDS : null,
                canWithdraw: false,
              },
            }),
          );
        }
        if (path === '/ambassador/join') {
          changed = false;
          return reply({ link: 'x', message: 'Welcome back.' });
        }
        return reply({ error: { message: 'Not stubbed' } }, 404);
      }),
    );
    const news = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <ReferralCard as="shopper" onNews={news} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(WORDS)).toBeInTheDocument();
    // Their link still shows: it keeps working.
    expect(
      screen.getByText('https://example.test/business/join?ambassador=shopper-margaret'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByLabelText('I have read and agree to the new Ozi Ambassador terms'),
    );
    await user.click(screen.getByRole('button', { name: 'I agree' }));
    await waitFor(() => expect(screen.queryByText(WORDS)).toBeNull());
    expect(sent.find((row) => row.path === '/ambassador/join')?.body).toEqual({
      termsAgreed: true,
      termsVersion: '2026-10-30b',
    });
    expect(news).toHaveBeenCalledWith(
      'Thank you. You have agreed to the new Ozi Ambassador terms.',
    );
  });
});
