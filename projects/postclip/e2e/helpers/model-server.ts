/**
 * Shared e2e helper (S3): start the local model server (scripts/serve_model.mjs)
 * on a fixed port once per run; it serves the REAL pinned model file and the
 * failure variants (wrong-hash, truncated, kill-fresh, 404 — see the script).
 * The server must serve the real file from .cache/models/ (gitignored; fetched
 * by scripts/fetch_model.mjs / setup.sh) — a missing file is a loud failure,
 * never silently skipped.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PINNED_MODEL } from '../../src/model/manifest';

/** Fixed port so the test-only ?testModelUrl= flag is stable across specs. */
export const MODEL_SERVER_PORT = 4599;
export const MODEL_SERVER = `http://127.0.0.1:${MODEL_SERVER_PORT}`;

let started: Promise<void> | null = null;
let child: ChildProcess | null = null;

async function waitUp(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastErr = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MODEL_SERVER}/healthz`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`model server did not come up at ${MODEL_SERVER} (last error: ${lastErr})`);
}

/** Idempotent per Playwright worker process; the server logs every request. */
export async function startModelServer(): Promise<void> {
  if (started) return started;
  started = (async () => {
    const file = join(process.cwd(), '.cache/models', PINNED_MODEL.filename);
    if (!existsSync(file)) {
      throw new Error(
        `pinned model file missing: ${file} — run "node scripts/fetch_model.mjs" first`,
      );
    }
    const log = join(process.cwd(), 'artifacts', 'model-server.log');
    child = spawn(
      process.execPath,
      [
        join('scripts', 'serve_model.mjs'),
        '--port',
        String(MODEL_SERVER_PORT),
        '--file',
        file,
        '--log',
        log,
      ],
      { cwd: process.cwd(), stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code !== null && code !== 0 && started) {
        console.error(`model server exited with code ${code}`);
      }
    });
    process.on('exit', () => {
      child?.kill('SIGTERM');
    });
    await waitUp();
  })();
  return started;
}
