/**
 * The Runner agreement's version (ruling 55, 9 October 2026).
 *
 * A Runner agrees to the agreement before their first job, and the date, this version and how
 * they agreed are kept on their account. When the agreement page (`/runner/agreement`) changes
 * in a way that matters, this changes with it, and every Runner is asked to agree again before
 * their next job. The web page and the API both read it from here, so they can never disagree.
 */
export const RUNNER_AGREEMENT_VERSION = '2026-10-09';
