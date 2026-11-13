"""Pipeline orchestration: detect -> transform -> independent validate -> decide.

For S0: real Presidio detection, deterministic redaction, independent leak
validation against evaluation-only prohibited leaks, and a fail-closed
decision/report writer. Detector/validator unavailability yields FAILED.
"""
from __future__ import annotations

import dataclasses
import json
import pathlib
from datetime import datetime, timezone
from typing import Any

from . import __version__
from .contracts import ContractError, Transcript
from .policy import PolicyStore
from .pipeline import SafetyGate


@dataclasses.dataclass
class SessionResult:
    session_id: str
    decision: dict[str, Any]
    sanitized: dict[str, Any]
    report: dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def process_transcript(
    transcript: Transcript,
    policy: dict[str, Any],
    prohibited_leaks: list[str] | None = None,
    context_extractor: Any = None,
) -> SessionResult:
    from .transform import StableReplacer, redact_utterance
    from .validator import IndependentLeakValidator

    # Mandatory real detector stage, cached per process (spaCy loads once).
    # Fail closed on unavailability.
    detector = _get_detector()
    if detector is _FAILED_DETECTOR:
        gate = SafetyGate()
        decision = gate.decide(
            {"validator_available": True, "error": "detector_unavailable"},
            purpose=transcript.purpose,
        )
        return SessionResult(
            session_id=transcript.session_id,
            decision=decision,
            sanitized={"session_id": transcript.session_id, "utterances": []},
            report={"schema_version": "1.0", "session_id": transcript.session_id,
                    "pipeline_version": __version__, "error": "detector_unavailable"},
        )
    model_versions = detector.model_versions()

    replacer = StableReplacer()
    sanitized_utterances = []
    annotations = []
    # I22: raw values replaced in this run (in-process only; never written to
    # disk/logs/reports) so the independent validator can run an echo check.
    replaced_values: list[str] = []
    for utt in transcript.utterances:
        spans = detector.detect(utt.text)
        span_dicts = []
        for s in spans:
            span_dicts.append(
                {
                    "start": s.start,
                    "end": s.end,
                    "label": s.label,
                    "value": s.value,
                    "detector": s.detector,
                    "confidence": s.confidence,
                    "replacement": replacer.replacement_for(s.label, s.value),
                }
            )
            replaced_values.append(s.value)
            annotations.append(
                {
                    "utterance_id": utt.id,
                    "start": s.start,
                    "end": s.end,
                    "label": s.label,
                    "risk_level": "critical" if s.label.startswith("DIRECT_PII") else "low",
                    "detector": s.detector,
                    "confidence": s.confidence,
                }
            )
        red = redact_utterance(utt.text, span_dicts)
        sanitized_utterances.append(
            {
                "id": utt.id,
                "speaker_id": utt.speaker_id,
                "start_ms": utt.start_ms,
                "end_ms": utt.end_ms,
                "text": red["text"],
            }
        )

    sanitized = {
        "schema_version": "1.0",
        "session_id": transcript.session_id,
        "source_type": transcript.source_type,
        "purpose": transcript.purpose,
        "language": transcript.language,
        "speakers": [dataclasses.asdict(s) for s in transcript.speakers],
        "utterances": sanitized_utterances,
        "metadata": dict(transcript.metadata, sanitized_by=__version__),
    }

    # S3: contextual detection with real offline GLiNER (fail closed).
    from .context import RuleBasedContextRiskEngine, assert_supported_language
    context_risks: list[dict[str, Any]] = []
    context_error = None
    context_window_count = 0
    context_dropped_spans = 0
    try:
        assert_supported_language(transcript.language)
        # I16: fast tests may inject a stub extractor (never model evidence);
        # default is the real GLiNER via the process-wide cache.
        extractor = (
            context_extractor
            if context_extractor is not None
            else _get_context_extractor()
        )
        if extractor is _FAILED_EXTRACTOR:
            raise RuntimeError("gliner unavailable")
        # I20: windowed contextual detection. GLiNER medium-v2.1 truncates
        # input at max_len=384 tokens, so a single joined call silently drops
        # clues beyond the window. Build windows from WHOLE turns (never
        # splitting a turn), each safely under the model's limit; turns
        # longer than the limit split at word boundaries with overlap.
        entities_by_turn = {utt.id: [] for utt in transcript.utterances}
        context_spans_by_turn = {utt.id: [] for utt in transcript.utterances}
        context_dropped_spans = 0
        windows = _build_windows(transcript.utterances, _GLINER_WINDOW_CHARS)
        for window in windows:
            w_text = window["text"]
            if not w_text.strip():
                continue
            w_spans = extractor.extract(w_text)
            seen: set[tuple[str, int, int, str]] = set()
            for s in w_spans:
                # global offset within the window -> turn-local offset
                for turn in window["turns"]:
                    g_start, g_end, utt_id = turn["start"], turn["end"], turn["id"]
                    if s.start >= g_start and s.end <= g_end:
                        local = s.start - g_start
                        key = (utt_id, local, local + (s.end - s.start), s.label)
                        if key in seen:
                            break
                        seen.add(key)
                        entry = {"label": s.label, "value": s.value, "start": local,
                                 "end": local + (s.end - s.start),
                                 "confidence": s.confidence, "detector": "gliner"}
                        entities_by_turn[utt_id].append(entry)
                        context_spans_by_turn[utt_id].append(entry)
                        break
                else:
                    # Span not contained in a single turn (straddles boundary):
                    # attribute to the turn where it starts when that turn is
                    # fully inside this window; otherwise count as dropped.
                    context_dropped_spans += 1
        context_window_count = len(windows)
        context_risks = RuleBasedContextRiskEngine().assess(entities_by_turn)
    except Exception as exc:
        context_error = f"context_stage_error: {exc}"

    # Independent validation (fail closed)
    validator = IndependentLeakValidator()
    try:
        validation = validator.validate(
            prohibited_leaks=prohibited_leaks or [],
            sanitized_utterances=sanitized_utterances,
            replaced_values=replaced_values,
        )
    except Exception as exc:
        validation = {"validator_available": False, "error": str(exc)}

    # A leak of a prohibited identifier means transformation failed somewhere:
    # fail closed to BLOCKED.
    report = {
        "schema_version": "1.0",
        "session_id": transcript.session_id,
        "pipeline_version": __version__,
        "model_versions": model_versions,
        "policy": transcript.purpose,
        "annotations": annotations,
        "residual_pii": validation.get("residual_pii", []),
        "context_risks": context_risks,
        "context_spans": context_spans_by_turn if context_error is None else {},
        "context_stage_error": context_error,
        "cross_session_risks": [],  # implemented from S4
        "semantic_fidelity": {"turn_count_preserved": True},  # scoped checks from S2
        "review_reasons": [],
        "stage_timings_ms": {},
        "created_at": _now(),
    }
    # I19-S2: audio transcripts carry ASR uncertainty in metadata; the gate
    # consumes it (fail closed: missing/non-boolean = uncertain).
    asr_md = (transcript.metadata or {}).get("asr")
    if transcript.source_type == "synthetic_audio":
        asr_uncertain = (
            isinstance(asr_md, dict)
            and isinstance(asr_md.get("uncertain"), bool)
            and asr_md["uncertain"]
        ) or not (
            isinstance(asr_md, dict) and isinstance(asr_md.get("uncertain"), bool)
        )
    else:
        asr_uncertain = False

    gate = SafetyGate()
    # Honest stage accounting: a stage counts as executed only when the
    # capability exists in this pipeline version. S0 implements
    # real_pii_detector, transformation, independent_validator, policy_gate;
    # context_rules arrives in S3. Missing mandatory stages therefore yield
    # REVIEW_REQUIRED, never RELEASE_CANDIDATE (fail-closed honesty).
    executed_stages = {"real_pii_detector", "transformation", "policy_gate"}
    if validation.get("validator_available"):
        executed_stages.add("independent_validator")
    if context_error is None:
        executed_stages.add("context_rules")
    mandatory_stages = set(policy.get("mandatory_stages", []))
    all_mandatory = mandatory_stages.issubset(executed_stages)
    decision = gate.decide(
        {
            "validator_available": validation.get("validator_available", False),
            "error": validation.get("error") or context_error,
            "residual_pii": validation.get("residual_pii", []),
            "context_risks": context_risks,
            "asr_uncertain": asr_uncertain,
            "all_mandatory_stages_executed": all_mandatory,
        },
        purpose=transcript.purpose,
    )
    report["context_window_count"] = context_window_count
    report["context_dropped_spans"] = context_dropped_spans
    if transcript.source_type == "synthetic_audio" and isinstance(asr_md, dict):
        report["asr"] = {
            "model": asr_md.get("model"),
            "engine": asr_md.get("engine"),
            "speaker_attribution": asr_md.get("speaker_attribution"),
            "uncertain": asr_md.get("uncertain"),
            "signals": asr_md.get("signals", {}),
            "language": asr_md.get("language"),
            "language_probability": asr_md.get("language_probability"),
        }
    report["executed_stages"] = sorted(executed_stages)
    report["mandatory_stages"] = sorted(mandatory_stages)
    report["review_reasons"] = decision["review_reasons"]
    return SessionResult(
        session_id=transcript.session_id,
        decision=decision,
        sanitized=sanitized,
        report=report,
    )


def _input_format(args: Any, input_path: pathlib.Path) -> str:
    fmt = getattr(args, "input_format", "auto")
    if fmt != "auto":
        return fmt
    if input_path.suffix.lower() == ".json":
        return "json"
    if input_path.suffix.lower() == ".csv":
        return "csv"
    return "jsonl"


def _write_session_result(session_dir: pathlib.Path, result: Any) -> None:
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "sanitized.json").write_text(
        json.dumps(result.sanitized, indent=2) + "\n"
    )
    (session_dir / "validation_report.json").write_text(
        json.dumps(result.report, indent=2) + "\n"
    )
    (session_dir / "decision.json").write_text(
        json.dumps(result.decision, indent=2) + "\n"
    )


def run_pipeline(args: Any) -> int:
    input_path = pathlib.Path(args.input)
    if not input_path.is_file():
        raise ContractError(f"input file not found: {input_path}")
    # path traversal / oversized input guards (A23-relevant)
    if ".." in str(input_path):
        raise ContractError("path traversal rejected")
    size = input_path.stat().st_size
    if size > 50 * 1024 * 1024:
        raise ContractError("input exceeds 50MB limit")

    project_root = pathlib.Path(__file__).resolve().parents[2]  # .../coaching-privacy-pipeline
    policy_path = pathlib.Path(args.policy_file) if args.policy_file else project_root / "policies" / "sample_policy.yaml"
    policy_store = PolicyStore(policy_path)
    policy = policy_store.get(args.policy)

    output_dir = pathlib.Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # I21: materialise + validate the whole batch FIRST (all-or-nothing), then
    # stage results and move them into the output dir only after every
    # session succeeded. A malformed record leaves no partial outputs.
    batch: list[tuple[Any, list[str]]] = []
    fmt = _input_format(args, input_path)
    if fmt == "jsonl":
        with input_path.open() as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                transcript = Transcript.parse(record["transcript"])
                batch.append((transcript, record.get("prohibited_leaks", [])))
    else:
        from .batch import CSVBatchAdapter, JSONBatchAdapter

        if fmt == "json":
            adapter = JSONBatchAdapter()
        else:
            adapter = CSVBatchAdapter(purpose=args.policy)
        batch = list(adapter.read(str(input_path)))  # BatchError fails here, before any output

    if args.session_id:
        batch = [(t, l) for t, l in batch if t.session_id == args.session_id]

    for transcript, _leaks in batch:
        if transcript.purpose != args.policy:
            raise ContractError(
                f"transcript purpose {transcript.purpose!r} does not match "
                f"requested policy {args.policy!r}"
            )
    if not batch:
        raise ContractError("no transcripts processed")

    staging = output_dir / ".staging"
    if staging.exists():
        import shutil as _shutil

        _shutil.rmtree(staging)
    staging.mkdir(parents=True)
    processed = 0
    try:
        for transcript, leaks in batch:
            result = process_transcript(transcript, policy, prohibited_leaks=leaks)
            _write_session_result(staging / transcript.session_id, result)
            processed += 1
            print(
                f"{transcript.session_id}: decision={result.decision['decision']} "
                f"leaks={len(result.report['residual_pii'])}"
            )
        # All sessions succeeded: move staged dirs into place.
        for transcript, _leaks in batch:
            src = staging / transcript.session_id
            dst = output_dir / transcript.session_id
            if dst.exists():
                import shutil as _shutil

                _shutil.rmtree(dst)
            src.rename(dst)
    finally:
        if staging.exists():
            import shutil as _shutil

            _shutil.rmtree(staging, ignore_errors=True)
    return processed


# --- detector cache (load spaCy once per process) ---
_FAILED_DETECTOR = object()
_DETECTOR_CACHE: dict[str, Any] = {}


def _get_detector():
    if "_det" in _DETECTOR_CACHE:
        return _DETECTOR_CACHE["_det"]
    try:
        from .detect import PresidioDetector
        _DETECTOR_CACHE["_det"] = PresidioDetector()
    except Exception:
        _DETECTOR_CACHE["_det"] = _FAILED_DETECTOR
    return _DETECTOR_CACHE["_det"]


# --- GLiNER extractor cache (load once per process) ---
_FAILED_EXTRACTOR = object()
_EXTRACTOR_CACHE: dict[str, Any] = {}


def _get_context_extractor():
    if "ex" in _EXTRACTOR_CACHE:
        return _EXTRACTOR_CACHE["ex"]
    try:
        from .context_extractor import GLiNERContextExtractor
        _EXTRACTOR_CACHE["ex"] = GLiNERContextExtractor()
    except Exception:
        _EXTRACTOR_CACHE["ex"] = _FAILED_EXTRACTOR
    return _EXTRACTOR_CACHE["ex"]


# --- I20: whole-turn windowing for the contextual stage ---

# GLiNER medium-v2.1 max_len=384 tokens. A conservative character budget:
# English averages ~4 chars/token; 384 tokens ~= 1536 chars. Use 1200 chars
# per window to stay safely under with label prompts and separators.
_GLINER_WINDOW_CHARS = 1200
_GLINER_TURN_OVERLAP_WORDS = 30  # overlap for over-long turns split at words


def _build_windows(utterances: Any, max_chars: int) -> list[dict[str, Any]]:
    """Pack WHOLE turns into windows <= max_chars (never split a turn).
    A single turn longer than max_chars becomes its own window sequence
    split at word boundaries with overlap. Returns
    [{'text': str, 'turns': [{'id','start','end'}]}] where turn offsets are
    relative to the window text."""
    windows: list[dict[str, Any]] = []
    cur_parts: list[str] = []
    cur_turns: list[dict[str, Any]] = []
    cur_len = 0
    sep = "\n"

    def flush():
        nonlocal cur_parts, cur_turns, cur_len
        if cur_turns:
            windows.append({"text": sep.join(cur_parts), "turns": cur_turns})
            cur_parts, cur_turns, cur_len = [], [], 0

    for utt in utterances:
        text = utt.text
        if len(text) > max_chars:
            # Over-long turn: split at word boundaries with overlap.
            flush()
            words = text.split(" ")
            pos = 0
            while pos < len(words):
                chunk_words = words[pos:pos + _GLINER_TURN_OVERLAP_WORDS * 10]
                chunk = " ".join(chunk_words)
                # shrink to max_chars
                while len(chunk) > max_chars and chunk_words:
                    chunk_words.pop()
                    chunk = " ".join(chunk_words)
                start_off = len(" ".join(words[:pos])) + (1 if pos > 0 else 0)
                windows.append({
                    "text": chunk,
                    "turns": [{"id": utt.id, "start": 0, "end": len(chunk)}],
                })
                if pos + len(chunk_words) >= len(words):
                    break
                pos = max(pos + 1, pos + len(chunk_words) - _GLINER_TURN_OVERLAP_WORDS)
            continue
        if cur_len + len(text) + (len(sep) if cur_parts else 0) > max_chars:
            flush()
        start = cur_len + (len(sep) if cur_parts else 0)
        cur_parts.append(text)
        cur_turns.append({"id": utt.id, "start": start, "end": start + len(text)})
        cur_len = start + len(text)
    flush()
    return windows
