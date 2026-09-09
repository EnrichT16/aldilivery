/**
 * Tailwind reads the brand from config/store.json.
 *
 * Rule Nine: the colours are configuration. Changing the brand is a JSON edit, not a hunt
 * through stylesheets. The names below are roles, not colours, so a future brand that is
 * not navy and gold still reads sensibly in the markup.
 */
import { readFileSync } from 'node:fs';

const storeConfig = JSON.parse(
  readFileSync(new URL('../../config/store.json', import.meta.url), 'utf8'),
);

const { navy, gold, white } = storeConfig.brand.colours;
const { baseFontSizePx, minimumControlHeightPx } = storeConfig.accessibility;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: navy,
        highlight: gold,
        paper: white,
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
    },
  },
  plugins: [],
};
