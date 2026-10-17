import { normalisePhrase, phraseWithoutName } from '@aldilivery/core';
import rawSmallTalk from '@small-talk';

import { storeConfig } from '../config';

/**
 * Small talk and general statements are not shopping (ruling 66, Anthony, 17 October 2026).
 *
 * When Ozi has just asked "What would you like?", or hears a sentence with an ordering word in
 * it, the words used to be looked up as a product whatever they were, so "how are you doing"
 * was answered with "I couldn't find how are you doing… I haven't added anything". This tells
 * the two apart, in three steps:
 *
 *   a) A short list of small talk with warm replies, in `config/small-talk.json`, answered in
 *      the app itself, so a slow server never leaves "thank you" sounding like an order.
 *   b) A heuristic for everything else: words with no quantity and no food or household noun,
 *      shaped like a sentence said to a person (pronouns, question words), are chatter, not an
 *      order. The caller still checks the catalogue first, so a product Ozi has never heard of
 *      is never mistaken for a remark. Ozi then says one gentle line and stays quiet for more
 *      chatter in the next twenty seconds, rather than answering every sentence in the room.
 *   c) Anything unclear is still sent to the server, which keeps what is fit to keep on the
 *      Learning list for a person to answer (ruling 49).
 *
 * Nothing here names the product or the company: {assistant} in a reply is filled in from
 * `config/store.json` (Rule Nine).
 */

export interface SmallTalk {
  id: string;
  when: string[];
  replies: string[];
}

export interface SmallTalkConfig {
  nudge: string;
  quietSeconds: number;
  phrases: SmallTalk[];
}

const NAMES = {
  product: storeConfig.productName,
  assistant: storeConfig.assistantName,
  heardAs: storeConfig.assistantHeardAs,
};

/** Checks the file, throwing a sentence that says which entry is wrong. */
export function parseSmallTalk(raw: unknown): SmallTalkConfig {
  const file = 'small-talk.json';
  const given = raw as Partial<SmallTalkConfig> | null;
  if (!given || typeof given !== 'object') throw new Error(`${file} must be an object.`);
  if (typeof given.nudge !== 'string' || given.nudge.trim() === '')
    throw new Error(`${file} needs a "nudge" sentence.`);
  if (typeof given.quietSeconds !== 'number' || !(given.quietSeconds >= 0))
    throw new Error(`${file} needs "quietSeconds", zero or more.`);
  if (!Array.isArray(given.phrases)) throw new Error(`${file} must have a "phrases" list.`);
  const ids = new Set<string>();
  const phrases = given.phrases.map((entry, index) => {
    const e = entry as Partial<SmallTalk>;
    const where = `${file} entry ${index + 1}${e.id ? ` (${e.id})` : ''}`;
    if (typeof e.id !== 'string' || e.id === '') throw new Error(`${where} needs an id.`);
    if (ids.has(e.id)) throw new Error(`${where}: the id is used twice.`);
    ids.add(e.id);
    if (!Array.isArray(e.when) || e.when.length === 0 || e.when.some((w) => typeof w !== 'string'))
      throw new Error(`${where} needs at least one phrase in "when".`);
    if (
      !Array.isArray(e.replies) ||
      e.replies.length === 0 ||
      e.replies.some((r) => typeof r !== 'string' || r.trim() === '' || r.length > 300)
    )
      throw new Error(`${where} needs replies, each under 300 characters.`);
    const when = e.when.map(normalisePhrase).filter((w) => w !== '');
    if (when.length === 0) throw new Error(`${where} needs words in "when".`);
    return { id: e.id, when, replies: e.replies };
  });
  return { nudge: given.nudge, quietSeconds: given.quietSeconds, phrases };
}

export const smallTalk: SmallTalkConfig = parseSmallTalk(rawSmallTalk);

/** Every small talk phrase, whole, for an instant answer. */
const exact = new Map<string, SmallTalk>();
for (const phrase of smallTalk.phrases) {
  for (const when of phrase.when) if (!exact.has(when)) exact.set(when, phrase);
}

/** How many words a sentence may have for a small talk phrase inside it to count. */
const WITHIN_WORDS = 9;

/**
 * A quantity or a measure: "two", "a dozen", "500", "a pack of". Anything with one of these is
 * shopping, never chatter.
 */
const QUANTITY = new Set(
  (
    'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ' +
    'twenty thirty forty fifty hundred dozen half quarter couple few several pack packs bag bags ' +
    'bottle bottles tin tins cans loaf loaves pint pints litre litres liter liters kilo kilos ' +
    'kg gram grams box boxes carton cartons jar jars tub tubs punnet punnets bunch bunches slice ' +
    'slices pair pairs roll rolls packet packets sachet sachets multipack tray trays crate crates ' +
    'bar bars block blocks pot pots'
  ).split(' '),
);

/**
 * Food and household words people buy. Said with one of these, a sentence is shopping, so "have
 * you got any bread" is still an order. The list is deliberately broad and plain; a product not
 * on it is caught by the catalogue check the caller makes before calling anything chatter.
 */
const GROCERY = new Set(
  (
    'milk bread egg butter cheese yoghurt yogurt cream flour sugar salt pepper oil vinegar rice ' +
    'pasta spaghetti noodle cereal porridge oat oats biscuit cake crisp crisps chocolate sweet ' +
    'sweets snack snacks tea coffee juice water squash lemonade cola pop beer wine cider spirits ' +
    'fruit apple banana orange grape pear plum peach melon berry berries strawberry raspberry ' +
    'blueberry lemon lime mango pineapple kiwi cherry cherries avocado tomato potato potatoes ' +
    'onion garlic carrot pea peas bean beans sweetcorn corn pepper cabbage lettuce salad cucumber ' +
    'broccoli cauliflower spinach kale leek celery mushroom courgette aubergine squash pumpkin ' +
    'parsnip turnip swede beetroot radish veg vegetable vegetables greens herb herbs spice spices ' +
    'meat chicken beef pork lamb bacon sausage sausages ham turkey mince steak chop chops fish ' +
    'salmon tuna cod prawn prawns haddock mackerel sardine sardines kipper burger burgers nugget ' +
    'nuggets pie pies pizza quiche soup stock gravy sauce ketchup mayonnaise mayo mustard pickle ' +
    'jam marmalade honey syrup peanut nut nuts seed seeds raisin raisins dried tinned frozen chips ' +
    'fries ice lolly lollies dessert pudding custard jelly trifle margarine spread lard dough ' +
    'tortilla wrap wraps bagel bagels bun buns roll rolls crumpet crumpets muffin muffins scone ' +
    'scones croissant croissants pastry baby formula nappy nappies wipes toilet tissue tissues ' +
    'kitchen foil clingfilm cling film bin liner liners bleach detergent washing powder liquid ' +
    'softener soap shampoo conditioner toothpaste toothbrush deodorant razor razors shower gel ' +
    'sponge sponges cloth cloths brush polish spray cleaner candle candles battery batteries bulb ' +
    'bulbs matches lighter charcoal sandwich sandwiches curry stew casserole roast dog cat pet litter ' +
    'birdseed treats tomatoes drink drinks snackbar flapjack doughnut doughnuts cookie cookies ' +
    'cracker crackers rusk rusks hummus houmous dip dips olives olive coleslaw cereal granola ' +
    'muesli lentil lentils chickpea chickpeas tofu quorn vegan vegetarian gluten dairy lactose ' +
    'organic halal kosher plaster plasters paracetamol painkiller vitamins'
  ).split(' '),
);

/** Pronouns, question words and the little verbs that make a sentence said to a person. */
const SENTENCE_MARKERS = new Set(
  (
    "i i'm im i've ive i'd id i'll ill me my mine myself you you're youre your yours yourself we " +
    "we're were our us ours he he's hes she she's shes they they're theyre them their him her who " +
    "who's whos what what's whats where where's wheres when when's whens why why's whys how how's " +
    'hows is are am was do does did can could will would should shall have has had been being ' +
    "isn't isnt aren't arent don't dont doesn't doesnt didn't didnt can't cant won't wont " +
    "wouldn't wouldnt shouldn't shouldnt"
  ).split(' '),
);

/** "bananas" and "banana" are the same word; "tomatoes" and "tomato" too. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('es') && !word.endsWith('ees')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** What was said, without Ozi's name, in the form phrases are compared in. */
export function saidWithoutName(text: string): string {
  return phraseWithoutName(text, NAMES);
}

/**
 * The small talk entry the words are, if they are one: the whole sentence, or, in a short
 * sentence, one of the phrases inside it ("how are you doing today, love"). Null otherwise.
 */
export function findSmallTalk(text: string): SmallTalk | null {
  const said = saidWithoutName(text);
  if (said === '') return null;
  const whole = exact.get(said);
  if (whole) return whole;
  const words = said.split(' ');
  if (words.length > WITHIN_WORDS) return null;
  // A quantity or a grocery word means shopping, whatever else was said: "hi, two milks".
  if (words.some((word) => QUANTITY.has(word) || GROCERY.has(stem(word)) || /\d/.test(word)))
    return null;
  const padded = ` ${said} `;
  for (const [when, phrase] of exact) {
    // Only phrases of two or more words count inside a sentence: "hi" is in "white bread".
    if (when.includes(' ') && padded.includes(` ${when} `)) return phrase;
  }
  return null;
}

/** The reply to a small talk entry, taken in turn so Ozi does not sound like a recording. */
export function smallTalkReply(phrase: SmallTalk, turn: number): string {
  const reply = phrase.replies[turn % phrase.replies.length]!;
  return reply.replace(/\{assistant\}/g, storeConfig.assistantName);
}

/**
 * Whether the words are shaped like a sentence said to a person rather than a product or a
 * command: no quantity, no digits, no food or household noun, and either a pronoun, a question
 * word or a little verb, or at least four words ("pass me the remote", "put the kettle on
 * love"). The caller checks the catalogue before treating the sentence as chatter.
 */
export function looksLikeChatter(text: string): boolean {
  const said = saidWithoutName(text);
  if (said === '') return false;
  const words = said.split(' ');
  if (words.some((word) => QUANTITY.has(word) || /\d/.test(word))) return false;
  if (words.some((word) => GROCERY.has(stem(word)))) return false;
  if (words.some((word) => SENTENCE_MARKERS.has(word))) return true;
  return words.length >= 4;
}

export interface QuietSpell {
  /** Whether Ozi is still keeping quiet after its one gentle line. */
  quiet: () => boolean;
  /** Ozi has said its line: keep quiet for the configured spell. */
  start: () => void;
  /** Forget the spell, for example when an order starts. */
  clear: () => void;
}

/** The twenty seconds of quiet after the nudge (ruling 66), with the clock injectable for tests. */
export function quietSpell(
  seconds: number = smallTalk.quietSeconds,
  now: () => number = () => Date.now(),
): QuietSpell {
  let until: number | null = null;
  return {
    quiet: () => until !== null && now() < until,
    start: () => {
      until = now() + seconds * 1000;
    },
    clear: () => {
      until = null;
    },
  };
}
