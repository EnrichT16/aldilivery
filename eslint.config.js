// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Aldilivery lint rules.
 *
 * The accessibility rules are not advisory. `eslint-plugin-jsx-a11y` runs in its strict
 * configuration over every screen, and the web package's build fails on any warning, so an
 * unlabelled control cannot reach a bundle. Rule Seven.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/coverage/**',
      '**/build/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // The web package: browser globals, React hooks rules, and the accessibility rules.
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.configs.strict.rules,
      ...reactHooks.configs.recommended.rules,

      // Anchors that go nowhere are a trap for a screen reader user.
      'jsx-a11y/anchor-is-valid': 'error',
      // A label must be joined to its control, not merely near it.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either' }],
      // Nothing may be reachable only by mouse.
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      // A positive tabindex reorders the page for keyboard users in ways nobody expects.
      'jsx-a11y/tabindex-no-positive': 'error',
    },
  },

  // Tests may reach for things that production code may not.
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // The Prisma backed repository maps generated types onto ours at the boundary.
  {
    files: ['packages/api/src/data/prisma.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  prettier,
);
