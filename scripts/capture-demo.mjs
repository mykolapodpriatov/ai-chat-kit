#!/usr/bin/env node
//
// Captures the README media from the built Storybook.
//
// A static screenshot cannot show the one thing this library is about, so the
// primary artefact is an animated GIF of a reply streaming in. Frames are taken
// from the real demo story — no mock-ups, no editing.
//
//   pnpm build-storybook
//   npx serve storybook-static -l 6099   (or any static server)
//   node scripts/capture-demo.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../docs/images');
const FRAMES = resolve(HERE, '../.frames');
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:6099';

const STORY = 'chat--slow-enough-to-interrupt';
const FRAME_COUNT = 34;
const FRAME_DELAY_MS = 180;

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 900, height: 560 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // iframe.html renders the story on its own, without the Storybook chrome —
  // the README should show the component, not the tool it was built in.
  await page.goto(`${BASE}/iframe.html?id=${STORY}&viewMode=story`, {
    waitUntil: 'networkidle',
  });

  await page.getByLabel('Message').fill('Why not just use useState?');
  await page.getByRole('button', { name: 'Send' }).click();

  // Clip to the component rather than the page: the README should show the
  // chat, not the empty canvas Storybook centres it on. The box is measured
  // once and reused so the frames do not jitter as the transcript grows.
  const chat = page.locator('.demo-chat');
  const box = await chat.boundingBox();
  if (!box) throw new Error('Could not find the demo chat to capture.');
  const clip = {
    x: Math.max(0, Math.floor(box.x) - 8),
    y: Math.max(0, Math.floor(box.y) - 8),
    width: Math.ceil(box.width) + 16,
    height: Math.ceil(box.height) + 16,
  };

  for (let i = 0; i < FRAME_COUNT; i += 1) {
    await page.screenshot({
      path: join(FRAMES, `frame-${String(i).padStart(3, '0')}.png`),
      clip,
    });
    await page.waitForTimeout(FRAME_DELAY_MS);
  }

  await page.screenshot({ path: join(OUT, 'streaming.png'), clip });
  process.stdout.write(`✓ ${readdirSync(FRAMES).length} frames captured\n`);

  await context.close();
  await browser.close();

  // ffmpeg is the only dependency not in package.json; if it is missing the
  // still image is still produced, which is better than failing outright.
  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-framerate',
        '6',
        '-pattern_type',
        'glob',
        '-i',
        join(FRAMES, '*.png'),
        '-vf',
        'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
        '-loop',
        '0',
        join(OUT, 'streaming.gif'),
      ],
      { stdio: 'pipe' },
    );
    process.stdout.write('✓ docs/images/streaming.gif\n');
  } catch {
    process.stdout.write('! ffmpeg not available — wrote streaming.png only\n');
  } finally {
    rmSync(FRAMES, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
