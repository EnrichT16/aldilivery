/**
 * Talking to the Aldilivery API.
 *
 * The shell works without it: every screen has something sensible to show when the server
 * is not running, and says so in plain words rather than spinning forever or showing a
 * stack trace.
 */

import { readToken } from './session';

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
    const token = readToken();
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        // Only sent when there is one. An anonymous browse must stay anonymous.
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
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

/* ------------------------------------------------------------------------------------- *
 * The account
 * ------------------------------------------------------------------------------------- */

export type SubstitutionChoice = 'no_substitutes' | 'similar_item' | 'ask_me';

export interface Shopper {
  id: string;
  displayName: string;
  handle: string;
  phone: string;
  doorstepProtocol: string;
  deliveryAddress: string;
  substitutionDefault: SubstitutionChoice;
  budgetCapPence: number | null;
}

export interface RegisterShopperInput {
  displayName: string;
  phone: string;
  deliveryAddress: string;
  doorstepProtocol?: string;
  substitutionDefault?: SubstitutionChoice;
}

/**
 * Setting up an account. The server answers with a session token as well as the Shopper,
 * which is what keeps somebody signed in afterwards — see `lib/session.ts` for why that is
 * the whole of the sign-in story for now.
 */
export function registerShopper(
  input: RegisterShopperInput,
): Promise<{ shopper: Shopper; token: string }> {
  return request<{ shopper: Shopper; token: string }>('/shoppers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Who the stored token belongs to. Used to restore a session when the app opens. */
export function fetchMe(): Promise<{ role: string; shopper?: Shopper }> {
  return request<{ role: string; shopper?: Shopper }>('/me');
}

/** Changing the account. Used when somebody corrects their address on the way to an order. */
export function updateMe(patch: Partial<RegisterShopperInput>): Promise<{ shopper: Shopper }> {
  return request<{ shopper: Shopper }>('/me', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/* ------------------------------------------------------------------------------------- *
 * What the server will tell anybody
 * ------------------------------------------------------------------------------------- */

export interface PublicPaymentsConfig {
  /** `rehearsal` means no card can be charged, and the screens must say so. */
  mode: 'stripe' | 'rehearsal';
  /** Public by design. Null when nobody has configured one. */
  publishableKey: string | null;
  supportedCardRegions: string[];
}

export function fetchPaymentsConfig(): Promise<PublicPaymentsConfig> {
  return request<{ payments: PublicPaymentsConfig }>('/config').then((body) => body.payments);
}

/* ------------------------------------------------------------------------------------- *
 * Saved cards
 * ------------------------------------------------------------------------------------- */

export interface PaymentMethod {
  id: string;
  lastFour: string;
  brand: string | null;
  isDefault: boolean;
}

/**
 * Rule Ten. Read the arguments: an identifier Stripe gave the browser, and four digits.
 * There is no card number here because no card number ever comes near our server — the
 * details went from the Shopper's browser straight to Stripe.
 */
export function savePaymentMethod(input: {
  stripePaymentMethodId: string;
  lastFour: string;
  brand?: string;
  region?: string;
}): Promise<{ paymentMethod: PaymentMethod; message: string }> {
  return request<{ paymentMethod: PaymentMethod; message: string }>('/payment-methods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listPaymentMethods(): Promise<{ paymentMethods: PaymentMethod[] }> {
  return request<{ paymentMethods: PaymentMethod[] }>('/payment-methods');
}

/* ------------------------------------------------------------------------------------- *
 * Orders
 * ------------------------------------------------------------------------------------- */

export interface PlacedOrder {
  id: string;
  status: string;
  totalEstimatePence: number;
  feePence: number;
  goodsEstimatePence: number;
}

export interface CreateOrderResult {
  order: PlacedOrder;
  payment: {
    id: string;
    status: string;
    clientSecret: string | null;
    requiresAction: boolean;
  };
  message: string;
}

/**
 * Sending the order.
 *
 * `confirmation` is Rule One on the wire. `statement` is the exact sentence the Shopper was
 * shown next to the button, and `agreedTotalPence` is the figure they were shown at that
 * moment. The server prices the basket again from its own catalogue and refuses the order if
 * the total has moved, rather than charging a different amount from the one that was agreed.
 * That refusal arrives as an ordinary error with the new price in the message.
 */
export function createOrder(input: {
  lines: Array<{ catalogueItemId: string; quantity: number }>;
  deliveryAddress: string;
  paymentMethodId: string;
  confirmation: { statement: string; agreedTotalPence: number };
}): Promise<CreateOrderResult> {
  return request<CreateOrderResult>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      lines: input.lines,
      deliveryAddress: input.deliveryAddress,
      paymentMethodId: input.paymentMethodId,
      confirmation: {
        confirmed: true,
        channel: 'button',
        statement: input.confirmation.statement,
        agreedTotalPence: input.confirmation.agreedTotalPence,
      },
    }),
  });
}
