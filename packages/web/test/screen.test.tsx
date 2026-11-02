/**
 * Ozi sees the screen (Anthony, 2 November 2026, ruling 89): every request to Ozi carries a
 * small picture of the page at that moment, so "this one" and "what's that number" make sense,
 * built only from words already shown. A form field's value never leaves the device: a password
 * typed, an address typed, a note typed are all absent, and anything like a telephone number is
 * blanked before it goes.
 */

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { askOzi } from '../src/lib/api';
import { SCREEN_MAX_CHARACTERS, screenSnapshot } from '../src/lib/screen';

function NeedsYouNow({ many = 2 }: { many?: number }): JSX.Element {
  return (
    <main>
      <h1>Needs you now</h1>
      <h2>Runner documents</h2>
      <p role="status">3 Runner documents waiting</p>
      <nav aria-label="Admin pages">
        <div role="tablist" aria-label="Parts of the admin panel">
          <button type="button" role="tab" aria-selected="true">
            Today
          </button>
          <button type="button" role="tab" aria-selected="false">
            Money
          </button>
        </div>
      </nav>
      <ul>
        {Array.from({ length: many }, (_, index) => (
          <li key={index}>
            {index === 0
              ? 'Margaret Ade, driving licence, ring 07700 900123'
              : `Runner ${index}, insurance certificate, waiting since this morning ${'and more '.repeat(8)}`}
            <button type="button">Open</button>
          </li>
        ))}
      </ul>
      <form>
        <label>
          Password
          <input type="password" defaultValue="hunter2-secret" />
        </label>
        <label>
          Address
          <input defaultValue="12 Hidden Street" />
        </label>
        <label>
          Note
          <textarea defaultValue="typed note" />
        </label>
        <label>
          Area
          <select defaultValue="ME">
            <option value="ME">Medway secret option</option>
          </select>
        </label>
      </form>
      <button type="button">Approve</button>
      <p hidden>Hidden words</p>
    </main>
  );
}

afterEach(() => {
  window.history.pushState({}, '', '/');
  document.title = '';
});

describe('what is on the screen', () => {
  it('is the path, the title, the headings, the status line, the tab open and the useful lines', () => {
    window.history.pushState({}, '', '/staff');
    document.title = 'Admin panel';
    render(<NeedsYouNow />);
    const seen = screenSnapshot();
    expect(seen).toMatchObject({
      path: '/staff',
      title: 'Admin panel',
      headings: ['Needs you now', 'Runner documents'],
      status: ['3 Runner documents waiting'],
      section: 'Today',
    });
    expect(seen?.lines).toEqual(
      expect.arrayContaining([
        'Margaret Ade, driving licence, ring [phone number] Open',
        expect.stringMatching(/^Runner 1, insurance certificate/),
        'Approve',
      ]),
    );
    // The status line is given once, on its own, not again among the lines.
    expect(seen?.lines).not.toContain('3 Runner documents waiting');
    const words = JSON.stringify(seen);
    // Never a form field's value, never hidden words, never the other tabs as content.
    expect(words).not.toMatch(/hunter2|Hidden Street|typed note|Medway secret|Hidden words/);
    expect(words).not.toContain('07700');
    expect(words).not.toContain('Money');
  });

  it('is kept small whatever is on the page', () => {
    window.history.pushState({}, '', '/staff');
    render(<NeedsYouNow many={60} />);
    const seen = screenSnapshot();
    expect(seen?.lines?.length).toBeLessThanOrEqual(12);
    for (const line of seen?.lines ?? []) expect(line.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(seen).length).toBeLessThanOrEqual(SCREEN_MAX_CHARACTERS);
  });

  it('goes with every request to Ozi, with the path and the headings, and no typed value', async () => {
    window.history.pushState({}, '', '/staff');
    render(<NeedsYouNow />);
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => Promise.resolve({ reply: 'The first one is a licence.' }),
        } as unknown as Response;
      }),
    );
    await askOzi('what does the first one say', 'within', 0, { kind: 'shopper' });
    expect(bodies).toHaveLength(1);
    const screen = bodies[0]!['screen'] as Record<string, unknown>;
    expect(screen).toMatchObject({
      path: '/staff',
      headings: ['Needs you now', 'Runner documents'],
      section: 'Today',
    });
    expect(JSON.stringify(bodies[0])).not.toMatch(/hunter2|Hidden Street|typed note|07700/);
  });
});
