/**
 * Getting the microphone on a stranger's phone, in one tap (ruling 62).
 *
 * Found on a real iPhone, 10 October 2026: Ozi listened by itself as soon as it had finished
 * speaking, with nobody touching the screen. Safari refuses the microphone to a page that asks
 * that way, without ever showing its own "Allow microphone?" question, and Ozi then said the
 * microphone was not allowed and to go to Settings. A person handed a flyer in the street will
 * not go to Settings. So the first listening of a visit starts only from a tap, and when
 * something does go wrong, the words say exactly what to tap on the phone in hand.
 *
 * Everything here works from the browser's own description of itself (its user agent), and
 * is plain functions, so the tests can try every phone without owning one.
 */

/** What matters about the browser in hand. */
export interface BrowserFacts {
  /** An iPhone or iPad. */
  iPhone: boolean;
  android: boolean;
  /**
   * The page was opened inside another app (Instagram, Facebook, Messenger, LinkedIn, Gmail,
   * TikTok and the like), whose own browser has no voice. The app's name when known, or
   * "another app".
   */
  inApp: string | null;
}

/** Named apps, by the mark each puts in its browser's description of itself. */
const IN_APP_MARKS: Array<[RegExp, string]> = [
  [/Instagram/i, 'Instagram'],
  [/FB_IAB\/MESSENGER|\bMessenger(ForiOS|Lite)?\b|Orca-Android/i, 'Messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS|\bFB4A\b/i, 'Facebook'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/\bGmail\b|GoogleMail/i, 'Gmail'],
  [/\bGSA\//, 'the Google app'],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/Twitter|\bX-iOS\b/i, 'X'],
  [/Pinterest/i, 'Pinterest'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bLine\//, 'LINE'],
  [/WhatsApp/i, 'WhatsApp'],
];

/** iPhone, iPad, or an iPad describing itself as a Mac (it has a touch screen; a Mac has not). */
function isIPhone(ua: string, touchPoints: number): boolean {
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1);
}

/**
 * Which app's own browser this is, if any. A page in a browser of its own, such as Safari,
 * Chrome, Edge or Firefox, is not in an app.
 */
export function inAppBrowser(ua: string, touchPoints = 0): string | null {
  for (const [mark, name] of IN_APP_MARKS) if (mark.test(ua)) return name;
  // Android's built-in web view, which apps use to show pages: marked "; wv)".
  if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) return 'another app';
  // On an iPhone, every real browser says "Safari/" at the end; an app's own view does not.
  if (isIPhone(ua, touchPoints) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) {
    return 'another app';
  }
  return null;
}

export function browserFacts(ua: string, touchPoints = 0): BrowserFacts {
  return {
    iPhone: isIPhone(ua, touchPoints),
    android: /Android/i.test(ua),
    inApp: inAppBrowser(ua, touchPoints),
  };
}

/**
 * The browser in hand. Inside the App Store or Google Play app (packages/mobile) the page is
 * in a web view too, but it is our own app, which asks for the microphone itself: never told
 * to open in another browser.
 */
export function currentBrowser(): BrowserFacts {
  if (typeof navigator === 'undefined') return { iPhone: false, android: false, inApp: null };
  const facts = browserFacts(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const bridge = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  let ourApp = false;
  try {
    ourApp = bridge?.isNativePlatform?.() === true;
  } catch {
    ourApp = false;
  }
  return ourApp ? { ...facts, inApp: null } : facts;
}

/** The browser to open the page in instead: Safari on an iPhone, Chrome everywhere else. */
export function betterBrowser(facts: BrowserFacts): string {
  return facts.iPhone ? 'Safari' : 'Chrome';
}

/** On the big button, before the first listening of a visit. `assistant` is from config. */
export function tapToTalkLabel(assistant: string): string {
  return `Tap to talk to ${assistant}`;
}

/** Shown, and said, just before the browser asks. */
export const ALLOW_LINE = 'Your phone will ask to use the microphone. Tap Allow.';

/** For the install and help steps on the flyer, the Help page and Get the app. */
export function allowStep(assistant: string): string {
  return `When asked, tap Allow so ${assistant} can hear you.`;
}

/** "Or just type, or call us", with the number when there is a real one. */
export function typeOrCall(telephone: string | null): string {
  return telephone ? `Or just type, or call us on ${telephone}.` : 'Or just type, or call us.';
}

/** After a tap, the browser said no: how to say yes, on this phone. */
export function deniedMessage(facts: BrowserFacts, telephone: string | null): string {
  if (facts.inApp) return openElsewhereMessage(facts);
  const how = facts.iPhone
    ? 'Tap the aA button by the web address, then Website Settings, then Microphone, Allow.'
    : facts.android
      ? 'Tap the lock by the web address, then Permissions, then Microphone, Allow.'
      : 'Click the lock by the web address, then allow the microphone.';
  return `${how} ${typeOrCall(telephone)}`;
}

/** The speech service itself is off, rather than the microphone refused. */
export function serviceOffMessage(facts: BrowserFacts, telephone: string | null): string {
  if (facts.inApp) return openElsewhereMessage(facts);
  if (facts.iPhone) {
    return 'Voice needs Dictation switched on: Settings, General, Keyboard, Enable Dictation.';
  }
  return `Voice is switched off in this browser. ${typeOrCall(telephone)}`;
}

/** No speech recognition in this browser at all. */
export function unsupportedMessage(facts: BrowserFacts): string {
  if (facts.inApp) return openElsewhereMessage(facts);
  return `Voice doesn't work in this browser. You can type, or open this page in ${betterBrowser(facts)}.`;
}

/** The page is inside another app's browser. */
export function openElsewhereMessage(facts: BrowserFacts): string {
  return `Voice doesn't work inside ${facts.inApp ?? 'this app'}. You can type, or open this page in ${betterBrowser(facts)}.`;
}

/** The banner at the top of the page, inside another app. `assistant` is from config. */
export function openElsewhereBanner(facts: BrowserFacts, assistant: string): string {
  return `For ${assistant}'s voice, open this page in ${betterBrowser(facts)}.`;
}

/**
 * An Android link that opens this same page in Chrome, out of the app it was opened in. Null
 * for anything but an ordinary web address.
 */
export function openInChromeLink(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const scheme = url.protocol.replace(':', '');
  const rest = `${url.host}${url.pathname}${url.search}`;
  const fallback = encodeURIComponent(url.href);
  return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}
