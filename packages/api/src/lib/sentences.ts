/**
 * Sentences for speaking as they arrive (ruling 92, 3 November 2026): a reply streamed from the
 * model is spoken one sentence at a time, the first as soon as it is complete, so nobody waits
 * for the whole answer. The split is on a full stop, a question mark or an exclamation mark
 * followed by a space, never after "Mr." or another short title, so "Mr. Anthony" stays whole.
 *
 * Also the reply inside the JSON everyone's model answers with: read progressively out of the
 * partial JSON text, so the spoken "reply" can start before the shape is complete. Only the
 * words are read early; the shopping in "items" is never acted on until the JSON is whole.
 */

/** A short title or abbreviation a full stop does not end a sentence after. */
const NOT_AN_END = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs|No|e\.g|i\.e)\.$/i;

/**
 * The complete sentences at the front of `text`, and the rest, which may still be growing.
 * "Hello there. How are" gives ["Hello there."] and "How are".
 */
export function splitSentences(text: string): { complete: string[]; rest: string } {
  const complete: string[] = [];
  let rest = text;
  const boundary = /[.!?…]+["'”’)\]]?\s+/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const candidate = text.slice(from, end).trim();
    // Decimal points and short titles ("Mr. Anthony", "£5.99 each") do not end a sentence.
    const head = text.slice(from, match.index + match[0].trimEnd().length);
    if (NOT_AN_END.test(head.trimEnd())) continue;
    if (candidate !== '') complete.push(candidate);
    from = end;
    rest = text.slice(from);
  }
  if (complete.length === 0) rest = text;
  return { complete, rest };
}

/**
 * Collects streamed text and gives back each sentence once, as it completes. `push` is called
 * with each delta; `flush` gives whatever is left at the end as a last sentence.
 */
export class SentenceSplitter {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += delta;
    const { complete, rest } = splitSentences(this.buffer);
    this.buffer = rest;
    return complete;
  }

  flush(): string[] {
    const last = this.buffer.replace(/\s+/g, ' ').trim();
    this.buffer = '';
    return last === '' ? [] : [last];
  }
}

export interface ReplySoFar {
  /** The "kind" field, once it has arrived. */
  kind: string | null;
  /** The "reply" string decoded so far, or null when it is JSON null or not yet begun. */
  reply: string | null;
  /** True once the closing quote of "reply" has arrived. */
  replyClosed: boolean;
}

/**
 * The "kind" and "reply" fields read out of a JSON object that may still be arriving. The
 * reply is decoded character by character, escapes included, up to where the text stops; an
 * escape cut in half is left for the next delta.
 */
export function replySoFar(partialJson: string): ReplySoFar {
  const kind = /"kind"\s*:\s*"([a-z]+)"/.exec(partialJson)?.[1] ?? null;
  const at = /"reply"\s*:\s*/.exec(partialJson);
  if (!at) return { kind, reply: null, replyClosed: false };
  let i = at.index + at[0].length;
  if (i >= partialJson.length) return { kind, reply: null, replyClosed: false };
  if (partialJson[i] !== '"') return { kind, reply: null, replyClosed: false };
  i += 1;
  let out = '';
  while (i < partialJson.length) {
    const ch = partialJson[i]!;
    if (ch === '"') return { kind, reply: out, replyClosed: true };
    if (ch === '\\') {
      const next = partialJson[i + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = partialJson.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out +=
        next === 'n'
          ? '\n'
          : next === 't'
            ? '\t'
            : next === 'r'
              ? '\r'
              : next === 'b' || next === 'f'
                ? ' '
                : next;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { kind, reply: out, replyClosed: false };
}

/**
 * The part of a final reply not yet spoken, given the sentences already sent: '' when the
 * reply was all sent; the whole reply when nothing was, or when the reply turned out
 * different from what was sent (a safe line in place of a refusal, for instance).
 */
export function unsaidPart(reply: string, sent: string[]): string {
  const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const whole = tidy(reply);
  const said = tidy(sent.join(' '));
  if (said === '') return whole;
  if (whole === said) return '';
  if (whole.startsWith(said)) return whole.slice(said.length).trim();
  return whole;
}
