"""S7 unit tests: batch adapters (JSON array / CSV) -> canonical transcript -> pipeline."""
import json
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def _transcript(session_id):
    return {
        "schema_version": "1.0",
        "session_id": session_id,
        "source_type": "synthetic_text",
        "purpose": "internal_coaching_analysis",
        "language": "en",
        "speakers": [{"id": "S1", "role": "COACH"}, {"id": "S2", "role": "CLIENT"}],
        "utterances": [
            {"id": "u1", "speaker_id": "S2", "start_ms": None, "end_ms": None,
             "text": "I want to lead better meetings."},
        ],
        "metadata": {"synthetic": True},
    }


def test_json_array_adapter(tmp_path):
    from coaching_privacy.batch import JSONBatchAdapter

    arr = [_transcript("s1"), _transcript("s2")]
    p = tmp_path / "batch.json"
    p.write_text(json.dumps(arr))
    adapter = JSONBatchAdapter()
    transcripts = list(adapter.read(str(p)))
    assert len(transcripts) == 2
    assert transcripts[0].session_id == "s1"
    assert transcripts[1].session_id == "s2"


def test_csv_adapter_flattens_utterances(tmp_path):
    from coaching_privacy.batch import CSVBatchAdapter

    csv_content = (
        "session_id,turn_index,speaker_role,utterance\n"
        "csv-1,0,COACH,How can I help?\n"
        "csv-1,1,CLIENT,I feel overwhelmed by my calendar.\n"
    )
    p = tmp_path / "batch.csv"
    p.write_text(csv_content)
    adapter = CSVBatchAdapter(purpose="internal_coaching_analysis")
    transcripts = list(adapter.read(str(p)))
    assert len(transcripts) == 1
    t = transcripts[0]
    assert t.session_id == "csv-1"
    assert len(t.utterances) == 2
    assert t.utterances[0].text == "How can I help?"
    assert t.utterances[1].text == "I feel overwhelmed by my calendar."
    # deterministic order by turn_index
    assert t.utterances[0].id == "u0" and t.utterances[1].id == "u1"


def test_malformed_batch_fails_closed(tmp_path):
    from coaching_privacy.batch import JSONBatchAdapter, BatchError

    p = tmp_path / "bad.json"
    p.write_text(json.dumps([{"broken": True}]))
    adapter = JSONBatchAdapter()
    try:
        list(adapter.read(str(p)))
    except BatchError:
        pass
    else:
        raise AssertionError("malformed batch entry accepted")


def test_empty_batch_is_reported_not_error(tmp_path):
    from coaching_privacy.batch import JSONBatchAdapter

    p = tmp_path / "empty.json"
    p.write_text("[]")
    adapter = JSONBatchAdapter()
    assert list(adapter.read(str(p))) == []
