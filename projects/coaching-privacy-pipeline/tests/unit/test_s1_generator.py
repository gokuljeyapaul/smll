"""S1 unit tests: deterministic fixture generation, gold spans, isolation (A03-A05)."""
import json
import pathlib
import subprocess

PROJECT = pathlib.Path(__file__).resolve().parents[2]
VENV_BIN = PROJECT / ".venv" / "bin"


def run_fixtures_cli(args):
    return subprocess.run(
        [str(VENV_BIN / "privacy-fixtures")] + args,
        capture_output=True, text=True,
    )


# --- determinism (A03) ---

def test_generate_same_seed_twice_is_byte_identical(tmp_path):
    out1 = tmp_path / "a.jsonl"
    out2 = tmp_path / "b.jsonl"
    r1 = run_fixtures_cli(["generate", "--seed", "42", "--sessions", "10", "--output", str(out1)])
    r2 = run_fixtures_cli(["generate", "--seed", "42", "--sessions", "10", "--output", str(out2)])
    assert r1.returncode == 0, r1.stderr
    assert r2.returncode == 0, r2.stderr
    assert out1.read_bytes() == out2.read_bytes()
    records = [json.loads(l) for l in out1.read_text().splitlines()]
    assert len(records) == 10
    for rec in records:
        assert rec["transcript"]["metadata"]["synthetic"] is True
    # no uncontrolled random ids: session ids derive from the seed
    ids = [rec["transcript"]["session_id"] for rec in records]
    assert len(set(ids)) == len(ids)


def test_generated_fixture_has_generator_version_and_seed(tmp_path):
    out = tmp_path / "dev.jsonl"
    r = run_fixtures_cli(["generate", "--seed", "42", "--sessions", "5", "--output", str(out)])
    assert r.returncode == 0, r.stderr
    rec = json.loads(out.read_text().splitlines()[0])
    meta = rec["transcript"]["metadata"]
    assert "generator_version" in rec
    assert meta["dataset_seed"] == 42


# --- gold span correctness (A04) ---

def test_every_gold_span_offset_matches_text(tmp_path):
    out = tmp_path / "dev.jsonl"
    run_fixtures_cli(["generate", "--seed", "42", "--sessions", "30", "--output", str(out)])
    for line in out.read_text().splitlines():
        rec = json.loads(line)
        utts = {u["id"]: u["text"] for u in rec["transcript"]["utterances"]}
        for span in rec["gold_spans"]:
            text = utts[span["utterance_id"]]
            assert text[span["start"]:span["end"]] == span["gold_value"], (
                f"{rec['fixture_id']} {span['utterance_id']}: "
                f"{text[span['start']:span['end']]!r} != {span['gold_value']!r}"
            )


def test_unicode_offsets_are_character_not_byte(tmp_path):
    out = tmp_path / "dev.jsonl"
    run_fixtures_cli(["generate", "--seed", "7", "--sessions", "30", "--output", str(out)])
    for line in out.read_text().splitlines():
        rec = json.loads(line)
        utts = {u["id"]: u["text"] for u in rec["transcript"]["utterances"]}
        for span in rec["gold_spans"]:
            text = utts[span["utterance_id"]]
            assert text[span["start"]:span["end"]] == span["gold_value"]


# --- persona isolation and directory (A05) ---

def test_dev_and_holdout_have_disjoint_personas(tmp_path):
    dev = tmp_path / "dev.jsonl"
    hold = tmp_path / "holdout.jsonl"
    run_fixtures_cli(["generate", "--seed", "42", "--sessions", "50", "--output", str(dev)])
    run_fixtures_cli(["generate", "--seed", "941", "--sessions", "100", "--output", str(hold), "--locked"])
    dev_subjects = {json.loads(l)["subject_id"] for l in dev.read_text().splitlines()}
    hold_subjects = {json.loads(l)["subject_id"] for l in hold.read_text().splitlines()}
    assert dev_subjects.isdisjoint(hold_subjects), "persona overlap between dev and holdout"


def test_directory_generation_deterministic_and_disjoint_from_gold(tmp_path):
    d1 = tmp_path / "d1.jsonl"
    d2 = tmp_path / "d2.jsonl"
    r1 = run_fixtures_cli(["directory", "--seed", "941", "--size", "60", "--output", str(d1)])
    r2 = run_fixtures_cli(["directory", "--seed", "941", "--size", "60", "--output", str(d2)])
    assert r1.returncode == 0 and r2.returncode == 0
    assert d1.read_bytes() == d2.read_bytes()
    assert len(d1.read_text().splitlines()) == 60


def test_scenario_families_covered(tmp_path):
    out = tmp_path / "dev.jsonl"
    run_fixtures_cli(["generate", "--seed", "42", "--sessions", "100", "--output", str(out)])
    families = {json.loads(l)["scenario_family"] for l in out.read_text().splitlines()}
    assert len(families) >= 12, f"expected >=12 scenario families, got {sorted(families)}"
