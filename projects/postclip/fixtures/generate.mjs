/**
 * Generate the synthetic fixture screenshots + gold JSON + manifest.
 *
 * Deterministic: content is fixed in fixture-data.mjs, fonts are system fonts,
 * rendering happens in headless Chromium at a fixed viewport and device scale
 * factor. Committed PNGs are the artifacts of one run; CI never regenerates
 * them (the manifest lint checks them).
 *
 * Usage: node fixtures/generate.mjs
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, REACTION_LABELS, chromeStrings, ocrExpected } from './fixture-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(HERE, 'images');
const GOLD_DIR = join(HERE, 'gold');

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderCard(f) {
  const dark = f.theme === 'dark';
  const colors = dark
    ? { bg: '#101418', card: '#1a2027', text: '#e8eaf0', muted: '#9aa4b0', border: '#2c343e', chip: '#22303c' }
    : { bg: '#f7f7f5', card: '#ffffff', text: '#1a1d21', muted: '#5c6470', border: '#d9dde3', chip: '#eef2f7' };
  const initials = f.author
    .split(' ')
    .map((p) => p[0])
    .join('');
  const avatarBg = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#be123c'][f.id.charCodeAt(f.id.length - 1) % 5];
  const reaction = REACTION_LABELS[f.id];
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${colors.bg}; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { padding: 24px; width: 640px; }
  .card {
    width: 592px; background: ${colors.card}; border: 1px solid ${colors.border};
    border-radius: 12px; padding: 20px 22px; color: ${colors.text};
  }
  .promoted { display:inline-block; color:${colors.muted}; font-size:13px; margin-bottom:10px; }
  .head { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
  .avatar { width:44px; height:44px; border-radius:50%; background:${avatarBg}; color:#fff;
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:17px; }
  .name { font-weight:700; font-size:16px; }
  .meta { color:${colors.muted}; font-size:13.5px; }
  .body { font-size:16px; line-height:1.55; white-space:pre-line; }
  .reactions { color:${colors.muted}; font-size:13.5px; margin-top:14px; padding-top:10px;
    border-top:1px solid ${colors.border}; }
  .actions { display:flex; justify-content:center; gap:28px; margin-top:10px; padding-top:10px;
    border-top:1px solid ${colors.border}; align-items:center; }
  .action { color:${colors.muted}; font-size:14px; font-weight:600; }
  .follow { background:${colors.chip}; border-radius:9999px; padding:4px 14px;
    font-weight:700; font-size:14px; }
</style></head>
<body><div class="wrap"><div class="card" id="post-card">
  ${f.promoted ? '<span class="promoted">Promoted</span><br>' : ''}
  <div class="head">
    <div class="avatar">${escapeHtml(initials)}</div>
    <div>
      <div class="name">${escapeHtml(f.author)}</div>
      <div class="meta">${escapeHtml(f.handle)} · ${escapeHtml(f.time)}</div>
    </div>
  </div>
  <div class="body">${escapeHtml(f.body.join('\n'))}</div>
  <div class="reactions">${escapeHtml(reaction)}</div>
  <div class="actions">
    <span class="action">Like</span><span class="action">Comment</span><span class="action">Share</span>
    ${f.kind === 'chrome' ? '<span class="follow">Follow</span>' : ''}
  </div>
</div></div></body></html>`;
}

async function main() {
  rmSync(IMAGES_DIR, { recursive: true, force: true });
  rmSync(GOLD_DIR, { recursive: true, force: true });
  mkdirSync(IMAGES_DIR, { recursive: true });
  mkdirSync(GOLD_DIR, { recursive: true });
  if (readdirSync(IMAGES_DIR).length > 0) throw new Error('images dir not empty after clean');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const manifest = { schema: 'postclip-fixtures/1', synthetic: true, images: [] };
  for (const f of FIXTURES) {
    const html = renderCard(f);
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pngPath = join(IMAGES_DIR, `${f.id}.png`);
    await page.locator('#post-card').screenshot({ path: pngPath });

    const gold = {
      id: f.id,
      kind: f.kind,
      theme: f.theme,
      author: f.author,
      handle: f.handle,
      language: 'en',
      body: f.body,
      chrome: chromeStrings(f),
      ocr_expected: ocrExpected(f),
      synthetic: true,
    };
    writeFileSync(join(GOLD_DIR, `${f.id}.json`), JSON.stringify(gold, null, 2) + '\n');

    const bytes = statSync(pngPath).size;
    const sha = createHash('sha256').update(readFileSync(pngPath)).digest('hex');
    manifest.images.push({
      id: f.id,
      file: `images/${f.id}.png`,
      sha256: sha,
      size_bytes: bytes,
      synthetic: true,
      gold: `gold/${f.id}.json`,
      note: 'Synthetic content: fictional author and company, generated from fixture-data.mjs.',
    });
    console.log(`${f.id}.png ${bytes} bytes`);
  }
  await browser.close();

  writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = manifest.images.reduce((sum, img) => sum + img.size_bytes, 0);
  console.log(`manifest.json written: ${manifest.images.length} images, ${total} bytes total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
