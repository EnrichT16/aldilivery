/**
 * A teachable helper: the part every helper shares.
 *
 * How it answers, cheapest first:
 *   1. Exact match with a taught question (or one of its other phrasings).
 *   2. Keyword match, never on one common word alone.
 *   3. The brain, given the taught answers and rules as its only facts.
 *   4. Nobody knows: the question goes on the review list for a person.
 *
 * How it learns: a person approves or corrects what is on the review list, and the approved
 * answer is taught, so the same question is answered at step 1 from then on.
 *
 * What it never does: keep a banned word; keep a card number, password or code; ask for one;
 * send anything public that a person has not approved, unless Anthony has switched that kind of
 * message to "act alone".
 */
import { NoBrain, type Brain } from '../brains/index.js';
import type { Business, HelperConfig, HelpersConfig, Permission } from './config.js';
import { newId } from './ids.js';
import { saidUnknown, systemPrompt } from './prompt.js';
import type { Records } from './records.js';
import {
  containsBanned,
  outgoingProblem,
  redactSensitive,
  withoutBanned,
  type BannedList,
} from './safety.js';
import { matchScore, normalise, shorten } from './text.js';
import type {
  EmailContext,
  HelperSettings,
  KnowledgeEntry,
  LogEntry,
  ReviewItem,
} from './types.js';

/** A taught answer is used when it matches at least this well. */
export const MATCH_THRESHOLD = 0.6;

export class TeachingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeachingRefused';
  }
}

export interface TeachInput {
  kind?: KnowledgeEntry['kind'];
  question?: string;
  alternatives?: string[];
  answer: string;
  by: string;
}

export interface AnswerResult {
  /** Where the answer came from; `none` when nobody knows, `refused` when the message is not kept. */
  source: 'exact' | 'keyword' | 'brain' | 'none' | 'refused';
  text: string | null;
  entry?: KnowledgeEntry;
  score: number;
  /** The message as it may be kept: banned words and private details taken out. */
  cleaned: string | null;
  /** What was taken out, in plain English, if anything. */
  removed: string[];
}

export class TeachableHelper {
  private brainInstance: Brain | null = null;

  constructor(
    readonly config: HelperConfig,
    readonly business: Business,
    readonly whole: HelpersConfig,
    readonly records: Records,
    readonly banned: BannedList,
    private readonly makeBrain: () => Brain,
  ) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  /** The brain, made when first needed. If it cannot be made, the helper still works without. */
  get brain(): Brain {
    if (!this.brainInstance) {
      try {
        this.brainInstance = this.makeBrain();
      } catch (error) {
        void this.log(
          'brain.missing',
          `${this.name} could not start its brain, so it is answering only from what it was taught. ${(error as Error).message}`,
        );
        this.brainInstance = new NoBrain();
      }
    }
    return this.brainInstance;
  }

  can(permission: Permission): boolean {
    return this.config.permissions.includes(permission);
  }

  /** Says, in the log, that something was not allowed; returns false so callers can stop. */
  async allowed(permission: Permission, what: string): Promise<boolean> {
    if (this.can(permission)) return true;
    await this.log(
      'permission.refused',
      `${this.name} did not ${what}, because it is not allowed to (${permission}).`,
    );
    return false;
  }

  log(event: string, text: string, data?: LogEntry['data']): Promise<LogEntry> {
    return this.records.log(this.id, event, text, data);
  }

  // Act alone

  settings(): Promise<HelperSettings> {
    return this.records.settings(this.id, { actAlone: [...(this.config.actAlone ?? [])] });
  }

  async mayActAlone(messageKind: string): Promise<boolean> {
    return (await this.settings()).actAlone.includes(messageKind);
  }

  async setActAlone(messageKind: string, on: boolean, by: string): Promise<HelperSettings> {
    const settings = await this.settings();
    const kinds = new Set(settings.actAlone);
    if (on) kinds.add(messageKind);
    else kinds.delete(messageKind);
    const updated = { ...settings, actAlone: [...kinds].sort() };
    await this.records.saveSettings(this.id, updated);
    await this.log(
      'settings.act-alone',
      on
        ? `${by} let ${this.name} send "${messageKind}" messages without asking first.`
        : `${by} asked ${this.name} to ask first before sending "${messageKind}" messages.`,
    );
    return updated;
  }

  // Teaching

  knowledge(): Promise<KnowledgeEntry[]> {
    return this.records.knowledge(this.id);
  }

  /** Checks something about to be taught. Throws `TeachingRefused` with the reason. */
  private checkTeachable(text: string, what: string): void {
    if (containsBanned(text, this.banned)) {
      throw new TeachingRefused(`The ${what} contains a banned word, so it was not kept.`);
    }
    if (redactSensitive(text).removed.length > 0) {
      throw new TeachingRefused(
        `The ${what} looks like it holds a card number, password, code or bank details, so it was not kept.`,
      );
    }
  }

  async teach(input: TeachInput): Promise<KnowledgeEntry> {
    const kind = input.kind ?? 'answer';
    const answer = input.answer.trim();
    const question = (input.question ?? '').trim();
    const alternatives = (input.alternatives ?? []).map((a) => a.trim()).filter(Boolean);
    if (!answer) throw new TeachingRefused('There is nothing to teach: the answer is empty.');
    if (kind !== 'rule' && !question)
      throw new TeachingRefused('A question is needed as well as the answer.');
    this.checkTeachable(answer, 'answer');
    for (const text of [question, ...alternatives]) this.checkTeachable(text, 'question');
    const problem = outgoingProblem(answer, this.banned);
    if (problem && kind !== 'rule') throw new TeachingRefused(problem);

    const now = this.records.clock().toISOString();
    const existing =
      kind === 'rule'
        ? undefined
        : (await this.knowledge()).find(
            (entry) => entry.kind === kind && normalise(entry.question) === normalise(question),
          );
    const entry: KnowledgeEntry = existing
      ? {
          ...existing,
          answer,
          alternatives: [...new Set([...existing.alternatives, ...alternatives])],
          taughtBy: input.by,
          updatedAt: now,
        }
      : {
          id: newId(),
          helperId: this.id,
          kind,
          question,
          alternatives,
          answer,
          taughtBy: input.by,
          createdAt: now,
          updatedAt: now,
          timesUsed: 0,
        };
    await this.records.saveKnowledge(entry);
    const what =
      kind === 'rule' ? `a rule: "${shorten(answer)}"` : `an answer to "${shorten(question)}"`;
    await this.log(
      'knowledge.taught',
      `${input.by} ${existing ? 'corrected' : 'taught'} ${this.name} ${what}.`,
    );
    return entry;
  }

  async forget(id: string, by: string): Promise<boolean> {
    const entry = await this.records.getKnowledge(this.id, id);
    if (!entry) return false;
    await this.records.deleteKnowledge(this.id, id);
    await this.log(
      'knowledge.forgotten',
      `${by} asked ${this.name} to forget "${shorten(entry.question || entry.answer)}".`,
    );
    return true;
  }

  // Answering

  /** The best taught answer for a message, if one matches well enough. */
  async findTaught(message: string): Promise<{ entry: KnowledgeEntry; score: number } | null> {
    let best: { entry: KnowledgeEntry; score: number } | null = null;
    for (const entry of await this.knowledge()) {
      if (entry.kind !== 'answer') continue;
      for (const phrasing of [entry.question, ...entry.alternatives]) {
        const score = matchScore(message, phrasing);
        if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { entry, score };
      }
    }
    return best;
  }

  /** Makes a message fit to keep: banned words and private details taken out. */
  clean(message: string): { cleaned: string | null; removed: string[] } {
    const { text, removed } = redactSensitive(message);
    const cleaned = withoutBanned(text, this.banned);
    const notes: string[] = [...removed];
    if (cleaned !== text) notes.push('banned words');
    return { cleaned, removed: notes };
  }

  async answer(message: string, purpose: 'email' | 'chat' = 'chat'): Promise<AnswerResult> {
    const { cleaned, removed } = this.clean(message);
    if (cleaned === null)
      return { source: 'refused', text: null, score: 0, cleaned: null, removed };

    const taught = await this.findTaught(cleaned);
    if (taught) {
      const entry = { ...taught.entry, timesUsed: taught.entry.timesUsed + 1 };
      await this.records.saveKnowledge(entry);
      return {
        source: taught.score >= 1 ? 'exact' : 'keyword',
        text: entry.answer,
        entry,
        score: taught.score,
        cleaned,
        removed,
      };
    }

    if (this.brain.thinks) {
      try {
        const reply = await this.brain.think({
          system: systemPrompt({
            helperName: this.name,
            businessName: this.business.name,
            signature: this.business.signature,
            purpose,
            knowledge: await this.knowledge(),
            question: cleaned,
          }),
          messages: [{ role: 'user', content: cleaned }],
          maxTokens: purpose === 'email' ? 700 : 300,
        });
        if (!saidUnknown(reply)) {
          const problem = outgoingProblem(reply, this.banned);
          if (!problem) return { source: 'brain', text: reply, score: 0, cleaned, removed };
          await this.log(
            'brain.blocked',
            `${this.name}'s brain wrote a reply that broke a rule, so it was thrown away. ${problem}`,
          );
        }
      } catch (error) {
        await this.log(
          'brain.failed',
          `${this.name} could not reach its brain (${this.brain.description}): ${(error as Error).message}`,
        );
      }
    }
    return { source: 'none', text: null, score: 0, cleaned, removed };
  }

  // The review list

  reviews(): Promise<ReviewItem[]> {
    return this.records.reviews(this.id);
  }

  async waiting(): Promise<ReviewItem[]> {
    return (await this.reviews())
      .filter((item) => item.status === 'waiting')
      .sort((a, b) => b.timesAsked - a.timesAsked || a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Puts something on the review list. The question must already be clean (see `clean`).
   * A question already waiting is not added twice: it is counted, so the most asked come first.
   */
  async askForReview(input: {
    kind: ReviewItem['kind'];
    messageKind: string;
    question: string;
    suggestedAnswer?: string | null;
    suggestedBy?: ReviewItem['suggestedBy'];
    email?: EmailContext;
    note?: string;
  }): Promise<ReviewItem> {
    const now = this.records.clock().toISOString();
    if (input.kind === 'question') {
      const same = (await this.reviews()).find(
        (item) =>
          item.status === 'waiting' &&
          item.kind === 'question' &&
          normalise(item.question) === normalise(input.question),
      );
      if (same) {
        const counted = { ...same, timesAsked: same.timesAsked + 1, updatedAt: now };
        await this.records.saveReview(counted);
        return counted;
      }
    }
    const item: ReviewItem = {
      id: newId(),
      helperId: this.id,
      kind: input.kind,
      messageKind: input.messageKind,
      status: 'waiting',
      question: input.question,
      suggestedAnswer: input.suggestedAnswer ?? null,
      suggestedBy: input.suggestedBy ?? null,
      finalAnswer: null,
      timesAsked: 1,
      createdAt: now,
      updatedAt: now,
      decidedBy: null,
      outcome: null,
      ...(input.email ? { email: input.email } : {}),
      ...(input.note ? { note: input.note } : {}),
    };
    await this.records.saveReview(item);
    return item;
  }

  /**
   * A person approves (optionally correcting) something on the review list. The approved answer
   * is taught unless `teach` is false, so it is used from then on.
   */
  async approve(
    reviewId: string,
    input: { answer?: string; question?: string; by: string; teach?: boolean },
  ): Promise<{ item: ReviewItem; taught: KnowledgeEntry | null }> {
    const item = await this.records.getReview(this.id, reviewId);
    if (!item) throw new TeachingRefused('That item is not on the review list.');
    if (item.status !== 'waiting') throw new TeachingRefused('That item has already been decided.');
    const answer = (input.answer ?? item.suggestedAnswer ?? '').trim();
    if (!answer) throw new TeachingRefused('Write an answer before approving.');
    const problem = outgoingProblem(answer, this.banned);
    if (problem) throw new TeachingRefused(problem);

    let taught: KnowledgeEntry | null = null;
    if (input.teach !== false) {
      const question = (input.question ?? questionToTeach(item)).trim();
      if (question)
        taught = await this.teach({
          question,
          answer: stripReplyFrame(answer, item, this.business.signature),
          by: input.by,
        });
    }
    const decided: ReviewItem = {
      ...item,
      status: 'approved',
      finalAnswer: answer,
      decidedBy: input.by,
      updatedAt: this.records.clock().toISOString(),
    };
    await this.records.saveReview(decided);
    const corrected = item.suggestedAnswer !== null && item.suggestedAnswer.trim() !== answer;
    await this.log(
      'review.approved',
      `${input.by} ${corrected ? 'corrected and approved' : 'approved'} ${item.kind === 'reply' ? 'a reply to' : 'an answer to'} "${shorten(item.email?.subject || item.question)}".`,
    );
    return { item: decided, taught };
  }

  async reject(reviewId: string, by: string, reason?: string): Promise<ReviewItem> {
    const item = await this.records.getReview(this.id, reviewId);
    if (!item) throw new TeachingRefused('That item is not on the review list.');
    const decided: ReviewItem = {
      ...item,
      status: 'rejected',
      decidedBy: by,
      outcome: reason ? `Turned down: ${reason}` : 'Turned down.',
      updatedAt: this.records.clock().toISOString(),
    };
    await this.records.saveReview(decided);
    await this.log(
      'review.rejected',
      `${by} turned down "${shorten(item.email?.subject || item.question)}".`,
    );
    return decided;
  }

  async recordOutcome(item: ReviewItem, outcome: string): Promise<ReviewItem> {
    const updated = { ...item, outcome, updatedAt: this.records.clock().toISOString() };
    await this.records.saveReview(updated);
    return updated;
  }
}

/** What to teach as "the question" when a reply to an email is approved. */
function questionToTeach(item: ReviewItem): string {
  if (item.kind === 'question' || !item.email) return item.question;
  const subject = item.email.subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim();
  // A real subject ("Delivery times on Sundays") is a good question; "Hello" or "Query" is not.
  if (subject.split(/\s+/).length >= 3) return subject;
  const firstSentence = item.question.split(/(?<=[.?!])\s/)[0] ?? item.question;
  return shorten(firstSentence, 160);
}

/** The heart of an approved email reply, without the greeting and sign-off, to teach. */
export function stripReplyFrame(
  answer: string,
  item: Pick<ReviewItem, 'kind'>,
  signature: string,
): string {
  if (item.kind !== 'reply') return answer;
  const lines = answer.trim().split('\n');
  if (
    lines.length > 1 &&
    /^\s*(dear|hello|hi|good (morning|afternoon|evening))\b[^.?!]*[,!]?\s*$/i.test(lines[0] ?? '')
  ) {
    lines.shift();
  }
  const signOff =
    /^\s*(kind regards|best regards|warm regards|regards|best wishes|best|many thanks|thanks|thank you|yours sincerely|yours faithfully)[,.!]?\s*$/i;
  const lowest = Math.max(1, lines.length - 4);
  for (let index = lines.length - 1; index >= lowest; index -= 1) {
    const line = (lines[index] ?? '').trim();
    if (signOff.test(line) || line === signature.trim()) {
      lines.splice(index);
    }
  }
  const body = lines.join('\n').trim();
  return body.length > 0 ? body : answer;
}
