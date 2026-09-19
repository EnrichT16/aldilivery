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
  constructor(goodsPence: number, maximumPence: number) {
    super(
      422,
      'basket_too_large',
      `This shop comes to more than we can take in one order. Please split it into two orders.`,
      { goodsPence, maximumPence },
    );
  }
}
