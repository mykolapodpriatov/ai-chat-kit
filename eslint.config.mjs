import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'storybook-static/**'] },
  js.configs.recommended,
  {
    // Build and release tooling runs in Node, not the browser.
    files: ['scripts/**/*.mjs', '*.config.{ts,mts,mjs}'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The whole point of the core layer is that it does not know about React.
      // Enforce it rather than trusting a convention.
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/transport/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'src/core and src/transport must stay React-free — that is what makes them testable without a DOM and reusable outside React.',
            },
          ],
        },
      ],
    },
  },
);
