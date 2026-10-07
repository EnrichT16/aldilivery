/**
 * Memory for the helpers: one small key and value store, the same on every platform.
 *
 * Adapters: in memory (tests), a JSON file (a home computer or any Node server), Cloudflare D1,
 * and Cloudflare KV. Keys are plain strings with `/` between parts, and `list` finds every key
 * that begins with a prefix, in key order.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: string }>>;
}

/** Reads and writes JSON on top of any store. */
export class JsonStore {
  constructor(readonly raw: KeyValueStore) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.raw.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.raw.put(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.raw.delete(key);
  }

  async list<T>(prefix: string): Promise<T[]> {
    const rows = await this.raw.list(prefix);
    return rows.map((row) => JSON.parse(row.value) as T);
  }
}

/** Kept in memory only: gone when the program stops. For tests and trying things out. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: string }>> {
    return [...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => ({ key, value }));
  }
}
