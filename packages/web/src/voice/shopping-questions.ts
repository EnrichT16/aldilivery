import type { MyOrder } from '../lib/api';
import { money } from '../lib/money';
import type { BasketLine } from '../state/basket';

/**
 * Questions about the shopping, answered by Ozi (Anthony, 6 October 2026: "if someone asks how
 * much milk is in the basket, it should be able to answer"). Everything Ozi answers is about
 * its purpose: the basket, the order, the Runner and when it arrives.
 *
 * Kept apart from the conversation itself so each kind of question can be added to, and tested,
 * on its own. Add new questions here, each with the words people really use.
 */

export type ShoppingAnswer =
  | { kind: 'say'; text: string }
  | { kind: 'remove'; itemId: string; text: string }
  | { kind: 'order-status' };

export interface BasketFacts {
  lines: BasketLine[];
  goodsPence: number;
  feePence: number;
  totalPence: number;
}

const WHATS_IN =
  /\b(what('?s| is| have i got)|read( me)?|tell me what('?s| is))\b.*\b(basket|trolley|cart)\b|\bwhat (have i|did i) (got|get|order|pick|choose)\b/;
const HOW_MANY =
  /\bhow (many|much)\s+(.+?)\s+(is|are|have i got|do i have|did i)\b.*\b(basket|trolley|cart)\b|\bhow (many|much)\s+(.+?)\s+(have i got|do i have)\b/;
const TOTAL =
  /\b(what('?s| is) the (total|cost|price)|how much (is it|will it (be|cost)|does it (come to|cost)|altogether|in total)|what does it come to)\b/;
const REMOVE =
  /\b(remove|take out|take off|delete|cancel|drop|get rid of)\s+(the\s+|my\s+|that\s+)?(.+?)(\s+(from|out of|off)\s+(the\s+|my\s+)?(basket|trolley|cart|list))?$/;
const WHERE =
  /\bwhere('?s| is) (my|the) (order|runner|shopping|delivery)\b|\bwhen (will|is) (it|my (order|shopping|delivery)|the runner) (arrive|arriving|come|coming|get here|be here)\b|\bhow long (will it be|until (it|my))\b/;

/** "bananas" finds "Bananas, loose"; "milk" finds "Semi skimmed milk, 2 pints". */
export function findLine(lines: BasketLine[], said: string): BasketLine | undefined {
  const words = said
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 && !['the', 'some', 'any', 'packs', 'pack', 'bottles', 'of'].includes(word),
    )
    .map((word) => word.replace(/(es|s)$/, ''));
  if (words.length === 0) return undefined;
  return lines.find((line) => {
    const name = line.item.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

function lineWords(line: BasketLine): string {
  return `${line.quantity} ${line.item.name}`;
}

export function answerShoppingQuestion(text: string, basket: BasketFacts): ShoppingAnswer | null {
  const said = text
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/, '');

  if (WHERE.test(said)) return { kind: 'order-status' };

  if (TOTAL.test(said)) {
    if (basket.lines.length === 0) {
      return { kind: 'say', text: 'Your basket is empty, so nothing yet. What would you like?' };
    }
    return {
      kind: 'say',
      text: `About ${money(basket.goodsPence)} for the shopping, plus ${money(basket.feePence)} delivery. That's about ${money(basket.totalPence)} altogether. You pay what the till says.`,
    };
  }

  const howMany = said.match(HOW_MANY);
  if (howMany) {
    const thing = (howMany[2] ?? howMany[7] ?? '').trim();
    const line = findLine(basket.lines, thing);
    return {
      kind: 'say',
      text: line
        ? `You have ${lineWords(line)} in your basket.`
        : `There's no ${thing} in your basket yet. Would you like some?`,
    };
  }

  if (WHATS_IN.test(said)) {
    if (basket.lines.length === 0) {
      return { kind: 'say', text: 'Your basket is empty. What would you like?' };
    }
    const list = basket.lines.map(lineWords);
    const spoken =
      list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}`;
    return {
      kind: 'say',
      text: `In your basket: ${spoken}. That's about ${money(basket.totalPence)} with delivery.`,
    };
  }

  const remove = said.match(REMOVE);
  if (remove && basket.lines.length > 0 && !/\border\b/.test(remove[3] ?? '')) {
    const thing = (remove[3] ?? '').trim();
    const line = findLine(basket.lines, thing);
    if (line) {
      return {
        kind: 'remove',
        itemId: line.item.id,
        text: `I've taken the ${line.item.name} out of your basket.`,
      };
    }
    return { kind: 'say', text: `I couldn't find ${thing} in your basket.` };
  }

  return null;
}

/** Where the order has got to, in words, for "where's my order?". */
export function orderWhere(order: MyOrder | null): string {
  if (!order)
    return "You don't have an order on its way at the moment. Would you like to order something?";
  const runner = order.runnerName ?? 'Your Runner';
  switch (order.status) {
    case 'paid':
    case 'offered':
      return "We're finding you a Runner now. I'll tell you as soon as one has your order.";
    case 'accepted':
      return `${runner} has your order and is going to the shop.`;
    case 'shopping':
      return `${runner} is doing your shopping now.`;
    case 'receipt_submitted':
      return `${runner} has paid at the till and will set off soon.`;
    case 'delivering':
      return `${runner} is on the way to you now.`;
    case 'delivered':
    case 'completed':
      return 'Your shopping has been delivered.';
  }
}
