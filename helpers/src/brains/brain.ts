/**
 * A brain reads and writes. Every helper can have a different one, and swapping is one line in
 * the configuration. The engine never depends on which: it asks, and treats the answer as a
 * suggestion that passes the same safety checks as anything else.
 */
export interface BrainRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** A ceiling on the length of the reply, in tokens (about three quarters of a word each). */
  maxTokens?: number;
}

export interface Brain {
  /** Plain English, for logs: "Cloudflare Workers AI (llama-3.1-8b-instruct)". */
  readonly description: string;
  /** False for "no brain": answers come only from what was taught. */
  readonly thinks: boolean;
  think(request: BrainRequest): Promise<string>;
}

export class BrainError extends Error {
  constructor(
    message: string,
    readonly brain: string,
  ) {
    super(message);
    this.name = 'BrainError';
  }
}

/** Answers only from taught answers and keyword matching. Costs nothing. */
export class NoBrain implements Brain {
  readonly description = 'no brain (taught answers only)';
  readonly thinks = false;

  async think(): Promise<string> {
    throw new BrainError(
      'This helper has no brain; it answers only from what it was taught.',
      'none',
    );
  }
}
