/**
 * Feedback after a delivery (docs/BUILD_PROMPT.md, Section O).
 *
 * The Shopper may pick any of these, give a score, write or say something, or all three. Any of
 * it earns the delivery credit in `feedback.creditPence`, never only praise. Shops are only ever
 * shown how often each theme comes up, never who said what.
 */

export const FEEDBACK_THEMES = {
  on_time: 'It came on time',
  late: 'It came late',
  runner_kind: 'The Runner was kind and helpful',
  runner_rushed: 'The Runner was rushed',
  missing: 'Something was missing',
  damaged: 'Something was damaged',
  swaps_good: 'Questions about swaps were handled well',
  prices: 'The prices',
  easy: 'Ordering was easy',
  hard: 'Ordering was hard',
} as const;

export type FeedbackTheme = keyof typeof FEEDBACK_THEMES;

export function isFeedbackTheme(value: string): value is FeedbackTheme {
  return Object.prototype.hasOwnProperty.call(FEEDBACK_THEMES, value);
}

/**
 * The fewest pieces of feedback before any pattern is shown at all, so that nothing can be
 * traced back to one person (the same floor as the business analysis, ruling 42).
 */
export const FEEDBACK_PATTERN_MINIMUM = 10;
