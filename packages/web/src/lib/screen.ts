/**
 * What is on the screen as somebody speaks to Ozi (ruling 89, 2 November 2026): a small, bounded
 * picture of the page at that moment, sent with every request to Ozi so it can answer "this
 * one", "the first one" and "what's that number", and refer to what the person is looking at.
 *
 * Only words already shown on the page go: the path, the title, the main headings, any status
 * or alert line, the tab open, and up to a dozen short lines of the most useful text (list
 * items, counts, the main buttons). Never a form field's value: inputs, text areas and select
 * boxes are taken out before any text is read, so a password or a typed address cannot leave the
 * device. Anything that looks like a telephone number, a card number, an email address or a code
 * is blanked here, and again on the server.
 */

export interface ScreenSnapshot {
  path: string;
  title?: string;
  headings?: string[];
  status?: string[];
  section?: string;
  lines?: string[];
}

/** The most the whole picture may be, in characters, once written out. */
export const SCREEN_MAX_CHARACTERS = 1_500;
const MOST_LINES = 12;
const LINE_MAX = 120;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONE = /(?:\+\d{1,3}[\s-]?)?\(?\d(?:[\s().-]?\d){8,}/g;
const NAMED_CODE =
  /\b(code|pin|passcode|password|otp|one[- ]time code|verification code|security code)(\s*(?:is|:|=|-)?\s*)([^\s,.;]+)/gi;
const DIGITS = /\b\d{5,8}\b/g;
const MIXED = /\b(?=[A-Za-z0-9-]*\d[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{6,}\b/g;

/** The same blanking as the server's (packages/api/src/lib/redact.ts), so nothing private leaves. */
export function blankPrivate(text: string): string {
  return text
    .replace(EMAIL, '[email address]')
    .replace(CARD, '[card number]')
    .replace(PHONE, '[phone number]')
    .replace(NAMED_CODE, (_whole, word: string, between: string) => `${word}${between}[code]`)
    .replace(DIGITS, '[code]')
    .replace(MIXED, '[code]');
}

/** Form fields, scripts and anything hidden: never read. */
const NEVER_READ =
  'input, textarea, select, option, script, style, noscript, [hidden], [aria-hidden="true"]';

/** The visible words of an element, with every form field and hidden part left out. */
function wordsOf(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || (node as Element).matches(NEVER_READ)) return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(element);
  return blankPrivate(parts.join(' ').replace(/\s+/g, ' ').trim());
}

function shown(element: Element): boolean {
  return element.closest('[hidden], [aria-hidden="true"]') === null && !element.matches(NEVER_READ);
}

function cut(text: string, most = LINE_MAX): string {
  return text.length > most ? `${text.slice(0, most - 1)}…` : text;
}

function unique(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (line === '' || seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

/** The lines most worth hearing about: list items, counts and the main buttons, in page order. */
function usefulLines(main: Element): string[] {
  const found: string[] = [];
  const candidates = Array.from(
    main.querySelectorAll('li, h3, p, button, summary, [role="listitem"], a[role="button"]'),
  ).filter(shown);
  for (const element of candidates) {
    // Tabs and navigation are the section, and status lines are given on their own.
    if (element.closest('nav, [role="tablist"], [role="status"], [role="alert"]')) continue;
    // A list item is one line as a whole; its own buttons are not read again.
    if (
      element.closest('li, [role="listitem"]') !== element &&
      element.closest('li, [role="listitem"]')
    ) {
      continue;
    }
    const words = wordsOf(element);
    if (words === '' || words.length > 240) continue;
    // Plain paragraphs are only worth it when they carry a count or a short state.
    if (element.tagName === 'P' && !/\d/.test(words) && words.length > 60) continue;
    found.push(cut(words));
    if (found.length >= MOST_LINES * 2) break;
  }
  return unique(found).slice(0, MOST_LINES);
}

function fits(snapshot: ScreenSnapshot): boolean {
  return JSON.stringify(snapshot).length <= SCREEN_MAX_CHARACTERS;
}

/**
 * The page as it is right now, or null when there is no page (no document, or nothing at all on
 * it). Never throws: a page that cannot be read is simply not described.
 */
export function screenSnapshot(
  root: Document | undefined = globalThis.document,
): ScreenSnapshot | null {
  try {
    if (!root?.body) return null;
    const path = cut(root.location?.pathname || '/', 200);
    const main = root.querySelector('main') ?? root.body;
    const headings = unique(
      Array.from(root.querySelectorAll('h1, h2'))
        .filter(shown)
        .map((heading) => cut(wordsOf(heading))),
    ).slice(0, 6);
    const status = unique(
      Array.from(root.querySelectorAll('[role="status"], [role="alert"]'))
        .filter(shown)
        .map((line) => cut(wordsOf(line), 200)),
    ).slice(0, 4);
    const tab = Array.from(root.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(
      shown,
    );
    const section = tab.length > 0 ? cut(wordsOf(tab[tab.length - 1]!), 80) : '';
    const title = cut(blankPrivate((root.title ?? '').replace(/\s+/g, ' ').trim()));
    const snapshot: ScreenSnapshot = {
      path,
      ...(title ? { title } : {}),
      ...(headings.length > 0 ? { headings } : {}),
      ...(status.length > 0 ? { status } : {}),
      ...(section ? { section } : {}),
    };
    const lines = usefulLines(main);
    // Keep within the cap: the lines go first, from the end, then the status, then the headings.
    while (lines.length > 0 && !fits({ ...snapshot, lines })) lines.pop();
    if (lines.length > 0) snapshot.lines = lines;
    while (!fits(snapshot) && snapshot.status && snapshot.status.length > 0) snapshot.status.pop();
    while (!fits(snapshot) && snapshot.headings && snapshot.headings.length > 1)
      snapshot.headings.pop();
    if (!fits(snapshot)) return { path };
    return snapshot;
  } catch {
    return null;
  }
}
