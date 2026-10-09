/**
 * Putting the website on a phone's home screen (ruling 50): the manifest, the icons, the iPhone
 * tags, the offline rules, and the "Get the app" steps for both kinds of phone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APPLE_TOUCH_ICON, ICONS, INCLUDE_ASSETS, WORKBOX, webAppManifest } from '../pwa';
import { ANDROID_HINT, GetTheApp, IPHONE_HINT } from '../src/components/GetTheApp';
import { storeConfig } from '../src/config';
import { Help } from '../src/pages/Help';

/** Vitest runs in packages/web, whichever way it is started (pnpm --filter, or the build). */
const publicFile = (name: string): string => join(process.cwd(), 'public', name.replace(/^\//, ''));

/** The width and height written in a PNG file's header. */
function pngSize(name: string): { width: number; height: number } {
  const bytes = readFileSync(publicFile(name));
  expect(bytes.subarray(1, 4).toString('ascii'), `${name} is a PNG`).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the web app manifest', () => {
  const manifest = webAppManifest(storeConfig);

  it('takes its name, description and colours from config/store.json (Rule Nine)', () => {
    expect(manifest.name).toBe(storeConfig.productName);
    expect(manifest.short_name).toBe(storeConfig.productName);
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.description).toBe(storeConfig.tagline);
    expect(manifest.theme_color).toBe(storeConfig.brand.colours.navy);
    expect(manifest.background_color).toBe(storeConfig.brand.colours.navy);
  });

  it('opens full screen at the home page, and covers the whole site', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.id).toBe('/');
    expect(manifest.lang).toBe('en-GB');
  });

  it('never locks the phone upright (WCAG 2.2, 1.3.4 Orientation)', () => {
    expect(manifest.orientation).toBe('any');
  });

  it('has 192 and 512 pixel icons, ordinary and maskable, each really that size', () => {
    for (const size of ['192x192', '512x512']) {
      for (const purpose of ['any', 'maskable']) {
        expect(manifest.icons.some((icon) => icon.sizes === size && icon.purpose === purpose)).toBe(
          true,
        );
      }
    }
    for (const icon of ICONS) {
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(icon.src), icon.src).toEqual({ width, height });
    }
  });

  it('keeps every icon for working without a signal', () => {
    for (const name of INCLUDE_ASSETS) {
      expect(() => readFileSync(publicFile(name)), name).not.toThrow();
    }
    expect(INCLUDE_ASSETS).toContain('apple-touch-icon.png');
  });
});

describe('the page an iPhone reads when adding it to the home screen', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  it('has a 180 pixel home screen icon, which is what iOS uses', () => {
    expect(html).toContain(
      `<link rel="apple-touch-icon" sizes="180x180" href="${APPLE_TOUCH_ICON.src}" />`,
    );
    expect(pngSize(APPLE_TOUCH_ICON.src)).toEqual({ width: 180, height: 180 });
  });

  it('opens full screen with the name from configuration under the icon', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain(
      '<meta name="apple-mobile-web-app-title" content="%STORE_PRODUCT_NAME%" />',
    );
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style"');
    expect(html).toContain('<meta name="theme-color" content="%STORE_NAVY%" />');
  });

  it('lets people pinch to zoom (ruling 43)', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });
});

describe('working without a signal', () => {
  it('answers any page with the app itself, which then says it cannot reach us', () => {
    expect(WORKBOX.navigateFallback).toBe('/index.html');
    expect(WORKBOX.globPatterns.join()).toContain('html');
  });

  it('never answers the API with the cached app', () => {
    const denied = (path: string): boolean =>
      WORKBOX.navigateFallbackDenylist.some((rule) => rule.test(path));
    expect(denied('/api')).toBe(true);
    expect(denied('/api/health')).toBe(true);
    expect(denied('/apiary')).toBe(false);
    expect(denied('/shop')).toBe(false);
  });
});

describe('Get the app', () => {
  const realAgent = navigator.userAgent;
  function pretendToBe(agent: string): void {
    Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true });
  }
  afterEach(() => {
    pretendToBe(realAgent);
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
  });

  it('writes out the steps for an iPhone (Share, then Add to Home Screen) and for Android', () => {
    render(<GetTheApp />);
    const iPhone = screen.getByRole('region', { name: 'On an iPhone or iPad' });
    expect(within(iPhone).getByText(/Open this page in Safari/)).toBeInTheDocument();
    expect(within(iPhone).getByText(/Press the Share button/)).toBeInTheDocument();
    expect(within(iPhone).getByText(/Add to Home Screen/)).toBeInTheDocument();
    const android = screen.getByRole('region', { name: 'On an Android phone' });
    expect(within(android).getByText(/Install app, or Add to Home screen/)).toBeInTheDocument();
  });

  it("puts the reader's own phone first", () => {
    pretendToBe(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    );
    render(<GetTheApp />);
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['On an iPhone or iPad', 'On an Android phone']);
  });

  it('tells an iPhone user what to press when the button is pressed', async () => {
    pretendToBe(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    );
    render(<GetTheApp />);
    await userEvent.click(
      screen.getByRole('button', { name: `Put ${storeConfig.productName} on my phone` }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(IPHONE_HINT);
    expect(IPHONE_HINT).toMatch(/Share button, then choose Add to Home Screen/);
  });

  it('tells an Android user where the menu is when Chrome has not offered to install', async () => {
    pretendToBe(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    );
    render(<GetTheApp />);
    await userEvent.click(
      screen.getByRole('button', { name: `Put ${storeConfig.productName} on my phone` }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(ANDROID_HINT);
  });

  it('keeps the steps behind one press where space is short', () => {
    render(<GetTheApp compact />);
    expect(screen.getByText('How to do it on an iPhone or Android')).toBeInTheDocument();
  });

  it('is not shown inside the App Store or Google Play app', () => {
    (window as Window & { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const { container } = render(<GetTheApp />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not shown once the app is on the home screen', () => {
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation(
        (query: string) => ({ matches: query.includes('standalone') }) as MediaQueryList,
      );
    const { container } = render(<GetTheApp />);
    expect(container).toBeEmptyDOMElement();
    matchMedia.mockRestore();
  });
});

describe('help and contact, the support page in the store listings', () => {
  it('says how to reach a person and how to close an account, with a link Google Play can name', () => {
    const { container } = render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Help and contact' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Talk to a person' })).toBeInTheDocument();
    const closing = container.querySelector('#close-account');
    expect(closing).not.toBeNull();
    expect(closing).toHaveTextContent(`waits ${storeConfig.accountDeletion.recycleBinDays} days`);
    expect(within(closing as HTMLElement).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });
});
