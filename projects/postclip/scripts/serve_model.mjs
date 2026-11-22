#!/usr/bin/env node
/**
 * The local model server (S3 — plan testability map, UC08/UC09): serves the
 * REAL pinned model file plus the failure variants the acceptance flows
 * need, so the e2e suite exercises the real download path (real bytes, real
 * network stack, real Range headers) without ever leaving the machine.
 *
 * Endpoints (GET only; every response carries CORS headers so the browser
 * page can read the body — an opaque response could never be hashed):
 *   /healthz          liveness probe
 *   /model            the real pinned file, Range-supported (A12 happy, A14)
 *   /model-slow       the real pinned file, paced (~100 ms per 8 MiB) so a
 *                     human and a test can SEE the download progress (A12)
 *   /model-wrong-hash the real file with one byte flipped (A13 checksum)
 *   /model-truncated  an honest-but-short body: half the real file with a
 *                     matching Content-Length (A13 truncation)
 *   /model-kill-fresh every request that does NOT resume (no Range header
 *                     with a start offset > 0) is killed after ~25% of the
 *                     body; resumed requests are served fully (A12 resume)
 *   /model-404        a hard 404 (A13 server-side failure)
 *
 * Every request is logged (path, Range header, status, bytes sent) so the
 * resume/variant behavior is provable from the log:
 *   node scripts/serve_model.mjs --port 4599 \
 *     --file .cache/models/Qwen3-0.6B-Q4_K_M.gguf --log artifacts/model-server.log
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', '4599'));
const FILE = arg('file', join(ROOT, '.cache/models/Qwen3-0.6B-Q4_K_M.gguf'));
const LOG = arg('log', join(ROOT, 'artifacts/model-server.log'));

if (!existsSync(FILE)) {
  console.error(`serve_model: model file missing: ${FILE}`);
  console.error('serve_model: run `node scripts/fetch_model.mjs` first (setup.sh does this in CI).');
  process.exit(1);
}

const real = readFileSync(FILE);
const sha256 = createHash('sha256').update(real).digest('hex');
console.log(`serve_model: serving ${FILE}`);
console.log(`serve_model: size=${real.length} sha256=${sha256}`);

// Variants (in memory; the host measured ~62 GiB RAM, CI ~16 GiB).
const wrongHash = Uint8Array.from(real);
wrongHash[100_000] ^= 0xff;
const wrongHashSha = createHash('sha256').update(wrongHash).digest('hex');
const truncated = real.subarray(0, Math.floor(real.length / 2));
console.log(`serve_model: wrong-hash sha256=${wrongHashSha} (differs from the pinned one)`);
console.log(`serve_model: truncated size=${truncated.length} (half of ${real.length})`);

mkdirSync(dirname(LOG), { recursive: true });
// appendFileSync per line: the evidence flow moves the log between engine
// runs, and re-opening per write keeps writing to the file at the path.
function logLine(text) {
  const line = `${new Date().toISOString()} ${text}\n`;
  appendFileSync(LOG, line);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length, content-range, etag',
  'cache-control': 'no-store',
};

function parseRangeStart(header) {
  const m = header?.match(/^bytes=(\d+)-/);
  return m ? Number(m[1]) : -1;
}

function serveBuffer(req, res, path, buf, { acceptRanges = true, delayMs = 0 } = {}) {
  const rangeStart = acceptRanges ? parseRangeStart(req.headers['range']) : -1;
  if (rangeStart >= 0) {
    if (rangeStart >= buf.length) {
      logLine(`GET ${path} range=${req.headers['range'] ?? '-'} status=416 sent=0`);
      res.writeHead(416, { ...CORS, 'content-range': `bytes */${buf.length}` });
      res.end();
      return;
    }
    const slice = buf.subarray(rangeStart);
    res.writeHead(206, {
      ...CORS,
      'content-type': 'application/octet-stream',
      'content-length': String(slice.length),
      'content-range': `bytes ${rangeStart}-${buf.length - 1}/${buf.length}`,
      'accept-ranges': 'bytes',
    });
    logLine(`GET ${path} range=${req.headers['range']} status=206 sent=${slice.length}`);
    res.end(slice);
    return;
  }
  res.writeHead(200, {
    ...CORS,
    'content-type': 'application/octet-stream',
    'content-length': String(buf.length),
    ...(acceptRanges ? { 'accept-ranges': 'bytes' } : {}),
  });
  logLine(`GET ${path} range=${req.headers['range'] ?? '-'} status=200 sent=${buf.length}`);
  if (delayMs === 0) {
    res.end(buf);
    return;
  }
  // Paced write so the download progress is observable in the UI.
  let at = 0;
  const CHUNK = 8 * 1024 * 1024;
  const timer = setInterval(() => {
    const end = Math.min(at + CHUNK, buf.length);
    const ok = res.write(buf.subarray(at, end));
    at = end;
    if (at >= buf.length) {
      clearInterval(timer);
      res.end();
    } else if (!ok) {
      res.once('drain', () => {});
    }
  }, delayMs);
  req.on('close', () => clearInterval(timer));
}

const server = http.createServer((req, res) => {
  const path = req.url?.split('?')[0] ?? '/';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, CORS).end();
    return;
  }
  switch (path) {
    case '/healthz': {
      res.writeHead(200, CORS).end('ok');
      return;
    }
    case '/model': {
      serveBuffer(req, res, path, real);
      return;
    }
    case '/model-slow': {
      serveBuffer(req, res, path, real, { delayMs: 100 });
      return;
    }
    case '/model-wrong-hash': {
      serveBuffer(req, res, path, wrongHash, { acceptRanges: false });
      return;
    }
    case '/model-truncated': {
      serveBuffer(req, res, path, truncated, { acceptRanges: false });
      return;
    }
    case '/model-kill-fresh': {
      const rangeStart = parseRangeStart(req.headers['range']);
      if (rangeStart > 0) {
        // A resumed request is served fully — the app recovered from the kill.
        serveBuffer(req, res, path, real);
      } else {
        // Kill every fresh download after ~25% of the body, PACED: writing the
        // whole slice and destroying immediately would let the TCP reset
        // discard the client's unread receive buffer (the app would then see
        // zero bytes and restart instead of resuming). Pacing the writes lets
        // the client consume data first, so the kill lands mid-download and
        // the app has a non-zero offset to resume from (A12).
        const quarter = Math.floor(real.length / 4);
        const CHUNK = 8 * 1024 * 1024;
        res.writeHead(200, {
          ...CORS,
          'content-type': 'application/octet-stream',
          'content-length': String(real.length),
          'accept-ranges': 'bytes',
        });
        logLine(`GET ${path} range=${req.headers['range'] ?? '-'} status=200-kill sent=${quarter}`);
        let at = 0;
        const timer = setInterval(() => {
          const end = Math.min(at + CHUNK, quarter);
          const ok = res.write(real.subarray(at, end));
          at = end;
          if (at >= quarter && ok) {
            clearInterval(timer);
            res.destroy();
          }
        }, 40);
        req.on('close', () => clearInterval(timer));
      }
      return;
    }
    case '/model-404': {
      logLine(`GET ${path} range=${req.headers['range'] ?? '-'} status=404 sent=0`);
      res.writeHead(404, CORS).end('model not found');
      return;
    }
    default: {
      logLine(`GET ${path} range=- status=404 sent=0`);
      res.writeHead(404, CORS).end('not found');
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serve_model: listening on http://127.0.0.1:${PORT} (file size ${statSync(FILE).size})`);
  console.log(`serve_model: logging requests to ${LOG}`);
});
