"""The BM25-top-passage extract baseline: extractive answer logic (pure, fast)."""


def test_best_sentences_selected():
    from folderchat.baseline import extract_key_sentences

    passages = [
        "The travel reimbursement limit is $500 per trip. Extra text about weather. More filler sentences here.",
        "Weather in Lisbon is mild. Nothing about expenses at all.",
    ]
    question = "What is the travel reimbursement limit?"
    sents = extract_key_sentences(question, passages, max_sentences=2)
    assert sents, "no sentences extracted"
    assert any("$500" in s for s in sents)


def test_baseline_answer_mode_returns_passages():
    from folderchat.baseline import passages_answer

    hit = {"text": "Reimbursement capped at $500 per trip.", "file": "p.md", "page": 1, "heading": None}
    result = passages_answer("limit", [hit])
    assert result["not_found"] is False
    assert result["passages"][0]["file"] == "p.md"
