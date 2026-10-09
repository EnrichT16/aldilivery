/**
 * Shopper feedback after a delivery (docs/BUILD_PROMPT.md, Section O; docs/STILL_TO_DO.md
 * item 10).
 *
 * - Any feedback at all earns the delivery credit in `feedback.creditPence`, once per order,
 *   whatever it says. The reward never depends on the feedback being kind.
 * - Shops, and anyone outside, see patterns only: how many raised each theme, and the average
 *   score, and only once there are enough pieces that nobody can be picked out.
 */

import { FEEDBACK_PATTERN_MINIMUM, FEEDBACK_THEMES, type FeedbackTheme } from '@aldilivery/core';

import type { ShopperFeedback } from '../domain.js';

export interface FeedbackPatterns {
  /** How many pieces of feedback the patterns are made from. */
  count: number;
  /** Null when there are too few to show anything. */
  averageRating: number | null;
  /** Each theme, with how many raised it, most raised first. Empty when there are too few. */
  themes: Array<{ theme: FeedbackTheme; words: string; count: number }>;
  /** True when there are too few to show anything without risking pointing at someone. */
  tooFew: boolean;
}

/** Patterns only: counts and an average, never words, never who. */
export function feedbackPatterns(rows: readonly ShopperFeedback[]): FeedbackPatterns {
  if (rows.length < FEEDBACK_PATTERN_MINIMUM) {
    return { count: rows.length, averageRating: null, themes: [], tooFew: true };
  }
  const rated = rows.filter((row) => row.rating !== null);
  const averageRating =
    rated.length >= FEEDBACK_PATTERN_MINIMUM
      ? Math.round((rated.reduce((sum, row) => sum + (row.rating ?? 0), 0) / rated.length) * 10) /
        10
      : null;
  const counts = new Map<FeedbackTheme, number>();
  for (const row of rows) {
    for (const theme of row.themes.split(',').filter(Boolean)) {
      if (theme in FEEDBACK_THEMES) {
        counts.set(theme as FeedbackTheme, (counts.get(theme as FeedbackTheme) ?? 0) + 1);
      }
    }
  }
  const themes = [...counts.entries()]
    .map(([theme, count]) => ({ theme, words: FEEDBACK_THEMES[theme], count }))
    .sort((a, b) => b.count - a.count);
  return { count: rows.length, averageRating, themes, tooFew: false };
}
