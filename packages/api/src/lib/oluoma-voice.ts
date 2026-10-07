/**
 * Oluoma Voice, the engine Ozi speaks and hears through (ruling 53, docs/OLUOMA_VOICE.md).
 *
 * The engine's API key belongs to this server and never leaves it. What a browser gets is a
 * session token made from the key: it lasts five minutes and can do nothing but speak and
 * hear. The app asks for one at `GET /voice/session`, and goes straight to the engine with it.
 *
 * Without the two settings (OLUOMA_VOICE_URL, OLUOMA_VOICE_KEY) there is no engine here, and
 * the app uses the phone's own speech, as it always has.
 */

export interface VoiceSessionToken {
  token: string;
  /** When the token stops working, as an ISO date. */
  expiresAt: string;
}

export interface VoiceEngineLink {
  /** Where the engine runs, `https://…`. Public: the browser talks to it directly. */
  readonly url: string;
  /** Swaps the key for a short-lived token. Throws when the engine does not give one. */
  issueToken(ttlSeconds: number): Promise<VoiceSessionToken>;
}

/** How long to wait for the engine before the app goes on with the phone's own speech. */
const WAIT_MS = 5000;

/** The engine gives seconds since 1970; accept milliseconds or a date in words as well. */
function expiryAsIso(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new Error('The voice engine gave a token with no expiry.');
}

export function oluomaVoice(settings: {
  url: string;
  key: string;
  /** For the tests. The real `fetch` otherwise. */
  fetch?: typeof fetch;
}): VoiceEngineLink {
  const url = settings.url.replace(/\/+$/, '');
  const send = settings.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    url,
    async issueToken(ttlSeconds) {
      const response = await send(`${url}/v1/session-tokens`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${settings.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ttl_seconds: ttlSeconds }),
        signal: AbortSignal.timeout(WAIT_MS),
      });
      if (!response.ok) {
        throw new Error(`The voice engine answered ${response.status}.`);
      }
      const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
      if (typeof body.token !== 'string' || body.token === '') {
        throw new Error('The voice engine gave no token.');
      }
      return { token: body.token, expiresAt: expiryAsIso(body.expires_at) };
    },
  };
}
