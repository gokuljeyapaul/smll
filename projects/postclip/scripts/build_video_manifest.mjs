/**
 * Build/update docs/evidence/video_manifest.json from the videos Playwright
 * recorded in test-results/ during the last (green) run.
 *
 * For each test directory with a video: copy the .webm into artifacts/video/
 * as <id>.webm, compute sha256 + size, read the duration with ffprobe, and map
 * it to the JUnit testcase that proves the flow (from the slice's per-engine
 * JUnit files). Videos themselves are never committed — only this manifest.
 *
 * A directory name is `<spec file base>-<sanitized testcase>-<project>`
 * (underscores in the testcase become dashes), so the testcase is matched by
 * its sanitized name — this supports specs with more than one testcase
 * (uc11_bad_inputs, a15_privacy_audit since S1).
 *
 * Usage: node scripts/build_video_manifest.mjs <slice> [junitDir]
 *   e.g. node scripts/build_video_manifest.mjs S1 docs/evidence/S1/junit
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const slice = process.argv[2] ?? 'S0';
const junitDir = process.argv[3] ?? join(ROOT, 'docs/evidence', slice, 'junit');
// Videos are snapshotted per project run by the slice evidence script (the
// next playwright run clears test-results/).
const videoSources = [
  { root: join(ROOT, 'artifacts/video-raw-chromium'), engine: 'chromium' },
  { root: join(ROOT, 'artifacts/video-raw-webkit'), engine: 'webkit' },
];
const videoDir = join(ROOT, 'artifacts/video');
const manifestPath = join(ROOT, 'docs/evidence/video_manifest.json');

/** Every testcase that may own a video (S0 + S1 flows and evals). */
const TESTCASES = [
  'a01_built_app_loads_home_screen_no_console_errors',
  'uc01_pick_ocr_review_share',
  'eval_ocr_cer_clean_set',
  's0_negative_corrupt_input_fails_closed',
  'uc05_edit_reflects_in_payloads',
  'uc07_export_downloads_md_txt_json',
  'uc10_non_english_rejected_no_cleanup',
  'uc11_bad_input_error_states',
  'uc11_huge_downscaled_before_ocr',
  'eval_cleanup_body_f1_standard_set',
  'a15_no_storage_log_request_leaks_after_flows',
  'a15_audit_negative_control_detects_seeded_leak',
];

/** Match a video directory name to its testcase. Playwright names video dirs
 *  `<spec base>-<sanitized testcase>-<project>` but SHORTENS long ids by
 *  replacing the middle with a hash while PRESERVING the tail (~28 chars).
 *  Matching on the last 26 chars of the sanitized testcase name covers both
 *  the full and the shortened form. Exactly one testcase must match or we
 *  refuse to guess. */
function matchTestcase(dirName) {
  const matches = TESTCASES.filter((tc) => dirName.includes(tc.replaceAll('_', '-').slice(-26)));
  if (matches.length !== 1) {
    throw new Error(`video dir "${dirName}" matches ${matches.length} testcases (${matches.join(', ')}); refusing to guess`);
  }
  return matches[0];
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function durationSeconds(path) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
    ]).toString().trim();
    return Math.round(parseFloat(out) * 10) / 10;
  } catch {
    return null;
  }
}

function junitRef(engine, testcase) {
  const file = `${engine}-e2e.xml`;
  const path = join(junitDir, file);
  if (!existsSync(path)) return null;
  const xml = readFileSync(path, 'utf-8');
  // Parse testcase blocks and confirm the named one passed (no failure/skip child).
  const blocks = xml.match(/<testcase\b[\s\S]*?<\/testcase>/g) ?? [];
  for (const block of blocks) {
    const nameMatch = block.match(/\bname="([^"]*)"/);
    if (nameMatch && nameMatch[1] === testcase && !block.includes('<failure') && !block.includes('<skipped')) {
      return `junit:docs/evidence/${slice}/junit/${file}::${testcase}`;
    }
  }
  return null;
}

function main() {
  mkdirSync(videoDir, { recursive: true });
  let manifest = { videos: [] };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    manifest = { videos: [] };
  }

  const entries = [];
  for (const source of videoSources) {
    if (!existsSync(source.root)) continue;
    for (const dir of readdirSync(source.root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const video = join(source.root, dir.name, 'video.webm');
      if (!existsSync(video)) continue;
      const engine = source.engine;
      const testcase = matchTestcase(dir.name);
      const id = `${testcase}_${engine}`;
      const dest = join(videoDir, `${id}.webm`);
      copyFileSync(video, dest);
      const ref = junitRef(engine, testcase);
      const entry = {
        id,
        path: `artifacts/video/${id}.webm`,
        sha256: sha256(dest),
        size_bytes: statSync(dest).size,
        duration_s: durationSeconds(dest),
        engine,
        junit: ref ?? `junit:docs/evidence/${slice}/junit/${engine}-e2e.xml::${testcase}`,
        junit_verified: ref !== null,
      };
      entries.push(entry);
      console.log(`${id}: ${(entry.size_bytes / 1e6).toFixed(2)} MB, ${entry.duration_s}s, junit_verified=${entry.junit_verified}`);
    }
  }

  const byId = new Map(manifest.videos.map((v) => [v.id, v]));
  for (const e of entries) {
    byId.set(e.id, { ...byId.get(e.id), ...e });
  }
  manifest.videos = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`video_manifest.json updated: ${manifest.videos.length} videos`);
}

main();
