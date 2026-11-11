import { matchScore } from './text.js';
import type { KnowledgeEntry } from './types.js';

/** What the brain is told, every time. Short, so small free models follow it. */
export function systemPrompt(options: {
  helperName: string;
  businessName: string;
  signature: string;
  purpose: 'email' | 'chat';
  knowledge: KnowledgeEntry[];
  question: string;
}): string {
  const rules = options.knowledge.filter((entry) => entry.kind === 'rule');
  const answers = options.knowledge
    .filter((entry) => entry.kind === 'answer')
    .map((entry) => ({
      entry,
      score: Math.max(
        ...[entry.question, ...entry.alternatives].map((q) => matchScore(options.question, q)),
      ),
    }))
    .sort((a, b) => b.score - a.score || b.entry.timesUsed - a.entry.timesUsed)
    .slice(0, 8)
    .map(({ entry }) => entry);
  const examples = options.knowledge.filter((entry) => entry.kind === 'example').slice(0, 3);

  const lines = [
    `You are ${options.helperName}, a helper for ${options.businessName}.`,
    'Write in plain, kind, British English, in short sentences. No lists, no headings, no emojis.',
    'Use only the facts below. Never invent prices, dates, promises or policies.',
    'If the facts below do not answer the message, reply with the single word UNKNOWN.',
    'Never ask anybody for a card number, password, code or bank details.',
  ];
  if (options.purpose === 'email') {
    lines.push(
      `Write only the body of a reply email. Start with a greeting and end with "${options.signature}".`,
    );
  } else {
    lines.push('Answer in two or three sentences at most.');
  }
  if (rules.length > 0) {
    lines.push('', 'Rules you always keep:', ...rules.map((rule) => `- ${rule.answer}`));
  }
  if (answers.length > 0) {
    lines.push(
      '',
      'Facts (approved answers):',
      ...answers.map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`),
    );
  }
  if (examples.length > 0) {
    lines.push(
      '',
      'Examples of the right tone:',
      ...examples.map((entry) => `Message: ${entry.question}\nReply: ${entry.answer}`),
    );
  }
  return lines.join('\n');
}

/** Whether the brain said it does not know. */
export function saidUnknown(reply: string): boolean {
  const flat = reply.trim().replace(/[."']/g, '').toUpperCase();
  return flat === 'UNKNOWN' || flat.startsWith('UNKNOWN') || flat.length === 0;
}
