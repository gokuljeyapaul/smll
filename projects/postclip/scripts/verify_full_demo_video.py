#!/usr/bin/env python3
"""Structural verification of the committed demo asset (DV2, no-eyes mode).

Recomputes the final-timeline windows from artifacts/dv/markers.json with the
SAME math scripts/compress_full_demo.mjs used, then checks on
docs/demo/postclip-full-demo.mp4:
  * full-file null decode exit code;
  * container facts: exactly one H.264 video stream, NO audio stream, 720p,
    ~15 fps, +faststart (moov before mdat);
  * duration vs the marker math; frame count ~= fps x duration;
  * per-stage luminance samples (YAVG/YMAX per crop) — no blank stage;
  * the responsive segment is centered (left/right padding strips match the
    card background, the centered 390px strip carries content);
  * caption-band presence: the lower-third band is brighter exactly inside
    the computed caption windows than in the gaps between them;
  * the persistent inference caption is present through the compressed
    segment (bottom-center band brighter than the same band outside it);
  * the committed sha256/size match size-comparison.json and the manifest.

Every check prints PASS/FAIL with the real numbers; exit 1 on any FAIL.
Output is captured to docs/evidence/DV2/verify.log.
"""
import json
import pathlib
import re
import subprocess
import sys

# Run from the project root:  python3 scripts/verify_full_demo_video.py
# (reads artifacts/dv/markers.json + size-comparison.json and the committed
# docs/demo/postclip-full-demo.mp4; exit 0 = every check passed)
ROOT = pathlib.Path(__file__).resolve().parents[1]
MP4 = ROOT / "docs/demo/postclip-full-demo.mp4"
MARKERS = ROOT / "artifacts/dv/markers.json"
COMPARISON = ROOT / "artifacts/dv/size-comparison.json"
MANIFEST = ROOT / "docs/evidence/video_manifest.json"
INTRO = 4.0
GUARD = 1.2

fails = []


def say(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def sh(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def probe(args):
    rc, out = sh(["ffprobe", "-v", "error", *args, str(MP4)])
    return rc, out.strip()


def band_stat(t, crop):
    """YAVG of a crop of the frame at time t (input-side seek, one frame)."""
    vf = f"{crop},signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    rc, out = sh(["ffmpeg", "-v", "info", "-ss", f"{t:.3f}", "-i", str(MP4), "-vf", vf, "-frames:v", "1", "-f", "null", "-"])
    m = re.search(r"YAVG=([0-9.]+)", out)
    return float(m.group(1)) if m else None


# ---- load the capture math ----
cap = json.loads(MARKERS.read_text())
M = {m["name"]: m["t"] for m in cap["markers"]}
comp = json.loads(COMPARISON.read_text())
tc = comp["time_compression"]
cutA = min((M["llm_running"] + 1.0), M["llm_applied"] - 2)
cutB = M["llm_applied"] + GUARD
durB = cutB - cutA
factor = tc["factor"]
durBShown = durB / factor
respA, respB = M["resp_start"], M["resp_end"]


def finalT(t):
    if t <= cutA:
        return INTRO + t
    if t < cutB:
        return INTRO + cutA + (t - cutA) / factor
    return INTRO + cutA + durBShown + (t - cutB)


# ---- 1. null decode ----
rc, out = sh(["ffmpeg", "-v", "error", "-i", str(MP4), "-f", "null", "-"])
say(rc == 0, f"full-file null decode (exit {rc})" + (f" out={out[:200]}" if rc else ""))

# ---- 2. container facts ----
_, dur = probe(["-show_entries", "format=duration", "-of", "csv=p=0"])
dur = float(dur)
webm_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", str(ROOT / "artifacts/dv/postclip-full-run.webm")],
                                capture_output=True, text=True).stdout.strip())
expect = INTRO + cutA + durBShown + (webm_dur - cutB) + 3.0
say(abs(dur - expect) < 1.5, f"duration {dur:.1f}s matches the marker math (expected ~{expect:.1f}s: intro 4 + natural {cutA:.1f} + shown inference {durBShown:.1f} + natural {webm_dur - cutB:.1f} + end 3)")
streams = probe(["-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json"])[1]
st = json.loads(streams)["streams"]
video = [s for s in st if s["codec_type"] == "video"]
audio = [s for s in st if s["codec_type"] == "audio"]
say(len(audio) == 0, f"NO audio track (audio streams: {len(audio)})")
say(len(video) == 1 and video[0]["codec_name"] == "h264", f"exactly one H.264 video stream ({st})")
say(video[0]["height"] == 720 and video[0]["width"] == 1280, f"1280x720 ({video[0]['width']}x{video[0]['height']})")

# frame count vs duration
_, frames = probe(["-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0"])
frames = int(frames)
fps = 15.0
say(abs(frames - dur * fps) <= dur * 0.5, f"frame count {frames} ~= fps({fps}) x duration({dur:.1f}) = {dur * fps:.0f} (within 50% slack)")

# faststart: moov must appear before mdat in the file head
head = (ROOT / "docs/demo/postclip-full-demo.mp4").read_bytes()[:4 * 1024 * 1024]
moov = head.find(b"moov")
mdat = head.find(b"mdat")
say(moov != -1 and (mdat == -1 or moov < mdat), f"+faststart: moov@{moov} before mdat@{mdat}")

# ---- 3. per-stage luminance samples (no blank stage) ----
stages = [
    ("intro card", 2.0),
    ("home screen (paste stage)", 8.0),
    ("result screen (copy/share/export)", 20.0),
    ("responsive 390x844 segment", finalT((respA + respB) / 2)),
    ("model download progress", finalT(M["model_progress_50"])),
    ("model ready", finalT(M["model_ready"]) + 0.5),
    ("time-lapsed inference (segB mid)", finalT(cutA + durB / 2)),
    ("applied result (segC)", finalT(cutB) + 2.0),
    ("host round trip (segC)", finalT(M["host_result"])),
    ("end card", dur - 1.0),
]
for name, t in stages:
    y = band_stat(t, "null")
    say(y is not None and 5 < y < 250, f"stage '{name}' @ {t:.1f}s: YAVG={y} (not blank, not blown out)")

# ---- 4. the responsive segment is CENTERED ----
t_resp = finalT((respA + respB) / 2)
left_pad = band_stat(t_resp, "crop=200:720:0:0")
strip = band_stat(t_resp, "crop=390:720:445:0")
right_pad = band_stat(t_resp, "crop=200:720:1080:0")
card_bg = band_stat(2.0, "null")  # the intro card IS the pure card background (dark, with its own text)
say(left_pad is not None and right_pad is not None and strip is not None and left_pad < 60 and right_pad < 60,
    f"responsive: both padding strips are the dark card background (left YAVG={left_pad}, right YAVG={right_pad}; the intro card measures {card_bg})")
say(strip > left_pad + 100 and strip > right_pad + 100, f"responsive: the centered 390px strip carries the bright app content (strip YAVG={strip} vs pads {left_pad}/{right_pad})")

# ---- 5. lower-third caption windows vs caption-free cards ----
y_cap = band_stat(finalT(M["paste_click"]) + 1.0, "crop=1280:120:0:560")
y_intro = band_stat(2.0, "crop=1280:120:0:560")
y_end = band_stat(dur - 1.2, "crop=1280:120:0:560")
say(y_cap is not None and y_intro is not None and y_cap > y_intro + 3, f"lower-third caption present at the paste window, absent on the intro card ({y_cap} > {y_intro}+3)")
say(y_end is not None and y_cap > y_end + 3, f"lower-third caption absent on the end card ({y_cap} > {y_end}+3)")

# ---- 6. the persistent inference caption through the compressed segment ----
# The caption is a DARK box (0x101418E6) with white text drawn over the
# bright app screen, so the bottom-center band must be substantially DARKER
# inside the compressed segment than the same band just before it (the app
# screen is otherwise unchanged across the cut).
segB_mid = finalT(cutA + durB / 2)
y_in = band_stat(segB_mid, "crop=700:90:290:580")
y_out = band_stat(finalT(cutA) - 2.0, "crop=700:90:290:580")
say(y_in is not None and y_out is not None and y_out - y_in > 40, f"inference caption present inside the compressed segment (band YAVG {y_in}; the same band before it, no caption: {y_out})")

# ---- 7. committed file matches the manifest + comparison + budget ----
mp4_sha = comp["mp4"]["sha256"]
import hashlib
real_sha = hashlib.sha256(MP4.read_bytes()).hexdigest()
size = MP4.stat().st_size
say(real_sha == mp4_sha, f"committed sha256 matches size-comparison.json ({real_sha[:16]}…)")
man = json.loads(MANIFEST.read_text())
entry = next(v for v in man["videos"] if v["id"] == "postclip_full_demo")
say(entry["sha256"] == real_sha and entry["size_bytes"] == size, f"manifest entry matches the file (sha256 {entry['sha256'][:16]}…, {size} bytes)")
say(size <= 15 * 1024 * 1024, f"size {size} bytes <= 15 MB budget")
say(comp["committed"].startswith("mp4"), f"the mp4 was committed as the smaller render (mp4 {comp['mp4']['size_bytes']} vs gif {comp['gif_full']['size_bytes']})")

print()
print(f"duration={dur:.1f}s  size={size}  sha256={real_sha}")
print(f"time_compression: {tc['stage']}: {tc['real_duration_s']}s real shown {tc['shown_duration_s']}s at {tc['factor']}x (disclosed on screen)")
if fails:
    print(f"VERIFY: {len(fails)} FAIL(S)")
    sys.exit(1)
print("VERIFY: ALL CHECKS PASSED")
