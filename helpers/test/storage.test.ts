import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { D1Store, KVStore, type D1Like, type KVLike } from '../src/storage/cloudflare.js';
import { FileStore } from '../src/storage/file-store.js';
import { MemoryStore, type KeyValueStore } from '../src/storage/store.js';

/** A pretend D1 that understands exactly the statements D1Store sends. */
function fakeD1(): D1Like & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...v: unknown[]) {
          values = v;
          return statement;
        },
        async first<T>() {
          const value = rows.get(values[0] as string);
          return (value === undefined ? null : { value }) as T | null;
        },
        async all<T>() {
          const [from, to] = values as [string, string];
          const results = [...rows.entries()]
            .filter(([key]) => key >= from && key < to)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, value]) => ({ key, value }));
          return { results: results as T[] };
        },
        async run() {
          if (query.startsWith('INSERT')) rows.set(values[0] as string, values[1] as string);
          if (query.startsWith('DELETE')) rows.delete(values[0] as string);
          return {};
        },
      };
      return statement;
    },
  };
}

function fakeKV(): KVLike {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    list: async ({ prefix, cursor }) => {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 2);
      const done = start + 2 >= keys.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: done,
        ...(done ? {} : { cursor: String(start + 2) }),
      };
    },
  };
}

async function behavesLikeAStore(store: KeyValueStore): Promise<void> {
  await store.put('knowledge/a/2', 'two');
  await store.put('knowledge/a/1', 'one');
  await store.put('knowledge/b/1', 'other');
  await store.put('knowledge/a_x/1', 'not a');
  expect(await store.get('knowledge/a/1')).toBe('one');
  expect(await store.get('missing')).toBeNull();
  expect(await store.list('knowledge/a/')).toEqual([
    { key: 'knowledge/a/1', value: 'one' },
    { key: 'knowledge/a/2', value: 'two' },
  ]);
  await store.put('knowledge/a/1', 'uno');
  await store.delete('knowledge/a/2');
  expect(await store.list('knowledge/a/')).toEqual([{ key: 'knowledge/a/1', value: 'uno' }]);
}

describe('storage adapters', () => {
  it('memory', () => behavesLikeAStore(new MemoryStore()));
  it('Cloudflare D1', () => behavesLikeAStore(new D1Store(fakeD1())));
  it('Cloudflare KV, across pages', () => behavesLikeAStore(new KVStore(fakeKV())));

  it('a JSON file, which survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helpers-'));
    try {
      const path = join(dir, 'nested', 'helpers.json');
      await behavesLikeAStore(await FileStore.open(path));
      const reopened = await FileStore.open(path);
      expect(await reopened.get('knowledge/a/1')).toBe('uno');
      expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty(['knowledge/b/1'], 'other');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
