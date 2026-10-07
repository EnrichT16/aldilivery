import { askOzi, type OziAsker } from '../lib/api';
import { nameHeardIn } from './name';

/**
 * Ozi's everyday phrases (rulings 34 and 44): what Ozi says to "thank you", "who are you",
 * "how much is delivery" and thousands more. The collections are kept on the server, one for
 * each kind of account, and never sent to the app (Anthony, 7 October 2026: nobody should be
 * able to read them, himself included). The app sends what was heard and gets one reply back.
 *
 * Only used when nothing about an order or the basket was meant, and only when the whole
 * sentence is one of the phrases, or Ozi was called by name. So a television saying "thank you"
 * mid-sentence is not answered.
 */

/**
 * A reply, if the words are an everyday phrase for whoever is signed in. `exact`: the whole
 * sentence, apart from Ozi's name, is one of them. `within`: one of them is somewhere in a
 * sentence said to Ozi by name. Null when it is not a phrase, or the server cannot be reached,
 * so a phrase can never stand in the way of an order.
 */
export async function phraseReply(
  text: string,
  turn: number,
  mode: 'exact' | 'within',
  as: OziAsker = { kind: 'shopper' },
): Promise<string | null> {
  try {
    const { reply } = await askOzi(text, mode, turn, as);
    return reply;
  } catch {
    return null;
  }
}

/**
 * For a page with its own voice commands, when what was said was none of them: an everyday
 * phrase for this account if it is one, otherwise `notUnderstood`, but only if Ozi was called
 * by name, so Ozi does not talk back to the television.
 */
export function everydayOr(
  text: string,
  turn: { current: number },
  as: OziAsker,
  say: (words: string) => void,
  notUnderstood: string,
): void {
  const named = nameHeardIn(text);
  void (async () => {
    const reply =
      (await phraseReply(text, turn.current, 'exact', as)) ??
      (named ? await phraseReply(text, turn.current, 'within', as) : null);
    if (reply) {
      turn.current += 1;
      say(reply);
    } else if (named) {
      say(notUnderstood);
    }
  })();
}
