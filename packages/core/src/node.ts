/**
 * Loading `config/store.json` from disk. Node only — the web app imports the JSON through
 * its bundler instead, and validates it with the same `parseStoreConfig`.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseStoreConfig, StoreConfigError, type StoreConfig } from './config.js';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const DEFAULT_RELATIVE_PATH = join('config', 'store.json');

/**
 * Walk upwards from a starting directory until the workspace root is found.
 *
 * Used so that the API, the tests and any script all resolve the same single configuration
 * file no matter which directory they were started from.
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new StoreConfigError(
        `could not find the workspace root (no ${WORKSPACE_MARKER} above ${startDir}). ` +
          `Set STORE_CONFIG_PATH to the absolute path of the store configuration file.`,
      );
    }
    current = parent;
  }
}

/** The resolved path to the store configuration file. */
export function storeConfigPath(explicitPath?: string): string {
  const candidate = explicitPath ?? process.env['STORE_CONFIG_PATH'];
  if (candidate && isAbsolute(candidate)) {
    return candidate;
  }

  // Start the search from this module's own directory rather than the process working
  // directory, so a service started from anywhere still finds the one true config file.
  const here = dirname(fileURLToPath(import.meta.url));
  const root = findWorkspaceRoot(here);
  return resolve(root, candidate ?? DEFAULT_RELATIVE_PATH);
}

/**
 * Read and validate the store configuration.
 *
 * Throws `StoreConfigError` if the file is missing, malformed, or contradicts an
 * inviolable rule. Services call this once at startup and refuse to serve without it.
 */
export function loadStoreConfig(explicitPath?: string): StoreConfig {
  const path = storeConfigPath(explicitPath);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new StoreConfigError(`could not read ${path}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StoreConfigError(`${path} is not valid JSON — ${(error as Error).message}`);
  }

  return parseStoreConfig(parsed);
}

export { parseStoreConfig, StoreConfigError, type StoreConfig };
