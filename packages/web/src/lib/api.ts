/**
 * Talking to the Aldilivery API.
 *
 * The shell works without it: every screen has something sensible to show when the server
 * is not running, and says so in plain words rather than spinning forever or showing a
 * stack trace.
 */

export interface CatalogueItem {
  id: string;
  name: string;
  category: string;
  estimatedPricePence: number;
}

export interface CatalogueResult {
  items: CatalogueItem[];
  attribution: string;
  source: string;
}

/**
 * Where the API lives. Baked in at build time from `VITE_API_URL`.
 *
 * On DigitalOcean the web app and the API sit behind one hostname, so this is set to `/api`
 * and no request ever leaves the origin. On a developer's machine, with nothing set, it is
 * the API running locally on port 8080. A trailing slash is trimmed so that `/api/` and
 * `/api` cannot produce two different URLs for the same route.
 */
const LOCAL_API_URL = 'http://localhost:8080';

const BASE_URL = String(
  import.meta.env['VITE_API_URL'] ?? (import.meta.env.DEV ? LOCAL_API_URL : '/api'),
).replace(/\/+$/, '');

export class ApiUnavailableError extends Error {
  /**
   * `reason` is for the console and for us. The message a person sees stays the same plain
   * sentence however the API failed to answer, because "we cannot reach it" is the whole of
   * what a Shopper needs to know.
   */
  constructor(readonly reason = 'no answer') {
    super('We cannot reach Aldilivery at the moment.');
    this.name = 'ApiUnavailableError';
  }
}

/**
 * Did something other than the API answer?
 *
 * When the API is redeploying, or a route is misconfigured, a request to `/api/...` can fall
 * through to whatever serves the rest of the site and come back as the web app's own HTML
 * page, with a perfectly cheerful 200 on it. Parsing that as JSON gives an empty object, and
 * an empty object looks exactly like a shop with nothing in it. A blank catalogue that should
 * have been an error message is the worst of both: nothing works and nothing says why.
 */
function isNotJson(response: Response): boolean {
  const contentType = response.headers?.get?.('content-type');
  // No header at all is not evidence of a problem; the wrong one is.
  return typeof contentType === 'string' && !contentType.includes('json');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiUnavailableError();
  }

  if (isNotJson(response)) {
    throw new ApiUnavailableError('the reply was not JSON');
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A body that will not parse is not an empty body. Saying so is the whole point.
    if (response.ok) throw new ApiUnavailableError('the reply could not be read');
    parsed = {};
  }

  const body = parsed as T | { error?: { message?: string } };

  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } }).error?.message ??
      'Something went wrong. Nothing has been charged.';
    throw new Error(message);
  }

  return body as T;
}

export function searchCatalogue(query: string): Promise<CatalogueResult> {
  return request<CatalogueResult>(`/catalogue/search?q=${encodeURIComponent(query)}`);
}

export interface BasketPrice {
  goodsEstimatePence: number;
  feePence: number;
  totalPence: number;
  explanation: string[];
}

export function priceBasketRemotely(
  lines: Array<{ catalogueItemId: string; quantity: number }>,
): Promise<BasketPrice> {
  return request<BasketPrice>('/basket/price', {
    method: 'POST',
    body: JSON.stringify({ lines }),
  });
}
