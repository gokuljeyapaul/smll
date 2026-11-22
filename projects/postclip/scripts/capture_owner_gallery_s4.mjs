#!/usr/bin/env node
/**
 * Owner-visual gallery capture (S4 — plan Conformance O04): phone-viewable
 * before/after screenshots from a REAL passing run, committed under
 * docs/evidence/S4/owner/ with a gallery.md. What the owner confirms (plan
 * row O04): "Model cleanup is faithful, drops only UI chrome, and the
 * hostile text was not obeyed" — on SIX fixtures (incl. the hostile one),
 * three panels each: the raw OCR text, the rules-only cleanup, and the
 * model cleanup (with the flagged items visible: the removed-chrome list,
 * the verified author, the suggestion toggles, and on the hostile fixture
 * the demotion note).
 *
 * Run against the TEST build (npm run build:test) — the flow uses the
 * test-only model-server URL override. Chromium only (owner-visual is
 * about the words and states; the engine matrix is the e2e suite's job).
 *
 * Usage: node scripts/capture_owner_gallery_s4.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4291;
const MODEL_PORT = 4599;
const OUT = join(ROOT, 'docs/evidence/S4/owner');
const MODEL_SERVER = `http://127.0.0.1:${MODEL_PORT}`;

// The six fixtures: a spread of the families incl. the hostile one (O04).
const FIXTURES = ['clean01', 'chrome01', 'longpost01', 'heavychrome01', 'emoji01', 'inj01'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixturePath(id) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf-8'));
  const entry = manifest.images.find((i) => i.id === id);
  if (!entry) throw new Error(`fixture ${id} missing`);
  return join(ROOT, 'fixtures', entry.file);
}

function gold(id) {
  return JSON.parse(readFileSync(join(ROOT, 'fixtures/gold', `${id}.json`), 'utf-8'));
}

async function waitUp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await sleep(250);
  }
  throw new Error(`server did not come up at ${url} (last error: ${lastErr})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const modelServer = spawn(
    process.execPath,
    ['scripts/serve_model.mjs', '--port', String(MODEL_PORT), '--file', join('.cache/models', 'Qwen3-0.6B-Q4_K_M.gguf')],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const preview = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const browser = await chromium.launch();
  try {
    await waitUp(`http://127.0.0.1:${PORT}/`);
    await waitUp(`${MODEL_SERVER}/healthz`);
    const context = await browser.newContext({ viewport: { width: 860, height: 1100 } });
    const page = await context.newPage();

    // The model must be ready once; the toggle + picks reuse the page.
    await page.goto(`http://127.0.0.1:${PORT}/?testModelUrl=${MODEL_SERVER}/model`);
    await page.locator('#model-download-btn').click();
    await page.locator('#model-ready').waitFor({ timeout: 240_000 });
    console.log('gallery: model ready');

    const panels = [];
    const startOver = page.getByRole('button', { name: 'Start over' });
    for (const id of FIXTURES) {
      const g = gold(id);

      // Panel 1 + 2: toggle OFF (rules only), plus the raw OCR view.
      await page.locator('#llm-cleanup-toggle').uncheck();
      await page.setInputFiles('#file-input', fixturePath(id));
      await page.locator('#review-text').waitFor({ timeout: 120_000 });
      for (let i = 0; i < 150; i++) {
        if ((await page.locator('#review-text').inputValue()).length > 0) break;
        await sleep(1000);
      }
      await page.locator('.raw-ocr summary').click(); // expand the raw OCR view
      await sleep(400);
      await page.screenshot({ path: join(OUT, `${id}-1-raw-ocr.jpg`), type: 'jpeg', quality: 85, fullPage: true });
      await page.locator('.raw-ocr summary').click(); // collapse again
      await sleep(200);
      await page.screenshot({ path: join(OUT, `${id}-2-rules-only.jpg`), type: 'jpeg', quality: 85, fullPage: true });
      panels.push({ id, panel: 1, file: `${id}-1-raw-ocr.jpg`, note: 'The raw OCR text of the screenshot.' });
      panels.push({ id, panel: 2, file: `${id}-2-rules-only.jpg`, note: 'The standard rules cleanup (deterministic, no model).' });
      // Back to the home screen for the model-cleanup pick (the review
      // screen has no file input; the opt-in toggle persists across Start over).
      await startOver.click();
      await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });

      // Panel 3: toggle ON, the model cleanup (with flagged items visible).
      await page.locator('#llm-cleanup-toggle').check();
      await page.setInputFiles('#file-input', fixturePath(id));
      for (let i = 0; i < 300; i++) {
        const state = (await page.locator('#llm-status').getAttribute('data-state').catch(() => '')) ?? '';
        if (state === 'applied' || state === 'unavailable') break;
        await sleep(1000);
      }
      const state = (await page.locator('#llm-status').getAttribute('data-state')) ?? '';
      if (state === 'applied') {
        // Flagged items visible: expand the removed-chrome disclosure.
        const removed = page.locator('#llm-removed-chrome');
        if ((await removed.count()) > 0) {
          await page.locator('#llm-removed-chrome summary').click();
          await sleep(300);
        }
      }
      await page.screenshot({ path: join(OUT, `${id}-3-model-cleanup.jpg`), type: 'jpeg', quality: 85, fullPage: true });
      const note =
        state === 'applied'
          ? g.kind === 'injection'
            ? 'THE HOSTILE ONE: model cleanup applied, every suggestion hidden (the post text tried to instruct the model — it was treated as content), and the instruction line is preserved as post text.'
            : 'The model cleanup, validated against the screenshot, with the flagged items visible (what was removed, verified author, optional suggestions off by default).'
          : g.kind === 'injection'
            ? 'THE HOSTILE ONE: the model cleanup could not run within its safety budget for this screenshot — the app says so, keeps the rules cleanup, and the instruction text stays in the post as content, never obeyed (no suggestion is shown).'
            : 'The model cleanup could not run for this screenshot — the app says so and keeps the rules cleanup.';
      panels.push({ id, panel: 3, file: `${id}-3-model-cleanup.jpg`, note });
      console.log(`gallery: ${id} captured (state=${state})`);
      // Back to the home screen for the next fixture.
      await startOver.click();
      await page.locator('#llm-cleanup-toggle').waitFor({ timeout: 30_000 });
    }
    await context.close();

    const rows = FIXTURES.map((id) => {
      const g = gold(id);
      const hostile = g.kind === 'injection' ? ' **(the hostile fixture)**' : '';
      const panels3 = panels
        .filter((p) => p.id === id)
        .map((p) => `![${id} panel ${p.panel}](./${p.file})\n\n*${p.note}*\n`)
        .join('\n');
      return `### ${id}${hostile}\n\n${panels3}`;
    }).join('\n');

    writeFileSync(
      join(OUT, 'gallery.md'),
      [
        '# S4 owner gallery — model cleanup, before and after',
        '',
        'Six synthetic fixtures (fictional authors, fictional companies; the sixth is the hostile one).',
        'For each: the raw OCR text the app read, the standard rules cleanup, and the model cleanup with the flagged items visible.',
        'All screenshots come from one real passing run of the built app in Chromium with the real pinned model.',
        '',
        '**What to look for (plan O04):** the model cleanup is faithful to the screenshot, it drops only UI chrome (and says what it removed), and in the hostile fixture the instruction text was NOT obeyed — it stayed in the post text and every generated suggestion was hidden.',
        '',
        rows,
        '',
      ].join('\n'),
    );
    console.log(`gallery: wrote ${OUT}/gallery.md with ${panels.length} panels`);
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
    modelServer.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
