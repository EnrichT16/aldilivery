/**
 * No other delivery app is named in Ambassador material (Anthony, 31 October 2026). The guide,
 * the Toolkit, the flyers, the presentation slides and every phrase say "other delivery apps",
 * keeping the comparison: the restaurant is paid at the counter straight away, where other apps
 * pay later and take a commission. This scan fails if a name creeps back in.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB = process.cwd();
const ROOT = join(WEB, '..', '..');
const SRC = join(WEB, 'src');

/** The names never to be said, written loosely so a space or none, and any case, is caught. */
const NAMES: Array<[string, RegExp]> = [
  ['Just Eat', /just[\s-]*eat/i],
  ['Deliveroo', /deliveroo/i],
  ['Uber Eats', /uber[\s-]*eats/i],
];

function walk(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** packages/web/src/**\/ambassador* (any file or folder so named), and the Ambassador pages. */
function ambassadorFiles(): string[] {
  return walk(SRC).filter((path) => /ambassador/i.test(relative(SRC, path)));
}

function phraseFiles(): string[] {
  const phrases = join(ROOT, 'config', 'phrases');
  return [
    ...readdirSync(phrases)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(phrases, name)),
    join(ROOT, 'config', 'ozi-phrases.json'),
  ];
}

describe('Ambassador material names no other delivery app', () => {
  it('finds the material it scans', () => {
    const files = ambassadorFiles().map((path) => relative(SRC, path));
    expect(files).toEqual(
      expect.arrayContaining([
        join('components', 'ambassador', 'AmbassadorGuide.tsx'),
        join('components', 'ambassador', 'Toolkit.tsx'),
        join('components', 'ambassador', 'Flyers.tsx'),
        join('pages', 'AmbassadorPresentation.tsx'),
        join('pages', 'StaffAmbassadors.tsx'),
      ]),
    );
    expect(phraseFiles().length).toBeGreaterThan(1);
  });

  it.each(NAMES)('never says %s', (_name, pattern) => {
    const found = [...ambassadorFiles(), ...phraseFiles()].filter((path) =>
      pattern.test(readFileSync(path, 'utf8')),
    );
    expect(found.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it('keeps the comparison, in plain words', () => {
    const guide = readFileSync(
      join(SRC, 'components', 'ambassador', 'AmbassadorGuide.tsx'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(guide).toMatch(/other delivery apps/);
    expect(guide).toMatch(/pays you at the counter straight away/);
    expect(guide).toMatch(/Other delivery apps pay you later and take a commission/);
  });
});
