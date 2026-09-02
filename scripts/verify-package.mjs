#!/usr/bin/env node
//
// Guards the shape of what npm would actually publish.
//
// The three things that break a freshly published package, in order of how
// often they bite:
//
//   1. types that do not resolve because `exports` lists them after `import`;
//   2. a CJS consumer getting an ESM-only file;
//   3. tests, stories or source maps of internal tooling shipped by accident.
//
// `pnpm pack` produces the real tarball, so this checks the real thing rather
// than assumptions about it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REQUIRED = [
  'package/dist/index.js',
  'package/dist/index.cjs',
  'package/dist/index.d.ts',
  'package/dist/headless.js',
  'package/dist/headless.cjs',
  'package/dist/headless.d.ts',
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
];

const FORBIDDEN_PATTERNS = [
  /\.test\./,
  /\.stories\./,
  /^package\/src\//,
  /^package\/bench\//,
  /^package\/test\//,
];

const workdir = mkdtempSync(join(tmpdir(), 'ai-chat-kit-pack-'));

try {
  const tarball = execFileSync(
    'pnpm',
    ['pack', '--pack-destination', workdir],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .at(-1);

  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const missing = REQUIRED.filter((file) => !listing.includes(file));
  if (missing.length > 0) {
    console.error('Missing from the tarball:\n  ' + missing.join('\n  '));
    process.exit(1);
  }

  const leaked = listing.filter((file) =>
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(file)),
  );
  if (leaked.length > 0) {
    console.error('These should not be published:\n  ' + leaked.join('\n  '));
    process.exit(1);
  }

  // `types` must come first in every exports condition, or TypeScript resolves
  // the JS file and reports the package as untyped.
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
    if (typeof conditions !== 'object') continue;
    const [first] = Object.keys(conditions);
    if (first !== 'types') {
      console.error(
        `exports["${subpath}"] lists "${first}" before "types" — TypeScript will not find the declarations.`,
      );
      process.exit(1);
    }
  }

  console.log(`✓ tarball contains ${listing.length} files, all expected`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
