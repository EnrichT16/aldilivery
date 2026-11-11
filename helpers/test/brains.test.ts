import { describe, expect, it } from 'vitest';

import { ClaudeBrain } from '../src/brains/anthropic.js';
import { BrainError, NoBrain, createBrain } from '../src/brains/index.js';
import { OllamaBrain } from '../src/brains/ollama.js';
import { OpenAICompatibleBrain } from '../src/brains/openai-compatible.js';
import { WorkersAIBrain } from '../src/brains/workers-ai.js';
import type { FetchLike } from '../src/core/types.js';

const request = { system: 'Be kind.', messages: [{ role: 'user' as const, content: 'Hello?' }] };

function recorder(reply: unknown, status = 200) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetcher: FetchLike = async (input, init = {}) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = input instanceof Request ? input.headers : new Headers(init.headers);
    const raw = input instanceof Request ? await input.text() : (init.body as string);
    calls.push({ url, init: { ...init, headers }, body: raw ? JSON.parse(raw) : null });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetcher };
}

describe('brains', () => {
  it('no brain never thinks', async () => {
    const brain = new NoBrain();
    expect(brain.thinks).toBe(false);
    await expect(brain.think()).rejects.toThrow(BrainError);
  });

  it('Workers AI through the binding', async () => {
    const seen: unknown[] = [];
    const brain = new WorkersAIBrain({
      binding: { run: async (model, input) => (seen.push([model, input]), { response: ' Hi. ' }) },
    });
    expect(await brain.think(request)).toBe('Hi.');
    expect(seen[0]).toEqual([
      '@cf/meta/llama-3.1-8b-instruct',
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'Be kind.' },
          { role: 'user', content: 'Hello?' },
        ],
      }),
    ]);
  });

  it('Workers AI through the REST API', async () => {
    const { calls, fetcher } = recorder({ result: { response: 'Hi.' } });
    const brain = new WorkersAIBrain({ accountId: 'acc', apiToken: 'tok', fetch: fetcher });
    expect(await brain.think(request)).toBe('Hi.');
    expect(calls[0]!.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/meta/llama-3.1-8b-instruct',
    );
    expect((calls[0]!.init.headers as Headers).get('authorization')).toBe('Bearer tok');
  });

  it('Ollama', async () => {
    const { calls, fetcher } = recorder({ message: { content: 'Hi.' } });
    const brain = new OllamaBrain({ model: 'llama3.2', fetch: fetcher });
    expect(await brain.think(request)).toBe('Hi.');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
    expect(calls[0]!.body).toMatchObject({ model: 'llama3.2', stream: false });
  });

  it('any OpenAI-compatible service', async () => {
    const { calls, fetcher } = recorder({ choices: [{ message: { content: 'Hi.' } }] });
    const brain = new OpenAICompatibleBrain({
      baseUrl: 'https://api.groq.example/openai/v1/',
      model: 'm',
      apiKey: 'k',
      fetch: fetcher,
    });
    expect(await brain.think(request)).toBe('Hi.');
    expect(calls[0]!.url).toBe('https://api.groq.example/openai/v1/chat/completions');
    expect((calls[0]!.init.headers as Headers).get('authorization')).toBe('Bearer k');
  });

  it('reports a failing service plainly', async () => {
    const { fetcher } = recorder({}, 503);
    await expect(new OllamaBrain({ model: 'x', fetch: fetcher }).think(request)).rejects.toThrow(
      /status 503/,
    );
  });

  it('Claude through the API', async () => {
    const { calls, fetcher } = recorder({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Hello there.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 3 },
    });
    const brain = new ClaudeBrain({ apiKey: 'test-key', fetch: fetcher });
    expect(await brain.think(request)).toBe('Hello there.');
    expect(calls[0]!.url).toContain('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'Be kind.',
      output_config: { effort: 'low' },
      fallbacks: 'default',
    });
    expect((calls[0]!.init.headers as Headers).get('x-api-key')).toBe('test-key');
  });

  it('Claude declining is a brain error, not an answer', async () => {
    const { fetcher } = recorder({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(new ClaudeBrain({ apiKey: 'k', fetch: fetcher }).think(request)).rejects.toThrow(
      /declined/,
    );
  });

  it('are made from configuration, with secrets only from the environment', () => {
    expect(createBrain(undefined, {}).thinks).toBe(false);
    expect(createBrain({ type: 'ollama', model: 'llama3.2' }, {}).description).toBe(
      'Ollama (llama3.2)',
    );
    expect(() => createBrain({ type: 'claude' }, {})).toThrow(/ANTHROPIC_API_KEY is missing/);
    expect(createBrain({ type: 'claude' }, { ANTHROPIC_API_KEY: 'k' }).description).toBe(
      'Claude (claude-opus-5-5)',
    );
    expect(() => createBrain({ type: 'workers-ai' }, {})).toThrow(/binding/);
  });
});
