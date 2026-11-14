# Streaming / live-session processing — design

Issue #17 slice 1 (design only; the reference implementation is a separate
milestone and must not start in this PR). This doc is written against the
actual code on `main`: `src/coaching_privacy/engine.py`,
`src/coaching_privacy/pipeline.py`, `src/coaching_privacy/context.py`,
`src/coaching_privacy/linkage.py`, `src/coaching_privacy/asr.py`,
`src/coaching_privacy/batch.py`.

## 1. Consumer & release semantics

**Chosen PoC default: (a) hold-all-until-session-end.**

The live consumer is a coach-facing review console (the same human reviewer
who today consumes `decision.json` per session). "Streaming" means
**incremental scanning** — each turn is detected and validated as it
arrives so per-turn work is amortised — but **nothing is released before the
session-end gate**. No sanitized turn is emitted to any consumer mid-session;
consumers see only the terminal decision (`RELEASED` or `REJECTED` outputs
equivalent to today's `sanitized.json` / `decision.json` pair).

Justification: per-turn conditional release requires a cumulative-risk rule
whose calibration we cannot validate with the current 18-fixture suite, and
it would create a new mid-session leak surface (a turn released as benign
can become identifying once later turns arrive — exactly the
`COMBINATION_OF_CLUES` pattern `context.py` already catches at session
level). **(b) per-turn conditional release** is documented as future work
below, with its added risks named.

## 2. Fail-closed contract

Fail-closed for a live turn means **hold, never partially release**:

- A turn is *scanned* incrementally (Presidio direct-PII pass per turn —
  `engine.process_transcript`'s detector stage lifted per turn) but its
  sanitized text exists only inside the stream's memory.
- Validator/detector unavailability mid-session → the whole session routes to
  `FAILED` exactly like the batch path (`engine.py`'s detector-unavailable
  branch and `context_stage_error` handling). All held buffers are destroyed.
- Latency overrun **degrades the decision** (→ `REVIEW_REQUIRED` / `BLOCKED`),
  never the validation depth. A turn that cannot be scanned in the latency
  budget does not skip scanning; the session is gated with the turn unscanned
  and reported as such (honest `executed_stages` accounting, as in
  `engine.py` today).
- No partial sanitized output exists anywhere before the gate: there is no
  incremental writer.

## 3. State machine

```
PENDING → SCANNED → HELD → RELEASED | REJECTED
```

- `PENDING`: turn received, not yet scanned.
- `SCANNED`: direct-PII detection + replacement plan computed for this turn
  (per-turn Presidio; GLiNER context detection stays session-wide — see
  §5).
- `HELD`: turn validated by the independent validator (`validator.py`
  second pass) against everything revealed so far; buffered in memory.
- `RELEASED`: **only at the session gate**, when `SafetyGate.decide`
  (`pipeline.py`) returns `RELEASE_CANDIDATE` on the aggregate report, and
  only then are the held turns written out together.
- `REJECTED`: gate returned `REVIEW_REQUIRED`/`BLOCKED`/`FAILED`; held turns
  are destroyed (never written), and the decision/report pair is the only
  output.

A failed stage transition aborts to `REJECTED` regardless of state.

## 4. API sketch

```python
class StreamSession:
    def __init__(self, session_meta: dict, policy: dict): ...
    def add_turn(self, text: str, speaker_id: str) -> TurnState: ...
    def asr_turn(self, wav_path: str) -> TurnState: ...
    def close(self) -> SessionResult: ...
```

- `add_turn` runs the per-turn stages (detect → plan replacement → validate
  the buffer) and returns the turn's state. It never emits sanitized text.
- `asr_turn` reuses `asr.py` (WhisperModel, confidence signals from #19) and
  `asr_transcript.transcript_from_asr`; partial-transcript handling is a §5
  risk.
- `close()` runs the session-level stages on the accumulated buffer — the
  GLiNER contextual pass with the #20 whole-turn windows
  (`engine._build_windows`), the combination rules (`context.py`), and where
  a stream-coordinator manages multiple live sessions, the cross-session
  linker (`linkage.py`) — then the session gate (`pipeline.SafetyGate.decide`)
  on the aggregate report. Output artifacts identical to batch.
- **Refactor needed in `engine.py`:** `process_transcript` is monolithic
  (detect → transform → context → validate → gate in one function over the
  full session). The streaming refactor must split per-turn stages from
  session-level stages without changing batch behavior; batch `run_pipeline`
  and the streaming `StreamSession` then share the same stage functions. The
  all-or-nothing batch semantics of #21 (`engine.run_pipeline` staging) are
  the natural in-memory analogue of HELD→RELEASED.

## 5. New risks

1. **Detection context spanning turn boundaries.** GLiNER spans that
   straddle turns are already counted, not dropped (`context_dropped_spans`,
   #20); in streaming, a turn boundary becomes a *time* boundary — the same
   span cannot be reassessed retroactively once later turns arrive, so
   session-wide detection must run at `close()` on the full buffer (the
   design keeps it there deliberately).
2. **Cumulative quasi-identifier linkage across incrementally revealed
   turns.** `COMBINATION_OF_CLUES` needs ≥2 categories across turns
   (`context.py`); the per-turn Presidio pass cannot see this, so a turn
   that scanned clean at arrival can still gate the session at close — the
   release semantics of §1 exist precisely so no per-turn "clean" is ever
   observable.
3. **ASR partial-transcript handling.** `asr.py` transcribes complete
   utterances; a live utterance may arrive incrementally. The design
   requires utterance-complete framing at the caller (VAD segmentation) —
   the pipeline itself never sees partial utterances; `asr_turn` accepts a
   finalized WAV only.
4. **Window overlap.** #20's 1200-char windows are per session; incremental
   arrival does not change windowing because windowing runs at close().
5. **Cross-session linkage for live sessions** (`linkage.py`, #23) needs a
   stream coordinator with a group key; out of PoC scope, named for the
   future milestone.
6. **Memory-bound hold buffers.** HELD buffers live in memory only; a
   session exceeding a bounded buffer (e.g. 50MB, mirroring the audio and
   batch input caps in `engine.run_pipeline`) aborts to REJECTED.

## 6. Negative scenarios (the future implementation must pass these)

1. **Validator drops mid-session** → every held turn is destroyed, nothing
   is released, session decision `FAILED` (`validator_unavailable`), no
   partial sanitized output on disk anywhere.
2. **PII turn is never emitted partially sanitised** — a probe consumer
   observing the stream sees no sanitized text before `close()`; the only
   mid-session observable is `TurnState` (state enum + counts), never text.
3. **Latency budget exceeded on a turn** → the session gates with the turn
   marked unscanned in the report; the decision degrades (REVIEW/BLOCKED),
   never to reduced validation.
4. **Cumulative combination attack**: two individually clean turns whose
   quasi-identifier categories combine (the §5 risk 2 pattern) still route
   the session to REVIEW at close even though every per-turn scan was clean.
5. **Hold buffer overflow** → session REJECTED (never silently truncated).
6. **Stream coordinator crash** → identical batch semantics: no session dirs
   exist without a full session gate (#21 staging analogue).

## Future work (out of this issue's scope)

- **(b) Per-turn conditional release**: a cumulative-risk release rule, its
  calibration harness, and a named live consumer with authentication. Extra
  risks vs (a): mid-session release surface, retroactive-identifiability of
  released turns, and a much harder false-RELEASE calibration (the #10
  baseline already shows 6 false-RELEASE vs 2 false-REVIEW in batch mode).
- Latency budgets: TBD pending the #9 (GLiNER load amortisation) and #13
  (ASR model latency) numbers; the profile in `docs/evidence/I9-S1/`
  (model load ~19s dominates; ~1s per session) suggests per-turn scanning
  is cheap but session-level GLiNER close-out is the latency bottleneck.
- Reference implementation: separate milestone, one slice per PR, same
  RED→GREEN→evidence rules as S0–S7.
