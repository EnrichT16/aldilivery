import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

import { forgetCardEntry } from '../src/lib/stripe';

/**
 * How long `waitFor` and `findBy` keep trying. The default is one second, which is fine on
 * a developer's machine and marginal on a build container: the screens here wait on the
 * session being restored and on the payment methods arriving before they settle. Waiting
 * longer costs nothing when the assertion passes, because these return as soon as it does.
 */
configure({ asyncUtilTimeout: 8_000 });

/**
 * jsdom has no document language by default, and no layout engine. The language is set here
 * because the real `index.html` sets it and every screen is judged against WCAG with it in
 * place. The missing layout engine is the reason axe reports colour contrast as
 * "incomplete" rather than passing in these tests; contrast is checked separately, by hand,
 * against the two brand colours.
 */
beforeEach(() => {
  document.documentElement.lang = 'en-GB';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  // Stripe.js is loaded once per page and memoised. Tests must not inherit each other's.
  forgetCardEntry();
});

/** A small catalogue, so the shopping page has something to draw. */
export const FAKE_CATALOGUE = {
  items: [
    {
      id: 'item-milk',
      name: 'Semi skimmed milk, 2 pints',
      category: 'Dairy',
      estimatedPricePence: 125,
    },
    {
      id: 'item-bread',
      name: 'White sliced bread, 800g',
      category: 'Bakery',
      estimatedPricePence: 89,
    },
  ],
  attribution: 'Prices are estimates. You pay what the till says.',
  source: 'community',
};

export const FAKE_SHOPPER = {
  id: 'shopper-1',
  displayName: 'Ada',
  handle: 'ada',
  phone: '07700 900000',
  doorstepProtocol: 'Knock loudly, I am slow to the door.',
  deliveryAddress: '12 Made Up Street, Leeds, LS1 1AA',
  substitutionDefault: 'ask_me' as const,
  budgetCapPence: null,
};

export const FAKE_CARD = {
  id: 'pm-row-1',
  lastFour: '4242',
  brand: 'visa',
  isDefault: true,
};

export interface RecordedRequest {
  path: string;
  method: string;
  body: unknown;
}

export interface ApiStubOptions {
  /** Present means signed in: a token is stored and `/me` answers with this Shopper. */
  shopper?: typeof FAKE_SHOPPER | undefined;
  paymentMethods?: Array<typeof FAKE_CARD>;
  /** `rehearsal` keeps the card screen from ever reaching for Stripe.js. */
  paymentsMode?: 'stripe' | 'rehearsal';
  publishableKey?: string | null;
  /** An error the API should return for `POST /orders`, as the API would phrase it. */
  orderError?: string;
  /** Stripe asked for the bank's approval rather than settling straight away. */
  orderRequiresAction?: boolean;
}

/**
 * The API, answered by path.
 *
 * The previous version of this helper answered every request with the catalogue, which was
 * fine while only one screen called the server. Now that signing up, saving a card and
 * sending an order all talk to it, a stub that cannot tell `/me` from `/config` would have
 * every screen quietly reading the wrong shape. So this routes on the path, and returns the
 * recorded requests so a test can assert on what was actually sent — which for the order is
 * the point of the exercise, because Rule One is about what goes on the wire.
 */
export function stubApi(options: ApiStubOptions = {}): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];

  /**
   * Signed in, or signed out — never "whatever the last test left behind".
   *
   * This used to only ever write the token, so a test asking for nobody signed in inherited
   * one from the test before it and reached the signed-out state only because `/me` answered
   * 401 and the client cleared it. That worked by accident and stopped working on a slower
   * machine, where one test's request was still in flight when the next one replaced the
   * stub. Setting both states explicitly makes the order of tests stop mattering.
   */
  if (options.shopper) {
    window.localStorage.setItem('aldilivery.session.token', 'test-token');
  } else {
    window.localStorage.removeItem('aldilivery.session.token');
  }

  const reply = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      json: async () => Promise.resolve(body),
    }) as unknown as Response;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      /**
       * The path, with wherever the client was pointed taken off the front.
       *
       * The client's base address is baked in at build time from `VITE_API_URL`, and that
       * variable is set on the deployment: to `/api`, because there the web app and the API
       * share a hostname. Vitest reads `import.meta.env` from the same place, so on the build
       * machine every request arrived here as `/api/me` rather than `/me`, matched nothing,
       * and fell through to the 404 below. The client then treated a 404 on `/me` as a
       * refused session and signed itself out, and fourteen tests failed for a reason that
       * had nothing to do with any of them.
       *
       * Taking both the origin and the `/api` prefix off makes these tests say the same thing
       * whatever the client is pointed at, which is the only property that matters here: they
       * are about what is sent, not about where it is sent.
       */
      const path = String(url)
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api(?=\/|$)/, '');
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      recorded.push({ path, method, body });

      if (path.startsWith('/catalogue/search')) return reply(FAKE_CATALOGUE);

      if (path.startsWith('/config')) {
        return reply({
          payments: {
            mode: options.paymentsMode ?? 'rehearsal',
            publishableKey: options.publishableKey ?? null,
            supportedCardRegions: ['GB'],
          },
        });
      }

      if (path === '/me' && method === 'GET') {
        return options.shopper
          ? reply({ role: 'shopper', shopper: options.shopper })
          : reply({ error: { message: 'You are not signed in.' } }, 401);
      }

      if (path === '/me' && method === 'PATCH') {
        const patch = (body ?? {}) as Record<string, unknown>;
        return reply({ shopper: { ...FAKE_SHOPPER, ...patch } });
      }

      if (path === '/shoppers') {
        return reply({ shopper: FAKE_SHOPPER, token: 'new-token' }, 201);
      }

      if (path === '/payment-methods' && method === 'GET') {
        return reply({ paymentMethods: options.paymentMethods ?? [] });
      }

      if (path === '/payment-methods' && method === 'POST') {
        return reply({ paymentMethod: FAKE_CARD, message: 'Saved. The card ending 4242.' }, 201);
      }

      if (path === '/orders' && method === 'POST') {
        if (options.orderError) {
          return reply({ error: { message: options.orderError } }, 400);
        }
        const requiresAction = options.orderRequiresAction ?? false;
        return reply(
          {
            order: {
              id: 'order-1',
              status: requiresAction ? 'confirmed' : 'paid',
              goodsEstimatePence: 214,
              feePence: 800,
              totalEstimatePence: 1014,
            },
            payment: {
              id: 'pi_1',
              status: requiresAction ? 'requires_action' : 'succeeded',
              clientSecret: 'pi_1_secret',
              requiresAction,
            },
            message: requiresAction
              ? 'Your bank wants to check it is really you. Nothing has been taken yet.'
              : 'Thank you. Your order is on its way to a Runner. We have taken £10.14.',
          },
          201,
        );
      }

      return reply({ error: { message: `Nothing stubbed for ${method} ${path}` } }, 404);
    }),
  );

  return recorded;
}

/** Kept for the screens that only ever read the catalogue. */
export function stubCatalogueFetch(): void {
  stubApi();
}
