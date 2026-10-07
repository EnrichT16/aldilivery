/**
 * A pass to Oluoma Voice for the app (ruling 53).
 *
 * Anybody may ask, signed in or not, because Ozi speaks from the very first screen. What they
 * get is a token that lasts five minutes, never the engine's key. When the engine is not set
 * up, or does not answer, the reply is `{ enabled: false }` and the app carries on with the
 * phone's own speech: a voice that is not there must never stop anybody shopping.
 *
 * How often one internet address may ask is limited in lib/guard.ts.
 */

import type { FastifyInstance } from 'fastify';

/** Five minutes: the engine's own default, and long enough for the app to fetch the next one. */
export const VOICE_TOKEN_SECONDS = 300;

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/voice/session', async (request) => {
    if (!ctx.voice) return { enabled: false };
    try {
      const { token, expiresAt } = await ctx.voice.issueToken(VOICE_TOKEN_SECONDS);
      return { enabled: true, url: ctx.voice.url, token, expiresAt };
    } catch (error) {
      request.log.warn({ err: error }, 'Oluoma Voice gave no token; the phone speaks instead');
      return { enabled: false };
    }
  });
}
