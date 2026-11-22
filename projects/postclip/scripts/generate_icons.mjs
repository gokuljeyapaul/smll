/**
 * Generate the PostClip PWA app icons (public/icons/*.png) deterministically
 * with headless Chromium — the same rendering path as fixtures/generate.mjs.
 * Synthetic, brand-free mark: a dark rounded square with a light "clip"
 * glyph. Committed output; CI never regenerates (the manifest hashes them).
 *
 * Usage: node scripts/generate_icons.mjs   (needs PLAYWRIGHT_BROWSERS_PATH)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'public', 'icons');

/** The icon mark, drawn in pure HTML/CSS with percentage sizing so 192 and
 *  512 render identically. `maskable` adds the safe-zone padding (inner 80%). */
function iconHtml(maskable) {
  const glyphSize = maskable ? '52%' : '68%';
  const radius = maskable ? '0%' : '18%';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { width: 100vw; height: 100vh; background: #101418; }
  .bg {
    position: absolute; inset: 0;
    background: linear-gradient(160deg, #16202a 0%, #101418 60%);
    border-radius: ${radius};
  }
  .glyph {
    position: absolute; left: 50%; top: 50%;
    width: ${glyphSize}; height: ${glyphSize};
    transform: translate(-50%, -50%);
  }
  /* The clip mark: a paperclip silhouette from two rounded strokes. */
  .stroke {
    position: absolute; border-radius: 999px;
    border: solid #7ec8f2;
  }
  .outer { inset: 0; border-width: 9%; }
  .inner { inset: 22% 22% 22% 22%; border-width: 9%; border-color: #e8f4fb; }
  .cap {
    position: absolute; left: 24%; top: 46%; width: 52%; height: 8%;
    background: #7ec8f2; border-radius: 999px;
  }
</style></head>
<body>
  <div class="bg"></div>
  <div class="glyph">
    <div class="stroke outer"></div>
    <div class="stroke inner"></div>
    <div class="cap"></div>
  </div>
</body></html>`;
}

async function renderIcon(browser, size, file, maskable) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(iconHtml(maskable), { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, file), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`icons: ${file} (${size}x${size}${maskable ? ', maskable safe zone' : ''})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await renderIcon(browser, 192, 'icon-192.png', false);
    await renderIcon(browser, 512, 'icon-512.png', false);
    await renderIcon(browser, 512, 'icon-512-maskable.png', true);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
