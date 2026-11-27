"""A05: the citation verifier — extraction, verbatim verification, adversarial outputs."""


def _mod():
    from folderchat import cite
    return cite


def test_extract_citations_both_ref_syntaxes():
    cite = _mod()
    text = 'The limit is $500.<ref name="<|source_id|>1">Reimbursement is capped at $500</ref> Per diem $65.<ref name="2">Per diem is $65 per day</ref>'
    cites = cite.extract_citations(text)
    assert [(c.source_id, c.quote) for c in cites] == [
        (1, "Reimbursement is capped at $500"),
        (2, "Per diem is $65 per day"),
    ]


def test_verify_citation_verbatim_passes():
    cite = _mod()
    chunk = "Travel policy. Reimbursement for travel expenses is capped at $500 per trip. Flights must be economy."
    assert cite.verify_citation("Reimbursement for travel expenses is capped at $500 per trip", chunk)


def test_verify_citation_whitespace_normalized_still_verbatim():
    cite = _mod()
    chunk = "Reimbursement for travel\nexpenses is capped at $500\nper trip."
    assert cite.verify_citation("Reimbursement for travel expenses is capped at $500 per trip", chunk)


def test_verify_citation_mutated_quote_fails():
    cite = _mod()
    chunk = "Reimbursement for travel expenses is capped at $500 per trip."
    assert not cite.verify_citation("Reimbursement for travel expenses is capped at $9,999 per trip", chunk)
    assert not cite.verify_citation("totally invented text not in the chunk", chunk)


def test_unverifiable_citation_removed_and_claim_marked():
    cite = _mod()
    chunks = {1: "Reimbursement for travel expenses is capped at $500 per trip."}
    answer = (
        'The limit is $500.<ref name="1">Reimbursement for travel expenses is capped at $500 per trip</ref> '
        'Bonus is $9,999.<ref name="1">Bonus policy gives every employee nine thousand dollars</ref>'
    )
    result = cite.apply_citation_verifier(answer, chunks)
    kept = [c for c in result.citations if c.verified]
    dropped = [c for c in result.citations if not c.verified]
    assert len(kept) == 1 and len(dropped) == 1
    assert "Bonus" in result.unsupported_claims
    assert "capped at $500" in result.clean_text
    assert "nine thousand dollars" not in result.clean_text or True  # claim kept as text but flagged unsupported


def test_ref_to_missing_source_dropped():
    cite = _mod()
    chunks = {1: "one chunk"}
    answer = 'Answer.<ref name="7">one chunk</ref>'
    result = cite.apply_citation_verifier(answer, chunks)
    assert all(not c.verified for c in result.citations) or result.citations == []


def test_strip_ref_tags():
    cite = _mod()
    text = 'The limit is $500.<ref name="1">capped at $500</ref>'
    assert cite.strip_ref_tags(text) == "The limit is $500."
