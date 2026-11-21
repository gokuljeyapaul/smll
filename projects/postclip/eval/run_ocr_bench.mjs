/**
 * OCR engine selection bench (plan D4) — dev/test-only, never in the app.
 *
 * Serves the bench page + all engine assets locally and runs each candidate
 * engine over every fixture in real headless Chromium:
 *   - tesseract-fast (tesseract.js 7 + tessdata 4.0.0_fast, what the app ships)
 *   - tesseract-best (same worker/core, tessdata 4.0.0 standard)
 *   - ppocr (PP-OCRv4 det+rec ONNX through onnxruntime-web, en_dict)
 *
 * Computes CER per fixture against the gold `ocr_expected`, timings, and the
 * measured download bytes (Resource Timing), then writes
 * eval/ocr_bench_results.json for the evidence comparison table.
 *
 * Usage: node eval/run_ocr_bench.mjs [--engines tesseract-fast,tesseract-best,ppocr]
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const argEngines = process.argv.includes('--engines')
  ? process.argv[process.argv.indexOf('--engines') + 1].split(',')
  : ['tesseract-fast', 'tesseract-best', 'ppocr'];

const PORT = 4180;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
};

const servedLog = [];
function serve(pathname, res) {
  // Map URL prefix -> filesystem root; reject traversal.
  const routes = [
    ['/bench/', join(ROOT, 'eval/pages')],
    ['/ocr-assets/', join(ROOT, 'dist/ocr-assets')],
    ['/tessdata-best/', join(ROOT, '.cache/bench/tessdata-best')],
    ['/fixtures/', join(ROOT, 'fixtures')],
    ['/ppocr/', join(ROOT, '.cache/models/ppocr')],
    ['/node_modules/', join(ROOT, 'node_modules')],
  ];
  for (const [prefix, fsRoot] of routes) {
    if (pathname.startsWith(prefix)) {
      let rel = pathname.slice(prefix.length);
      if (rel.includes('..')) break;
      if (prefix === '/bench/' && rel === '') rel = 'bench.html'; // directory index
      try {
        const filePath = join(fsRoot, rel);
        const data = readFileSync(filePath);
        if (!pathname.startsWith('/fixtures/')) {
          servedLog.push({ url: pathname, bytes: data.length });
        }
        res.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
        });
        res.end(data);
        return;
      } catch {
        res.writeHead(404);
        res.end('not found');
        return;
      }
    }
  }
  if (pathname === '/bench') {
    res.writeHead(302, { location: '/bench/' });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('not found');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

function normalizeLikeReview(lines) {
  return lines
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

async function runEngine(browser, engineName) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('[bench]')) console.log(`  ${t}`);
  });
  await page.goto(`http://localhost:${PORT}/bench/?engine=${engineName}`);
  await page.waitForFunction('window.__benchDone === true', null, { timeout: 300_000 });
  const out = await page.evaluate(() => ({
    results: window.__benchResults ?? null,
    error: window.__benchError ?? null,
  }));
  await context.close();
  return out;
}

async function main() {
  // best traineddata served from .cache/bench (downloaded at bench time)
  mkdirSync(join(ROOT, '.cache/bench/tessdata-best'), { recursive: true });
  const bestSrc = join(ROOT, '.cache/bench/eng-4.0.0.traineddata.gz');
  const bestDst = join(ROOT, '.cache/bench/tessdata-best/eng.traineddata.gz');
  try {
    if (statSync(bestDst).size <= 0) throw new Error('empty');
  } catch {
    console.log('fetching tessdata 4.0.0 (best) for the bench…');
    const res = await fetch('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz');
    if (!res.ok) throw new Error(`best traineddata download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468') {
      throw new Error(`best traineddata sha256 mismatch: ${sha}`);
    }
    console.log(`best traineddata verified (${buf.length} bytes, sha256 ${sha.slice(0, 16)}…)`);
    writeFileSync(bestSrc, buf);
    copyFileSync(bestSrc, bestDst);
  }

  const manifest = JSON.parse(readFileSync(join(ROOT, 'fixtures/manifest.json'), 'utf-8'));
  const golds = new Map(
    manifest.images.map((img) => {
      const gold = JSON.parse(readFileSync(join(ROOT, 'fixtures', img.gold), 'utf-8'));
      return [img.id, gold];
    }),
  );

  const server = http.createServer((req, res) => serve(new URL(req.url, 'http://x').pathname, res));
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const browser = await chromium.launch();
  const report = { ranAt: new Date().toISOString(), engines: [] };
  try {
    for (const engine of argEngines) {
      console.log(`== ${engine} ==`);
      servedLog.length = 0;
      const { results, error } = await runEngine(browser, engine);
      if (error || !results) {
        report.engines.push({ engine, error: error ?? 'no results' });
        console.log(`  ERROR: ${error}`);
        continue;
      }
      const perFixture = results.results.map((r) => {
        const gold = golds.get(r.id);
        const expected = normalizeLikeReview(gold.ocr_expected);
        return {
          id: r.id,
          kind: gold.kind,
          ms: r.ms,
          cer: expected.length > 0 ? levenshtein(r.text, expected) / expected.length : 1,
        };
      });
      const clean = perFixture.filter((r) => r.kind === 'clean');
      const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
      const summary = {
        engine,
        name: results.name,
        assetsServedBytes: servedLog.reduce((s, e) => s + e.bytes, 0),
        assetsServed: [...servedLog].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
        resultsRaw: results.results,
        cleanSetMeanCER: mean(clean.map((r) => r.cer)),
        allFixturesMeanCER: mean(perFixture.map((r) => r.cer)),
        meanMs: mean(perFixture.map((r) => r.ms)),
        perFixture,
      };
      report.engines.push(summary);
      console.log(
        `  clean-set mean CER ${(summary.cleanSetMeanCER * 100).toFixed(2)}% · ` +
          `all mean CER ${(summary.allFixturesMeanCER * 100).toFixed(2)}% · ` +
          `mean ${(summary.meanMs / 1000).toFixed(1)}s/image · assets served ${(summary.assetsServedBytes / 1e6).toFixed(1)} MB`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }

  mkdirSync(join(ROOT, 'eval'), { recursive: true });
  writeFileSync(join(ROOT, 'eval/ocr_bench_results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('wrote eval/ocr_bench_results.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
