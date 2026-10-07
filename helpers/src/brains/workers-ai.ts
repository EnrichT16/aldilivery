import { BrainError, type Brain, type BrainRequest } from './brain.js';
import type { FetchLike } from '../core/types.js';

/** The part of Cloudflare's `env.AI` binding the helpers use. */
export interface WorkersAIBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function replyText(result: unknown, brain: string): string {
  const body = result as { response?: unknown; result?: { response?: unknown } } | null;
  const text = body?.response ?? body?.result?.response;
  if (typeof text !== 'string') throw new BrainError('Workers AI gave no reply.', brain);
  return text.trim();
}

/**
 * Cloudflare Workers AI: open models with a free daily allowance. Inside a Worker it uses the
 * `AI` binding; anywhere else it calls Cloudflare's REST API with an account ID and an API token
 * from the environment.
 */
export class WorkersAIBrain implements Brain {
  readonly thinks = true;
  readonly description: string;

  constructor(
    private readonly options: {
      model?: string;
      binding?: WorkersAIBinding;
      accountId?: string;
      apiToken?: string;
      fetch?: FetchLike;
    },
  ) {
    this.description = `Cloudflare Workers AI (${this.model})`;
    if (!options.binding && !(options.accountId && options.apiToken)) {
      throw new BrainError(
        'Workers AI needs the AI binding (on Cloudflare) or an account ID and API token (elsewhere).',
        'workers-ai',
      );
    }
  }

  private get model(): string {
    return this.options.model ?? DEFAULT_WORKERS_AI_MODEL;
  }

  async think(request: BrainRequest): Promise<string> {
    const input = {
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      max_tokens: request.maxTokens ?? 600,
    };
    if (this.options.binding) {
      return replyText(await this.options.binding.run(this.model, input), this.description);
    }
    const fetcher = this.options.fetch ?? fetch;
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/ai/run/${this.model}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) {
      throw new BrainError(`Workers AI answered with status ${response.status}.`, this.description);
    }
    return replyText(await response.json(), this.description);
  }
}
