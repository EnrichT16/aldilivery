/**
 * The Runner agreement's version (ruling 55, 9 October 2026).
 *
 * A Runner agrees to the agreement before their first job, and the date, this version and how
 * they agreed are kept on their account. When the agreement page (`/runner/agreement`) changes
 * in a way that matters, this changes with it, and every Runner is asked to agree again before
 * their next job. The web page and the API both read it from here, so they can never disagree.
 */
// 2026-10-10 (ruling 61, Anthony): every Runner agrees again, because the agreement now sets
// out £7 for an order of £120 or more delivered whole, £5 for each part of a split job, how
// split parts are offered (motorbike first, then foot and bicycle), and the carrying limits.
// 2026-10-25 (Anthony): issued as the final agreement — the draft notice removed, the terms
// numbered, office-sent jobs and the automatic document check described, general terms added.
// 2026-10-30 (Anthony): every Runner agrees again, because the agreement was corrected after an
// audit: 18 or over, vans with cars and motorbikes, the automatic document check, how paying
// back works, the instant payout fee, and that nothing is taken from pay except the cool bag
// deposit and money owed after a written decision; the enhanced DBS and public transport lines
// removed.
export const RUNNER_AGREEMENT_VERSION = '2026-10-30';
