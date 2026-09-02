import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects, matching the two halves of the library:
//
//   node — src/core and src/transport. No DOM, no React. If a test here needs
//          jsdom, something has leaked across the boundary.
//   dom  — hooks and components under jsdom + Testing Library.
//
// No path aliases on purpose: this is a published package, and tsup's d.ts
// build needs the deprecated `baseUrl` to honour them. Relative imports inside
// a library this size cost nothing and remove a whole class of resolution
// problems for consumers.

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          globals: true,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx', 'test/**/*.test.tsx'],
          setupFiles: ['./test/setup-dom.ts'],
          globals: true,
        },
      },
    ],
  },
});
