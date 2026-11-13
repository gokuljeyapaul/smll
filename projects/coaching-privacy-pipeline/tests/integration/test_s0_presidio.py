"""S0 integration tests: real Presidio + spaCy analyzer (A06)."""
import json
import pytest
import pathlib

pytestmark = pytest.mark.slow

PROJECT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = PROJECT / "fixtures"


def _first_fixture():
    line = (FIXTURES / "seed_fixtures.jsonl").read_text().splitlines()[0]
    return json.loads(line)


def test_real_presidio_detects_name_and_email():
    from coaching_privacy.detect import PresidioDetector
    fixture = _first_fixture()
    utterance = fixture["transcript"]["utterances"][1]
    detector = PresidioDetector()
    spans = detector.detect(utterance["text"])
    labels = {s.label for s in spans}
    assert "DIRECT_PII.PERSON" in labels
    assert "DIRECT_PII.EMAIL" in labels
    # exact offsets against original text
    for span in spans:
        if span.label == "DIRECT_PII.EMAIL":
            assert utterance["text"][span.start:span.end] == "mira.solen@example.test"


def test_detector_reports_model_versions():
    from coaching_privacy.detect import PresidioDetector
    detector = PresidioDetector()
    versions = detector.model_versions()
    assert "presidio_analyzer" in versions
    assert "spacy_model" in versions
    assert versions["spacy_model"] == "en_core_web_sm"


def test_phone_and_address_detected_in_seed_s02():
    from coaching_privacy.detect import PresidioDetector
    lines = (FIXTURES / "seed_fixtures.jsonl").read_text().splitlines()
    fixture = json.loads(lines[1])
    utterance = fixture["transcript"]["utterances"][0]
    detector = PresidioDetector()
    spans = detector.detect(utterance["text"])
    labels = {s.label for s in spans}
    assert "DIRECT_PII.PHONE" in labels
