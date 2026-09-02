import { defineConfig } from 'tsup';

// Two entry points on purpose:
//
//   index    — hooks + components, what most consumers want
//   headless — core + hooks only, for teams bringing their own UI
//
// Shipping both from one build means the headless path costs nothing extra at
// runtime and cannot drift from the full one.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    headless: 'src/headless.ts',
  },
  format: ['esm', 'cjs'],
  // Declarations are emitted by tsc, not tsup: tsup's d.ts worker injects the
  // deprecated `baseUrl` compiler option, which TypeScript 6 errors on and 7
  // removes. `tsc --emitDeclarationOnly` has no such problem and is one fewer
  // moving part between the source and the published types.
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom'],
});
