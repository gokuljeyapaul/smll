#!/usr/bin/env node
/**
 * R2-3 environment probe (issue #78: "Reproduce and find which before
 * changing anything"): measure what THIS machine's Playwright Chromium and
 * WebKit actually report for the storage-persistence surface in the four
 * environments that decide whether the model cache survives:
 *
 *   1. persistent profile (launchPersistentContext, reused dir) — the
 *      "same profile" case the owner's install should be in;
 *   2. Chromium incognito (persistent context + --incognito) — the real
 *      private-window case;
 *   3. ephemeral context (browser.newContext()) — a fresh, wiped profile
 *      (WebView-like), lost at close;
 *   4. a REUSED persistent profile (relaunch the same dir) — does the storage
 *      API state and an OPFS/Cache-Storage marker written in launch 1 survive
 *      to launch 2? This is the repeated-download reproduction: it answers
 *      "is the model kept on disk but reported absent?".
 *
 * Output: docs/evidence/R2-3/env-probe.json (+ stdout). Real numbers only.
 */
/* global TextEncoder, Response */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const OUT = 'docs/evidence/R2-3/env-probe.json';
const PORT = 4617;
const BASE = `http://127.0.0.1:${PORT}/`;

/** A tiny local static server: navigator.storage / caches / OPFS exist only
 * on SECURE contexts (about:blank is not one — measured the hard way). */
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: '.',
  stdio: 'ignore',
});
process.on('exit', () => server.kill('SIGTERM'));
await new Promise((resolve) => {
  const deadline = Date.now() + 10_000;
  (async function attempt() {
    try {
      const res = await fetch(`${BASE}index.html`);
      if (res.ok) return resolve();
    } catch {
      /* not up yet — retry */
    }
    if (Date.now() > deadline) throw new Error('probe static server did not come up');
    setTimeout(attempt, 250);
  })();
});

async function measurePage(page) {
  await page.goto(BASE);
  return page.evaluate(async () => {
    const out = {
      persistFn: typeof navigator.storage?.persist === 'function',
      persistedFn: typeof navigator.storage?.persisted === 'function',
      estimateFn: typeof navigator.storage?.estimate === 'function',
    };
    try {
      out.persistedBefore = await navigator.storage.persisted();
    } catch (err) {
      out.persistedBefore = `error:${String(err)}`;
    }
    try {
      out.persistResult = await navigator.storage.persist();
    } catch (err) {
      out.persistResult = `error:${String(err)}`;
    }
    try {
      out.persistedAfter = await navigator.storage.persisted();
    } catch (err) {
      out.persistedAfter = `error:${String(err)}`;
    }
    try {
      const est = await navigator.storage.estimate();
      out.quotaBytes = est.quota;
      out.usageBytes = est.usage;
    } catch (err) {
      out.estimate = `error:${String(err)}`;
    }
    return out;
  });
}

/** Write a small marker through the REAL model-store backends, return what survived. */
async function markerRoundTrip(page, phase) {
  return page.evaluate(async (phase) => {
    const marker = `postclip-probe-${phase}`;
    const results = {};
    // OPFS
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('postclip-probe', { create: true });
      if (phase === 'write') {
        const fh = await dir.getFileHandle(marker, { create: true });
        const w = await fh.createWritable();
        await w.write(new TextEncoder().encode('probe'));
        await w.close();
        results.opfs = 'written';
      } else {
        const fh = await dir.getFileHandle(marker);
        results.opfs = (await (await fh.getFile()).text()) === 'probe' ? 'survived' : 'corrupt';
      }
    } catch (err) {
      results.opfs = `error:${String(err).slice(0, 80)}`;
    }
    // Cache Storage
    try {
      const cache = await caches.open('postclip-probe');
      if (phase === 'write') {
        await cache.put(`probe-${marker}`, new Response('probe'));
        results.cacheStorage = 'written';
      } else {
        const hit = await cache.match(`probe-${marker}`);
        results.cacheStorage = hit ? 'survived' : 'missing';
      }
    } catch (err) {
      results.cacheStorage = `error:${String(err).slice(0, 80)}`;
    }
    return results;
  }, phase);
}

async function launchMeasure(label, engine, opts, reuseDir = null) {
  const dir = reuseDir ?? mkdtempSync(join(tmpdir(), 'postclip-r2-3-probe-'));
  const ctx = await engine.launchPersistentContext(dir, opts);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const facts = await measurePage(page);
  const opfs = await markerRoundTrip(page, reuseDir ? 'read' : 'write');
  await ctx.close();
  return { label, profile: dir, reused: !!reuseDir, facts, storage: opfs };
}

async function ephemeralMeasure(label, engineName) {
  const browser = engineName === 'chromium' ? chromium : webkit;
  const browser_ = await browser.launch();
  const ctx = await browser_.newContext();
  const page = await ctx.newPage();
  const facts = await measurePage(page);
  const storage = await markerRoundTrip(page, 'write');
  await ctx.close();
  await browser_.close();
  return { label, profile: '(ephemeral context — wiped at close)', reused: false, facts, storage };
}

const results = { slice: 'R2-3', measured_with: 'Playwright (this host, headless)', environments: [] };

// 1+4: persistent profile, then REUSED (the repeated-download reproduction)
const pdir = mkdtempSync(join(tmpdir(), 'postclip-r2-3-persist-'));
results.environments.push(await launchMeasure('chromium persistent profile (launch 1)', chromium, {}, pdir));
results.environments.push(await launchMeasure('chromium persistent profile REUSED (launch 2, same dir)', chromium, {}, pdir));

// 2: Chromium incognito (real private window)
results.environments.push(
  await launchMeasure('chromium incognito (--incognito, private window)', chromium, { args: ['--incognito'] }),
);

// 3: ephemeral contexts
results.environments.push(await ephemeralMeasure('chromium ephemeral context (newContext)', 'chromium'));
results.environments.push(await ephemeralMeasure('webkit ephemeral context (newContext)', 'webkit'));

// WebKit persistent + reused
const wdir = mkdtempSync(join(tmpdir(), 'postclip-r2-3-wk-'));
results.environments.push(await launchMeasure('webkit persistent profile (launch 1)', webkit, {}, wdir));
results.environments.push(await launchMeasure('webkit persistent profile REUSED (launch 2, same dir)', webkit, {}, wdir));

mkdirSync('docs/evidence/R2-3', { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, (k, v) => (k === 'profile' ? v.slice(0, 40) + '…' : v), 2));
console.log(`\nwrote ${OUT}`);
