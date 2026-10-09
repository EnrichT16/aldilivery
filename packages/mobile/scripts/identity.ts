/**
 * Who the phone apps are, read from config/store.json at build time (Rule Nine).
 *
 * The product name is never written into this package, nor into the native projects that are
 * committed, because none are: they are generated into build/ (ignored by git, and skipped by
 * the Rule Nine scan in packages/core/test/config.test.ts) each time the apps are built, and
 * the name is filled in from store.json as they are made.
 *
 * This file is loaded three ways: by Node directly (the build script), by Vitest, and by the
 * Capacitor command line tool, which turns capacitor.config.ts and what it imports into old
 * style CommonJS. So it may not use `import.meta`, and finds config/store.json by walking up
 * from wherever the command was run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The app identifier the stores know us by, unless store.json says otherwise. */
export const DEFAULT_APP_ID = 'uk.co.ozidelivery.app';

/** The website, which the apps talk to for everything. */
export const DEFAULT_SITE = 'https://ozidelivery.co.uk';

export interface AppIdentity {
  /** The name under the icon and in the stores, from `productName`. */
  name: string;
  /**
   * The identifier both stores know the app by: the iOS bundle identifier and the Android
   * application id. Once an app is published under it, it can never change again.
   */
  appId: string;
  /** The website the app's API calls go to, such as https://ozidelivery.co.uk. */
  site: string;
  /** The brand colours, for the splash screen and the bar along the top. */
  navy: string;
  gold: string;
  tagline: string;
  /** The assistant's name, for the permission reasons ("Ozi listens when..."). */
  assistant: string;
}

interface StoreJson {
  productName?: unknown;
  assistantName?: unknown;
  tagline?: unknown;
  brand?: { colours?: { navy?: unknown; gold?: unknown } };
  mobileApp?: { appId?: unknown; site?: unknown };
}

/** The folder holding pnpm-workspace.yaml, above `start`. */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find the repository root (pnpm-workspace.yaml) above ${start}.`);
    }
    current = parent;
  }
}

const APP_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`config/store.json: ${what} must be filled in for the phone apps.`);
  }
  return value.trim();
}

/**
 * The identity from a parsed store.json, with two optional overrides from the environment:
 * `APP_ID` (to build a test copy under another identifier) and `APP_SITE`.
 */
export function identityFrom(
  store: StoreJson,
  env: Record<string, string | undefined> = {},
): AppIdentity {
  const appId = text(env['APP_ID'] ?? store.mobileApp?.appId ?? DEFAULT_APP_ID, 'mobileApp.appId');
  if (!APP_ID.test(appId)) {
    throw new Error(
      `The app identifier "${appId}" is not in the reverse domain form both stores need, such as ${DEFAULT_APP_ID}: lower case, at least three parts, no hyphens.`,
    );
  }
  const site = text(
    env['APP_SITE'] ?? store.mobileApp?.site ?? DEFAULT_SITE,
    'mobileApp.site',
  ).replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(site)) {
    throw new Error(
      `The website "${site}" must be an https address with nothing after the domain.`,
    );
  }
  const navy = text(store.brand?.colours?.navy, 'brand.colours.navy');
  const gold = text(store.brand?.colours?.gold, 'brand.colours.gold');
  if (!COLOUR.test(navy) || !COLOUR.test(gold)) {
    throw new Error('config/store.json: the brand colours must be written like #0B1F3A.');
  }
  return {
    name: text(store.productName, 'productName'),
    appId,
    site,
    navy,
    gold,
    tagline: text(store.tagline, 'tagline'),
    assistant: text(store.assistantName, 'assistantName'),
  };
}

/** The identity for this checkout, read from config/store.json and the environment. */
export function loadIdentity(
  root: string = findRepoRoot(),
  env: Record<string, string | undefined> = process.env,
): AppIdentity {
  const store = JSON.parse(readFileSync(join(root, 'config', 'store.json'), 'utf8')) as StoreJson;
  return identityFrom(store, env);
}
