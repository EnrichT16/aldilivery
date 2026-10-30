/**
 * Errors that carry an HTTP status and a message written for a person.
 *
 * Every message in this file is meant to be read aloud without embarrassment. Our users
 * include people who cannot see the screen and people who find dense text hard, so an error
 * says what happened and what to do next, in short sentences, with no codes and no jargon.
 */

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toResponse(): { error: { code: string; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'bad_request', message, details);
  }
}

export class UnauthorisedError extends ApiError {
  constructor(message = 'You need to sign in again before doing that.') {
    super(401, 'unauthorised', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'That is not yours to change.') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(what: string) {
    super(404, 'not_found', `We could not find that ${what}.`);
  }
}

/** Too many codes asked for. Says to wait, because waiting is the whole of the fix. */
export class TooManyRequestsError extends ApiError {
  constructor(message: string) {
    super(429, 'too_many_requests', message);
  }
}

/**
 * Something this server depends on is not set up or not answering. Not the person's fault.
 *
 * It answers 424, not 503: DigitalOcean's edge treats a 503 from the app as the app being
 * down and replaces the whole reply with its own HTML page (a 504, `x-do-orig-status: 503`),
 * so the browser never saw the sentence and said "we cannot reach" instead. Found on
 * 16 October 2026, after two weeks of a sign-in text that "could not reach" the server.
 */
export class UnavailableError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(424, 'unavailable', message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'conflict', message, details);
  }
}

/** Rule One. Raised whenever payment is attempted without a confirmation on record. */
export class ConfirmationRequiredError extends ApiError {
  constructor() {
    super(
      409,
      'confirmation_required',
      'Nothing has been charged. We need you to confirm this order before we take any payment.',
    );
  }
}

/** Rule Six. Raised when an age restricted item reaches a basket. */
export class AgeRestrictedItemError extends ApiError {
  constructor(itemNames: string[]) {
    super(
      422,
      'age_restricted_item',
      itemNames.length === 1
        ? `We cannot deliver ${itemNames[0]} yet. Age restricted items are not available.`
        : `We cannot deliver these yet: ${itemNames.join(', ')}. Age restricted items are not available.`,
      { itemNames },
    );
  }
}

/**
 * Raised when the payment gateway refuses, so the Shopper is told plainly rather than being
 * shown a bare five hundred.
 *
 * The reason Stripe gave is deliberately not in the message. "Your card was declined" is
 * sometimes true and sometimes wrong — the same refusal covers an expired card, a bank's
 * fraud check, and a misconfiguration at our end — and guessing which, out loud, at the
 * moment somebody is trying to buy food, is worse than saying plainly that it did not work.
 * The real reason goes to the log, where somebody can act on it.
 */
export class PaymentFailedError extends ApiError {
  constructor() {
    super(
      402,
      'payment_failed',
      'Your payment did not go through, so your order has not been sent. Nothing has been charged. Your basket is still here, so you can try again.',
    );
  }
}

/** Raised when a basket is larger than the largest fee band can price without breaking Rule Three. */
export class BasketTooLargeError extends ApiError {
  /**
   * Over the most one order carries, the Shopper may keep everything as linked orders (ruling
   * 61); over the most one basket holds (`basket`), they must take something out.
   */
  constructor(goodsPence: number, maximumPence: number, basket = false) {
    super(
      422,
      'basket_too_large',
      basket
        ? `This comes to £${(goodsPence / 100).toFixed(2)} of shopping, and one basket holds up to £${(maximumPence / 100).toFixed(2)}, brought by several Runners. Please take something out.`
        : `This comes to £${(goodsPence / 100).toFixed(2)} of shopping, and one order carries up to £${(maximumPence / 100).toFixed(2)}. You can take something out, or keep everything and a second Runner brings the rest.`,
      { goodsPence, maximumPence },
    );
  }
}

/**
 * A restaurant basket below the smallest restaurant order (Anthony, 30 October 2026). It cannot
 * be sent; the words come from `restaurantMinimumWords` in core, every figure from config.
 */
export class RestaurantMinimumError extends ApiError {
  constructor(message: string, goodsPence: number, minimumPence: number) {
    super(422, 'restaurant_minimum', message, { goodsPence, minimumPence });
  }
}

/**
 * Restaurant dishes with other shopping, or dishes from two restaurants, in one basket (Anthony,
 * 30 October 2026): each restaurant order goes on its own. The words are `RESTAURANT_MIXED_WORDS`.
 */
export class RestaurantMixedError extends ApiError {
  constructor(message: string) {
    super(422, 'restaurant_mixed', message);
  }
}

/** One product dearer than any one product may be (ruling 58: no single product over £60). */
export class ProductTooDearError extends ApiError {
  constructor(names: string[], maximumPence: number) {
    super(
      422,
      'product_too_dear',
      `We can't bring ${names.join(' or ')}: no single product can cost more than £${(maximumPence / 100).toFixed(2)}. Please choose something else.`,
      { names, maximumPence },
    );
  }
}
