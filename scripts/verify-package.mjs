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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  // Resolution is the thing that actually breaks for consumers, and it cannot
  // be checked by reading package.json — install the tarball and import it.
  const consumer = join(workdir, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  );
  // React and its types are peer dependencies, so a consumer always has them.
  // Installing them here means the probe compiles against the same shape a real
  // project does — without them the check would pass for the wrong reason.
  execFileSync(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      tarball,
      'react@19',
      'react-dom@19',
      '@types/react@19',
    ],
    { cwd: consumer, stdio: 'pipe' },
  );

  const checks = [
    [
      'ESM default entry',
      "import('@podpriatov/ai-chat-kit').then((m) => { if (typeof m.createChatStore !== 'function') throw new Error('createChatStore missing'); })",
    ],
    [
      'ESM headless subpath',
      "import('@podpriatov/ai-chat-kit/headless').then((m) => { if (typeof m.useChatStream !== 'function') throw new Error('useChatStream missing'); if ('Chat' in m) throw new Error('headless must not export components'); })",
    ],
    [
      'CJS default entry',
      "const m = require('@podpriatov/ai-chat-kit'); if (typeof m.createChatStore !== 'function') throw new Error('createChatStore missing from CJS');",
    ],
  ];

  for (const [label, source] of checks) {
    const isCjs = label.startsWith('CJS');
    execFileSync(
      'node',
      ['--input-type', isCjs ? 'commonjs' : 'module', '-e', source],
      { cwd: consumer, stdio: 'pipe' },
    );
    console.log(`✓ ${label} resolves`);
  }

  // Types are the third thing that breaks, and the `exports` check above only
  // proves the key order — not that the declarations actually compile against a
  // consumer's own settings. So compile a real file.
  writeFileSync(
    join(consumer, 'probe.ts'),
    [
      "import { createChatStore, useChatStream, Chat } from '@podpriatov/ai-chat-kit';",
      "import { createMockTransport } from '@podpriatov/ai-chat-kit/headless';",
      'const store = createChatStore();',
      'const first: string | undefined = store.getSnapshot().messages[0]?.content;',
      'export { store, first, useChatStream, Chat, createMockTransport };',
    ].join('\n'),
  );
  execFileSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js'),
      '--noEmit',
      '--strict',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--jsx',
      'react-jsx',
      '--target',
      'es2022',
      '--lib',
      'es2022,dom',
      'probe.ts',
    ],
    { cwd: consumer, stdio: 'inherit' },
  );
  console.log('✓ TypeScript declarations resolve and compile');

  console.log(`✓ tarball contains ${listing.length} files, all expected`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
