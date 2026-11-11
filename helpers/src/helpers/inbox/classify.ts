/**
 * Sorting email with no AI: words and phrases that mark each kind. Free, fast, and easy to teach:
 * add words for any kind in the configuration (`inbox.categoryWords`).
 */
import { normalise } from '../../core/text.js';

export type Category = 'spam' | 'complaint' | 'order' | 'partner' | 'council' | 'job' | 'general';

export const CATEGORY_LABELS: Record<Category, string> = {
  spam: 'spam',
  complaint: 'a complaint',
  order: 'an order question',
  partner: 'a shop or partner',
  council: 'a council or authority',
  job: 'a job enquiry',
  general: 'a general question',
};

const WORDS: Record<Exclude<Category, 'general'>, string[]> = {
  spam: [
    'unsubscribe from this list',
    'seo services',
    'backlinks',
    'rank your website',
    'first page of google',
    'crypto',
    'bitcoin',
    'investment opportunity',
    'you have won',
    'lottery',
    'claim your prize',
    'viagra',
    'casino',
    'web design services',
    'lead generation',
    'guest post',
    'increase your sales',
    'dear sir madam',
    'business proposal',
    'inheritance',
    'beneficiary',
    'wire transfer',
  ],
  complaint: [
    'complaint',
    'complain',
    'refund',
    'disappointed',
    'unacceptable',
    'rude',
    'never arrived',
    'not arrived',
    'missing',
    'wrong item',
    'damaged',
    'broken',
    'late',
    'cold',
    'overcharged',
    'charged twice',
    'poor service',
    'terrible',
    'awful',
    'not happy',
    'unhappy',
    'compensation',
  ],
  order: [
    'order',
    'delivery',
    'deliver',
    'basket',
    'runner',
    'driver',
    'booking',
    'book a',
    'appointment',
    'collection',
    'tracking',
    'arrive',
    'eta',
    'invoice',
    'receipt',
    'payment',
    'paid',
    'price',
    'quote',
  ],
  partner: [
    'partnership',
    'partner',
    'our shop',
    'my shop',
    'our store',
    'wholesale',
    'supplier',
    'stock',
    'list our products',
    'collaborate',
    'collaboration',
    'sponsor',
    'franchise',
    'care home',
  ],
  council: [
    'council',
    'local authority',
    'borough',
    'licence',
    'license',
    'licensing',
    'inspection',
    'environmental health',
    'trading standards',
    'hmrc',
    'companies house',
    'ico',
    'cqc',
    'nhs',
    'government',
  ],
  job: [
    'job',
    'vacancy',
    'vacancies',
    'apply',
    'application',
    'cv',
    'work for you',
    'hiring',
    'recruit',
  ],
};

/** Words that mean someone needs a person now. Anthony is texted. */
const URGENT = [
  'urgent',
  'emergency',
  'asap',
  'immediately',
  'police',
  'injured',
  'injury',
  'accident',
  'hospital',
  'ambulance',
  'fire',
  'threat',
  'threaten',
  'legal action',
  'solicitor',
  'lawyer',
  'court',
  'sue',
  'fraud',
  'scam',
  'stolen',
  'safeguarding',
  'abuse',
  'unsafe',
  'danger',
  'data breach',
  'hacked',
  'chargeback',
  'final notice',
  'deadline today',
];

function hits(text: string, phrases: string[]): number {
  const padded = ` ${text} `;
  return phrases.filter((phrase) => padded.includes(` ${normalise(phrase)} `)).length;
}

export interface Sorted {
  category: Category;
  urgent: boolean;
  /** The urgent words found, to say in the alert. */
  urgentWords: string[];
}

export function sortEmail(
  subject: string,
  body: string,
  extraWords: Record<string, string[]> = {},
): Sorted {
  // The subject counts twice: it is what the sender thinks the email is about.
  const text = normalise(`${subject} ${subject} ${body}`);
  const urgentWords = URGENT.filter((phrase) => hits(text, [phrase]) > 0);
  let best: Category = 'general';
  let bestScore = 0;
  for (const category of Object.keys(WORDS) as Array<keyof typeof WORDS>) {
    const score = hits(text, [...WORDS[category], ...(extraWords[category] ?? [])]);
    // Spam needs two signs, so one unlucky word never hides a real email.
    if (category === 'spam' && score < 2) continue;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  // Something urgent is never treated as spam.
  if (best === 'spam' && urgentWords.length > 0) best = 'general';
  return { category: best, urgent: best !== 'spam' && urgentWords.length > 0, urgentWords };
}
