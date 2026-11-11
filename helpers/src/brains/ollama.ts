import { BrainError, type Brain, type BrainRequest } from './brain.js';
import type { FetchLike } from '../core/types.js';

/**
 * Ollama on a home computer or Mac mini: free, private, and nothing leaves the house. The
 * computer must be on. From Cloudflare, reach it through a Cloudflare Tunnel.
 */
export class OllamaBrain implements Brain {
  readonly thinks = true;
  readonly description: string;

  constructor(
    private readonly options: {
      model: string;
      baseUrl?: string;
      /** Extra headers, for example a Cloudflare Access service token in front of a tunnel. */
      headers?: Record<string, string>;
      fetch?: FetchLike;
    },
  ) {
    this.description = `Ollama (${options.model})`;
  }

  async think(request: BrainRequest): Promise<string> {
    const base = (this.options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.options.headers },
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        options: { num_predict: request.maxTokens ?? 600 },
      }),
    });
    if (!response.ok) {
      throw new BrainError(`Ollama answered with status ${response.status}.`, this.description);
    }
    const body = (await response.json()) as { message?: { content?: unknown } };
    if (typeof body.message?.content !== 'string') {
      throw new BrainError('Ollama gave no reply.', this.description);
    }
    return body.message.content.trim();
  }
}
