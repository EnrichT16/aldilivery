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
