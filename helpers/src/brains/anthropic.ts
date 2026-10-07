import Anthropic from '@anthropic-ai/sdk';

import { BrainError, type Brain, type BrainRequest } from './brain.js';
import type { FetchLike } from '../core/types.js';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/** Models that accept the server side fallback chain (a declined request is retried for us). */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

/**
 * Anthropic's Claude through the API. Optional, and billed per use: see HOSTING.md. The cleverest
 * of the brains, so it is worth it for drafting replies a person then approves.
 */
export class ClaudeBrain implements Brain {
  readonly thinks = true;
  readonly description: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: 'low' | 'medium' | 'high';

  constructor(options: {
    apiKey: string;
    model?: string;
    /** How hard it thinks. `low` is right for short emails and keeps the cost down. */
    effort?: 'low' | 'medium' | 'high';
    fetch?: FetchLike;
  }) {
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.effort = options.effort ?? 'low';
    this.description = `Claude (${this.model})`;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 2,
      ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
    });
  }

  async think(request: BrainRequest): Promise<string> {
    const useFallbacks = FALLBACK_MODELS.has(this.model);
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.model,
        // Room for its thinking as well as the reply; it stops when it is done.
        max_tokens: Math.max(request.maxTokens ?? 0, 8000),
        system: request.system,
        messages: request.messages,
        output_config: { effort: this.effort },
        ...(useFallbacks
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new BrainError(
          'Claude refused the API key. Check ANTHROPIC_API_KEY.',
          this.description,
        );
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new BrainError('Claude is busy or the monthly limit is reached.', this.description);
      }
      if (error instanceof Anthropic.APIError) {
        throw new BrainError(`Claude answered with status ${error.status}.`, this.description);
      }
      throw error;
    }
    if (message.stop_reason === 'refusal') {
      throw new BrainError('Claude declined to write this one.', this.description);
    }
    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new BrainError('Claude gave no reply.', this.description);
    return text;
  }
}
