import type { StorybookConfig } from '@storybook/react-vite';

// Storybook is this package's live documentation: the demo on GitHub Pages is
// the built output. Every story runs on MockTransport, so it works with no API
// key, offline, and shows states a live demo cannot reach on demand — a
// mid-stream Stop, a 502 after two tokens, a rate limit.
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)', '../stories/**/*.mdx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  typescript: { check: false, reactDocgen: 'react-docgen-typescript' },
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    // GitHub Pages serves under /<repo>/; locally the default '/' applies.
    base: process.env.STORYBOOK_BASE_PATH ?? '/',
  }),
};

export default config;
