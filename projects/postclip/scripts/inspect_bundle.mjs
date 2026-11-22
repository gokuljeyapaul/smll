#!/usr/bin/env node
/**
 * Production-bundle inspection (S5 — A29): prove the PRODUCTION build ships
 * no test hooks and no eval runner, and carries the strict CSP verbatim.
 *
 * What "test hooks" means here (the S3/S4 build-time-gated surface):
 *   - the test-only model-URL override    ?testModelUrl=…
 *   - the test-only capability override   ?testProbe=unsupported
 *   - the test-only debug record           window.__postclipLlmDebug
 *   - the build gate itself                __POSTCLIP_TEST_BUILD__
 *   - the pure parser behind the flags     parseTestFlags
 * plus any direct `eval(`/`new Function(` in the app's own bundles.
 *
 * Two modes:
 *   node scripts/inspect_bundle.mjs dist prod
 *     The PRODUCTION build must contain NONE of the markers (exit 0 = clean;
 *     any find = exit 1 with the file + match printed).
 *   node scripts/inspect_bundle.mjs dist test
 *     The NEGATIVE CONTROL: the same detector run against a TEST build, which
 *     MUST trip (the hooks exist there by design). Exit 0 = the detector
 *     found the hooks (the trip is recorded as evidence the detector works);
 *     exit 1 = nothing found (the detector would be broken/useless).
 *
 * Both modes also assert:
 *   - dist/index.html carries the expected CSP <meta> VERBATIM
 *     (scripts/csp-policy.mjs: PROD_CSP for prod, TEST_CSP for test) with
 *     no 'unsafe-eval' / 'unsafe-inline' anywhere in the policy;
 *   - every <script src> / <link href> in index.html is same-origin
 *     (no third-party scripts or styles);
 *   - no *.map source maps shipped (sourcemap: false).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { PROD_CSP, TEST_CSP } from './csp-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const MARKERS = [
  '__postclipLlmDebug',
  'testModelUrl',
  'testProbe',
  'parseTestFlags',
  '__POSTCLIP_TEST_BUILD__',
];

function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function walkMaps(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMaps(p));
    else if (entry.name.endsWith('.map')) out.push(p);
  }
  return out;
}

function main() {
  const distDir = process.argv[2] ?? join(ROOT, 'dist');
  const mode = process.argv[3] ?? 'prod';
  if (mode !== 'prod' && mode !== 'test') {
    console.error('usage: node scripts/inspect_bundle.mjs <distDir> <prod|test>');
    process.exit(2);
  }
  const expectedCsp = mode === 'prod' ? PROD_CSP : TEST_CSP;
  const problems = [];
  const trips = [];

  console.log(`# bundle inspection (${mode} mode) — ${distDir}`);
  if (!existsSync(distDir)) {
    console.error(`inspect_bundle: ${distDir} does not exist (build first)`);
    process.exit(2);
  }

  // 1. The strict CSP, verbatim, in the shipped index.html.
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf-8');
  const meta = indexHtml.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/,
  );
  if (!meta) {
    problems.push('index.html has NO Content-Security-Policy meta tag');
  } else if (meta[1] !== expectedCsp) {
    problems.push(`CSP mismatch.\n  expected: ${expectedCsp}\n  shipped:  ${meta[1]}`);
  } else {
    console.log('CSP meta: matches the expected policy verbatim');
    console.log(`CSP policy: ${meta[1]}`);
  }
  if (/unsafe-eval|unsafe-inline/.test(meta ? meta[1] : '')) {
    problems.push('CSP contains unsafe-eval or unsafe-inline');
  }

  // 2. Same-origin scripts/styles only (no third-party anything).
  const srcs = [...indexHtml.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const remote = srcs.filter((s) => !s.startsWith('/') && !s.startsWith('./'));
  if (remote.length > 0) {
    problems.push(`index.html references non-same-origin resources: ${remote.join(', ')}`);
  } else {
    console.log(`index.html resource URLs: ${srcs.length}, all same-origin`);
  }
  const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>[^<]/g)];
  if (inlineScripts.length > 0) {
    problems.push(`index.html has inline script bodies (${inlineScripts.length})`);
  }

  // 3. No source maps shipped.
  const maps = walkMaps(distDir);
  if (maps.length > 0) problems.push(`source maps shipped: ${maps.join(', ')}`);
  else console.log('no source maps shipped');

  // 4. The test-hook marker scan over every shipped .js file.
  const jsFiles = walkJs(distDir);
  let scanned = 0;
  for (const file of jsFiles) {
    const src = readFileSync(file, 'utf-8');
    scanned += 1;
    for (const marker of MARKERS) {
      let at = src.indexOf(marker);
      while (at !== -1) {
        trips.push(
          `${file.replace(ROOT + '/', '')}: "${marker}" at byte ${at} (context: ${JSON.stringify(
            src.slice(Math.max(0, at - 40), at + marker.length + 40),
          )})`,
        );
        at = src.indexOf(marker, at + 1);
      }
    }
    if (file.includes(join('dist', 'assets'))) {
      // App's own bundles: no eval, no new Function (the eval RUNNER would
      // live here; vendored engine files under /ocr-assets are not ours).
      const evalRe = /\beval\s*\(|new Function\s*\(/g;
      let m;
      while ((m = evalRe.exec(src)) !== null) {
        problems.push(
          `${file.replace(ROOT + '/', '')}: eval/new Function at byte ${m.index} (context: ${JSON.stringify(
            src.slice(Math.max(0, m.index - 40), m.index + 40),
          )})`,
        );
      }
    }
  }
  console.log(`scanned ${scanned} .js files (${jsFiles.map((f) => statSync(f).size).reduce((a, b) => a + b, 0)} bytes)`);

  // 5. Verdict.
  if (mode === 'prod') {
    for (const t of trips) console.log(`TEST HOOK FOUND: ${t}`);
    for (const p of problems) console.log(`PROBLEM: ${p}`);
    if (trips.length === 0 && problems.length === 0) {
      console.log('PRODUCTION BUNDLE: CLEAN — no test hooks, no eval, strict CSP verbatim.');
      process.exit(0);
    }
    console.error(`PRODUCTION BUNDLE: NOT CLEAN (${trips.length} hook finds, ${problems.length} problems)`);
    process.exit(1);
  } else {
    // test mode: the detector MUST trip — that is the point of the control.
    for (const t of trips) console.log(`TRIPPED (expected in a test build): ${t}`);
    for (const p of problems) console.log(`PROBLEM: ${p}`);
    if (trips.length > 0 && problems.length === 0) {
      console.log(
        `TEST-BUILD CONTROL: detector works — found ${trips.length} hook occurrence(s) in the test build that must be absent from production.`,
      );
      process.exit(0);
    }
    console.error(
      `TEST-BUILD CONTROL FAILED: ${trips.length} trips (need > 0), ${problems.length} problems (need 0)`,
    );
    process.exit(1);
  }
}

main();
