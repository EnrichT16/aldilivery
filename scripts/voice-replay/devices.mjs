// The browsers a replay can pretend to be (ruling 95: Chrome, Safari and most browsers), and
// which Chromium to drive. Playwright's own, or the Chrome at CHROME_PATH where Playwright's
// download is not allowed through.

export const DEVICES = {
  iphone: {
    name: 'Safari on an iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
  'desktop-chrome': {
    name: 'Chrome 130 on Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    mobile: false,
  },
  'android-chrome': {
    name: 'Chrome on a Pixel (Android)',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    mobile: true,
  },
};

/** The device named on the command line: --device=, or --ua= with --viewport=WIDTHxHEIGHT. */
export function pickDevice(args, fallback) {
  const value = (flag) => (args.find((arg) => arg.startsWith(`${flag}=`)) ?? '').slice(flag.length + 1);
  const named = value('--device');
  if (named !== '') {
    const found = DEVICES[named];
    if (!found) throw new Error(`Unknown --device=${named}. One of: ${Object.keys(DEVICES).join(', ')}`);
    return found;
  }
  const ua = value('--ua');
  if (ua === '') return fallback;
  const size = /^(\d+)x(\d+)$/.exec(value('--viewport'));
  return {
    name: `a browser saying "${ua.slice(0, 60)}"`,
    userAgent: ua,
    viewport: size ? { width: Number(size[1]), height: Number(size[2]) } : fallback.viewport,
    mobile: /Mobile|Android|iPhone/.test(ua),
  };
}

/** How to launch: Playwright's Chromium, or the Chrome named in CHROME_PATH. */
export function launchOptions() {
  const path = process.env.CHROME_PATH;
  return path ? { executablePath: path } : {};
}
