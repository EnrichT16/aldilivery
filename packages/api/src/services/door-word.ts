/**
 * The door safe word (docs/BUILD_PROMPT.md, T6; docs/STILL_TO_DO.md item 7).
 *
 * For every order the Shopper is told their Runner's first name and two words, and the Runner
 * says the two words at the door, so somebody who cannot see who is knocking knows it is their
 * Runner. The words are everyday, easy to hear and to say, and never a number. The pair is made
 * when a Runner takes the order, kept on the order, and shown only to that Shopper and that
 * Runner.
 */

import { randomInt } from 'node:crypto';

import type { Repository } from '../data/repository.js';
import type { Order } from '../domain.js';

/** Colours and simple describing words: one or two syllables, nothing that sounds like another. */
export const FIRST_WORDS = [
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'silver',
  'golden',
  'happy',
  'sunny',
  'gentle',
  'quiet',
  'little',
  'early',
  'windy',
  'lucky',
  'brave',
  'jolly',
  'tidy',
  'cosy',
  'rosy',
  'snowy',
  'shiny',
  'sleepy',
  'friendly',
  'lemon',
  'cherry',
  'velvet',
  'copper',
  'woolly',
  'summer',
] as const;

/** Everyday things: easy to picture, easy to hear. */
export const SECOND_WORDS = [
  'kettle',
  'teapot',
  'garden',
  'robin',
  'apple',
  'pebble',
  'blanket',
  'candle',
  'button',
  'pillow',
  'basket',
  'meadow',
  'river',
  'window',
  'ladder',
  'muffin',
  'biscuit',
  'tulip',
  'daisy',
  'rabbit',
  'pigeon',
  'lantern',
  'harbour',
  'orchard',
  'compass',
  'trumpet',
  'saucer',
  'jumper',
  'wellies',
  'parsnip',
] as const;

/** Two words, such as "blue kettle". */
export function newDoorWord(pick: (size: number) => number = randomInt): string {
  const first = FIRST_WORDS[pick(FIRST_WORDS.length)] ?? FIRST_WORDS[0];
  const second = SECOND_WORDS[pick(SECOND_WORDS.length)] ?? SECOND_WORDS[0];
  return `${first} ${second}`;
}

/** The first name, which is all the Shopper is told of who is coming. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The order's two words, made now if the order has a Runner and none yet (an order taken before
 * the words existed gets them the first time anyone looks). Null before a Runner has it.
 */
export async function ensureDoorWord(repository: Repository, order: Order): Promise<string | null> {
  if (order.doorWord) return order.doorWord;
  if (!order.runnerId) return null;
  const doorWord = newDoorWord();
  await repository.orders.update(order.id, { doorWord });
  return doorWord;
}

/** What the Shopper is told, in one sentence Ozi can say as it is. */
export function doorWordSentence(runnerName: string, doorWord: string): string {
  return `Your Runner is ${firstName(runnerName)}. At your door they will say "${doorWord}". If they do not, you do not need to open the door.`;
}
