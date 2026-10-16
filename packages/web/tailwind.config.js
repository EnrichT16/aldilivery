/**
 * Tailwind reads the brand from config/store.json.
 *
 * Rule Nine: the colours are configuration. Changing the brand is a JSON edit, not a hunt
 * through stylesheets. The names below are roles, not colours, so a future brand that is
 * not navy and gold still reads sensibly in the markup.
 *
 * Each role is a CSS variable holding red, green and blue channels, so that `bg-paper/10`
 * and the like still work, and so that the light appearance (Settings, "Appearance") can swap
 * `ink` and `paper` over without a second set of class names. The brand's own values are
 * written to `:root` here, at build time, from the same file; `applyBrandToDocument` writes
 * them again at run time.
 */
import { readFileSync } from 'node:fs';

const storeConfig = JSON.parse(
  readFileSync(new URL('../../config/store.json', import.meta.url), 'utf8'),
);

const { navy, gold, white, listening } = storeConfig.brand.colours;
const { baseFontSizePx, minimumControlHeightPx } = storeConfig.accessibility;

/** `#0B1F3A` becomes `11 31 58`, the form `rgb(… / alpha)` takes. */
function channels(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(' ');
}

const role = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The page and its words: swapped over in the light appearance.
        ink: role('--ink-rgb'),
        paper: role('--paper-rgb'),
        // The one primary action on a screen. The same in either appearance.
        highlight: role('--highlight-rgb'),
        // Ozi's bubble while it listens or talks, and nothing else.
        listening: role('--listening-rgb'),
        // Words and edges on top of gold or green: dark in either appearance, so the
        // contrast on those two colours never changes.
        'on-accent': role('--on-accent-rgb'),
      },
      fontSize: {
        // The default body size for this product, from configuration. Twenty pixels, not
        // sixteen, because our users are not twenty five with perfect eyesight.
        base: [`${baseFontSizePx}px`, { lineHeight: '1.6' }],
        lead: [`${Math.round(baseFontSizePx * 1.4)}px`, { lineHeight: '1.45' }],
        display: [`${Math.round(baseFontSizePx * 2)}px`, { lineHeight: '1.25' }],
      },
      minHeight: {
        control: `${minimumControlHeightPx}px`,
      },
      minWidth: {
        control: `${minimumControlHeightPx}px`,
      },
      transitionDuration: {
        DEFAULT: '180ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
    },
  },
  plugins: [
    ({ addBase }) => {
      addBase({
        ':root': {
          '--brand-ink-rgb': channels(navy),
          '--brand-paper-rgb': channels(white),
          '--brand-highlight-rgb': channels(gold),
          '--brand-listening-rgb': channels(listening),
          '--base-font-size': `${baseFontSizePx}px`,
          '--control-height': `${minimumControlHeightPx}px`,
        },
      });
    },
  ],
};
