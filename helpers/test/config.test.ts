import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ConfigError, parseConfig } from '../src/core/config.js';
import { cronMatches } from '../src/core/cron.js';
import { testConfig } from './support.js';

describe('configuration', () => {
  it('accepts the starting configuration and the test one', () => {
    const shipped = JSON.parse(
      readFileSync(new URL('../helpers.config.json', import.meta.url), 'utf8'),
    );
    expect(parseConfig(shipped).helpers.map((h) => h.type)).toEqual([
      'inbox',
      'watchman',
      'briefing',
    ]);
    expect(parseConfig(testConfig()).owner.name).toBe('Anthony');
  });

  it('lists every problem in plain English', () => {
    const bad = testConfig();
    bad.helpers[0]!.business = 'nobody';
    bad.helpers[0]!.permissions = ['fly'] as never;
    bad.helpers[1]!.watchman = { checks: [{ name: 'x', url: 'ftp://x' }] };
    try {
      parseConfig(bad);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems).toEqual([
        'Helper "inbox" names a business that is not listed.',
        'Helper "inbox" has an unknown permission "fly".',
        'Helper "watchman" has a check without a name or a web address starting http.',
      ]);
    }
  });

  it('never holds a secret, only the names of environment settings', () => {
    const text = readFileSync(new URL('../helpers.config.json', import.meta.url), 'utf8');
    expect(text).not.toMatch(/sk-|api[_-]?key"\s*:\s*"[^"]*[A-Za-z0-9]{12}/i);
  });
});

describe('cron lines', () => {
  const at = (iso: string) => new Date(iso);
  it('reads every five minutes, daily and weekly lines', () => {
    expect(cronMatches('*/5 * * * *', at('2026-10-07T09:05:00Z'))).toBe(true);
    expect(cronMatches('*/5 * * * *', at('2026-10-07T09:06:00Z'))).toBe(false);
    expect(cronMatches('30 6 * * *', at('2026-10-07T06:30:00Z'))).toBe(true);
    expect(cronMatches('0 7 * * 1', at('2026-10-05T07:00:00Z'))).toBe(true); // a Monday
    expect(cronMatches('0 7 * * 1', at('2026-10-07T07:00:00Z'))).toBe(false);
    expect(cronMatches('0 9-17/4 * * 1-5', at('2026-10-07T13:00:00Z'))).toBe(true);
    expect(cronMatches('0 0 * * 7', at('2026-10-04T00:00:00Z'))).toBe(true); // Sunday as 7
  });

  it('refuses a line it cannot read', () => {
    expect(() => cronMatches('every day', new Date())).toThrow(/five parts/);
  });
});
