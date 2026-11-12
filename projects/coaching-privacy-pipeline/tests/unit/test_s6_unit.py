"""S6 unit tests: provenance fields, logging audit, no-gold-leakage verification (A20, A21, A23)."""
import json
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def test_provenance_report_includes_all_fields():
    from coaching_privacy.audit import build_provenance

    prov = build_provenance(
        pipeline_version="0.6.0",
        dataset_seed=42,
        models={
            "detector": "presidio-analyzer",
            "nlp_backend": "en_core_web_sm",
            "context_extractor": "urchade/gliner_medium-v2.1",
            "asr": "tiny.en",
        },
        policy="internal_coaching_analysis",
    )
    # every artifact field the spec demands (A20)
    for key in ("pipeline_version", "dataset_seed", "models", "policy",
                "timestamp_utc", "host"):
        assert key in prov, key
    assert prov["models"]["context_extractor"] == "urchade/gliner_medium-v2.1"


def test_log_scanner_finds_pii_in_logs():
    from coaching_privacy.audit import scan_logs_for_pii

    logs = [
        "2026-11-12 processing session synthetic-42-0000",
        "DEBUG: raw text = 'My name is Mira Solen'",
        "DEBUG: replacement map {'Mira Solen': '<PERSON_1>'}",
    ]
    findings = scan_logs_for_pii(logs, prohibited=["Mira Solen"])
    assert len(findings) == 2, findings
    assert all("Mira Solen" in f["line"] for f in findings)


def test_log_scanner_clean_logs_pass():
    from coaching_privacy.audit import scan_logs_for_pii

    logs = ["processing session synthetic-42-0000", "decision=REVIEW_REQUIRED"]
    findings = scan_logs_for_pii(logs, prohibited=["Mira Solen"])
    assert findings == []


def test_gold_labels_never_in_release_artifacts():
    from coaching_privacy.audit import assert_no_gold_in_artifacts

    # sanitized + decision + report must never contain gold labels (A21)
    artifacts = {
        "sanitized.json": {"session_id": "x", "utterances": [{"id": "u1", "text": "hello"}]},
        "decision.json": {"decision": "RELEASE_CANDIDATE"},
        "validation_report.json": {"annotations": []},
    }
    gold_values = ["Mira Solen", "mira.solen@example.test"]
    assert_no_gold_in_artifacts(artifacts, gold_values)  # must not raise

    bad = dict(artifacts)
    bad["sanitized.json"] = {"utterances": [{"id": "u1", "text": "Mira Solen said hi"}]}
    try:
        assert_no_gold_in_artifacts(bad, gold_values)
    except AssertionError:
        pass
    else:
        raise AssertionError("gold value in release artifact not caught")
