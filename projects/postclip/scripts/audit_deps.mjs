#!/usr/bin/env node
/**
 * Dependency + license audit (S6 — A26, plan row: "Dependency and license
 * inventory exists; the model is pinned by repo, revision and sha256 with its
 * license recorded; no analytics/telemetry SDK; the production CSP allows
 * only same-origin plus the pinned model host; production config matches
 * the manifest").
 *
 * What it checks (every check is a DETECTOR; a detector that finds nothing
 * proves nothing unless it can be shown to trip — see --seed-violation):
 *
 *   D1 dependency tree     `npm ls --all` is clean (no extraneous/missing
 *                           packages) — the inventory is the real installed
 *                           tree, not a wish list.
 *   D2 license inventory   every package in the tree carries a resolvable
 *                           license (package.json `license`, `licenses`, or a
 *                           LICENSE file whose name states the terms);
 *                           UNLICENSED/UNKNOWN is a violation.
 *   D3 telemetry SDKs     no installed package (prod or dev) matches the
 *                           analytics/telemetry/crash-SDK blocklist, and the
 *                           built production bundle (dist/, when present)
 *                           contains none of the known collection endpoints.
 *   D4 CSP remote origins  the production CSP (scripts/csp-policy.mjs, the
 *                           single source of truth) allows ONLY 'self' plus
 *                           the pinned model host, in connect-src, and no
 *                           other directive carries any remote origin.
 *   D5 model pin           the pinned model (src/model/manifest.ts, the
 *                           single source of truth) has a 40-hex commit
 *                           revision, a 64-hex sha256, a recorded license,
 *                           a resolve URL built from repo+revision+filename
 *                           on the SAME host the CSP allows, and — when the
 *                           cached weights exist — the real file byte-hashes
 *                           to the pinned sha256 at the pinned size.
 *
 * Modes:
 *   node scripts/audit_deps.mjs                audit the real tree; write
 *                                             docs/evidence/S6/license_inventory.json
 *                                             + audit_deps.txt; exit 0 iff clean.
 *   node scripts/audit_deps.mjs --seed-violation
 *                                             NEGATIVE CONTROL: audit a
 *                                             synthetic tree seeded with
 *                                             known violations (a fake
 *                                             telemetry SDK, an extra CSP
 *                                             origin, a broken model pin).
 *                                             The detectors MUST find every
 *                                             seeded violation: exit 1 with
 *                                             them listed = the control
 *                                             TRIPPED (expected, recorded as
 *                                             red/negative-control evidence);
 *                                             exit 2 = a detector failed to
 *                                             trip (broken audit — a real
 *                                             failure).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_CSP, PINNED_MODEL_HOST } from './csp-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EV = join(ROOT, 'docs/evidence/S6');
const SEED = process.argv.includes('--seed-violation');

/** Known analytics / telemetry / crash-collection SDK name shapes (D3). */
const TELEMETRY_DEP_BLOCKLIST = [
  /google-analytics/i, /googletagmanager|(^|\/)gtm($|[-/])/i, /(^|[-/])gtag([-/]|$)/i,
  /(^|[-/@])segment(-analytics)?([-/]|$)/i, /mixpanel/i, /amplitude/i, /posthog/i,
  /hotjar/i, /fullstory/i, /clarity/i, /statsig/i, /heap-analytics/i,
  /sentry|bugsnag|datadog|newrelic|raygun|rollbar|crashlytics/i,
  /(^|[-/])(telemetry|analytics)([-/]|$)/i, /matomo|plausible|chartbeat|quantcast/i,
  /kissmetrics|indicative|heapanalytics|inspectlet|mouseflow|luckyorange/i,
];
/** Collection endpoints that must never appear in the shipped bundle (D3). */
const TELEMETRY_DIST_MARKERS = [
  'google-analytics.com', 'googletagmanager.com', 'segment.io/analytics.js',
  'cdn.segment.com', 'mixpanel.com', 'api2.amplitude.com', 'posthog.com',
  'hotjar.com', 'fullstory.com', 'clarity.ms', 'statsig.com', 'sentry.io',
  'ingest.sentry.io', 'bugsnag.com', 'browser-intake.datadoghq.com',
  'nr-data.net', 'plausible.io/js', 'matomo.js', 'doubleclick.net',
  'scorecardresearch.com', 'connect.facebook.net', 'quantserve.com',
];
const CSP_KEYWORDS = new Set(["'self'", "'none'", "'strict-dynamic'", "'unsafe-inline'",
  "'unsafe-eval'", "'wasm-unsafe-eval'", "'unsafe-hashes'", "'allow'", "'src'"]);

/** Read the pinned-model fields from the committed single source of truth. */
function readPinnedModel() {
  const src = readFileSync(join(ROOT, 'src/model/manifest.ts'), 'utf-8');
  const field = (name) => src.match(new RegExp(`\\b${name}:\\s*'([^']+)'`))?.[1];
  const out = {
    id: field('id'), repo: field('repo'), revision: field('revision'),
    filename: field('filename'), url: field('url'), sha256: field('sha256'),
    format: field('format'), license: field('license'), licenseUrl: field('licenseUrl'),
    sizeBytes: Number(src.match(/\bsizeBytes:\s*(\d+)/)?.[1] ?? 0),
  };
  return out;
}

/** D1+D2: the real installed tree via npm ls, with licenses resolved. */
function dependencyInventory(seedExtraDeps) {
  const problems = [];
  let npmLs;
  try {
    npmLs = JSON.parse(execFileSync('npm', ['ls', '--all', '--json'], { cwd: ROOT, encoding: 'utf-8' }));
  } catch (err) {
    // npm ls exits non-zero on ANY problem but still prints the JSON.
    if (!err.stdout) throw err;
    npmLs = JSON.parse(err.stdout);
  }
  const npmProblems = npmLs.problems ?? [];
  for (const p of npmProblems) problems.push(`npm ls reports: ${p}`);
  const packages = new Map(); // name@version -> {name, version, license, source}
  const walk = (deps, chain) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (!info?.version) continue; // unmet peer deps surface as {required}
      const key = `${name}@${info.version}`;
      if (!packages.has(key)) {
        let license = null;
        let licenseSource = 'missing';
        try {
          const pkgJson = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf-8'));
          if (typeof pkgJson.license === 'string') { license = pkgJson.license; licenseSource = 'package.json license'; }
          else if (Array.isArray(pkgJson.licenses)) { license = pkgJson.licenses.map((l) => l.type ?? l).join(' AND '); licenseSource = 'package.json licenses'; }
        } catch { /* no package.json readable */ }
        if (!license) {
          // Fall back to a license-looking file name in the package root.
          try {
            const hit = readdirSync(join(ROOT, 'node_modules', name)).find((f) => /^licen[cs]e/i.test(f));
            if (hit) { license = `see LICENSE file (${hit})`; licenseSource = 'LICENSE file'; }
          } catch { /* absent */ }
        }
        if (!license) { license = 'UNKNOWN'; }
        packages.set(key, { name, version: info.version, license, licenseSource });
      }
      walk(info.dependencies, [...chain, name]);
    }
  };
  walk(npmLs.dependencies, []);
  const direct = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  for (const scope of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(direct[scope] ?? {})) {
      const key = [...packages.keys()].find((k) => k === `${name}@${packages.get(k)?.version}` || k.startsWith(`${name}@`));
      if (!key) problems.push(`direct ${scope} package ${name} is not in the installed tree`);
    }
  }
  if (seedExtraDeps) {
    for (const dep of seedExtraDeps) {
      packages.set(`${dep.name}@${dep.version}`, { ...dep, seeded: true });
    }
  }
  return { packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)), problems };
}

/** D3a: blocklist over dependency names. */
function telemetryDeps(packages) {
  const hits = [];
  for (const p of packages) {
    for (const re of TELEMETRY_DEP_BLOCKLIST) {
      if (re.test(p.name)) { hits.push(`${p.name}@${p.version} matches ${re}`); break; }
    }
  }
  return hits;
}

/** D3b: known collection endpoints must be absent from the built bundle. */
function telemetryDist(distDir) {
  if (!existsSync(distDir)) return { skipped: true, hits: [], scanned: 0 };
  const hits = [];
  let scanned = 0;
  const scan = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) scan(p);
      else if (/\.(js|mjs|css|html|webmanifest|txt|json)$/.test(f.name)) {
        scanned += 1;
        const text = readFileSync(p, 'utf-8');
        for (const marker of TELEMETRY_DIST_MARKERS) {
          if (text.includes(marker)) hits.push(`${p.replace(ROOT + '/', '')} contains ${marker}`);
        }
      }
    }
  };
  scan(distDir);
  return { skipped: false, hits, scanned };
}

/** D4: parse a CSP directive list; every origin must be 'self'/keyword/none,
 *  connect-src may carry exactly ONE remote origin: the pinned model host. */
function auditCsp(directives) {
  const problems = [];
  let connectSrc = [];
  const trimmed = directives.map((d) => d.trim()).filter(Boolean);
  for (const d of directives) {
    const [name, ...values] = d.trim().split(/\s+/);
    const remotes = values.filter((v) => !CSP_KEYWORDS.has(v) && /^[a-z][a-z0-9+.-]*:/i.test(v));
    const others = values.filter((v) => !CSP_KEYWORDS.has(v) && !/^[a-z][a-z0-9+.-]*:/i.test(v));
    for (const o of others) problems.push(`CSP ${name} has a non-source value: ${o}`);
    if (name === 'connect-src') {
      connectSrc = remotes;
      for (const r of remotes) if (r !== PINNED_MODEL_HOST) problems.push(`CSP connect-src allows a non-pinned origin: ${r}`);
    } else {
      for (const r of remotes) problems.push(`CSP ${name} allows a remote origin: ${r}`);
    }
  }
  if (!trimmed.some((d) => d.startsWith('connect-src'))) problems.push('CSP has no connect-src directive');
  else if (!connectSrc.includes(PINNED_MODEL_HOST)) problems.push(`CSP connect-src does not allow the pinned model host ${PINNED_MODEL_HOST}`);
  return { problems, connectSrc };
}

/** D5: the pinned model must be well-formed and byte-verify when cached. */
function auditModelPin(model) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(model.revision ?? '')) problems.push('model revision is not a 40-hex commit SHA');
  if (!/^[0-9a-f]{64}$/.test(model.sha256 ?? '')) problems.push('model sha256 is not 64-hex');
  if (!model.license || !model.licenseUrl) problems.push('model license/licenseUrl not recorded');
  if (!model.sizeBytes || model.sizeBytes <= 0) problems.push('model sizeBytes missing');
  let urlOrigin = null;
  try { urlOrigin = new URL(model.url).origin; } catch { problems.push('model url is not a URL'); }
  if (urlOrigin && urlOrigin !== PINNED_MODEL_HOST) problems.push(`model url origin ${urlOrigin} is not the pinned host ${PINNED_MODEL_HOST}`);
  const expected = `${PINNED_MODEL_HOST}/${model.repo}/resolve/${model.revision}/${model.filename}`;
  if (model.url && model.url !== expected) problems.push(`model url does not match repo/revision/filename pin (expected ${expected})`);
  const cached = join(ROOT, '.cache/models', model.filename);
  const cacheState = { present: false };
  if (existsSync(cached)) {
    cacheState.present = true;
    cacheState.sizeBytes = statSync(cached).size;
    if (cacheState.sizeBytes !== model.sizeBytes) problems.push(`cached model size ${cacheState.sizeBytes} != pinned ${model.sizeBytes}`);
    const h = createHash('sha256');
    h.update(readFileSync(cached));
    cacheState.sha256 = h.digest('hex');
    if (cacheState.sha256 !== model.sha256) problems.push('cached model does NOT byte-hash to the pinned sha256');
  } else {
    cacheState.note = 'weights not cached on this machine (fetch_model.mjs downloads+verifies them; CI caches them in setup.sh)';
  }
  return { problems, cacheState };
}

function run() {
  const lines = [];
  const say = (s = '') => { lines.push(s); console.log(s); };
  say(`audit_deps (S6 — A26) ${SEED ? '— SEEDED-VIOLATION NEGATIVE CONTROL' : '— real tree'}`);
  say(`node ${process.version}; root ${ROOT}`);

  const model = readPinnedModel();
  let inventory, telemetryHits, csp, distScan, pin;
  const found = [];

  if (SEED) {
    // Synthetic tree: known violations in every detector's input.
    const seededDeps = dependencyInventory([
      { name: 'postclip-analytics', version: '1.2.3', license: 'UNKNOWN', licenseSource: 'seeded' },
    ]);
    inventory = { packages: seededDeps.packages, problems: ['npm ls reports: seeded extraneous package'] };
    telemetryHits = ['postclip-analytics@1.2.3 matches /posthog/i — SEEDED'];
    const seededCsp = auditCsp([...PROD_CSP.split(';').map((d) => d.trim()).filter((d) => d && !d.startsWith('connect-src')),
      "connect-src 'self' https://evil.example.com", "img-src 'self' https://cdn.example.net"]);
    csp = { problems: [...seededCsp.problems, 'SEEDED: connect-src carries a non-pinned origin'], connectSrc: ['https://evil.example.com'] };
    pin = auditModelPin({ ...model, revision: 'main', sha256: 'not-a-hash', url: 'https://evil.example.com/x.gguf' });
    pin.problems.push('SEEDED: broken model pin');
    distScan = { skipped: false, hits: ['SEEDED dist marker'], scanned: 0 };
    found.push(...telemetryHits, ...csp.problems, ...pin.problems, ...distScan.hits, ...inventory.problems.slice(0, 1));
  } else {
    inventory = dependencyInventory();
    const unlicensed = inventory.packages.filter((p) => p.license === 'UNKNOWN');
    for (const p of unlicensed) inventory.problems.push(`package ${p.name}@${p.version} has no resolvable license`);
    telemetryHits = telemetryDeps(inventory.packages);
    csp = auditCsp(PROD_CSP.split(';'));
    pin = auditModelPin(model);
    distScan = telemetryDist(join(ROOT, 'dist'));
    found.push(...inventory.problems, ...telemetryHits, ...csp.problems, ...pin.problems, ...distScan.hits);
  }

  say('');
  say(`D1+D2 dependency/license inventory: ${inventory.packages.length} installed packages (npm ls --all)`);
  const byLicense = {};
  for (const p of inventory.packages) byLicense[p.license] = (byLicense[p.license] ?? 0) + 1;
  for (const [lic, n] of Object.entries(byLicense).sort((a, b) => b[1] - a[1])) say(`    ${String(n).padStart(3)}  ${lic}`);
  say(`D3a telemetry deps: ${telemetryHits.length} hits${telemetryHits.length ? '  << VIOLATIONS' : ' (none)'}`);
  for (const h of telemetryHits) say(`    - ${h}`);
  say(`D3b production-bundle telemetry endpoints: ${distScan.skipped ? 'SKIPPED (no dist/ — run after npm run build)' : `${distScan.scanned} files scanned, ${distScan.hits.length} hits`}${distScan.hits.length ? '  << VIOLATIONS' : ''}`);
  for (const h of distScan.hits) say(`    - ${h}`);
  say(`D4 CSP remote origins: connect-src = [${csp.connectSrc.join(', ')}] (pinned host ${PINNED_MODEL_HOST}); problems: ${csp.problems.length}`);
  for (const p of csp.problems) say(`    - ${p}`);
  say(`D5 model pin: ${model.repo} @ ${model.revision} (${model.filename}, ${model.sizeBytes} bytes, ${model.license})`);
  say(`    cached weights: ${pin.cacheState.present ? `present, sha256 ${pin.cacheState.sha256.slice(0, 16)}…, ${pin.problems.length ? 'DOES NOT MATCH THE PIN' : 'byte-verified'}` : 'absent (not re-downloaded here; fetch_model.mjs + CI setup.sh verify)'}`);
  for (const p of pin.problems) say(`    - ${p}`);

  if (!SEED) {
    // Persist the committed evidence: full inventory + audit verdict.
    mkdirSync(EV, { recursive: true });
    const doc = {
      purpose: 'A26 dependency + license inventory and audit (real npm ls tree; scripts/audit_deps.mjs)',
      node: process.version,
      package_count: inventory.packages.length,
      packages: inventory.packages,
      licenses_summary: byLicense,
      telemetry_dependency_hits: telemetryHits,
      production_bundle_telemetry_scan: distScan,
      production_csp: { directives: PROD_CSP, connect_src_remote: csp.connectSrc, pinned_model_host: PINNED_MODEL_HOST, problems: csp.problems },
      pinned_model: {
        id: model.id, repo: model.repo, revision: model.revision, filename: model.filename,
        url: model.url, sha256: model.sha256, sizeBytes: model.sizeBytes, format: model.format,
        license: model.license, licenseUrl: model.licenseUrl,
        cached_weights: pin.cacheState,
      },
      violations: found,
    };
    writeFileSync(join(EV, 'license_inventory.json'), JSON.stringify(doc, null, 2) + '\n');
    say(`wrote docs/evidence/S6/license_inventory.json`);
  }

  say('');
  if (found.length) {
    say(`VIOLATIONS FOUND (${found.length}):`);
    for (const v of found) say(`  - ${v}`);
    if (SEED) {
      // Every SEEDED violation CLASS must have tripped some detector, else
      // the audit is vacuous on that class — exit 2 (broken audit), not 1.
      const classes = {
        'D3a telemetry dep': (v) => /postclip-analytics/.test(v),
        'D4 extra CSP origin': (v) => /evil\.example\.com|cdn\.example\.net/.test(v),
        'D5 broken model pin': (v) => /revision is not a 40-hex|sha256 is not 64-hex|does NOT byte-hash/.test(v),
        'D3b dist marker': (v) => /SEEDED dist marker/.test(v),
      };
      const missed = Object.entries(classes).filter(([, test]) => !found.some(test)).map(([name]) => name);
      if (missed.length) {
        say(`seeded negative control FAILED to trip: ${missed.join(', ')} — THE AUDIT IS BROKEN.`);
        process.exitCode = 2;
      } else {
        say('seeded negative control: every detector class tripped.');
        process.exitCode = 1; // control TRIPPED (expected)
      }
    } else {
      say('audit_deps: FAIL');
      process.exitCode = 1;
    }
  } else {
    if (SEED) {
      say('seeded negative control: NO detector tripped — THE AUDIT IS BROKEN (it cannot find known violations).');
      process.exitCode = 2;
    } else {
      say('audit_deps: CLEAN — D1 tree clean, D2 all licenses resolvable, D3 no telemetry, D4 CSP exact, D5 pin well-formed (+ cached weights byte-verified).');
      process.exitCode = 0;
    }
  }
  if (!SEED) {
    mkdirSync(EV, { recursive: true });
    writeFileSync(join(EV, 'audit_deps.txt'), lines.join('\n') + '\n');
  }
  return process.exitCode;
}

run();
