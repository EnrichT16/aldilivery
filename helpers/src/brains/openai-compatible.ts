import { BrainError, type Brain, type BrainRequest } from './brain.js';
import type { FetchLike } from '../core/types.js';

/**
 * Any service that speaks the common "chat completions" format: for example Groq, Together,
 * OpenRouter, DeepSeek, Mistral, LM Studio on a home computer, or OpenAI itself.
 */
export class OpenAICompatibleBrain implements Brain {
  readonly thinks = true;
  readonly description: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      fetch?: FetchLike;
    },
  ) {
    this.description = `${new URL(options.baseUrl).host} (${options.model})`;
  }

  async think(request: BrainRequest): Promise<string> {
    const fetcher = this.options.fetch ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    const response = await fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: request.maxTokens ?? 600,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
      }),
    });
    if (!response.ok) {
      throw new BrainError(
        `The service answered with status ${response.status}.`,
        this.description,
      );
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string')
      throw new BrainError('The service gave no reply.', this.description);
    return text.trim();
  }
}
