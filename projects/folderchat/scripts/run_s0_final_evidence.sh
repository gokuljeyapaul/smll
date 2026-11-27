#!/usr/bin/env bash
# S0 final evidence run — the proven stage-marker pattern (idempotent; each stage
# stamps .cache/evidence-stages/S0/<stage> and is skipped when already green).
# Produces everything docs/evidence/S0/ needs: green.log, junit/*.xml, negative.log,
# e2e.log, demo.log, eval/*.json, versions.json. Re-run any time; FOLDERCHAT_FORCE=1 redoes.
#
# Exit semantics are written down per stage: a stage that is expected to refuse bad
# input records expected-vs-observed exit codes in negative.log (a control passes
# when the observed refusal exit equals the expected one).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
EV=docs/evidence/S0
STAMP=.cache/evidence-stages/S0
PY=.venv/bin/python
mkdir -p "$EV/junit" "$EV/eval" "$STAMP"
FORCE="${FOLDERCHAT_FORCE:-0}"

stage() { # stage <name> -> 0 = run it, 1 = skip (already green)
  [ "$FORCE" = "1" ] && return 0
  [ -f "$STAMP/$1" ] && return 1
  return 0
}
mark() { date -u +%Y-%m-%dT%H:%M:%SZ > "$STAMP/$1"; }

if stage lint; then
  echo "== lint: ruff + mypy ==" | tee -a "$EV/green.log"
  $PY -m ruff check src tests scripts/gen_fixtures.py scripts/fetch_model.py scripts/verify_evidence.py scripts/gen_ship_rule.py scripts/gen_s0_summary.py 2>&1 | tee -a "$EV/green.log"
  RUFF=$?
  $PY -m mypy 2>&1 | tee -a "$EV/green.log"
  MYPY=$?
  [ "$RUFF" = 0 ] && [ "$MYPY" = 0 ] && mark lint
  echo "ruff=$RUFF mypy=$MYPY" | tee -a "$EV/green.log"
fi

if stage fast; then
  echo "== pytest fast (no model inference) ==" | tee -a "$EV/green.log"
  $PY -m pytest tests -m "fast" --junitxml="$EV/junit/host-fast.staging.xml" -q 2>&1 | tail -20 | tee -a "$EV/green.log"
  FAST=${PIPESTATUS[0]}
  [ "$FAST" = 0 ] && mv "$EV/junit/host-fast.staging.xml" "$EV/junit/host-fast.xml" && mark fast
  echo "fast exit=$FAST" | tee -a "$EV/green.log"
fi

if stage slow; then
  echo "== pytest slow (real models: embeddings + answer model) ==" | tee -a "$EV/green.log"
  $PY -m pytest tests -m "slow" --junitxml="$EV/junit/host-slow.staging.xml" -q 2>&1 | tee "$EV/e2e.log" | tail -20 | tee -a "$EV/green.log"
  SLOW=${PIPESTATUS[0]}
  [ "$SLOW" = 0 ] && mv "$EV/junit/host-slow.staging.xml" "$EV/junit/host-slow.xml" && mark slow
  echo "slow exit=$SLOW" | tee -a "$EV/green.log"
fi

if stage negative; then
  echo "== negative controls (expected refusals; control passes when observed exit == expected) ==" | tee "$EV/negative.log"
  # 1. oversized question (1001 chars) -> exit 2 with the specific numbers
  Q1001=$(printf 'x%.0s' {1..1001})
  $PY -m folderchat ask "$Q1001" >/tmp/neg1.out 2>/tmp/neg1.err; OBS1=$?
  echo "-- $PY -m folderchat ask <1001 chars>  EXPECTED exit=2  OBSERVED exit=$OBS1" | tee -a "$EV/negative.log"
  cat /tmp/neg1.err | tee -a "$EV/negative.log"
  # 2. bad limits.yaml (out of safe range) -> refused at startup, exit 2
  printf 'max_file_mb: 5000\n' > /tmp/neg_limits.yaml
  FOLDERCHAT_LIMITS=/tmp/neg_limits.yaml $PY -m folderchat ask "hi" >/tmp/neg2.out 2>/tmp/neg2.err; OBS2=$?
  echo "-- FOLDERCHAT_LIMITS=<max_file_mb: 5000> ask  EXPECTED exit=2  OBSERVED exit=$OBS2" | tee -a "$EV/negative.log"
  cat /tmp/neg2.err | tee -a "$EV/negative.log"
  # 3. add of a missing folder -> clean refusal, exit 1
  $PY -m folderchat add /nonexistent-folder-xyz >/tmp/neg3.out 2>/tmp/neg3.err; OBS3=$?
  echo "-- add /nonexistent-folder-xyz  EXPECTED exit=1  OBSERVED exit=$OBS3" | tee -a "$EV/negative.log"
  cat /tmp/neg3.err | tee -a "$EV/negative.log"
  # 4. the pytest negative suite (each asserts a refusal behaviour; PASS == refusal worked)
  $PY -m pytest tests/negative -m "fast or slow" --junitxml="$EV/junit/negative.staging.xml" -q 2>&1 | tail -8 | tee -a "$EV/negative.log"
  NEG=${PIPESTATUS[0]}
  [ "$OBS1" = 2 ] && [ "$OBS2" = 2 ] && [ "$OBS3" = 1 ] && [ "$NEG" = 0 ] \
    && mv "$EV/junit/negative.staging.xml" "$EV/junit/negative.xml" && mark negative
  echo "negative exit=$NEG (junit promoted only if all observed==expected)" | tee -a "$EV/negative.log"
fi

if stage vector-choice; then
  echo "== vector backend measurement (sqlite-vec vs hnswlib) ==" | tee -a "$EV/green.log"
  FOLDERCHAT_RUN_VECTOR_CHOICE=1 $PY -m pytest tests/bench -k vector_backend_choice \
    --junitxml="$EV/junit/bench-vector.staging.xml" -q -s 2>&1 | tail -15 | tee -a "$EV/green.log"
  VEC=${PIPESTATUS[0]}
  [ "$VEC" = 0 ] && mv "$EV/junit/bench-vector.staging.xml" "$EV/junit/bench-vector.xml" && mark vector-choice
fi

if stage demo; then
  echo "== demo (the issue #93 observable result, offline) ==" | tee -a "$EV/green.log"
  bash scripts/demo.sh 2>&1 | tee -a "$EV/green.log"
  DEMO=$?
  [ "$DEMO" = 0 ] && mark demo
  echo "demo exit=$DEMO" | tee -a "$EV/green.log"
fi

if stage bench-retrieval; then
  echo "== full retrieval eval (A03; building host bench) ==" | tee -a "$EV/green.log"
  FOLDERCHAT_RUN_BENCH=1 $PY -m pytest tests/eval -k test_a03_recall_full_eval_recorded \
    --junitxml="$EV/junit/bench-retrieval.staging.xml" -q -s 2>&1 | tail -15 | tee -a "$EV/green.log"
  BR=${PIPESTATUS[0]}
  [ "$BR" = 0 ] && mv "$EV/junit/bench-retrieval.staging.xml" "$EV/junit/bench-retrieval.xml" && mark bench-retrieval
  echo "bench-retrieval exit=$BR" | tee -a "$EV/green.log"
fi

if stage bench-answers; then
  echo "== answer-selection bench (A04/A06; every candidate + baseline; parallel workers, HOURS on CPU) ==" | tee -a "$EV/green.log"
  # 5 parallel workers, one per candidate, FOLDERCHAT_BENCH_THREADS=1 (one eval thread
  # each: the building host's cgroup quota is 4 CPUs; the measured load context is
  # recorded here and in model_selection.md). Every candidate gets the SAME fixed
  # stratified subset (10 answerable + 10 unanswerable + 3 injection, seed 20261127)
  # — a fair fight. Each worker writes its own JUnit, promoted only on success.
  BA_CANDS="pleias-rag-1b pleias-rag-350m occ-rag-1.7b granite-4.0-micro bm25-top-passage"
  echo "bench-answers host context: cpu.max=$(cat /sys/fs/cgroup/cpu.max 2>/dev/null || echo '?') loadavg=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo '?')" | tee -a "$EV/green.log"
  for c in $BA_CANDS; do
    (
      FOLDERCHAT_RUN_BENCH=1 FOLDERCHAT_BENCH_THREADS=1 \
        $PY -m pytest "tests/bench/test_answer_bench.py::test_a04_candidate_eval[$c]" \
        --junitxml="$EV/junit/bench-answers-$c.staging.xml" -q -s \
        > "$EV/bench-answers-$c.log" 2>&1
      echo $? > "$STAMP/bench-answers-$c.exit"
    ) &
  done
  wait
  BA_FAIL=0
  for c in $BA_CANDS; do
    RC=$(cat "$STAMP/bench-answers-$c.exit" 2>/dev/null || echo 99)
    if [ "$RC" = 0 ] && [ -f "$EV/junit/bench-answers-$c.staging.xml" ]; then
      mv "$EV/junit/bench-answers-$c.staging.xml" "$EV/junit/bench-answers-$c.xml"
      tail -3 "$EV/bench-answers-$c.log" | tee -a "$EV/green.log"
    else
      BA_FAIL=1
      echo "-- candidate $c FAILED (exit=$RC):" | tee -a "$EV/green.log"
      tail -15 "$EV/bench-answers-$c.log" 2>/dev/null | tee -a "$EV/green.log"
    fi
  done
  if [ "$BA_FAIL" = 0 ]; then
    echo "== ship rule from the recorded numbers (gen_ship_rule.py) ==" | tee -a "$EV/green.log"
    $PY scripts/gen_ship_rule.py 2>&1 | tee -a "$EV/green.log" || BA_FAIL=1
  fi
  if [ "$BA_FAIL" = 0 ]; then
    echo "== ship-rule consistency + latency pass (4 threads, 2 questions/candidate) ==" | tee -a "$EV/green.log"
    FOLDERCHAT_RUN_BENCH=1 $PY -m pytest tests/bench -k "test_a04_ship_rule or test_a04_latency_pass" \
      --junitxml="$EV/junit/bench-answers-ship.staging.xml" -q -s 2>&1 | tail -10 | tee -a "$EV/green.log"
    SHIPRC=${PIPESTATUS[0]}
    if [ "$SHIPRC" = 0 ]; then mv "$EV/junit/bench-answers-ship.staging.xml" "$EV/junit/bench-answers-ship.xml"; else BA_FAIL=1; fi
  fi
  [ "$BA_FAIL" = 0 ] && mark bench-answers
  echo "bench-answers exit=$BA_FAIL" | tee -a "$EV/green.log"
fi

if stage versions; then
  echo "== versions.json ==" | tee -a "$EV/green.log"
  {
    echo "{"
    echo '  "generated": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",'
    echo '  "python": "'"$($PY --version 2>&1 | awk '{print $2}')"'",'
    echo '  "platform": "'"$($PY -c 'import platform; print(platform.platform())')"'",'
    echo '  "packages": {'
    $PY -m pip freeze --local 2>/dev/null | grep -v "^-e" | sort | awk -F== '{printf "    \"%s\": \"%s\",\n", $1, $2}' | sed '$ s/,$//'
    echo "  }"
    echo "}"
  } > "$EV/versions.json"
  mark versions
fi

# final verdict: every stage must be stamped
MISSING=0
for s in lint fast slow negative vector-choice demo bench-retrieval bench-answers versions; do
  if [ ! -f "$STAMP/$s" ]; then echo "STAGE NOT GREEN: $s"; MISSING=1; fi
done
if [ "$MISSING" = 0 ]; then
  echo "ALL STAGES GREEN — run scripts/gen_s0_summary.py to finish summary.json"
else
  echo "EVIDENCE INCOMPLETE (see above)"
fi
exit "$MISSING"
