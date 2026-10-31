/**
 * Ozi knows the owner on his own phone (Anthony, 31 October 2026, ruling 84).
 *
 * The few things Ozi says to somebody it already knows, the owner or a member of staff, without
 * the language model: a greeting fit for the time of day in the UK, "do you know my name", and
 * "this is the owner". The same words on the server, when the model is away, slow or used up,
 * and in the app, when the server is slow. Never the Shopper's introduction and never an offer
 * to open an account: they are signed in already.
 *
 * Every name comes from configuration (`owner.spokenName`, the product and assistant names).
 */

import { phraseWithoutName, type PhraseNames } from './phrase-text.js';

/** Who Ozi already knows: the owner, or a member of staff by first name when known. */
export interface KnownSpeaker {
  kind: 'owner' | 'staff';
  /** The staff member's first name; ignored for the owner, who is `spokenName`. */
  firstName: string | null;
}

export interface KnownSpeakerNames extends PhraseNames {
  /** How the owner is addressed aloud: config `owner.spokenName`. */
  spokenName: string;
}

/**
 * Said to the owner or staff who ask for shopping (ruling 84): orders stay safe behind a Shopper
 * account, said kindly, and never with an offer to open one.
 */
export const SHOPPER_ACCOUNT_FOR_ORDERS =
  "Shopping orders go through a Shopper account, so I can't order from your staff sign-in. When you'd like to shop, please use a Shopper account in the shop, and I'll help you there.";

/** Morning from four until noon, afternoon until six, evening after, by the clock in the UK. */
export function ukPartOfDay(at: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at),
  );
  if (hour >= 4 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

function addressOf(who: KnownSpeaker, names: KnownSpeakerNames): string | null {
  return who.kind === 'owner' ? names.spokenName : who.firstName;
}

/** "Good morning, Mr. Anthony. How can I help?" */
export function knownGreeting(who: KnownSpeaker, names: KnownSpeakerNames, at: Date): string {
  const name = addressOf(who, names);
  return `Good ${ukPartOfDay(at)}${name ? `, ${name}` : ''}. How can I help?`;
}

const GREETING =
  /^(?:(?:hello|hi|hey|hiya|howdy|good (?:morning|afternoon|evening|day)|morning|afternoon|evening)\s*)+(?:(?:there|again|sir|to you|mate)\s*)?$/;

const ASKS_NAME =
  /\b(?:do you know (?:my name|who i am|who this is|who's (?:talking|speaking))|what'?s my name|what is my name|who am i|who is (?:this|speaking|talking)|who'?s (?:this|speaking|talking)|do you recogni[sz]e me|say my name)\b/;

const SAYS_OWNER =
  /\b(?:this is|it'?s|i am|i'?m)\s+(?:the |your )?(?:owner|founder|boss)\b|\b(?:the|your) (?:owner|founder)(?: and (?:the )?(?:owner|founder))? (?:here|speaking)\b/;

/**
 * What Ozi says, without the model, to somebody it knows, when it is one of these: a greeting,
 * "do you know my name", or "this is the owner". Null for anything else.
 */
export function knownSpeakerReply(
  text: string,
  who: KnownSpeaker,
  names: KnownSpeakerNames,
  at: Date,
): string | null {
  const said = phraseWithoutName(text, names);
  const name = addressOf(who, names);
  if (ASKS_NAME.test(said)) {
    if (who.kind === 'owner') {
      return `Yes, of course. You're ${names.spokenName}, the owner and founder of ${names.product}. How can I help?`;
    }
    return name
      ? `Yes. You're ${name}, signed in on the ${names.product} team. How can I help?`
      : `You're signed in on the ${names.product} team. How can I help?`;
  }
  if (SAYS_OWNER.test(said)) {
    if (who.kind === 'owner') {
      return `I know, ${names.spokenName}. You're signed in as the owner and founder on this phone. How can I help?`;
    }
    return `You're signed in as staff${name ? `, ${name}` : ''}. How can I help?`;
  }
  if (said === '' || GREETING.test(said)) return knownGreeting(who, names, at);
  return null;
}
