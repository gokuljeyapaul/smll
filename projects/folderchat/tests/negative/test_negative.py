"""Negative-path behaviour: bad inputs, limit refusals, timeout fallback. Fail-closed, specific reasons."""
import textwrap

import pytest


def test_question_over_limit_refused_with_specific_reason(cli, data_dir):
    """A24: a question just over 1000 chars is refused with the numbers, exit != 0."""
    r = cli(["ask", "x" * 1001])
    assert r.returncode != 0
    assert "1001" in (r.stdout + r.stderr)
    assert "1000" in (r.stdout + r.stderr)


def test_question_just_under_limit_accepted_length_check(cli, data_dir, corpus_path):
    """A24 boundary: exactly at the limit passes the length gate (may still say no sources)."""
    r = cli(["ask", "x" * 1000])
    # reaches the question handling (not refused for length); no sources yet -> honest error
    out = r.stdout + r.stderr
    assert "1001" not in out
    assert "too long" not in out.lower()


def test_out_of_range_limits_refused_at_cli_startup(cli, data_dir, tmp_path, monkeypatch):
    bad = tmp_path / "limits.yaml"
    bad.write_text(textwrap.dedent("""\
        max_question_chars: 100000
    """))
    monkeypatch.setenv("FOLDERCHAT_LIMITS", str(bad))
    r = cli(["ask", "hi"])
    assert r.returncode != 0
    assert "max_question_chars" in (r.stdout + r.stderr)


def test_add_missing_folder_fails_cleanly(cli, data_dir, tmp_path):
    r = cli(["add", str(tmp_path / "nope")])
    assert r.returncode != 0
    assert "not found" in (r.stdout + r.stderr).lower() or "no such" in (r.stdout + r.stderr).lower()


@pytest.mark.slow
def test_a24_timeout_falls_back_to_passage_mode(data_dir, corpus_path, load_engine):
    """A24: a timed-out answer falls back to 'find passages' mode with a visible notice."""

    from folderchat.config import data_dir as resolve_data_dir
    from folderchat.config import load_limits
    from folderchat.indexer import add_source

    add_source(str(corpus_path), load_limits(), data_dir=resolve_data_dir())
    engine = load_engine(timeout_s=0.05, n_threads=4)  # real model, impossible deadline
    from folderchat.retrieve import retrieve

    passages = retrieve("What is the travel reimbursement limit?", k=5, mode="hybrid", data_dir=resolve_data_dir())
    result = engine.ask("What is the travel reimbursement limit?", passages)
    assert result.timed_out is True
    assert result.not_found is True or result.answer_text == ""
    assert result.fallback_notice and "passage" in result.fallback_notice.lower()
    assert result.closest_passages, "fallback must show passages"
    del engine


@pytest.mark.slow
def test_a24_prompt_fits_context_and_drop_notice(load_engine, corpus_path):
    """A24: the assembled prompt fits the pinned model's real context with the answer budget
    reserved (asserted with the model's own tokenizer); dropped passages produce a notice."""
    long_text = "Reimbursement is capped at $500 per trip. " * 60
    passages = [{"text": long_text, "file": "a.md", "page": None, "heading": "Travel"}] * 12
    engine = load_engine(n_threads=4)
    assembled = engine.assemble_prompt("What is the travel reimbursement limit?", passages)
    budget = engine.token_count(assembled["prompt"]) + engine.reserved_answer_tokens
    assert budget <= engine.context_length, f"prompt {budget} > ctx {engine.context_length}"
    assert assembled["dropped"] >= 1, "with 12 over-long passages at least one must be dropped"
    assert assembled["dropped"] > 0
    assert "only" in assembled["notice"].lower() or "part" in assembled["notice"].lower()
    del engine
