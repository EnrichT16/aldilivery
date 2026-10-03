/**
 * Reporting a problem with a job from the Runner's own account (rulings of 2 October 2026):
 * what went wrong, then notes and photos added to it, and the written decision shown back.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';

interface Report {
  id: string;
  summary: string;
  status: 'open' | 'decided';
  evidence: Array<{ id: string; kind: string; addedBy: string; text: string | null }>;
  decisionWords: string | null;
  decisionNote: string | null;
  refundPence: number;
}

let reports: Report[];
let sent: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  reports = [];
  sent = [];
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
      sent.push({ method, path, body });
      const full = (report: Report) => ({
        ...report,
        orderId: 'order-1',
        reportedBy: 'runner',
        refundRequestedPence: 0,
        decideBy: '2026-10-06T10:00:00.000Z',
        decision: report.status === 'decided' ? 'runner_at_fault' : null,
        decidedAt: null,
      });
      if (path === '/orders/order-1/problems' && method === 'GET') {
        return reply({ reports: reports.map(full) });
      }
      if (path === '/orders/order-1/problems' && method === 'POST') {
        const report: Report = {
          id: 'p1',
          summary: (body as { summary: string }).summary,
          status: 'open',
          evidence: [],
          decisionWords: null,
          decisionNote: null,
          refundPence: 0,
        };
        reports.unshift(report);
        return reply(
          { report: full(report), message: 'Thank you. A person will look at this.' },
          201,
        );
      }
      if (path === '/problems/p1/evidence') {
        const input = body as { kind: string; text?: string };
        reports[0]!.evidence.push({
          id: `e${reports[0]!.evidence.length}`,
          kind: input.kind,
          addedBy: 'runner',
          text: input.text ?? null,
        });
        return reply(
          { message: input.kind === 'photo' ? 'Your photo is sent.' : 'Your note is sent.' },
          201,
        );
      }
      if (path === '/config') return reply({ push: { publicKey: null } });
      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/runner/jobs/order-1/problem']}>
      <App />
    </MemoryRouter>,
  );
}

describe('reporting a problem with a job', () => {
  it('asks what went wrong, then takes notes and photos, listing everything sent', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please say what went wrong.');

    await user.type(screen.getByLabelText('What went wrong?'), 'The bag split on the stairs.');
    await user.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('heading', { name: 'Add to your report' })).toBeInTheDocument();
    expect(screen.getByText(/A person will decide by Tuesday 6 October/)).toBeInTheDocument();
    // jsdom cannot record sound: the page says so and offers a note instead.
    expect(screen.getByText(/cannot record a voice note here/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Write a note'), 'Two eggs broke.');
    await user.click(screen.getByRole('button', { name: 'Send the note' }));
    expect(await screen.findByText('Your note is sent.')).toBeInTheDocument();
    expect(await screen.findByText('Note from you: Two eggs broke.')).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText('Take a photo'),
      new File(['x'], 'bag.jpg', { type: 'image/jpeg' }),
    );
    expect(await screen.findByText('Your photo is sent.')).toBeInTheDocument();
    expect(
      sent.find(
        (r) => r.path === '/problems/p1/evidence' && (r.body as { kind: string }).kind === 'photo',
      ),
    ).toBeDefined();

    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    } as axe.RunOptions);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('shows the written decision, and how to answer it', async () => {
    reports = [
      {
        id: 'p0',
        summary: 'Jar broke.',
        status: 'decided',
        evidence: [],
        decisionWords: 'The Runner was responsible.',
        decisionNote: 'Heavy jars should go in a separate bag.',
        refundPence: 120,
      },
    ];
    renderPage();
    expect(
      await screen.findByText(
        'Decided: The Runner was responsible. Heavy jars should go in a separate bag. The Shopper was refunded £1.20.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If you disagree with a decision, send a new report/),
    ).toBeInTheDocument();
  });
});
