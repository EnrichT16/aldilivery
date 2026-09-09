/**
 * Rule Seven: every screen meets WCAG 2.2 level AA.
 *
 * axe-core is run against every screen in the product. Any violation fails this test, and
 * the web build runs these tests before it will produce a bundle, so a violation cannot be
 * shipped.
 *
 * What axe cannot see in jsdom: colour contrast and anything else that needs a layout
 * engine. Those are checked by hand and recorded in BUILD_LOG.md — the two brand colours,
 * gold #D4AF37 on navy #0B1F3A, give a contrast ratio of about 7.9 to 1, comfortably past
 * the 4.5 to 1 that AA asks for, and white on navy is about 16.5 to 1.
 */

import axe, { type Result } from 'axe-core';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { stubCatalogueFetch } from './setup';

const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'the landing page', path: '/' },
  { name: 'signing up', path: '/sign-up' },
  { name: 'browsing the shopping', path: '/shop' },
  { name: 'the basket', path: '/basket' },
  { name: 'the confirmation screen', path: '/confirm' },
  { name: 'the Runner door', path: '/runner' },
  { name: 'just looking', path: '/just-looking' },
  { name: 'a page that does not exist', path: '/nowhere' },
];

function describeViolations(violations: Result[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.html}`).join('\n'),
    )
    .join('\n\n');
}

beforeEach(() => {
  stubCatalogueFetch();
});

describe('every screen passes axe with no violations', () => {
  for (const screen of SCREENS) {
    it(`has no accessibility violations: ${screen.name}`, async () => {
      render(
        <MemoryRouter initialEntries={[screen.path]}>
          <App />
        </MemoryRouter>,
      );

      // Let the shopping page finish loading before it is judged.
      await waitFor(() => {
        expect(document.querySelector('main')).not.toBeNull();
      });

      const results = await axe.run(document.body, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      });

      expect(describeViolations(results.violations)).toBe('');
      expect(results.violations).toHaveLength(0);
    }, 20_000);
  }
});
