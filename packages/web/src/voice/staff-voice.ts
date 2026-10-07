/**
 * Ozi in the admin panel (Anthony, 7 October 2026): "every aspect of the admin panel should
 * be able to speak to the admin", so that a blind person can be employed in any job here.
 *
 * Ozi says what is waiting when someone signs in, reads any list out one item at a time, moves
 * between the tabs, and carries out decisions by voice after reading them back and hearing yes.
 * Kept apart from the screen, as plain functions, so every phrase can be tested on its own.
 */

import type {
  OwnerMoney,
  ProblemDecision,
  StaffOverview,
  StaffArea,
  StaffDocument,
  StaffEnquiry,
  StaffFeedback,
  StaffFindRequest,
  StaffProblem,
  StaffAnalytics,
  StaffPartnerProduct,
  StaffRecovery,
  TeamMember,
  LearningRow,
  BankPaymentRow,
} from '../lib/api';
import { money } from '../lib/money';
import { pairsAloud } from '../lib/phone-aloud';

/** Everything the signed-in person's job lets them see, as last loaded. */
export interface StaffLists {
  documents?: StaffDocument[];
  problems?: StaffProblem[];
  feedback?: StaffFeedback[];
  owed?: StaffRecovery[];
  finds?: StaffFindRequest[];
  enquiries?: StaffEnquiry[];
  /** Partner shop products waiting to be checked. */
  partners?: StaffPartnerProduct[];
  /** Numbers, not a list to work through. */
  analytics?: never[];
  overview?: never[];
  money?: never[];
  team?: TeamMember[];
  /** What Ozi could not answer, waiting for an answer (ruling 49). */
  learning?: LearningRow[];
  /** Bank transfers waiting to be checked against the business account (ruling 50). */
  payments?: BankPaymentRow[];
}

/** What each part is called aloud, as one and as many. */
export const AREA_WORDS: Record<StaffArea, { one: string; many: string; tab: string }> = {
  documents: {
    one: 'Runner document to check',
    many: 'Runner documents to check',
    tab: 'Documents',
  },
  problems: { one: 'complaint to decide', many: 'complaints to decide', tab: 'Problems' },
  feedback: { one: 'feedback message', many: 'feedback messages', tab: 'Feedback' },
  owed: { one: 'Runner who owes money', many: 'Runners who owe money', tab: 'Money owed' },
  finds: { one: 'Finds It request', many: 'Finds It requests', tab: 'Finds It' },
  enquiries: { one: 'enquiry to ring back', many: 'enquiries to ring back', tab: 'Enquiries' },
  partners: {
    one: 'shop product to check',
    many: 'shop products to check',
    tab: 'Shops and organisations',
  },
  analytics: { one: 'report', many: 'reports', tab: 'Analytics' },
  overview: { one: 'figure', many: 'figures', tab: 'Overview' },
  money: { one: 'payment', many: 'payments', tab: 'Money' },
  team: { one: 'person on the team', many: 'people on the team', tab: 'Team' },
  payments: {
    one: 'bank transfer to check',
    many: 'bank transfers to check',
    tab: 'Payments',
  },
  learning: {
    one: 'question Ozi could not answer',
    many: 'questions Ozi could not answer',
    tab: 'Learning',
  },
};

/** The items of one part that are still waiting for somebody. */
export function waiting(lists: StaffLists, area: StaffArea): unknown[] {
  if (area === 'enquiries') return (lists.enquiries ?? []).filter((row) => !row.handled);
  return (lists[area] as unknown[] | undefined) ?? [];
}

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** What Ozi says when someone signs in: who they are, and what is waiting for them. */
export function summary(
  name: string,
  title: string,
  areas: readonly StaffArea[],
  lists: StaffLists,
  now = new Date(),
): string {
  const parts: string[] = [];
  for (const area of areas) {
    if (area === 'team' || area === 'analytics' || area === 'overview' || area === 'money')
      continue;
    const count = waiting(lists, area).length;
    if (count === 0) continue;
    const words = AREA_WORDS[area];
    let part = `${count} ${count === 1 ? words.one : words.many}`;
    if (area === 'problems') {
      const names = (lists.problems ?? [])
        .slice(0, 3)
        .map((row) => row.reporterName ?? (row.reportedBy === 'runner' ? 'a Runner' : 'a Shopper'));
      part += `, from ${listWords(names)}${count > 3 ? ' and others' : ''}`;
      const overdue = (lists.problems ?? []).filter((row) => row.overdue).length;
      if (overdue > 0) part += `. ${overdue} ${overdue === 1 ? 'is' : 'are'} overdue`;
    }
    parts.push(part);
  }
  const opening = `${greeting(now)}, ${name}. You're signed in as ${title}.`;
  if (parts.length === 0) {
    return `${opening} Nothing is waiting for you right now. Say "help" to hear what I can do.`;
  }
  return `${opening} You have ${listWords(parts)}. Say, for example, "read me the ${firstNoun(areas, lists)}", or "help".`;
}

function firstNoun(areas: readonly StaffArea[], lists: StaffLists): string {
  const area =
    areas.find(
      (one) =>
        !['team', 'analytics', 'overview', 'money'].includes(one) && waiting(lists, one).length > 0,
    ) ?? (areas.includes('analytics') ? 'analytics' : 'problems');
  return {
    documents: 'documents',
    problems: 'complaints',
    feedback: 'feedback',
    owed: 'money owed',
    finds: 'Finds It requests',
    enquiries: 'enquiries',
    partners: 'shop products',
    analytics: 'analytics',
    overview: 'overview',
    money: 'money',
    team: 'team',
    learning: 'learning list',
    payments: 'payments',
  }[area];
}

export function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function longDate(when: string): string {
  return new Date(when).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** One item, read out in full. `position` is "1 of 3". */
export function readItem(area: StaffArea, item: unknown, position: string): string {
  switch (area) {
    case 'payments': {
      const row = item as BankPaymentRow;
      return `Bank transfer ${position}. ${row.shopperName}, ${money(row.amountPence)}, reference ${row.reference ?? 'none'}. When you have seen it arrive in the bank account, mark it as received in the Payments tab. Or say next.`;
    }
    case 'learning': {
      const row = item as LearningRow;
      return `Question ${position}, asked ${row.timesHeard} ${row.timesHeard === 1 ? 'time' : 'times'}: "${row.text}". To teach me the answer, type it in the Learning tab and press approve. Or say next.`;
    }
    case 'problems': {
      const row = item as StaffProblem;
      const from = row.reporterName ?? (row.reportedBy === 'runner' ? 'A Runner' : 'A Shopper');
      const role = row.reportedBy === 'runner' ? 'a Runner' : 'a Shopper';
      const count = (kind: string, one: string): string => {
        const n = row.evidence.filter((piece) => piece.kind === kind).length;
        return n === 0 ? '' : `${n} ${one}${n === 1 ? '' : 's'}`;
      };
      const evidence = [
        count('voice_note', 'voice note'),
        count('photo', 'photo'),
        count('note', 'written note'),
      ].filter(Boolean);
      const notes = row.evidence
        .filter((piece) => piece.kind === 'note' && piece.text)
        .map(
          (piece) =>
            ` A note from the ${piece.addedBy === 'runner' ? 'Runner' : 'Shopper'} says: ${piece.text}`,
        )
        .join('');
      return (
        `Complaint ${position}. ${from}, ${role}, says: ${row.summary}` +
        (row.refundRequestedPence ? ` They ask for ${money(row.refundRequestedPence)} back.` : '') +
        (evidence.length > 0 ? ` With it: ${listWords(evidence)}.` : '') +
        notes +
        (row.overdue ? ' It is overdue.' : ` Decide it by ${longDate(row.decideBy)}.`) +
        ' To decide, say, for example, "nobody at fault, refund 2 pounds 50", or say "next".'
      );
    }
    case 'feedback': {
      const row = item as StaffFeedback;
      return `Feedback ${position}, from ${row.runner ? `${row.runner.name}, a Runner` : 'someone who gave no name'}, on ${longDate(row.createdAt)}: ${row.message}`;
    }
    case 'documents': {
      const row = item as StaffDocument;
      return (
        `Document ${position}. ${row.runner?.name ?? 'A Runner'} sent their ${row.name}` +
        (row.sentAs === 'share code' && row.shareCode
          ? `, as a share code: ${row.shareCode.split('').join(' ')}. Check it on the government website first.`
          : ', as a photo.') +
        ' Say "accept" or "turn it down", or "next".'
      );
    }
    case 'owed': {
      const row = item as StaffRecovery;
      return `${position}. ${row.runner.name} owes ${money(row.remainingPence)}.${row.canWriteOff ? ' It is small enough to write off: say "write it off", or "next".' : ' It is too much to write off, so please ask them for it.'}`;
    }
    case 'finds': {
      const row = item as StaffFindRequest;
      return `Finds It ${position}. ${row.shopperName}${row.area ? `, near ${row.area},` : ''} is looking for ${row.description}. When you've looked, say "found it", or "not found", or "next".`;
    }
    case 'enquiries': {
      const row = item as StaffEnquiry;
      return (
        `Enquiry ${position}, from ${row.organisation}. Ask for ${row.contactName}, on ${pairsAloud(row.telephone)}.` +
        (row.people ? ` They support ${row.people} people.` : '') +
        (row.message ? ` They wrote: ${row.message}` : '') +
        ' When you have rung them, say "rung back".'
      );
    }
    case 'partners': {
      const row = item as StaffPartnerProduct;
      return (
        `Shop product ${position}. ${row.shopName} sent ${row.name}, at ${money(row.pricePence)}` +
        (row.tags ? `, labelled ${row.tags}` : '') +
        (row.expiresOn ? `, best before ${longDate(row.expiresOn)}` : '') +
        `. ${row.hasPhoto ? 'It has a photo.' : 'It has no photo.'} Say "accept" or "turn it down", or "next".`
      );
    }
    case 'analytics':
    case 'overview':
    case 'money':
      return '';
    case 'team': {
      const row = item as TeamMember;
      return `${position}. ${row.name}, ${row.title}, signs in as ${row.username}${row.active ? '' : '. Their account is turned off'}.`;
    }
  }
}

/** What someone said, understood. */
export type StaffCommand =
  | { kind: 'summary' }
  | { kind: 'help' }
  | { kind: 'open'; area: StaffArea }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'again' }
  | { kind: 'decide'; decision: ProblemDecision; refundPence: number | null }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'write-off' }
  | { kind: 'not-found' }
  | { kind: 'found' }
  | { kind: 'rung-back' }
  | { kind: 'sign-out' };

const AREA_PATTERNS: Array<[StaffArea, RegExp]> = [
  ['payments', /\b(payments?|bank transfers?|transfers?)\b/],
  [
    'money',
    /\b(money|income|takings|stripe|revenue|earnings|paid in|how much (came|have we taken))\b/,
  ],
  ['overview', /\b(overview|how many (shoppers|runners|people|staff)|head ?count)\b/],
  ['analytics', /\b(analytics|analysis|numbers|statistics|stats|insights?|trends?)\b/],
  ['problems', /\b(complaints?|problems?|issues?|disputes?|refunds?)\b/],
  ['feedback', /\bfeedback\b/],
  ['documents', /\b(documents?|dbs|right to work|share codes?|insurance|licen[cs]es?|checks)\b/],
  ['owed', /\b(money owed|owed|owes|debts?|write[ -]?offs?)\b/],
  ['finds', /\b(finds? it|finds|searches|looking for)\b/],
  ['enquiries', /\b(enquir(y|ies)|inquir(y|ies)|messages?|emails?|web ?mail|organisations?)\b/],
  ['partners', /\b(shop products?|products?|partner shops?|partners?|shops?)\b/],
  ['team', /\b(team|staff|colleagues?)\b/],
  [
    'learning',
    /\b(learning|unanswered|questions? (ozi|you) (could ?n.?t|couldn't|did ?n.?t) answer)\b/,
  ],
];

/** "2 pounds 50", "£2.50", "250 pence", "five pounds". */
export function spokenMoney(said: string): number | null {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
  };
  const text = said
    .toLowerCase()
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty)\b/g,
      (word) => String(words[word]),
    );
  const pounds =
    text.match(/£\s*(\d+)(?:\.(\d{1,2}))?/) ??
    text.match(
      /(\d+)(?:\.(\d{1,2}))?\s*(?:pounds?|quid)(?:\s*(?:and\s*)?(\d{1,2})\s*(?:p|pence)?)?/,
    );
  if (pounds) {
    const whole = Number(pounds[1]);
    const part = pounds[2] ?? pounds[3];
    const pence = part === undefined ? 0 : Number(part.length === 1 ? `${part}0` : part);
    return whole * 100 + pence;
  }
  const pence = text.match(/(\d+)\s*(?:p|pence)\b/);
  return pence ? Number(pence[1]) : null;
}

export function understand(said: string): StaffCommand | null {
  const text = said
    .toLowerCase()
    .replace(/[?.!,]+/g, ' ')
    .trim();
  if (/\b(sign me out|sign out|log out|log me out)\b/.test(text)) return { kind: 'sign-out' };
  if (/\b(help|what can (you|i) (do|say))\b/.test(text)) return { kind: 'help' };
  if (/\b(what'?s waiting|summary|anything new|what'?s new|catch me up|overview)\b/.test(text)) {
    return { kind: 'summary' };
  }
  if (/\b(rung (them )?back|called (them )?back|done|handled|i'?ve rung)\b/.test(text))
    return { kind: 'rung-back' };
  if (/\b(next|skip|carry on|the next one)\b/.test(text)) return { kind: 'next' };
  if (/\b(previous|back|go back|last one|the one before)\b/.test(text)) return { kind: 'previous' };
  if (/\b(read (it|that) again|again|repeat that)\b/.test(text)) return { kind: 'again' };

  const decisions: Array<[ProblemDecision, RegExp]> = [
    ['no_fault', /\b(nobody|no one|no-one|noone)\b.*\bfault\b|\bno fault\b/],
    ['runner_at_fault', /\b(the )?runner\b.*\b(fault|responsible)\b/],
    ['shop_at_fault', /\b(the )?shop\b.*\b(fault|responsible)\b/],
    ['platform_at_fault', /\b(our|we were|we are|the platform'?s?)\b.*\b(fault|responsible)\b/],
    ['shopper_at_fault', /\b(the )?(shopper|customer)\b.*\b(fault|responsible)\b/],
  ];
  for (const [decision, pattern] of decisions) {
    if (pattern.test(text)) {
      return {
        kind: 'decide',
        decision,
        refundPence: decision === 'shopper_at_fault' ? 0 : spokenMoney(text),
      };
    }
  }
  if (/\b(write (it|that) off|write off)\b/.test(text)) return { kind: 'write-off' };
  if (/\b(not found|couldn'?t find|no luck|none of the shops)\b/.test(text))
    return { kind: 'not-found' };
  if (/\b(found it|we found|i found)\b/.test(text)) return { kind: 'found' };
  if (/\b(turn (it|that) down|reject|refuse|decline)\b/.test(text)) return { kind: 'reject' };
  if (/\b(accept|approve|that'?s fine|looks good)\b/.test(text)) return { kind: 'accept' };

  for (const [area, pattern] of AREA_PATTERNS) {
    if (pattern.test(text)) return { kind: 'open', area };
  }
  return null;
}

/** What Ozi can do here, for this job. */
export function help(areas: readonly StaffArea[]): string {
  const tabs = areas.map((area) => AREA_WORDS[area].tab.toLowerCase());
  return (
    `You can say: "what's waiting", to hear everything; "read me the" and then ${listWords(tabs)}; ` +
    '"next", "back", or "again", to move through a list; and the decision itself, such as "accept", ' +
    '"nobody at fault, refund 2 pounds 50", "write it off", "not found" or "rung back". ' +
    'I always read a decision back and wait for your yes. Say "sign me out" when you finish.'
  );
}

/** The business numbers, read aloud: no names, groups of ten or more only. */
export function analyticsWords(data: StaffAnalytics): string {
  const t = data.totals;
  const busiest = data.shops[0];
  const hour = [...data.hours].sort((a, b) => b.purchases - a.purchases)[0];
  const day = [...data.weekdays].sort((a, b) => b.purchases - a.purchases)[0];
  const unmet = data.unmetSearches.slice(0, 3).map((row) => row.term);
  const parts = [
    `In the last ${data.period}: ${t.purchases} purchase${t.purchases === 1 ? '' : 's'}, worth ${money(t.goodsPence)} of shopping` +
      (t.shoppers !== null ? `, from ${t.shoppers} Shoppers` : '') +
      `, delivered by ${t.runners} Runner${t.runners === 1 ? '' : 's'}.`,
  ];
  if (busiest) parts.push(`Busiest shop: ${busiest.shop}, with ${busiest.purchases}.`);
  if (hour && hour.purchases > 0) parts.push(`Busiest hour: ${hour.hour} o'clock.`);
  if (day && day.purchases > 0) parts.push(`Busiest day: ${day.day}.`);
  if (data.ageBands.rows[0])
    parts.push(
      `Most purchases are by the ${data.ageBands.rows[0].key.replace('_', ' to ').replace('plus', 'and over')} age group.`,
    );
  if (unmet.length > 0) parts.push(`Most wanted, and nobody has it: ${listWords(unmet)}.`);
  if (t.throughOrganisations > 0)
    parts.push(`${t.throughOrganisations} came through organisations.`);
  return parts.join(' ');
}

/** The overview, read aloud: people and work, no money. */
export function overviewWords(data: StaffOverview): string {
  const p = data.people;
  const w = data.work;
  return (
    `${p.shoppers} Shoppers, ${p.runners} Runners, ${p.runnersOnShiftNow} on shift now, ` +
    `${p.shopPartners} Shop Partners, ${p.organisations} organisations and ${p.staff} staff. ` +
    `${w.ordersLastDay} orders in the last day, ${w.ordersLastWeek} in the last week. Waiting: ` +
    `${w.problemsWaiting} complaints, ${w.documentsWaiting} Runner documents, ` +
    `${w.shopProductsWaiting} shop products and ${w.findItWaiting} Finds It requests.`
  );
}

/** The owner's money, read aloud: today and the last month, by gateway. */
export function moneyWords(data: OwnerMoney): string {
  const gateways = data.month.byGateway.map((row) => `${row.name}, ${money(row.pence)}`);
  return (
    `Today, ${money(data.today.inPence)} in and ${money(data.today.outPence)} given back. ` +
    `In the last month, ${money(data.month.inPence)} in, ${money(data.month.outPence)} back, ` +
    `${money(data.month.netPence)} kept.` +
    (gateways.length ? ` By gateway: ${listWords(gateways)}.` : '')
  );
}

/** What Ozi says first when the owner asks for something (ruling 44), taken in turn. */
export const OWNER_ACKNOWLEDGEMENTS = ['Yes, sir.', 'Okay, sir.', 'All right, sir.'];

/**
 * Words for the owner (Anthony, 7 October 2026: "yes sir, okay sir, all right sir", with sir at
 * the end): "sir" at the end of what is said, unless it is there already, and an
 * acknowledgement first when he has asked for something.
 */
export function toOwner(text: string, acknowledgement: string | null = null): string {
  const ended = /\bsir\b/i.test(text)
    ? text
    : text.replace(/\s*([.!?])?\s*$/, (_whole, stop: string | undefined) => `, sir${stop ?? '.'}`);
  if (!acknowledgement || /^(yes|okay|all right), sir\b/i.test(ended)) return ended;
  return `${acknowledgement} ${ended}`;
}
