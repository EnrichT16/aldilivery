import { describe, expect, it } from 'vitest';

import worker from '../src/platform/worker.js';
import type { KVLike } from '../src/storage/cloudflare.js';

function fakeKV(): KVLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    list: async ({ prefix }) => ({
      keys: [...data.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((name) => ({ name })),
      list_complete: true,
    }),
  };
}

const RAW = [
  'From: Jane <jane@customer.example>',
  'To: hello@example.com',
  'Subject: Do you build websites?',
  'Message-ID: <w1@c>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello, do you build websites for small charities?',
].join('\r\n');

describe('the Cloudflare Worker', () => {
  it('receives email from Cloudflare Email Routing, forwards it to a person, and puts it on the review list', async () => {
    const kv = fakeKV();
    const forwarded: string[] = [];
    const env = { HELPERS_KV: kv, INBOX_FORWARD_TO: 'anthony@example.net', ADMIN_TOKEN: 'k' };
    await worker.email(
      {
        from: 'jane@customer.example',
        to: 'hello@example.com',
        raw: new Response(RAW).body!,
        rawSize: RAW.length,
        forward: async (to: string) => void forwarded.push(to),
      },
      env,
    );
    expect(forwarded).toEqual(['anthony@example.net']);
    const review = [...kv.data.entries()].filter(([key]) =>
      key.startsWith('review/tofadachi-inbox/'),
    );
    expect(review).toHaveLength(1);
    expect(JSON.parse(review[0]![1]).email.subject).toBe('Do you build websites?');

    const response = await worker.fetch(
      new Request('https://h.example/api/helpers/tofadachi-inbox/review', {
        headers: { authorization: 'Bearer k' },
      }),
      env,
    );
    expect(((await response.json()) as { review: unknown[] }).review).toHaveLength(1);
  });
});
