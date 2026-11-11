/**
 * The six helpers still to build, in order, after the Inbox helper, the Watchman and the
 * Briefing. Each will be a `TeachableHelper` like the others: same teaching, review list, log,
 * permissions and "act alone" switches. The full plan is in docs/AGENTS_PROPOSAL.md.
 */
export interface PlannedHelper {
  type: string;
  name: string;
  does: string;
  needsFromAnthony: string;
  permissions: string[];
  messageKinds: string[];
}

export const PLANNED_HELPERS: PlannedHelper[] = [
  {
    type: 'social-poster',
    name: 'Social media poster',
    does: 'Drafts posts and video captions for Facebook, Instagram, TikTok, YouTube, X and LinkedIn; a person approves; it posts on a schedule.',
    needsFromAnthony:
      "A business account on each platform, and each platform's developer approval for posting by software.",
    permissions: ['draft-posts', 'publish-posts'],
    messageKinds: ['scheduled-post'],
  },
  {
    type: 'community-manager',
    name: 'Community manager',
    does: 'Answers comments and messages on Telegram, WhatsApp and Facebook from what it was taught, hands hard ones to a person, and runs approved quizzes, polls and free prize draws.',
    needsFromAnthony:
      'A Telegram bot (minutes to set up), WhatsApp Business through Meta, and a Facebook page.',
    permissions: ['read-messages', 'draft-replies', 'send-messages'],
    messageKinds: ['taught-message-reply', 'poll', 'quiz'],
  },
  {
    type: 'reviews',
    name: 'Reviews helper',
    does: "After a delivery or visit, asks for a review; publishes good ones only with the person's permission; sends complaints to customer care.",
    needsFromAnthony:
      'Where reviews are collected (Google Business Profile, Trustpilot, or the website).',
    permissions: ['request-reviews', 'publish-reviews'],
    messageKinds: ['review-request'],
  },
  {
    type: 'outreach',
    name: 'Outreach helper',
    does: 'Finds local shops and organisations (care homes, councils, charities) and drafts a personal invitation for the partnerships staff to send.',
    needsFromAnthony:
      'The areas and kinds of organisation to look for, and who sends the invitations.',
    permissions: ['research', 'draft-replies'],
    messageKinds: ['invitation'],
  },
  {
    type: 'website-caretaker',
    name: 'Website caretaker',
    does: 'Checks a website daily for broken links, spelling, speed and out of date pages; suggests fixes; changes things only with approval, through a pull request or a WordPress editor account.',
    needsFromAnthony:
      'Which websites, and an editor account or GitHub access for each (never full hosting passwords).',
    permissions: ['check-websites', 'propose-changes'],
    messageKinds: ['website-change'],
  },
  {
    type: 'learning',
    name: 'Learning helper',
    does: "Suggests answers for the questions on the delivery app's Learning list, for staff to approve.",
    needsFromAnthony: "An admin key for the delivery app's Learning list.",
    permissions: ['read-learning-list', 'suggest-answers'],
    messageKinds: [],
  },
];
