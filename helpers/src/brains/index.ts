import { ClaudeBrain } from './anthropic.js';
import { BrainError, NoBrain, type Brain } from './brain.js';
import { OllamaBrain } from './ollama.js';
import { OpenAICompatibleBrain } from './openai-compatible.js';
import { WorkersAIBrain, type WorkersAIBinding } from './workers-ai.js';
import type { Env, FetchLike } from '../core/types.js';

export type BrainConfig =
  | { type: 'none' }
  | { type: 'workers-ai'; model?: string }
  | { type: 'ollama'; model: string; baseUrl?: string; baseUrlEnv?: string }
  | { type: 'openai-compatible'; baseUrl: string; model: string; apiKeyEnv?: string }
  | { type: 'claude'; model?: string; effort?: 'low' | 'medium' | 'high'; apiKeyEnv?: string };

/**
 * Makes the brain a helper's configuration names. Secrets come only from environment settings,
 * named in the configuration (for example `"apiKeyEnv": "ANTHROPIC_API_KEY"`), never written in it.
 */
export function createBrain(
  config: BrainConfig | undefined,
  env: Env,
  extras: { fetch?: FetchLike; workersAI?: WorkersAIBinding } = {},
): Brain {
  const needs = (name: string): string => {
    const value = env[name];
    if (!value)
      throw new BrainError(`The environment setting ${name} is missing.`, config?.type ?? 'none');
    return value;
  };
  switch (config?.type ?? 'none') {
    case 'none':
      return new NoBrain();
    case 'workers-ai': {
      const c = config as Extract<BrainConfig, { type: 'workers-ai' }>;
      return new WorkersAIBrain({
        model: c.model,
        binding: extras.workersAI,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
        fetch: extras.fetch,
      });
    }
    case 'ollama': {
      const c = config as Extract<BrainConfig, { type: 'ollama' }>;
      const headers: Record<string, string> = {};
      if (env.OLLAMA_ACCESS_CLIENT_ID && env.OLLAMA_ACCESS_CLIENT_SECRET) {
        headers['CF-Access-Client-Id'] = env.OLLAMA_ACCESS_CLIENT_ID;
        headers['CF-Access-Client-Secret'] = env.OLLAMA_ACCESS_CLIENT_SECRET;
      }
      return new OllamaBrain({
        model: c.model,
        baseUrl: (c.baseUrlEnv ? env[c.baseUrlEnv] : undefined) ?? c.baseUrl,
        headers,
        fetch: extras.fetch,
      });
    }
    case 'openai-compatible': {
      const c = config as Extract<BrainConfig, { type: 'openai-compatible' }>;
      return new OpenAICompatibleBrain({
        baseUrl: c.baseUrl,
        model: c.model,
        apiKey: c.apiKeyEnv ? needs(c.apiKeyEnv) : undefined,
        fetch: extras.fetch,
      });
    }
    case 'claude': {
      const c = config as Extract<BrainConfig, { type: 'claude' }>;
      return new ClaudeBrain({
        apiKey: needs(c.apiKeyEnv ?? 'ANTHROPIC_API_KEY'),
        model: c.model,
        effort: c.effort,
        fetch: extras.fetch,
      });
    }
    default:
      throw new BrainError(
        `Unknown brain type "${String((config as { type?: unknown }).type)}".`,
        'none',
      );
  }
}

export { BrainError, NoBrain, type Brain } from './brain.js';
