import type { KeyValueStore } from './store.js';

/**
 * The parts of Cloudflare's D1 and KV that the helpers use, written out here so the engine needs
 * no Cloudflare package to build or test.
 */
export interface D1Like {
  prepare(query: string): D1StatementLike;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** The one table the helpers need in D1. `wrangler d1 execute` runs this; so does `ensureTable`. */
export const D1_SCHEMA =
  'CREATE TABLE IF NOT EXISTS helper_items (key TEXT PRIMARY KEY, value TEXT NOT NULL)';

/** Cloudflare D1 (a small SQL database). The recommended memory on Cloudflare. */
export class D1Store implements KeyValueStore {
  private ready: Promise<unknown> | null = null;

  constructor(private readonly db: D1Like) {}

  private ensureTable(): Promise<unknown> {
    this.ready ??= this.db.prepare(D1_SCHEMA).run();
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureTable();
    const row = await this.db
      .prepare('SELECT value FROM helper_items WHERE key = ?')
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    await this.ensureTable();
    await this.db
      .prepare(
        'INSERT INTO helper_items (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .bind(key, value)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();
    await this.db.prepare('DELETE FROM helper_items WHERE key = ?').bind(key).run();
  }

  async list(prefix: string): Promise<Array<{ key: string; value: string }>> {
    await this.ensureTable();
    // A range rather than LIKE, so `%` and `_` in a key mean nothing special.
    const { results } = await this.db
      .prepare('SELECT key, value FROM helper_items WHERE key >= ? AND key < ? ORDER BY key')
      .bind(prefix, `${prefix}￿`)
      .all<{ key: string; value: string }>();
    return results;
  }
}

/**
 * Cloudflare KV. Works, but the free plan allows only about 1,000 writes a day and changes take
 * up to a minute to be seen everywhere, so D1 is the better choice for the helpers.
 */
export class KVStore implements KeyValueStore {
  constructor(private readonly kv: KVLike) {}

  get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  put(key: string, value: string): Promise<void> {
    return this.kv.put(key, value);
  }

  delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: string }>> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix, cursor });
      names.push(...page.keys.map((key) => key.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    const rows = await Promise.all(
      names.sort().map(async (key) => ({ key, value: await this.kv.get(key) })),
    );
    return rows.filter((row): row is { key: string; value: string } => row.value !== null);
  }
}
