/**
 * The shapes every part of the engine shares. Nothing in here touches a platform: no files, no
 * Cloudflare, no network. Those live behind the small adapters in `storage/`, `brains/`,
 * `senders/` and `platform/`.
 */

/** What time it is. Passed in, so tests can stand still in time. */
export type Clock = () => Date;

/** The web standard `fetch`, passed in so tests never touch the network. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Environment settings: where every secret comes from, and nowhere else. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Something a helper has been taught. */
export interface KnowledgeEntry {
  id: string;
  helperId: string;
  /**
   * `answer`: a question and its approved answer, used word for word.
   * `rule`: something the helper must always (or never) do; given to the brain.
   * `example`: a sample question and reply showing the tone; given to the brain.
   */
  kind: 'answer' | 'rule' | 'example';
  question: string;
  /** Other ways people ask the same thing. */
  alternatives: string[];
  answer: string;
  taughtBy: string;
  createdAt: string;
  updatedAt: string;
  timesUsed: number;
}

export type ReviewStatus = 'waiting' | 'approved' | 'rejected';

/** Something waiting for a person: a question nobody taught, or a reply drafted for approval. */
export interface ReviewItem {
  id: string;
  helperId: string;
  /** `question`: teach me an answer. `reply`: approve this message before it goes out. */
  kind: 'question' | 'reply';
  /** The kind of message, used for "act alone" (for example `taught-reply`). */
  messageKind: string;
  status: ReviewStatus;
  question: string;
  suggestedAnswer: string | null;
  suggestedBy: 'taught' | 'brain' | null;
  finalAnswer: string | null;
  timesAsked: number;
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  /** Plain English: what happened when it was approved, for example "Sent to the customer". */
  outcome: string | null;
  email?: EmailContext;
  note?: string;
}

export interface EmailContext {
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  category: string;
  urgent: boolean;
}

/** One line in the plain English log. */
export interface LogEntry {
  id: string;
  at: string;
  helperId: string;
  /** A short code for counting, for example `email.received`. */
  event: string;
  /** What happened, in a sentence a person would say. */
  text: string;
  data?: Record<string, string | number | boolean | null>;
}

/** Settings Anthony changes while a helper runs, kept in storage. */
export interface HelperSettings {
  /** Kinds of message this helper may send without asking first. */
  actAlone: string[];
}
