import { storeConfig } from '../config';

/**
 * Ozi's name as people say it and as phones write it down. Speech recognition hears "Ozi" as
 * "Ozzy", "Ozzie" or even "Aussie" (Anthony, 6 October 2026: "Hey Ozzy" got no answer), so
 * every spelling in `assistantHeardAs` counts as being spoken to.
 */

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A regular expression fragment matching any way the name is written. */
export const NAME_PATTERN = `(?:${[storeConfig.assistantName, ...storeConfig.assistantHeardAs]
  .map(escape)
  .join('|')})`;

/** Whether Ozi was spoken to, by any spelling of its name. */
export function nameHeardIn(text: string): boolean {
  return new RegExp(`\\b${NAME_PATTERN}\\b`, 'i').test(text);
}

/** Just the name, perhaps with "hey": a call for attention, with nothing asked yet. */
export function onlyName(text: string): boolean {
  return new RegExp(
    `^\\s*((hey|hi|hello|ok|okay|excuse me)[\\s,]+)?${NAME_PATTERN}[\\s,.!?]*$`,
    'i',
  ).test(text);
}
