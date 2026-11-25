#!/usr/bin/env node
/**
 * Owner-visual gallery capture (R2-2 — plan Conformance O08): phone-viewable
 * screenshots from a REAL passing run, committed under
 * docs/evidence/R2-2/owner/ with a gallery.md.
 *
 * What the owner confirms (plan row O08): "PostClip behaves like a component
 * inside a host app: it fits the frame, the hand-off round trip works,
 * nothing looks broken" — captured at BOTH 390×844 and 360×800:
 *   1. the demo host page (a mock "mobile app" frame) with PostClip embedded:
 *      the app's home screen fits the phone frame, nothing pokes out;
 *   2. the round trip: the host's Send button hands a real screenshot over,
 *      real in-browser OCR runs inside the frame, and the host receives the
 *      text (visible below the phone) — plus the app's result screen inside
 *      the frame;
 *   3. the same phone view in dark mode (the issue: light and dark both fine).
 *
 * Runs against the TEST build (npm run build:test) in Chromium. The e2e suite
 * (both engines, all viewports) is the machine matrix; this gallery is what
 * the owner opens on a phone.
 *
 * Usage: node scripts/capture_owner_gallery_r2_2.mjs   (after npm run build:test)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'docs/evidence/R2-2/owner');
const APP_PORT = 4173;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const HOST_PORT = 4199;
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(url, timeoutMs = 60_000, expectOk = true) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (!expectOk || res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await sleep(500);
  }
  throw new Error(`server at ${url} never came up (${lastErr})`);
}

function startPreview() {
  const child = spawn('npm', ['run', 'preview'], { cwd: ROOT, stdio: 'ignore', detached: false });
  const stop = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already dead — nothing to do
    }
  };
  process.once('exit', stop);
  return { child, stop };
}

function startHostServer() {
  const html = readFileSync(join(ROOT, 'e2e/fixtures/host/host.html'), 'utf-8');
  const png = readFileSync(join(ROOT, 'fixtures/images/clean01.png'));
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/host.html' || path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (path === '/fixture.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  const stop = () => new Promise((resolve) => server.close(() => resolve()));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(HOST_PORT, '::', () => resolve({ server, stop }));
  });
}

const hostPage = (params = '') => `${HOST_ORIGIN}/host.html?app=${encodeURIComponent(APP_ORIGIN)}&allow=${encodeURIComponent(HOST_ORIGIN)}${params}`;

async function main() {
  if (!existsSync(join(ROOT, 'dist/index.html'))) {
    throw new Error('dist/index.html missing — run npm run build:test first');
  }
  mkdirSync(OUT, { recursive: true });

  const preview = startPreview();
  await waitUp(`${APP_ORIGIN}/`);
  const host = await startHostServer();
  await waitUp(`${HOST_ORIGIN}/host.html`);

  const browser = await chromium.launch();
  const shots = [];
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const tag = vp.name.replace('x', '-');

      // 1. the demo host page with PostClip embedded (home inside the frame)
      await page.goto(hostPage());
      await page.frameLocator('#postclip-frame').getByRole('button', { name: 'Choose screenshot' })
        .waitFor({ timeout: 60_000 });
      const home = `o08-host-page-embedded-home-${tag}.png`;
      await page.screenshot({ path: join(OUT, home), fullPage: true });
      shots.push({ file: home, caption: `The demo host app with PostClip embedded (${vp.name}) — the app fits the frame` });

      // 2. the round trip: Send → real OCR inside the frame → the host gets the text
      await page.locator('#send-btn').click();
      await page.locator('#result-text').waitFor({ state: 'visible', timeout: 240_000 });
      const round = `o08-host-page-round-trip-result-${tag}.png`;
      await page.screenshot({ path: join(OUT, round), fullPage: true });
      shots.push({ file: round, caption: `The round trip (${vp.name}) — the host app received the text (below the phone); the app's result screen is inside the frame` });

      // 3. dark mode phone view
      await page.emulateMedia({ colorScheme: 'dark' });
      const dark = `o08-host-page-embedded-home-${tag}-dark.png`;
      await page.screenshot({ path: join(OUT, dark), fullPage: true });
      shots.push({ file: dark, caption: `Dark mode (${vp.name}) — the embedded app and the host page both fine` });

      await page.close();
    }
  } finally {
    await browser.close();
    await host.stop();
    preview.stop();
  }

  const md = [
    '# O08 — PostClip inside a host app (R2-2 owner gallery)',
    '',
    'Every screenshot below is from a REAL passing run (the same demo host page the e2e',
    'suite drives: `e2e/fixtures/host/host.html` on a second origin, PostClip embedded in a',
    `cross-origin iframe at \`${APP_ORIGIN}\`). The host app hands a screenshot over through the`,
    'postMessage contract; the text comes back below the phone. Open this file on a phone.',
    '',
    ...shots.map((s) => `## ${s.caption}\n\n![${s.caption}](${s.file})\n`),
    '---',
    'The owner confirms (plan row O08): PostClip behaves like a component inside a host app —',
    'it fits the frame, the hand-off round trip works, nothing looks broken.',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'gallery.md'), md);
  console.log(`O08 gallery: ${shots.length} screenshots under ${join('docs/evidence/R2-2/owner')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
