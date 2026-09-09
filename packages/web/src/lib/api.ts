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

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '/api';

export class ApiUnavailableError extends Error {
  constructor() {
    super('We cannot reach Aldilivery at the moment.');
    this.name = 'ApiUnavailableError';
  }
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

  const body = (await response.json().catch(() => ({}))) as
    | T
    | { error?: { message?: string } };

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
