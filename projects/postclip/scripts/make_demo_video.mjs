#!/usr/bin/env node
/**
 * Compile the S6 demo/compilation video (O06, A24): ONE committed video of
 * every use-case flow (UC01–UC14) in Chromium and WebKit (where the use case
 * applies to that engine), built from the REAL per-flow videos Playwright
 * just recorded on this tree (artifacts/video/, listed in
 * docs/evidence/video_manifest.json) — nothing is faked or screen-acted;
 * long stages (the model download, the injection run, offline processing)
 * are sped up with a disclosed factor and the caption says so.
 *
 * Budget: at most 15 MB committed and at most 720p (plan D7 / O06). Output:
 *   docs/demo/postclip-demo.mp4  (H.264 baseline, yuv420p, +faststart —
 *   phone-viewable from the repo), plus a video_manifest.json entry
 *   (postclip_demo_compilation) with sha256/size/duration and the list of
 *   constituent per-flow videos.
 *
 * Usage: node scripts/make_demo_video.mjs   (after build_video_manifest.mjs)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'docs/demo');
const OUT = join(OUT_DIR, 'postclip-demo.mp4');
const TMP = join(ROOT, '.cache', 'demo-video');
const MANIFEST_PATH = join(ROOT, 'docs/evidence/video_manifest.json');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const TARGET_BYTES = 11.5 * 1024 * 1024; // 11.5 MiB target (hard cap 15 MB)
const HARD_CAP_BYTES = 15 * 1024 * 1024;

/** The tour: every UC01–UC14 flow, the engines it applies to, the caption
 *  card before it, and an honest speed-up factor for long stages. */
const SEGMENTS = [
  { id: 'uc01_pick_ocr_review_share_chromium', card: 'UC01 — Pick a screenshot → on-device OCR → review (Chromium)' },
  { id: 'uc01_pick_ocr_review_share_webkit', card: 'UC01 — Pick → OCR → review (WebKit); share/copy = UC06' },
  { id: 'a08_share_target_receives_image_chromium', card: 'UC02 — Share-target: image POST through the service worker (Chromium)' },
  { id: 'uc03_paste_button_processes_clipboard_image_chromium', card: 'UC03 — Paste a screenshot from the clipboard (Chromium)' },
  { id: 'a11_installable_manifest_and_sw_registered_chromium', card: 'UC04 — Installable PWA: manifest + service worker (Chromium)' },
  { id: 'a11_offline_reload_app_shell_loads_webkit', card: 'UC04 — Network cut, reload: the shell still loads (WebKit)' },
  { id: 'uc05_edit_reflects_in_payloads_chromium', card: 'UC05 — Edit the text; every payload follows (Chromium)' },
  { id: 'uc05_edit_reflects_in_payloads_webkit', card: 'UC05 — Edit (WebKit)' },
  { id: 'uc07_export_downloads_md_txt_json_chromium', card: 'UC07 — Export .md / .txt / .json (Chromium)' },
  { id: 'uc07_export_downloads_md_txt_json_webkit', card: 'UC07 — Export (WebKit)' },
  { id: 'a12_model_downloads_verifies_caches_chromium', card: 'UC08 — First use: download the pinned model, verify sha256 (Chromium, 4×)', speed: 4 },
  { id: 'a12_model_downloads_verifies_caches_webkit', card: 'UC08 — (WebKit, 6×)', speed: 6 },
  { id: 'a13_wrong_hash_falls_back_with_banner_and_purges_chromium', card: 'UC09 — Bad model file: fail closed, banner + purge (Chromium, 4×)', speed: 4 },
  { id: 'a13_unsupported_browser_banner_and_picker_works_webkit', card: 'UC09 — Unsupported browser: banner + OCR still works (WebKit)' },
  { id: 'uc10_non_english_rejected_no_cleanup_chromium', card: 'UC10 — Non-English screenshot: rejected, no cleanup (Chromium)' },
  { id: 'uc10_non_english_rejected_no_cleanup_webkit', card: 'UC10 — (WebKit)' },
  { id: 'uc11_bad_input_error_states_chromium', card: 'UC11 — Bad inputs: specific errors, never a crash (Chromium)' },
  { id: 'uc11_bad_input_error_states_webkit', card: 'UC11 — (WebKit)' },
  { id: 'a10_denied_paste_explains_and_picker_works_chromium', card: 'UC12 — Clipboard denied: explanation + picker still works (Chromium)' },
  { id: 'uc13_injection_posts_are_content_never_obeyed_webkit', card: 'UC13 — Injection posts are content, never obeyed (WebKit, designed fallback, 6×)', speed: 6 },
  { id: 'a14_offline_processing_zero_network_requests_chromium', card: 'UC14 — Offline: model cached → zero network requests (Chromium, 4×)', speed: 4 },
  { id: 'a14_offline_processing_zero_network_requests_webkit', card: 'UC14 — (WebKit, 6×)', speed: 6 },
];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...opts });
}

function durationSeconds(path) {
  return parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { quiet: true }).trim());
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
const byId = new Map(manifest.videos.map((v) => [v.id, v]));

// Every constituent video must be a REAL, manifest-listed recording from this run.
const missing = SEGMENTS.filter((s) => !byId.has(s.id)).map((s) => s.id);
if (missing.length) {
  console.error(`make_demo_video: missing per-flow videos in the manifest: ${missing.join(', ')}`);
  process.exit(1);
}
for (const s of SEGMENTS) {
  if (!existsSync(join(ROOT, byId.get(s.id).path))) {
    console.error(`make_demo_video: video file missing on disk: ${byId.get(s.id).path}`);
    process.exit(1);
  }
}

mkdirSync(TMP, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
const concatList = [];
const constituentIds = [];
let totalDuration = 0;

const X264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1', '-an'];
const CARD_SEC = 1.7;
let idx = 0;
for (const seg of SEGMENTS) {
  constituentIds.push(seg.id);
  // Title card (same encoder settings, so concat -c copy works).
  const cardFile = join(TMP, `card-${idx}.txt`);
  writeFileSync(cardFile, seg.card.replace(/\\/g, '\\\\'));
  const cardPath = join(TMP, `card-${idx}.mp4`);
  sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x101418:s=1280x720:r=15:d=${CARD_SEC}`,
    '-vf', `drawtext=fontfile=${FONT}:textfile=${cardFile}:fontcolor=0xf2f5f7:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p`,
    '-t', String(CARD_SEC), ...X264, cardPath], { quiet: true });
  concatList.push(cardPath);
  totalDuration += CARD_SEC;
  // The flow itself: normalize to 1280x720@15, speed up when disclosed.
  const speed = seg.speed ?? 1;
  const segPath = join(TMP, `seg-${idx}.mp4`);
  const vf = [
    ...(speed !== 1 ? [`setpts=PTS/${speed}`] : []),
    'fps=15',
    'scale=1280:720:force_original_aspect_ratio=decrease',
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    'setsar=1',
    'format=yuv420p',
  ].join(',');
  sh('ffmpeg', ['-y', '-i', join(ROOT, byId.get(seg.id).path), '-vf', vf, ...X264, segPath], { quiet: true });
  concatList.push(segPath);
  totalDuration += durationSeconds(join(ROOT, byId.get(seg.id).path)) / speed;
  console.log(`  segment: ${seg.card} (from ${seg.id}, ${speed}×)`);
  idx += 1;
}

// Concat every card+segment (identical codec params → stream copy).
const listFile = join(TMP, 'concat.txt');
writeFileSync(listFile, concatList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const rawOut = join(TMP, 'compilation-raw.mp4');
sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', rawOut], { quiet: true });

// Two-pass ABR to fit the budget: TARGET_BYTES over totalDuration.
const kbps = Math.max(220, Math.min(1400, Math.round((TARGET_BYTES * 8) / totalDuration / 1000)));
console.log(`compilation: ${SEGMENTS.length} flows, ${(totalDuration / 60).toFixed(1)} min → two-pass ${kbps} kbps`);
const logPrefix = join(TMP, '2pass');
for (const passNo of [1, 2]) {
  sh('ffmpeg', ['-y', '-i', rawOut, '-pass', String(passNo), '-passlogfile', logPrefix,
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.6)}k`,
    '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1', '-an',
    '-movflags', '+faststart', ...(passNo === 1 ? ['-f', 'null', '/dev/null'] : [OUT])], { quiet: true });
}

const size = statSync(OUT).size;
const outDuration = durationSeconds(OUT);
const height = parseInt(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', OUT], { quiet: true }).trim(), 10);
console.log(`docs/demo/postclip-demo.mp4: ${(size / 1e6).toFixed(2)} MB, ${outDuration.toFixed(1)} s, ${height}p`);
if (size > HARD_CAP_BYTES || height > 720) {
  console.error(`make_demo_video: FAILED budget (${size} bytes, ${height}p)`);
  process.exit(1);
}
if (size > 14.8 * 1024 * 1024) {
  console.error(`make_demo_video: over the safety margin (${(size / 1e6).toFixed(2)} MB); re-encode lower`);
  process.exit(1);
}

// Manifest entry for the committed compilation (A24/O06).
const sha256 = createHash('sha256').update(readFileSync(OUT)).digest('hex');
const firstConstituent = byId.get(SEGMENTS[0].id);
const entry = {
  id: 'postclip_demo_compilation',
  path: 'docs/demo/postclip-demo.mp4',
  sha256,
  size_bytes: size,
  duration_s: Math.round(outDuration * 10) / 10,
  engine: 'chromium+webkit',
  junit: firstConstituent.junit,
  junit_verified: firstConstituent.junit_verified,
  note: 'S6/O06 compilation of every UC01-UC14 flow, built by scripts/make_demo_video.mjs from the S6 per-flow recordings; the junit field points at the first constituent (uc01 Chromium) and compilation_of lists every constituent, each with its own manifest entry; long stages are sped up with the disclosed factor in the caption.',
  compilation_of: constituentIds,
};
const others = manifest.videos.filter((v) => v.id !== entry.id);
manifest.videos = [...others, entry].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`video_manifest.json: entry postclip_demo_compilation (${(size / 1e6).toFixed(2)} MB, sha256 ${sha256.slice(0, 16)}…)`);
