#!/usr/bin/env bash
# Prerequisite check. Reports BLOCKED (exit 1) for anything missing; never installs.
#   bash scripts/preflight.sh          # full device toolchain check (the Mac)
#   bash scripts/preflight.sh ci       # minimal check (python3) for CI / plan-only phase
# Writes artifacts/preflight.json. Safe from any cwd; bash 3.2 compatible (macOS).
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
MODE="${1:-device}"
mkdir -p artifacts
REPORT="artifacts/preflight.tsv"
: > "$REPORT"
missing=0

check() { # name | test command | remediation
  local name="$1" cmd="$2" fix="$3" status="OK"
  if ! eval "$cmd" >/dev/null 2>&1; then status="MISSING"; missing=$((missing + 1)); fi
  printf '%s\t%s\t%s\n' "$name" "$status" "$fix" >> "$REPORT"
  printf '  [%s] %s%s\n' "$status" "$name" "$([ "$status" = MISSING ] && echo " -> $fix")"
}

echo "preflight ($MODE)"
check "python3" "command -v python3" "install Python 3"

if [ "$MODE" != "ci" ]; then
  check "macOS" '[ "$(uname -s)" = Darwin ]' "iOS builds and video recording need a Mac"
  check "node" "command -v node" "install Node (version in .nvmrc once S0 creates it)"
  check "npm" "command -v npm" "install npm"
  check "git" "command -v git" "install git"
  check "xcodebuild" "xcodebuild -version" "install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
  check "ios simulator runtime" "xcrun simctl list devices available | grep -q iPhone" "install an iOS simulator runtime in Xcode > Settings > Platforms"
  check "java (JDK)" "command -v java && java -version" "install a JDK (17)"
  check "adb" "command -v adb || [ -x \"\${ANDROID_HOME:-/nonexistent}/platform-tools/adb\" ]" "install Android SDK platform-tools; set ANDROID_HOME"
  check "android emulator" "command -v emulator || [ -x \"\${ANDROID_HOME:-/nonexistent}/emulator/emulator\" ]" "install the Android emulator package"
  check "an Android AVD" "[ -n \"\$( (command -v emulator >/dev/null && emulator -list-avds) || \${ANDROID_HOME:-/nonexistent}/emulator/emulator -list-avds 2>/dev/null)\" ]" "create an arm64 AVD with Android Studio / avdmanager"
  check "maestro" "command -v maestro" "brew install maestro   (allowed by plan D5)"
  check "idb_companion" "command -v idb_companion" "brew install facebook/fb/idb-companion   (allowed by plan D5)"
  check "ffmpeg" "command -v ffmpeg" "brew install ffmpeg   (allowed by plan D5)"
  check "disk >= 40 GB free" '[ "$(df -Pk . | awk "NR==2{print \$4}")" -ge 41943040 ]' "free up disk space"
fi

python3 - "$REPORT" "$MODE" <<'PY'
import json, sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
report = {"mode": sys.argv[2],
          "checks": [{"name": r[0], "status": r[1], "remediation": r[2]} for r in rows],
          "blocked": any(r[1] != "OK" for r in rows)}
json.dump(report, open("artifacts/preflight.json", "w"), indent=2)
PY

if [ "$missing" -gt 0 ]; then
  echo "preflight: BLOCKED ($missing prerequisite(s) missing; nothing was installed)"
  exit 1
fi
echo "preflight: OK"
