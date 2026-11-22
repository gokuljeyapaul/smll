/**
 * Generate the synthetic fixture screenshots + gold JSON + manifest.
 *
 * Deterministic: content is fixed in fixture-data.mjs, fonts are system fonts,
 * rendering happens in headless Chromium at a fixed viewport and device scale
 * factor. Committed images are the artifacts of one run; CI never regenerates
 * them (the manifest lint checks them).
 *
 * S1 additions: localized (de/es) cards, the heavy-chrome variant, low
 * contrast + slight blur variants, a long post (wraps at the card width), a
 * huge ≥ 4000 px render (deviceScaleFactor 7), a tiny 64×64 card, a blank
 * text-free card, plus two byte-level bad-input fixtures written directly:
 * corrupt01.png (valid PNG magic + IHDR, truncated stream) and
 * nonimage01.txt (plain text, not an image at all).
 *
 * Size guard: every committed file must stay ≤ 150 KB (plan "Fixtures and
 * metrics"). The huge render falls back to JPEG (quality 60, deterministic)
 * if the PNG exceeds the limit; the manifest records whichever was written.
 *
 * Usage: node fixtures/generate.mjs
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURES,
  REACTION_LABELS,
  chromeStrings,
  ocrExpected,
  goldLanguage,
  expectedError,
  isBadInputFixture,
  localeOf,
} from './fixture-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(HERE, 'images');
const GOLD_DIR = join(HERE, 'gold');
const FILES_DIR = join(HERE, 'files');
const MAX_BYTES = 150 * 1024;

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cardColors(f) {
  const dark = f.theme === 'dark';
  const base = dark
    ? { bg: '#101418', card: '#1a2027', text: '#e8eaf0', muted: '#9aa4b0', border: '#2c343e', chip: '#22303c' }
    : { bg: '#f7f7f5', card: '#ffffff', text: '#1a1d21', muted: '#5c6470', border: '#d9dde3', chip: '#eef2f7' };
  if (f.lowcontrast) {
    // Degraded-but-still-rendered variant: pale gray on white.
    base.text = '#a6acb4';
    base.muted = '#b8bec6';
  }
  return base;
}

function renderCard(f) {
  const colors = cardColors(f);
  const locale = localeOf(f);
  const cardWidth = f.cardWidth ?? 592;
  const wrapWidth = cardWidth + 48;
  const initials = f.author
    .split(' ')
    .map((p) => p[0])
    .join('');
  const avatarBg = ['#2563eb', '#7c3aed', '#0f766e', '#b45309', '#be123c'][f.id.charCodeAt(f.id.length - 1) % 5];
  const reaction = REACTION_LABELS[f.id];
  const actions = locale.actionRow
    .split(' ')
    .map((w) => `<span class="action">${escapeHtml(w)}</span>`)
    .join('');
  const follow = f.kind === 'chrome' || f.heavy ? '<span class="follow">Follow</span>' : '';
  const connect = f.heavy ? '<span class="follow">Connect</span>' : '';
  const dots = f.heavy ? '<div class="dots">···</div>' : '';
  const blurStyle = f.blur ? ' style="filter: blur(0.7px);"' : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${colors.bg}; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { padding: 24px; width: ${wrapWidth}px; }
  .card {
    width: ${cardWidth}px; background: ${colors.card}; border: 1px solid ${colors.border};
    border-radius: 12px; padding: 20px 22px; color: ${colors.text};
  }
  .promoted { display:inline-block; color:${colors.muted}; font-size:13px; margin-bottom:10px; }
  .dots { color:${colors.muted}; font-size:16px; font-weight:700; text-align:right; margin-bottom:6px; }
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
<body><div class="wrap"><div class="card" id="post-card"${blurStyle}>
  ${f.promoted ? `<span class="promoted">${escapeHtml(locale.promoted)}</span><br>` : ''}${dots}
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
    ${actions}
    ${follow}${connect}
  </div>
</div></div></body></html>`;
}

/** blank01: a card with an avatar block and NO text anywhere. */
function renderBlankCard() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f7f7f5; font-family: system-ui, sans-serif; }
  .wrap { padding: 24px; width: 640px; }
  .card { width: 592px; height: 300px; background: #ffffff; border: 1px solid #d9dde3;
    border-radius: 12px; padding: 20px 22px; }
  .avatar { width:44px; height:44px; border-radius:50%; background:#2563eb; }
  .spacer { height: 180px; background: #eef2f7; border-radius: 8px; margin-top: 14px; }
</style></head>
<body><div class="wrap"><div class="card" id="post-card">
  <div class="avatar"></div>
  <div class="spacer"></div>
</div></div></body></html>`;
}

/** tiny01: a 64×64 mini card, far too small to read (the validator rejects it
 *  before OCR ever runs). */
function renderTinyCard() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f7f7f5; font-family: system-ui, sans-serif; }
  .mini { width: 64px; height: 64px; background: #ffffff; border: 1px solid #d9dde3;
    border-radius: 6px; padding: 4px; font-size: 5px; line-height: 1.3; color: #1a1d21; }
  .avatar { width: 10px; height: 10px; border-radius: 50%; background: #2563eb; margin-bottom: 2px; }
  .muted { color: #5c6470; }
</style></head>
<body><div class="mini" id="post-card">
  <div class="avatar"></div>
  <div>A tiny synthetic post card far too small to read.</div>
  <div class="muted">mini · 2h</div>
</div></body></html>`;
}

/** corrupt01.png bytes: valid PNG signature + IHDR claiming 1184×1400 RGBA,
 *  then a truncated/garbage stream (no IDAT, no IEND). Structurally a PNG
 *  header, undecodable as an image — the corrupt-input case for A07. */
function corruptPngBytes() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1184, 0);
  ihdrData.writeUInt32BE(1400, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  const type = Buffer.from('IHDR');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const crc = Buffer.alloc(4); // zeros: this file is corrupt by construction
  const garbage = Buffer.from(
    'PostClip synthetic corrupt fixture: truncated PNG stream, never a real image. '.repeat(20),
    'utf-8',
  );
  return Buffer.concat([sig, len, type, ihdrData, crc, garbage]);
}

/** nonimage01.txt bytes: a plain-text file, not an image at all. */
function nonImageBytes() {
  return Buffer.from(
    [
      'PostClip synthetic test file.',
      'This is not an image at all, just plain text bytes.',
      'Generated for the S1 fixture set (use case UC11).',
      '',
    ].join('\n'),
    'utf-8',
  );
}

async function main() {
  rmSync(IMAGES_DIR, { recursive: true, force: true });
  rmSync(GOLD_DIR, { recursive: true, force: true });
  rmSync(FILES_DIR, { recursive: true, force: true });
  mkdirSync(IMAGES_DIR, { recursive: true });
  mkdirSync(GOLD_DIR, { recursive: true });
  mkdirSync(FILES_DIR, { recursive: true });
  if (readdirSync(IMAGES_DIR).length > 0) throw new Error('images dir not empty after clean');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 640, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  // longpost01 renders at 1×: the same content at 2× exceeds the 150 KB
  // committed-PNG limit, and 1× (592 px wide, 16 px text) is what a real
  // long screenshot looks like anyway.
  const smallContext = await browser.newContext({
    viewport: { width: 640, height: 900 },
    deviceScaleFactor: 1,
  });
  const smallPage = await smallContext.newPage();
  // huge01: a wide desktop-format screenshot — a 1336 CSS px card at
  // deviceScaleFactor 3 → 4008 device px wide (≥ 4000 px, the plan's
  // "very large" variant) at a size that still fits the 150 KB commit limit.
  const hugeContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 3,
  });
  const hugePage = await hugeContext.newPage();
  // tiny01: 1:1 pixels, 64×64 card.
  const tinyContext = await browser.newContext({
    viewport: { width: 128, height: 128 },
    deviceScaleFactor: 1,
  });
  const tinyPage = await tinyContext.newPage();

  const manifest = { schema: 'postclip-fixtures/1', synthetic: true, images: [] };
  for (const f of FIXTURES) {
    let filePath; // path relative to the fixtures dir, e.g. images/clean01.png
    if (f.kind === 'corrupt') {
      filePath = `images/${f.id}.png`;
      writeFileSync(join(HERE, filePath), corruptPngBytes());
    } else if (f.kind === 'non-image') {
      filePath = `files/${f.id}.txt`;
      writeFileSync(join(HERE, filePath), nonImageBytes());
    } else if (f.kind === 'tiny') {
      filePath = `images/${f.id}.png`;
      await tinyPage.setContent(renderTinyCard(), { waitUntil: 'networkidle' });
      await tinyPage.locator('#post-card').screenshot({ path: join(HERE, filePath) });
    } else if (f.kind === 'blank') {
      filePath = `images/${f.id}.png`;
      await page.setContent(renderBlankCard(), { waitUntil: 'networkidle' });
      await page.locator('#post-card').screenshot({ path: join(HERE, filePath) });
    } else if (f.kind === 'huge') {
      await hugePage.setContent(renderCard(f), { waitUntil: 'networkidle' });
      const pngPath = join(HERE, `images/${f.id}.png`);
      await hugePage.locator('#post-card').screenshot({ path: pngPath });
      if (statSync(pngPath).size <= MAX_BYTES) {
        filePath = `images/${f.id}.png`;
      } else {
        // Deterministic fallback: JPEG (quality 60) keeps the ≥ 4000 px render
        // under the 150 KB commit limit; the manifest records the real format.
        const jpgPath = join(HERE, `images/${f.id}.jpg`);
        await hugePage.locator('#post-card').screenshot({ path: jpgPath, type: 'jpeg', quality: 60 });
        rmSync(pngPath, { force: true });
        if (statSync(jpgPath).size > MAX_BYTES) {
          throw new Error(`${f.id}.jpg is ${statSync(jpgPath).size} bytes, still over the 150 KB limit`);
        }
        filePath = `images/${f.id}.jpg`;
      }
    } else {
      filePath = `images/${f.id}.png`;
      const renderPage = f.scale === 1 ? smallPage : page;
      await renderPage.setContent(renderCard(f), { waitUntil: 'networkidle' });
      await renderPage.locator('#post-card').screenshot({ path: join(HERE, filePath) });
    }

    const gold = {
      id: f.id,
      kind: f.kind,
      theme: f.theme,
      author: f.author,
      handle: f.handle,
      language: goldLanguage(f),
      body: f.body,
      chrome: chromeStrings(f),
      ocr_expected: ocrExpected(f),
      synthetic: true,
    };
    const err = expectedError(f);
    if (err) gold.expected_error = err;
    writeFileSync(join(GOLD_DIR, `${f.id}.json`), JSON.stringify(gold, null, 2) + '\n');

    const bytes = statSync(join(HERE, filePath)).size;
    const sha = createHash('sha256').update(readFileSync(join(HERE, filePath))).digest('hex');
    const note = isBadInputFixture(f)
      ? 'Synthetic bad-input fixture: generated bytes, no real content, no readable text.'
      : 'Synthetic content: fictional author and company, generated from fixture-data.mjs.';
    manifest.images.push({
      id: f.id,
      file: filePath,
      sha256: sha,
      size_bytes: bytes,
      synthetic: true,
      gold: `gold/${f.id}.json`,
      note,
    });
    if (bytes > MAX_BYTES) {
      throw new Error(`${filePath} is ${bytes} bytes, over the 150 KB fixture limit`);
    }
    console.log(`${filePath} ${bytes} bytes`);
  }
  await browser.close();

  writeFileSync(join(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = manifest.images.reduce((sum, img) => sum + img.size_bytes, 0);
  console.log(`manifest.json written: ${manifest.images.length} files, ${total} bytes total`);
  if (total > 6 * 1024 * 1024) throw new Error(`total fixture bytes ${total} exceed the 6 MB limit`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
