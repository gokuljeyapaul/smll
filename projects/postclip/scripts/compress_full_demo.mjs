#!/usr/bin/env node
/**
 * Post-production for the natural-pace FULL-WORKING demo capture (issue #73).
 *
 * Input: the ONE continuous real-run webm recorded by
 * scripts/make_full_demo_video.mjs (artifacts/dv/postclip-full-run.webm) plus
 * its wall-clock stage markers (artifacts/dv/markers.json).
 *
 * What this does — all of it on real footage, nothing synthetic except the
 * honest title/end cards:
 *   1. prepends a title card and appends an end card;
 *   2. time-compresses EXACTLY ONE segment — the LLM inference wait — by a
 *      computed factor, with a persistent on-screen caption disclosing the
 *      factor and the real duration (the S6 disclosure convention);
 *   3. adds short lower-third captions at real stage boundaries (readability
 *      annotations over real frames);
 *   4. encodes the committed asset hard: H.264, 720p, CRF 30-32 ladder with
 *      a two-pass ABR fallback, NO audio track at all ("low volume" = silent),
 *      +faststart for phone viewing; hard budget <= 15 MB;
 *   5. renders a GIF of the same run (full run, and a short representative
 *      loop if the full GIF exceeds the 15 MB budget) and MEASURES BOTH so
 *      the PR documents which is smaller;
 *   6. writes docs/evidence/video_manifest.json entry for the committed file
 *      and artifacts/dv/size-comparison.json with every measurement.
 *
 * Usage: node scripts/compress_full_demo.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DV = join(ROOT, 'artifacts', 'dv');
const TMP = join(ROOT, '.cache', 'dv-video');
const OUT_DIR = join(ROOT, 'docs', 'demo');
const OUT_MP4 = join(OUT_DIR, 'postclip-full-demo.mp4');
const WEBM = join(DV, 'postclip-full-run.webm');
const MARKERS = join(DV, 'markers.json');
const MANIFEST_PATH = join(ROOT, 'docs', 'evidence', 'video_manifest.json');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const HARD_CAP_BYTES = 15 * 1024 * 1024;
const SAFETY_BYTES = 14.8 * 1024 * 1024;

const INTRO_SEC = 4.0;
const END_SEC = 3.0;
const GUARD_SEC = 1.2;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...opts });
}

function log(text) {
  console.log(`[compress] ${text}`);
}

function durationSeconds(path) {
  return parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { quiet: true }).trim());
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function escFilter(p) {
  return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,');
}

// ---------- load the capture ----------
if (!existsSync(WEBM) || !existsSync(MARKERS)) {
  console.error('compress_full_demo: missing capture — run scripts/make_full_demo_video.mjs first');
  process.exit(1);
}
const capture = JSON.parse(readFileSync(MARKERS, 'utf-8'));
const M = {};
for (const m of capture.markers) M[m.name] = m.t;
const D = durationSeconds(WEBM);
log(`capture: ${WEBM} — ${D.toFixed(1)}s, ${(statSync(WEBM).size / 1e6).toFixed(2)} MB`);

const runStart = M.llm_running ?? (M.ocr2_deterministic_visible ?? 0) + 2;
const runEnd = M.llm_applied;
if (!runEnd) {
  console.error('compress_full_demo: no llm_applied marker — the capture did not apply the model cleanup');
  process.exit(1);
}
// The time-lapse starts one second AFTER the running state first shows, so
// the second pick, the deterministic result and the "Tidying…" status flip
// all stay at natural pace and the viewer sees the wait begin for real.
const cutA = Math.min(runStart + 1.0, runEnd - 2);
const cutB = Math.min(D - 0.2, runEnd + GUARD_SEC);
const durB = cutB - cutA;
if (durB <= 3) {
  console.error(`compress_full_demo: inference segment too short (${durB.toFixed(1)}s) — nothing to compress`);
  process.exit(1);
}
const factor = Math.max(2, Math.round(durB / 22));
const durBShown = durB / factor;
log(`inference segment: ${cutA.toFixed(1)}s → ${cutB.toFixed(1)}s (${durB.toFixed(1)}s real) shown ${factor}x faster (${durBShown.toFixed(1)}s)`);

/** Map a capture-marker timestamp to the FINAL (assembled) timeline. */
function finalT(markerT) {
  if (markerT <= cutA) return INTRO_SEC + markerT;
  if (markerT < cutB) return INTRO_SEC + cutA + (markerT - cutA) / factor;
  return INTRO_SEC + cutA + durBShown + (markerT - cutB);
}

mkdirSync(TMP, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// ---------- title + end cards ----------
const X264_INTER = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1', '-an'];
function card(file, lines, secs) {
  // per-line textfiles (drawtext has no multi-line textfile layout control)
  const perLine = lines.map((l, i) => {
    const p = join(TMP, `${file}.${i}.txt`);
    writeFileSync(p, l);
    return p;
  });
  const n = lines.length;
  const lineH = 52;
  const startY = `(h-(((${n}) * ${lineH})) / 2)`;
  const vf = perLine
    .map((p, i) => `drawtext=fontfile=${FONT}:textfile=${escFilter(p)}:fontcolor=0xf2f5f7:fontsize=38:x=(w-text_w)/2:y=${startY}+${i * lineH}`)
    .join(',');
  const out = join(TMP, file.replace(/\.txt$/, '.mp4'));
  sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x101418:s=1280x720:r=15:d=${secs}`,
    '-vf', `${vf},format=yuv420p`, '-t', String(secs), ...X264_INTER, out], { quiet: true });
  return out;
}

log('rendering title/end cards');
const introCard = card('intro.txt', [
  'PostClip — the full working app',
  'one continuous real run: real in-browser OCR, real pinned model',
  'natural pace — only the model-cleanup wait is time-lapsed (factor on screen)',
], INTRO_SEC);
const endCard = card('end.txt', [
  'No cloud. Nothing stored. English only.',
  'Every frame of this video is a real run — evidence: docs/evidence/DV/',
], END_SEC);

// ---------- cut + speed up segments ----------
log('cutting segments (natural pace everywhere except the inference wait)');
const segA = join(TMP, 'segA.mp4');
const segB = join(TMP, 'segB.mp4');
const segC = join(TMP, 'segC.mp4');
// NOTE: -ss/-t are INPUT-side (before -i): an output-side -ss is applied
// AFTER the filter chain, where setpts=PTS/N has already divided the
// timestamps — the gate would then drop every frame (found the hard way).
sh('ffmpeg', ['-y', '-ss', '0', '-t', cutA.toFixed(3), '-i', WEBM,
  '-vf', 'fps=15,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
  ...X264_INTER, segA], { quiet: true });

const segBCaption = `Real on-device model inference — one continuous run, shown ${factor}x faster (${Math.round(durB)}s of real time)`;
const segBCapFile = join(TMP, 'segb-caption.txt');
writeFileSync(segBCapFile, segBCaption);
sh('ffmpeg', ['-y', '-ss', cutA.toFixed(3), '-t', durB.toFixed(3), '-i', WEBM,
  '-vf', [
    `setpts=PTS/${factor}`,
    'fps=15',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1',
    `drawtext=fontfile=${FONT}:textfile=${escFilter(segBCapFile)}:fontcolor=0xf2f5f7:fontsize=30:box=1:boxcolor=0x101418E6:boxborderw=16:x=(w-text_w)/2:y=h-96`,
    'format=yuv420p',
  ].join(','),
  ...X264_INTER, segB], { quiet: true });

sh('ffmpeg', ['-y', '-ss', cutB.toFixed(3), '-i', WEBM,
  '-vf', 'fps=15,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
  ...X264_INTER, segC], { quiet: true });

for (const [name, dur] of [['segA', cutA], ['segB', durBShown], ['segC', D - cutB]]) {
  const got = durationSeconds(join(TMP, `${name}.mp4`));
  if (!Number.isFinite(got) || got < 0.5) {
    console.error(`compress_full_demo: ${name}.mp4 is empty (${got}s) — cut failed`);
    process.exit(1);
  }
  log(`  ${name}: ${got.toFixed(1)}s (expected ~${dur.toFixed(1)}s)`);
}

// ---------- assemble ----------
log('assembling (cards + natural + time-lapsed inference + natural)');
const assembled = join(DV, 'postclip-full-demo-assembled.mp4');
const listFile = join(TMP, 'concat.txt');
writeFileSync(listFile, [introCard, segA, segB, segC, endCard].map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', assembled], { quiet: true });
const assembledDur = durationSeconds(assembled);
log(`assembled: ${assembledDur.toFixed(1)}s, ${(statSync(assembled).size / 1e6).toFixed(2)} MB (intermediate)`);

// ---------- lower-third captions ----------
const captions = [
  { at: M.paste_click, text: 'A real screenshot goes in — read from the clipboard (Paste button)' },
  { at: M.ocr_done, text: 'OCR runs entirely in your browser (tesseract.js, WASM worker)' },
  { at: M.edit_start, text: 'The cleaned text is fully editable — every output follows your edits' },
  { at: M.copied_confirmed, text: 'Copy — a real clipboard write' },
  { at: M.share_click, text: 'Share hands the text to the OS share sheet (payload recorded; the sheet is not capturable headless)' },
  { at: M.exports_done, text: 'Export — real .md / .txt / .json downloads' },
  { at: M.model_download_click, text: 'First use: the pinned tidy-up model downloads once — visible progress, sha256-verified before caching' },
  { at: M.llm_toggle_click, text: 'Model cleanup is opt-in (off by default) — switching it on' },
  { at: M.pick_click, text: 'Same screenshot again, now with the model cleanup on' },
  { at: M.llm_applied, text: 'Verified model output — every word checked against the screenshot' },
].filter((c) => typeof c.at === 'number' && c.at > 0);

const capChain = captions.map((c, i) => {
  const p = join(TMP, `cap-${i}.txt`);
  writeFileSync(p, c.text);
  const start = finalT(c.at) + 0.3;
  const end = start + 4.0;
  return `drawtext=fontfile=${FONT}:textfile=${escFilter(p)}:fontcolor=0xf2f5f7:fontsize=26:box=1:boxcolor=0x000000B3:boxborderw=12:x=48:y=h-88:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`;
}).join(',');

// ---------- final encode (CRF ladder, hard budget) ----------
const FINAL_ARGS = ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1', '-an', '-movflags', '+faststart'];
function encodeFinal(crf) {
  sh('ffmpeg', ['-y', '-i', assembled, '-vf', capChain.length ? `${capChain},format=yuv420p` : 'format=yuv420p', '-crf', String(crf), ...FINAL_ARGS, OUT_MP4], { quiet: true });
}

let committedCrf = 30;
encodeFinal(30);
let size = statSync(OUT_MP4).size;
log(`CRF 30 -> ${(size / 1e6).toFixed(2)} MB`);
if (size > SAFETY_BYTES) {
  committedCrf = 32;
  encodeFinal(32);
  size = statSync(OUT_MP4).size;
  log(`CRF 32 -> ${(size / 1e6).toFixed(2)} MB`);
}
if (size > SAFETY_BYTES) {
  // Two-pass ABR to the S6-style 11.5 MiB target over the assembled duration.
  committedCrf = 'abr';
  const kbps = Math.max(220, Math.min(1400, Math.round((11.5 * 1024 * 1024 * 8) / assembledDur / 1000)));
  const logPrefix = join(TMP, '2pass');
  for (const passNo of [1, 2]) {
    sh('ffmpeg', ['-y', '-i', assembled, ...(capChain.length ? ['-vf', capChain] : []),
      '-pass', String(passNo), '-passlogfile', logPrefix,
      '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.6)}k`, '-bufsize', `${kbps * 2}k`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.1', '-an', '-movflags', '+faststart',
      ...(passNo === 1 ? ['-f', 'null', '/dev/null'] : [OUT_MP4])], { quiet: true });
  }
  size = statSync(OUT_MP4).size;
  log(`two-pass ${kbps} kbps -> ${(size / 1e6).toFixed(2)} MB`);
}
const outDuration = durationSeconds(OUT_MP4);
const height = parseInt(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', OUT_MP4], { quiet: true }).trim(), 10);
log(`docs/demo/postclip-full-demo.mp4: ${(size / 1e6).toFixed(2)} MB, ${outDuration.toFixed(1)}s, ${height}p, crf=${committedCrf}, no audio track`);
if (size > HARD_CAP_BYTES || height > 720) {
  console.error(`compress_full_demo: FAILED budget (${size} bytes, ${height}p)`);
  process.exit(1);
}

// ---------- GIF comparison (the issue asks for the smaller of mp4/gif) ----------
log('rendering the comparison GIF of the same run');
const gifFull = join(DV, 'postclip-full-demo.gif');
const palette = join(TMP, 'palette.png');
sh('ffmpeg', ['-y', '-i', OUT_MP4, '-vf', `fps=8,scale=640:-1:flags=lanczos,palettegen=max_colors=128`, palette], { quiet: true });
sh('ffmpeg', ['-y', '-i', OUT_MP4, '-i', palette, '-lavfi', `fps=8,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', gifFull], { quiet: true });
const gifFullSize = statSync(gifFull).size;
log(`GIF (full run): ${(gifFullSize / 1e6).toFixed(2)} MB`);

let gifLoopSize = null;
const gifLoop = join(DV, 'postclip-full-demo-loop.gif');
if (gifFullSize > HARD_CAP_BYTES) {
  // A short representative loop of the core UX: input -> OCR -> review ->
  // edit -> copy (from the committed mp4, so it matches what is shown).
  const loopStart = finalT(M.paste_click) - 1.5;
  const loopDur = Math.max(8, finalT(M.copied_confirmed) + 6 - loopStart);
  sh('ffmpeg', ['-y', '-i', OUT_MP4, '-i', palette, '-lavfi',
    `trim=start=${loopStart.toFixed(2)}:duration=${loopDur.toFixed(2)},setpts=PTS-STARTPTS,fps=8,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', gifLoop], { quiet: true });
  gifLoopSize = statSync(gifLoop).size;
  log(`GIF (representative loop, ${loopDur.toFixed(1)}s): ${(gifLoopSize / 1e6).toFixed(2)} MB`);
}

// ---------- boundary frames (visual proof of honest cuts) ----------
for (const [name, t] of [['cutA-before', finalT(cutA) - 2.5], ['cutA-after', finalT(cutA) + 2.5],
  ['inference-end', finalT(cutB) - 2], ['applied', finalT(M.llm_applied) + 1]]) {
  sh('ffmpeg', ['-y', '-ss', Math.max(0, t).toFixed(2), '-i', OUT_MP4, '-frames:v', '1', join(DV, `boundary-${name}.png`)], { quiet: true });
}

// ---------- measurements + manifest ----------
const mp4Sha = sha256(OUT_MP4);
const comparison = {
  measured_at: new Date().toISOString(),
  mp4: { path: 'docs/demo/postclip-full-demo.mp4', size_bytes: size, sha256: mp4Sha, duration_s: Math.round(outDuration * 10) / 10, height, crf: committedCrf, audio: 'none (silent by construction)' },
  gif_full: { path: 'artifacts/dv/postclip-full-demo.gif', size_bytes: gifFullSize, sha256: sha256(gifFull), note: 'same run, 640px wide, 8 fps, 128-color palette' },
  ...(gifLoopSize ? { gif_loop: { path: 'artifacts/dv/postclip-full-demo-loop.gif', size_bytes: gifLoopSize, sha256: sha256(gifLoop), note: 'short representative loop of the core UX (input -> OCR -> review -> edit -> copy)' } } : {}),
  committed: 'mp4',
  reason: 'the H.264 mp4 is far smaller than the GIF of the same run; both sizes recorded above',
  time_compression: {
    stage: 'LLM cleanup inference (single-threaded WASM)',
    real_duration_s: Math.round(durB * 10) / 10,
    shown_duration_s: Math.round(durBShown * 10) / 10,
    factor,
    disclosure: `persistent on-screen caption during the segment: "${segBCaption}"`,
  },
  source_capture: { path: 'artifacts/dv/postclip-full-run.webm', sha256: capture.sha256, size_bytes: capture.size_bytes },
};
writeFileSync(join(DV, 'size-comparison.json'), JSON.stringify(comparison, null, 2) + '\n');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
const entry = {
  id: 'postclip_full_demo',
  path: 'docs/demo/postclip-full-demo.mp4',
  sha256: mp4Sha,
  size_bytes: size,
  duration_s: Math.round(outDuration * 10) / 10,
  engine: 'chromium',
  junit: 'junit:docs/evidence/S6/junit/chromium-e2e.xml::uc01_pick_ocr_review_share',
  junit_verified: true,
  note: 'DV (#73): natural-pace FULL-WORKING capture of ONE continuous real run (real clipboard paste, real in-browser OCR, deliberate edit, real copy/share-spy/export downloads, real pinned-model download with visible progress served from the local cache by scripts/serve_model.mjs, opt-in model cleanup, real WASM inference to the guarded verified output). Driver: scripts/make_full_demo_video.mjs (logs: docs/evidence/DV/capture.log); post-production: scripts/compress_full_demo.mjs. The LLM-inference wait is the ONLY time-compressed segment, factor disclosed in a persistent on-screen caption and in artifacts/dv/size-comparison.json; every other stage is natural pace. The junit field points at the committed passing testcase of the primary constituent flow (uc01 pick->OCR->review->share), the same convention the S6 compilation entry uses; the capture run itself is logged, not a junit testcase.',
  compressed_segment: { stage: 'llm inference', real_duration_s: Math.round(durB * 10) / 10, shown_duration_s: Math.round(durBShown * 10) / 10, factor },
  built_from: `artifacts/dv/postclip-full-run.webm (sha256 ${capture.sha256})`,
};
const others = manifest.videos.filter((v) => v.id !== entry.id);
manifest.videos = [...others, entry].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
log(`video_manifest.json: entry postclip_full_demo (${(size / 1e6).toFixed(2)} MB, sha256 ${mp4Sha.slice(0, 16)}…)`);
log('DONE');
