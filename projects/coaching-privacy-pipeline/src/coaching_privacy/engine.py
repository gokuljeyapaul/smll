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
        # Batch: one GLiNER inference call per session (all utterances joined),
        # then map global spans back to per-turn offsets. Cuts CPU cost by
        # the per-call overhead x utterance count.
        sep = "\n"
        offset_map = []  # (global_start, global_end, utterance_id, local_start)
        parts = []
        pos = 0
        for utt in transcript.utterances:
            parts.append(utt.text)
            offset_map.append((pos, pos + len(utt.text), utt.id))
            pos += len(utt.text) + len(sep)
        joined = sep.join(parts)
        all_spans = extractor.extract(joined) if joined.strip() else []
        entities_by_turn = {utt.id: [] for utt in transcript.utterances}
        context_spans_by_turn = {utt.id: [] for utt in transcript.utterances}
        for s in all_spans:
            for g_start, g_end, utt_id in offset_map:
                if s.start >= g_start and s.end <= g_end:
                    local = s.start - g_start
                    entry = {"label": s.label, "value": s.value, "start": local,
                             "end": local + (s.end - s.start),
                             "confidence": s.confidence, "detector": "gliner"}
                    entities_by_turn[utt_id].append(entry)
                    context_spans_by_turn[utt_id].append(entry)
                    break
        context_risks = RuleBasedContextRiskEngine().assess(entities_by_turn)
    except Exception as exc:
        context_error = f"context_stage_error: {exc}"

    # Independent validation (fail closed)
    validator = IndependentLeakValidator()
    try:
        validation = validator.validate(
            prohibited_leaks=prohibited_leaks or [],
            sanitized_utterances=sanitized_utterances,
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
            "all_mandatory_stages_executed": all_mandatory,
        },
        purpose=transcript.purpose,
    )
    report["executed_stages"] = sorted(executed_stages)
    report["mandatory_stages"] = sorted(mandatory_stages)
    report["review_reasons"] = decision["review_reasons"]
    return SessionResult(
        session_id=transcript.session_id,
        decision=decision,
        sanitized=sanitized,
        report=report,
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

    processed = 0
    with input_path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if args.session_id and record["transcript"]["session_id"] != args.session_id:
                continue
            transcript = Transcript.parse(record["transcript"])
            if transcript.purpose != args.policy:
                raise ContractError(
                    f"transcript purpose {transcript.purpose!r} does not match "
                    f"requested policy {args.policy!r}"
                )
            result = process_transcript(
                transcript, policy, prohibited_leaks=record.get("prohibited_leaks")
            )
            session_dir = output_dir / transcript.session_id
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
            processed += 1
            print(
                f"{transcript.session_id}: decision={result.decision['decision']} "
                f"leaks={len(result.report['residual_pii'])}"
            )
    if processed == 0:
        raise ContractError("no transcripts processed")
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
