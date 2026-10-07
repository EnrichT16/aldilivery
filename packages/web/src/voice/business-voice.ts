/**
 * What Shop Partners and organisations can say to Ozi on their own dashboards (7 October 2026).
 * Each dashboard understands only its own commands, so Ozi never treats a shop as a Shopper,
 * an organisation as the admin panel, or either as the other.
 */

import { spokenMoney } from './staff-voice';

export type PartnerCommand =
  | { kind: 'add' }
  | { kind: 'products' }
  | { kind: 'plan' }
  | { kind: 'share' }
  | { kind: 'remove'; name: string }
  | { kind: 'price'; name: string; pricePence: number | null }
  | { kind: 'help' }
  | { kind: 'sign-out' };

export function understandPartner(said: string): PartnerCommand | null {
  const text = said
    .toLowerCase()
    .replace(/[?!,]+/g, ' ')
    .trim();
  if (/\b(sign me out|sign out|log out)\b/.test(text)) return { kind: 'sign-out' };
  if (/\b(help|what can (you|i) (do|say))\b/.test(text)) return { kind: 'help' };
  const price = text.match(
    /\b(?:change|set|update|make)\s+(?:the\s+)?price\s+(?:of\s+)?(.+?)\s+(?:to|at)\s+(.+)$/,
  );
  if (price?.[1] && price[2]) {
    return { kind: 'price', name: price[1].trim(), pricePence: spokenMoney(price[2]) };
  }
  const remove = text.match(
    /\b(?:remove|take off|take down|delete)\s+(?:the\s+)?(.+?)(?:\s+from\s+.*)?$/,
  );
  if (remove?.[1] && !/\bproducts?\b$/.test(remove[1]))
    return { kind: 'remove', name: remove[1].trim() };
  if (
    /\b(add|upload|new|put up|list)\b.*\b(product|item|something)\b|\badd (a|an|some)\b/.test(text)
  ) {
    return { kind: 'add' };
  }
  if (/\b(share|link|refer|referral|tell (other|my))\b/.test(text)) return { kind: 'share' };
  if (/\b(pay|paid|plan|subscription|monthly|renew|price of (my|the) plan)\b/.test(text)) {
    return { kind: 'plan' };
  }
  if (/\b(products?|items?|catalogue|catalog|what'?s live|waiting|read)\b/.test(text)) {
    return { kind: 'products' };
  }
  return null;
}

export function partnerHelp(): string {
  return (
    'You can say: "add a product", and I will ask you its name, price and best before date; ' +
    '"read my products"; "change the price of" a product "to" an amount; "remove" a product; ' +
    '"what do I pay"; "share my link"; or "sign me out".'
  );
}

export type OrganisationCommand =
  | { kind: 'summary' }
  | { kind: 'spent' }
  | { kind: 'orders' }
  | { kind: 'people' }
  | { kind: 'saved' }
  | { kind: 'budget' }
  | { kind: 'upcoming' }
  | { kind: 'offices' }
  | { kind: 'help' }
  | { kind: 'sign-out' };

export function understandOrganisation(said: string): OrganisationCommand | null {
  const text = said
    .toLowerCase()
    .replace(/[?!,]+/g, ' ')
    .trim();
  if (/\b(sign me out|sign out|log out)\b/.test(text)) return { kind: 'sign-out' };
  if (/\b(help|what can (you|i) (do|say))\b/.test(text)) return { kind: 'help' };
  if (/\b(sav(e|ed|ing|ings))\b/.test(text)) return { kind: 'saved' };
  if (/\bbudget\b|\b(left|remaining) to spend\b/.test(text)) return { kind: 'budget' };
  if (/\b(coming up|upcoming|next week|future|regular|weekly|repeat)\b/.test(text))
    return { kind: 'upcoming' };
  if (/\b(office|offices|team|teams|department|ward)\b/.test(text)) return { kind: 'offices' };
  if (/\b(who ordered|who bought|orders?|purchases?|bought|deliveries)\b/.test(text))
    return { kind: 'orders' };
  if (/\b(people|residents?|clients?|service users?|who do we support)\b/.test(text))
    return { kind: 'people' };
  if (/\b(spent|spend|cost|how much)\b/.test(text)) return { kind: 'spent' };
  if (/\b(summary|overview|what'?s new|catch me up)\b/.test(text)) return { kind: 'summary' };
  return null;
}

export function organisationHelp(): string {
  return (
    'You can say: "how much have we spent"; "read the orders", to hear who ordered what and when; ' +
    '"how much have we saved"; "what is left in the budget"; "what is coming up"; ' +
    '"spending by office"; "read the people we support"; or "sign me out".'
  );
}
